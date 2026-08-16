import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { isValidDate } from '@/lib/utils';

const number = (value: unknown) => Number(value) || 0;
function bucketFor(days: number) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/** Historical AR/AP aging based on allocations dated on or before asOf. */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'financial_reports', 'read');
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
    if (!['ar', 'ap'].includes(type)) return error('نوع التعمر يجب أن يكون ar أو ap');
    if (!isValidDate(asOf)) return error('تاريخ asOf غير صالح');

    const { data, error: queryError } = await getSupabase().rpc('get_aging_by_contact', {
      p_company_id: auth.companyId, p_type: type, p_as_of: asOf,
    });
    if (queryError) throw queryError;
    const aging = (data || []).map((row: any) => {
      const openInvoices = number(row.open_amount);
      const unapplied = number(row.unapplied);
      const days = number(row.max_days_overdue);
      return {
        id: row.contact_id, name: row.contact_name,
        ...(type === 'ar' ? { open_invoices: openInvoices, unapplied } : {}),
        balance: openInvoices - (type === 'ar' ? unapplied : 0),
        last_invoice_date: row.last_invoice_date, days_overdue: days, bucket: bucketFor(days),
        buckets: {
          '0-30': number(row.bucket_0_30), '31-60': number(row.bucket_31_60),
          '61-90': number(row.bucket_61_90), '90+': number(row.bucket_90_plus),
        },
      };
    }).sort((a: any, b: any) => b.balance - a.balance);
    const totals = aging.reduce((acc: any, row: any) => {
      acc.balance += row.balance;
      if (type === 'ar') {
        acc.open_invoices += row.open_invoices;
        acc.unapplied += row.unapplied;
      }
      for (const bucket of ['0-30', '31-60', '61-90', '90+']) acc[bucket] += row.buckets[bucket];
      return acc;
    }, { balance: 0, open_invoices: 0, unapplied: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });
    return success({ aging, totals, type, asOf });
  } catch (err) {
    return handleApiError(err);
  }
}
