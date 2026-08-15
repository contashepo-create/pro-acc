import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { loadCustodyFile, assertFileOpen, resolveCustodyAccounts, round2 } from '@/lib/custody';

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
    if (!amount || amount <= 0) return error('المبلغ يجب أن يكون موجباً');
    if (!description) return error('بيان المصروف مطلوب');

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return error('التاريخ غير صالح');
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

    if (body.invoice_id && body.purchase_invoice_id) return error('حدد مستنداً واحداً فقط');
    const { data: updated, error: rpcErr } = await s.rpc('post_custody_expense', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: date,
      p_amount: amount,
      p_description: description,
      p_expense_account_id: expenseAccountId,
      p_project_id: projectId,
      p_allow_excess: allowExcess,
      p_invoice_id: body.invoice_id || null,
      p_purchase_invoice_id: body.purchase_invoice_id || null,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    const result = updated as Record<string,any>;
    return success({
      ...result,
      message: Number(result.excess)>0
        ? `خُصم ${result.applied_from_custody} من الملف وسُجّل ${result.excess} مستحقاً للموظف`
        : `خُصم ${result.applied_from_custody} من الملف دون تكرار الصرف`,
    },201);
  } catch (err) {
    return handleApiError(err);
  }
}
