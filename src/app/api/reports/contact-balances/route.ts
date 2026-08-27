import { NextRequest } from 'next/server';
import { success, error, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

import type { Row } from '@/lib/types';

const number = (value: unknown) => Number(value) || 0;

/** Auxiliary customer/supplier ledger, aggregated without API row limits. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'reports', 'read');
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'all';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!['all', 'client', 'supplier'].includes(type)) return error('نوع الطرف غير صالح');
    if ((from && !isValidDate(from)) || (to && !isValidDate(to)) || (from && to && from > to)) return error('فترة التقرير غير صالحة');

    const { data, error: queryError } = await getSupabase().rpc('get_contact_balances', {
      p_company_id: auth.companyId, p_type: type, p_from: from, p_to: to,
    });
    if (queryError) throw queryError;
    const contacts = ((data ?? []) as Row[]).map((row: Row) => {
      const closing = number(row.closing);
      return {
        id: row.contact_id, name: row.name,
        type: row.contact_type === 'client' ? 'عميل'
          : row.contact_type === 'supplier' ? 'مورد'
            : row.contact_type === 'subcontractor' ? 'مقاول باطن' : 'عميل ومورد',
        phone: row.phone || '—', tax_number: row.tax_number || '—',
        opening_balance: number(row.opening), period_debit: number(row.period_debit),
        period_credit: number(row.period_credit), closing_balance: closing,
        balance_type: closing >= 0 ? 'مدين' : 'دائن',
      };
    });
    const totals = contacts.reduce((acc: Record<string, number>, row) => ({
      opening: acc.opening + row.opening_balance,
      debit: acc.debit + row.period_debit,
      credit: acc.credit + row.period_credit,
      closing: acc.closing + row.closing_balance,
    }), { opening: 0, debit: 0, credit: 0, closing: 0 });
    return success({ contacts, totals, type, count: contacts.length, period: { from, to } });
  } catch (err) {
    return handleApiError(err);
  }
}
