import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

function bucketFor(days: number) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('to') || new Date().toISOString().split('T')[0];
    const s = sb();
    const asOfTime = new Date(asOf).getTime();

    if (type === 'ar') {
      const { data: invoices } = await s.from('invoices')
        .select('id, number, contact_id, date, due_date, total, paid_amount, status, contacts(name)')
        .eq('company_id', auth.companyId)
        .neq('status', 'cancelled')
        .neq('status', 'paid');

      const byContact = new Map<string, any>();
      for (const inv of invoices || []) {
        const total = parseFloat(inv.total) || 0;
        const paid = parseFloat(inv.paid_amount) || 0;
        const remaining = Math.max(0, total - paid);
        if (remaining <= 0) continue;

        const due = inv.due_date || inv.date || asOf;
        const days = Math.max(0, Math.floor((asOfTime - new Date(due).getTime()) / 86400000));
        const bucket = bucketFor(days);
        const key = inv.contact_id || inv.id;

        if (!byContact.has(key)) {
          byContact.set(key, {
            id: key,
            name: (inv as any).contacts?.name || 'عميل',
            balance: 0,
            last_invoice_date: inv.date,
            days_overdue: days,
            bucket,
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        const row = byContact.get(key);
        row.balance += remaining;
        row.buckets[bucket] += remaining;
        if (days > row.days_overdue) {
          row.days_overdue = days;
          row.bucket = bucket;
        }
        if (inv.date && (!row.last_invoice_date || inv.date > row.last_invoice_date)) {
          row.last_invoice_date = inv.date;
        }
      }

      const aging = [...byContact.values()].sort((a, b) => b.balance - a.balance);
      const totals = aging.reduce((acc, r) => {
        acc.balance += r.balance;
        acc['0-30'] += r.buckets['0-30'];
        acc['31-60'] += r.buckets['31-60'];
        acc['61-90'] += r.buckets['61-90'];
        acc['90+'] += r.buckets['90+'];
        return acc;
      }, { balance: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

      return success({ aging, totals, type: 'ar', asOf });
    }

    if (type === 'ap') {
      const { data: invoices } = await s.from('purchase_invoices')
        .select('id, number, supplier_id, date, due_date, total, paid_amount, status, contacts:supplier_id(name)')
        .eq('company_id', auth.companyId)
        .neq('status', 'cancelled')
        .neq('status', 'paid');

      const byContact = new Map<string, any>();
      for (const inv of invoices || []) {
        const total = parseFloat(inv.total) || 0;
        const paid = parseFloat(inv.paid_amount) || 0;
        const remaining = Math.max(0, total - paid);
        if (remaining <= 0) continue;

        const due = inv.due_date || inv.date || asOf;
        const days = Math.max(0, Math.floor((asOfTime - new Date(due).getTime()) / 86400000));
        const bucket = bucketFor(days);
        const key = inv.supplier_id || inv.id;

        if (!byContact.has(key)) {
          byContact.set(key, {
            id: key,
            name: (inv as any).contacts?.name || 'مورد',
            balance: 0,
            last_invoice_date: inv.date,
            days_overdue: days,
            bucket,
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        const row = byContact.get(key);
        row.balance += remaining;
        row.buckets[bucket] += remaining;
        if (days > row.days_overdue) {
          row.days_overdue = days;
          row.bucket = bucket;
        }
      }

      const aging = [...byContact.values()].sort((a, b) => b.balance - a.balance);
      const totals = aging.reduce((acc, r) => {
        acc.balance += r.balance;
        acc['0-30'] += r.buckets['0-30'];
        acc['31-60'] += r.buckets['31-60'];
        acc['61-90'] += r.buckets['61-90'];
        acc['90+'] += r.buckets['90+'];
        return acc;
      }, { balance: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

      return success({ aging, totals, type: 'ap', asOf });
    }

    return error('Invalid aging type. Use "ar" or "ap"');
  } catch (err) {
    return handleApiError(err);
  }
}
