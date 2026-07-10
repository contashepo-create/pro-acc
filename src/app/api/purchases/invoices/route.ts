import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber, getNextVoucherNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const supplierId = url.searchParams.get('supplierId');

    let query = s.from('purchase_invoices')
      .select('*, contacts(name), purchase_orders(po_number)', { count: 'exact' }).eq('company_id', auth.companyId);
    if (supplierId) query = query.eq('supplier_id', supplierId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    const invoices = (data || []).map((pi: any) => ({
      ...pi, supplier_name: pi.contacts?.name || null, po_number: pi.purchase_orders?.po_number || null,
      paid_amount: 0,
    }));
    for (const inv of invoices) {
      const { data: items } = await s.from('purchase_invoice_items').select('*').eq('purchase_invoice_id', inv.id).order('id');
      inv.items = items || [];
    }
    return success({ invoices, total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { date, supplier_id, purchase_order_id, items, tax_rate, notes } = data;
    if (!date || !supplier_id || !items || items.length === 0)
      return error('date, supplier_id, items are required');

    const { data: maxPi } = await s.from('purchase_invoices')
      .select('invoice_number').eq('company_id', auth.companyId).order('invoice_number', { ascending: false }).limit(1).maybeSingle();
    const nextNum = ((maxPi as any)?.invoice_number || 0) + 1;

    let subtotal = 0;
    for (const item of items) subtotal += (item.quantity || 0) * (item.unit_price || 0);
    const rate = tax_rate || 0;
    const taxAmount = subtotal * rate;
    const total = subtotal + taxAmount;

    const { data: pi, error: piErr } = await s.from('purchase_invoices')
      .insert({ company_id: auth.companyId, invoice_number: nextNum, date, supplier_id, purchase_order_id: purchase_order_id || null, subtotal, tax_amount: taxAmount, tax_rate: rate, total, notes, created_by: auth.userId })
      .select('*').single();
    if (piErr) throw piErr;

    for (const item of items) {
      await s.from('purchase_invoice_items').insert({
        purchase_invoice_id: pi.id, description: item.description, quantity: item.quantity, unit_price: item.unit_price, total: item.quantity * item.unit_price,
      });
      if (purchase_order_id) {
        const { data: invItem } = await s.from('inventory_items').select('id, quantity, unit_price').eq('company_id', auth.companyId).eq('code', item.description).maybeSingle();
        if (invItem) {
          const newQty = (invItem.quantity || 0) + item.quantity;
          const newPrice = invItem.quantity === 0 ? item.unit_price : ((invItem.quantity * invItem.unit_price) + (item.quantity * item.unit_price)) / newQty;
          await s.from('inventory_items').update({ quantity: newQty, unit_price: newPrice }).eq('id', invItem.id);
        }
      }
    }

    const { data: invAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.INVENTORY).maybeSingle();
    const { data: apAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE).maybeSingle();

    if (invAcc && apAcc) {
      const jeNum = await getNextJournalNumber(companyId, date || new Date().toISOString());
      const { data: je } = await s.from('journal_entries')
        .insert({ company_id: auth.companyId, number: jeNum, date, type: 'general', description: `فاتورة مشتريات #${nextNum}`, reference_type: 'purchase_invoice', reference_id: pi.id, created_by: auth.userId })
        .select('id').single();

      const jl: any[] = [{ journal_entry_id: je.id, account_id: invAcc.id, debit: subtotal, credit: 0 }];
      if (taxAmount > 0) {
        const { data: vatAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_PURCHASES).maybeSingle();
        if (vatAcc) jl.push({ journal_entry_id: je.id, account_id: vatAcc.id, debit: taxAmount, credit: 0 });
      }
      jl.push({ journal_entry_id: je.id, account_id: apAcc.id, debit: 0, credit: total });
      await s.from('journal_lines').insert(jl);
      await s.from('purchase_invoices').update({ journal_entry_id: je.id }).eq('id', pi.id);
    }
    return success(pi, 201);
  } catch (err) { return handleApiError(err); }
}
