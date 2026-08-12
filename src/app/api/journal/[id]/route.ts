import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

// الجداول التي تشير إلى journal_entries
const REFERENCING_TABLES = [
  { table: 'voucher_receipts', name: 'سند قبض' },
  { table: 'voucher_disbursements', name: 'سند صرف' },
  { table: 'custodies', name: 'عهدة' },
  { table: 'custody_settlements', name: 'تسوية عهدة' },
  { table: 'custody_deposits', name: 'إيداع عهدة' },
  { table: 'invoices', name: 'فاتورة' },
  { table: 'purchase_invoices', name: 'فاتورة شراء' },
  { table: 'employee_advances', name: 'سلفة موظف' },
  { table: 'salary_sheets', name: 'كشف رواتب' },
  { table: 'fixed_assets', name: 'أصل ثابت' },
  { table: 'inventory_transactions', name: 'حركة مخزون' },
];

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'read');
    const { id } = await paramsPromise;
    const s = sb();

    // Do NOT select a non-existent `reference` column — the schema uses
    // reference_type / reference_id. A failed GET left the edit form empty.
    let entryRes: any = null;
    let entryErr: any = null;
    const primary = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference_type, reference_id, created_by, created_at')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    entryRes = primary.data;
    entryErr = primary.error;

    if (entryErr) {
      const fallback = await s.from('journal_entries')
        .select('id, company_id, number, date, type, description, created_by, created_at')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      entryRes = fallback.data;
      entryErr = fallback.error;
    }
    if (entryErr || !entryRes) return notFound();

    const { data: linesRes } = await s.from('journal_lines')
      .select('id, account_code, accounts(name, type), debit, credit, description')
      .eq('journal_entry_id', id).order('id');

    const lines = (linesRes || []).map((l: any) => ({
      id: l.id, account_code: l.account_code, account_name: (l.accounts as any)?.name || null,
      account_type: (l.accounts as any)?.type || null, debit: parseFloat(l.debit) || 0,
      credit: parseFloat(l.credit) || 0, description: l.description,
    }));

    const totalDebit = lines.reduce((s: number, l: any) => s + l.debit, 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + l.credit, 0);

    return success({ ...entryRes, totalDebit, totalCredit, lines });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'journal', 'update');
    const { id } = await paramsPromise;
    const s = sb();
    const body = await request.json();

    const { data: existing } = await s.from('journal_entries')
      .select('id, number')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();

    for (const ref of REFERENCING_TABLES) {
      try {
        const { data: refs } = await s.from(ref.table)
          .select('id').eq('journal_entry_id', id).limit(1);
        if (refs && refs.length > 0) {
          return error(`لا يمكن تعديل قيد مرتبط بـ: ${ref.name}`);
        }
      } catch { /* table/column may not exist */ }
    }

    const { journalEntrySchema } = await import('@/lib/validation');
    const parsed = journalEntrySchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { date, type, description, lines } = parsed.data;
    const resolved: Array<{ account_id: string; debit: number; credit: number; description: string | null }> = [];
    for (const line of lines) {
      const { findAccountByCode } = await import('@/lib/account-code');
      const account = await findAccountByCode(s, auth.companyId, line.accountCode);
      if (!account) return error(`الحساب برمز ${line.accountCode} غير موجود`);
      resolved.push({
        account_id: account.id,
        debit: line.debit,
        credit: line.credit,
        description: line.description || null,
      });
    }

    const { error: updErr } = await s.from('journal_entries')
      .update({ date, type, description: description || null })
      .eq('id', id).eq('company_id', auth.companyId);
    if (updErr) throw updErr;

    const { error: delErr } = await s.from('journal_lines').delete().eq('journal_entry_id', id);
    if (delErr) throw delErr;

    const { insertJournalLines } = await import('@/lib/journal-utils');
    const { error: linesErr } = await insertJournalLines(auth.companyId, resolved.map((l) => ({
      journal_entry_id: id,
      account_id: l.account_id,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })));
    if (linesErr) throw linesErr;

    return success({ id, number: existing.number, date, type, description });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await paramsPromise;
    const s = sb();

    // التحقق من وجود القيد
    const { data: entryRes } = await s.from('journal_entries')
      .select('id, number, date, type, description')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    
    if (!entryRes) return notFound();

    // التحقق من وجود قيود عكسية
    const { data: reversalRes } = await s.from('journal_entries')
      .select('id')
      .eq('reference', id)
      .eq('company_id', auth.companyId)
      .limit(1);
    
    if (reversalRes && reversalRes.length > 0) {
      return error('لا يمكن حذف قيد له قيود عكسية. قم بحذف القيود العكسية أولاً');
    }

    // التحقق من وجود سجلات مرتبطة في الجداول الأخرى
    const references: string[] = [];
    
    for (const ref of REFERENCING_TABLES) {
      try {
        const { data: refs } = await s.from(ref.table)
          .select('id')
          .eq('journal_entry_id', id)
          .limit(1);
        
        if (refs && refs.length > 0) {
          references.push(ref.name);
        }
      } catch {
        // الجدول قد لا يحتوي على هذا العمود - تجاهل
      }
    }

    if (references.length > 0) {
      return error(`لا يمكن حذف هذا القيد لأنه مرتبط بـ: ${references.join('، ')}. قم بحذف السجلات المرتبطة أولاً أو قم بتصفير تأثير القيد يدوياً`);
    }

    // حذف سطور القيد أولاً
    const { error: lErr } = await s.from('journal_lines')
      .delete()
      .eq('journal_entry_id', id)
      .eq('company_id', auth.companyId);
    
    if (lErr) {
      console.error('Error deleting journal lines:', lErr);
      throw lErr;
    }

    // حذف القيد نفسه
    const { error: jeErr } = await s.from('journal_entries')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);
    
    if (jeErr) {
      console.error('Error deleting journal entry:', jeErr);
      throw jeErr;
    }

    return success({ message: 'تم حذف القيد بنجاح' });
  } catch (err) {
    console.error('Journal DELETE error:', err);
    return handleApiError(err);
  }
}
