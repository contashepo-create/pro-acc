import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('quotations')
      .select('*, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const quotations = (data || []).map((q: any) => ({ ...q, contact_name: q.contacts?.name || null }));

    for (const q of quotations) {
      const { data: items } = await s.from('quotation_items').select('*').eq('quotation_id', q.id).order('id');
      q.items = items || [];
    }

    return success({ quotations, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const data = await parseBody(req);
    const { date, contact_id, items, notes, tax_rate, valid_until } = data;

    if (!date || !contact_id || !items || items.length === 0)
      return error('date, contact_id, items are required');

    let subtotal = 0;
    for (const item of items) subtotal += (item.quantity || 0) * (item.unit_price || 0);
    const rate = tax_rate || 0;
    const taxAmount = subtotal * rate;
    const total = subtotal + taxAmount;

    const { data: maxQ } = await s.from('quotations')
      .select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
    const nextNum = ((maxQ as any)?.number || 0) + 1;

    const { data: result, error: insertError } = await s.from('quotations')
      .insert({ company_id: auth.companyId, number: nextNum, date, contact_id, subtotal, tax_amount: taxAmount, tax_rate: rate, total, notes, valid_until, status: 'draft', created_by: auth.userId })
      .select('*').single();
    if (insertError) throw insertError;

    for (const item of items) {
      await s.from('quotation_items').insert({
        quotation_id: result.id, description: item.description, quantity: item.quantity,
        unit_price: item.unit_price, total: item.quantity * item.unit_price,
      });
    }

    const { data: full } = await s.from('quotations')
      .select('*, contacts(name)').eq('id', result.id).single();
    const fullResult: any = full;
    fullResult.items = items;
    fullResult.contact_name = fullResult.contacts?.name || null;

    return success(fullResult, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
