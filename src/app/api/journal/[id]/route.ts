import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
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
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data: entryRes, error: entryErr } = await s.from('journal_entries')
      .select('id, company_id, number, date, type, description, reference, created_by, created_at')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
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
      .eq('journal_entry_id', id);
    
    if (lErr) {
      console.error('Error deleting journal lines:', lErr);
      throw lErr;
    }

    // حذف القيد نفسه
    const { error: jeErr } = await s.from('journal_entries')
      .delete()
      .eq('id', id);
    
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
