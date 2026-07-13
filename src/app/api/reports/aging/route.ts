import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || new Date().toISOString().split('T')[0];
    const s = sb();

    if (type === 'ar') {
      const { data: account } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_RECEIVABLE)
        .maybeSingle();

      if (!account) return success({ aging: [] });

      // Get contacts with balances
      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId);

      const jeIdList = (jeIds || []).map((je: any) => je.id);

      const { data: contacts } = await s.from('contacts')
        .select('id, name')
        .eq('company_id', auth.companyId)
        .in('type', ['client', 'both'])
        .eq('is_active', true)
        .order('name');

      const aging: any[] = [];
      for (const c of (contacts || [])) {
        if (jeIdList.length === 0) continue;

        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('contact_id', c.id)
          .in('journal_entry_id', jeIdList);

        const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
        const balance = totalDebit - totalCredit;

        if (balance <= 0) continue;

        const { data: lastInvoice } = await s.from('invoices')
          .select('date')
          .eq('contact_id', c.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastDate = lastInvoice?.date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';

        aging.push({ id: c.id, name: c.name, balance, last_invoice_date: lastDate, days_overdue: Math.max(0, daysDiff), bucket });
      }

      return success({ aging, type: 'ar', asOf });
    }

    if (type === 'ap') {
      const { data: account } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE)
        .maybeSingle();

      if (!account) return success({ aging: [] });

      const { data: jeIds } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId);

      const jeIdList = (jeIds || []).map((je: any) => je.id);

      const { data: contacts } = await s.from('contacts')
        .select('id, name')
        .eq('company_id', auth.companyId)
        .in('type', ['supplier', 'both'])
        .eq('is_active', true)
        .order('name');

      const aging: any[] = [];
      for (const c of (contacts || [])) {
        if (jeIdList.length === 0) continue;

        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('contact_id', c.id)
          .in('journal_entry_id', jeIdList);

        const totalDebit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: any) => sum + (parseFloat(l.credit) || 0), 0);
        const balance = totalCredit - totalDebit;

        if (balance <= 0) continue;

        const { data: lastInvoice } = await s.from('purchase_invoices')
          .select('date')
          .eq('supplier_id', c.id)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastDate = lastInvoice?.date || asOf;
        const daysDiff = Math.floor((new Date(asOf).getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
        let bucket = '90+';
        if (daysDiff <= 30) bucket = '0-30';
        else if (daysDiff <= 60) bucket = '31-60';
        else if (daysDiff <= 90) bucket = '61-90';

        aging.push({ id: c.id, name: c.name, balance, last_invoice_date: lastDate, days_overdue: Math.max(0, daysDiff), bucket });
      }

      return success({ aging, type: 'ap', asOf });
    }

    return error('Invalid aging type. Use "ar" or "ap"');
  } catch (err) {
    return handleApiError(err);
  }
}
