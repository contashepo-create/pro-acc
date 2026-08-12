import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';
import {
  loadCustodyFile, assertFileOpen, resolveCustodyAccounts, recordCustodyTx, syncCustodyTotals, round2,
} from '@/lib/custody';

/**
 * إثبات مصروف من ملف العهدة:
 * مدين المصروف / دائن 1150 حتى رصيد الملف.
 * الزيادة (إن allow_excess) دائن 2140 مستحق للموظف — لا يُصرف نقداً مرة ثانية.
 *
 * يدعم مصروفاً عاماً أو تشغيلياً بلا فاتورة مورد:
 * - expense_account_code: حساب المصروف (افتراضي 5100 تكلفة مباشرة؛
 *   5110–5140 تكلفة مشروع، 5200/5300/5400 مصروفات تشغيلية/عمومية للشركة).
 * - project_id: تجاوز مشروع الملف بمشروع آخر (يُتحقق من ملكيته للشركة).
 * - link_to_project: false → مصروف على مستوى الشركة دون ربطه بأي مشروع.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'update');
    const { id } = await params;
    const body = await parseBody(request);
    const amount = round2(parseFloat(body.amount));
    const description = String(body.description || '').trim();
    const date = body.date || new Date().toISOString().split('T')[0];
    const expenseCode = body.expense_account_code || ACCOUNT_CODES.DIRECT_COSTS;
    const allowExcess = body.allow_excess === true;
    const invoiceId = body.invoice_id || body.purchase_invoice_id || null;

    if (!amount || amount <= 0) return error('المبلغ يجب أن يكون موجباً');
    if (!description) return error('بيان المصروف مطلوب');

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    const remaining = file.remaining_amount;
    if (amount > remaining + 0.005 && !allowExcess) {
      return error(`المبلغ أكبر من المتبقي في الملف (${remaining}). فعّل السماح بالزيادة إن أنفق الموظف من ماله`);
    }

    const fromCustody = round2(Math.min(amount, remaining));
    const excess = round2(Math.max(0, amount - remaining));

    const s = getSupabase();

    // ربط المشروع: الافتراضي مشروع الملف، يمكن تجاوزه بمشروع آخر أو فكه
    // (مصروف تشغيلي للشركة نفسها دون مشروع).
    let projectId: string | null = file.project_id;
    if (body.link_to_project === false) {
      projectId = null;
    } else if (body.project_id) {
      const { data: proj } = await s.from('projects').select('id').eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!proj) return error('المشروع غير موجود', 404);
      projectId = proj.id;
    }

    const acc = await resolveCustodyAccounts(auth.companyId);
    const { data: expAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', expenseCode).maybeSingle();
    const expenseAccountId = expAcc?.id || acc.defaultExpenseId;
    if (!expenseAccountId) return error('حساب المصروف غير موجود');

    if (invoiceId) {
      const { data: linked } = await s.from('custody_invoices')
        .select('id').eq('custody_id', id).or(`invoice_id.eq.${invoiceId},purchase_invoice_id.eq.${invoiceId}`).maybeSingle();
      if (linked) return error('هذا المستند مربوط بهذا الملف مسبقاً');
    }

    const lines: Array<{ account_id: string; debit: number; credit: number; description: string; project_id?: string | null }> = [
      { account_id: expenseAccountId, debit: amount, credit: 0, description, project_id: projectId },
    ];
    if (fromCustody > 0) {
      lines.push({
        account_id: acc.custodyId, debit: 0, credit: fromCustody,
        description: `خصم من ملف ${file.file_number || id}`,
      });
    }
    if (excess > 0) {
      if (!acc.accruedId) return error('حساب الرواتب المستحقة (2140) مطلوب لتسجيل زيادة العهدة');
      lines.push({
        account_id: acc.accruedId, debit: 0, credit: excess,
        description: `زيادة عهدة — مستحق للموظف`,
      });
    }

    const { journalId, error: jeErr } = await createJournalEntry(auth.companyId, {
      date, type: 'general',
      description: `مصروف من عهدة ${file.file_number || ''}: ${description}`,
      reference_type: 'custody_expense',
      reference_id: id,
      created_by: auth.userId,
      lines,
    });
    if (jeErr || !journalId) throw jeErr || new Error('فشل قيد المصروف');

    if (fromCustody > 0) {
      await recordCustodyTx(auth.companyId, id, 'expense', fromCustody, description, auth.userId, {
        reference_type: invoiceId ? 'invoice' : 'general',
        reference_id: invoiceId,
      });
    }
    if (excess > 0) {
      await recordCustodyTx(auth.companyId, id, 'adjustment', excess, `زيادة: ${description}`, auth.userId);
      try {
        await s.from('employee_advances').insert({
          company_id: auth.companyId,
          employee_id: file.employee_id,
          date,
          type: 'custody_surplus',
          amount: excess,
          description: `زيادة عهدة ${file.file_number || id}`,
          custody_id: id,
        });
      } catch { /* أعمدة اختيارية */ }
    }
    if (invoiceId) {
      try {
        await s.from('custody_invoices').insert({
          company_id: auth.companyId,
          custody_id: id,
          invoice_id: body.invoice_id || null,
          purchase_invoice_id: body.purchase_invoice_id || null,
          amount,
          description,
        });
      } catch { /* اختياري */ }
    }

    const updated = await syncCustodyTotals(auth.companyId, id);
    return success({
      ...updated,
      journal_entry_id: journalId,
      applied_from_custody: fromCustody,
      excess,
      message: excess > 0
        ? `خُصم ${fromCustody} من الملف وسُجّل ${excess} مستحقاً للموظف`
        : `خُصم ${fromCustody} من الملف دون تكرار الصرف`,
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
