import { NextRequest } from 'next/server';
import { success, error, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

function bucketFor(days: number) {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

async function unappliedReceiptsByContact(s: any, companyId: string, asOf: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data: receipts } = await s.from('voucher_receipts')
    .select('id, contact_id, amount')
    .eq('company_id', companyId)
    .eq('receipt_type', 'client')
    .neq('status', 'cancelled')
    .lte('date', asOf);
  const receiptIds = (receipts || []).map((r: any) => r.id);
  const allocated = new Map<string, number>();
  if (receiptIds.length > 0) {
    const { data: links } = await s.from('receipt_invoice_items')
      .select('voucher_receipt_id, amount')
      .in('voucher_receipt_id', receiptIds);
    for (const l of links || []) {
      const rid = (l as any).voucher_receipt_id;
      allocated.set(rid, (allocated.get(rid) || 0) + (parseFloat((l as any).amount) || 0));
    }
  }
  for (const r of receipts || []) {
    if (!r.contact_id) continue;
    const leftover = Math.max(0, (parseFloat(r.amount) || 0) - (allocated.get(r.id) || 0));
    if (leftover > 0) map.set(r.contact_id, (map.get(r.contact_id) || 0) + leftover);
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'financial_reports', 'read');
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'ar';
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('to') || new Date().toISOString().split('T')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(new Date(`${asOf}T00:00:00Z`).getTime())) {
      return error('تاريخ asOf غير صالح', 400);
    }
    const s = sb();
    const asOfTime = new Date(`${asOf}T00:00:00Z`).getTime();

    if (type === 'ar') {
      const { data: invoices } = await s.from('invoices')
        .select('id, number, contact_id, date, due_date, total, paid_amount, status, contacts(name)')
        .eq('company_id', auth.companyId)
        .neq('status', 'cancelled')
        .neq('status', 'paid')
        .lte('date', asOf);

      const unappliedByContact = await unappliedReceiptsByContact(s, auth.companyId, asOf);

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
            open_invoices: 0,
            unapplied: 0,
            balance: 0,
            last_invoice_date: inv.date,
            days_overdue: days,
            bucket,
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        const row = byContact.get(key);
        row.open_invoices += remaining;
        row.buckets[bucket] += remaining;
        if (days > row.days_overdue) {
          row.days_overdue = days;
          row.bucket = bucket;
        }
        if (inv.date && (!row.last_invoice_date || inv.date > row.last_invoice_date)) {
          row.last_invoice_date = inv.date;
        }
      }

      for (const [cid, amt] of unappliedByContact) {
        if (!byContact.has(cid)) {
          const { data: c } = await s.from('contacts').select('name').eq('id', cid).eq('company_id', auth.companyId).maybeSingle();
          byContact.set(cid, {
            id: cid,
            name: (c as any)?.name || 'عميل',
            open_invoices: 0,
            unapplied: 0,
            balance: 0,
            last_invoice_date: null,
            days_overdue: 0,
            bucket: '0-30',
            buckets: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 },
          });
        }
        byContact.get(cid).unapplied += amt;
      }

      for (const row of byContact.values()) {
        row.balance = row.open_invoices - row.unapplied;
      }

      const aging = [...byContact.values()].sort((a, b) => b.balance - a.balance);
      const totals = aging.reduce((acc, r) => {
        acc.open_invoices += r.open_invoices;
        acc.unapplied += r.unapplied;
        acc.balance += r.balance;
        acc['0-30'] += r.buckets['0-30'];
        acc['31-60'] += r.buckets['31-60'];
        acc['61-90'] += r.buckets['61-90'];
        acc['90+'] += r.buckets['90+'];
        return acc;
      }, { open_invoices: 0, unapplied: 0, balance: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

      return success({ aging, totals, type: 'ar', asOf });
    }

    if (type === 'ap') {
      const { data: invoices } = await s.from('purchase_invoices')
        .select('id, number, supplier_id, date, due_date, total, paid_amount, status, contacts:supplier_id(name)')
        .eq('company_id', auth.companyId)
        .neq('status', 'cancelled')
        .neq('status', 'paid')
        .lte('date', asOf);

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
