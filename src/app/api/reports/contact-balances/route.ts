import { NextRequest } from 'next/server';
import { success, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * Customer & Supplier Balances Summary (ميزان مراجعة مساعد - كشف أرصدة العملاء والموردين)
 * Shows each contact's Opening Balance, Period Debits, Period Credits, and Closing Balance.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const s = sb();
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all'; // 'client', 'supplier', 'all'
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let contactsQuery = s.from('contacts')
      .select('id, name, type, phone, tax_number, commercial_registration')
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .order('name');

    if (type === 'client') contactsQuery = contactsQuery.in('type', ['client', 'both']);
    if (type === 'supplier') contactsQuery = contactsQuery.in('type', ['supplier', 'both']);

    const { data: contacts } = await contactsQuery;
    const contactIds = (contacts || []).map((c: any) => c.id);

    if (contactIds.length === 0) {
      return success({ contacts: [], totals: { opening: 0, debit: 0, credit: 0, closing: 0 } });
    }

    // 1. Opening balances (prior to 'from' date)
    const openingMap = new Map<string, number>();
    if (from) {
      const { data: priorJEs } = await s.from('journal_entries')
        .select('id')
        .eq('company_id', auth.companyId)
        .lt('date', from)
        .is('deleted_at', null);

      const priorJeIds = (priorJEs || []).map((j: any) => j.id);
      if (priorJeIds.length > 0) {
        const { data: priorLines } = await s.from('journal_lines')
          .select('contact_id, debit, credit')
          .eq('company_id', auth.companyId)
          .in('contact_id', contactIds)
          .in('journal_entry_id', priorJeIds);

        for (const l of priorLines || []) {
          if (!l.contact_id) continue;
          const debit = parseFloat(l.debit) || 0;
          const credit = parseFloat(l.credit) || 0;
          openingMap.set(l.contact_id, (openingMap.get(l.contact_id) || 0) + debit - credit);
        }
      }
    }

    // 2. Period transactions (between 'from' and 'to')
    let periodQuery = s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId)
      .is('deleted_at', null);

    if (from) periodQuery = periodQuery.gte('date', from);
    if (to) periodQuery = periodQuery.lte('date', to);

    const { data: periodJEs } = await periodQuery;
    const periodJeIds = (periodJEs || []).map((j: any) => j.id);

    const periodDebitMap = new Map<string, number>();
    const periodCreditMap = new Map<string, number>();

    if (periodJeIds.length > 0) {
      const { data: periodLines } = await s.from('journal_lines')
        .select('contact_id, debit, credit')
        .eq('company_id', auth.companyId)
        .in('contact_id', contactIds)
        .in('journal_entry_id', periodJeIds);

      for (const l of periodLines || []) {
        if (!l.contact_id) continue;
        const debit = parseFloat(l.debit) || 0;
        const credit = parseFloat(l.credit) || 0;
        periodDebitMap.set(l.contact_id, (periodDebitMap.get(l.contact_id) || 0) + debit);
        periodCreditMap.set(l.contact_id, (periodCreditMap.get(l.contact_id) || 0) + credit);
      }
    }

    const rows = (contacts || []).map((c: any) => {
      const opening = openingMap.get(c.id) || 0;
      const debit = periodDebitMap.get(c.id) || 0;
      const credit = periodCreditMap.get(c.id) || 0;
      const closing = opening + debit - credit;

      return {
        id: c.id,
        name: c.name,
        type: c.type === 'client' ? 'عميل' : c.type === 'supplier' ? 'مورد' : 'عميل ومورد',
        phone: c.phone || '—',
        tax_number: c.tax_number || '—',
        opening_balance: opening,
        period_debit: debit,
        period_credit: credit,
        closing_balance: closing,
        balance_type: closing >= 0 ? 'مدين (له)' : 'دائن (عليه)',
      };
    }).filter((r) => r.opening_balance !== 0 || r.period_debit !== 0 || r.period_credit !== 0 || r.closing_balance !== 0);

    const totals = rows.reduce((acc, r) => {
      acc.opening += r.opening_balance;
      acc.debit += r.period_debit;
      acc.credit += r.period_credit;
      acc.closing += r.closing_balance;
      return acc;
    }, { opening: 0, debit: 0, credit: 0, closing: 0 });

    return success({ contacts: rows, totals, type, count: rows.length });
  } catch (err) {
    return handleApiError(err);
  }
}
