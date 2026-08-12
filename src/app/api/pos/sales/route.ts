import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { createJournalEntry } from '@/lib/journal-utils';
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'read');
    const s = sb();
    const { data, error: err } = await s.from('pos_sales').select('*').eq('company_id', auth.companyId).order('date', { ascending: false }).limit(50);
    if (err) throw err;
    return success({ sales: data || [] });
  } catch (e) { return handleApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'create');
    const s = sb();
    const body = await parseBody(req);
    const { terminal_id, total, payment_method } = body;
    if (!total) return error('total required');

    // Get next number
    let number = 1;
    try {
      const { data } = await s.rpc('next_voucher_number', { p_company_id: auth.companyId, p_table_name: 'pos_sales' });
      number = data as number;
    } catch {
      const { data: max } = await s.from('pos_sales').select('number').eq('company_id', auth.companyId).order('number', { ascending: false }).limit(1).maybeSingle();
      number = ((max as any)?.number || 0) + 1;
    }

    const { data, error: err } = await s.from('pos_sales').insert({
      company_id: auth.companyId,
      terminal_id: terminal_id || null,
      number,
      total,
      payment_method: payment_method || 'cash',
      status: 'completed',
    }).select().single();

    if (err) throw err;

    const { data: cashAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1110').maybeSingle();
    const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
    if (!cashAcc || !revAcc) {
      await s.from('pos_sales').delete().eq('id', data.id).eq('company_id', auth.companyId);
      return error('حسابات الصندوق أو الإيراد مفقودة — راجع دليل الحسابات', 400);
    }
    const saleDate = new Date().toISOString().split('T')[0];
    const { journalId, error: jeErr } = await createJournalEntry(auth.companyId, {
      date: saleDate,
      type: 'general',
      description: `مبيعات POS #${number}`,
      reference_type: 'pos_sale',
      reference_id: data.id,
      created_by: auth.userId,
      lines: [
        { account_id: cashAcc.id, debit: total, credit: 0, description: `مبيعات POS ${number}` },
        { account_id: revAcc.id, debit: 0, credit: total, description: `إيراد POS ${number}` },
      ],
    });
    if (jeErr || !journalId) {
      await s.from('pos_sales').delete().eq('id', data.id).eq('company_id', auth.companyId);
      throw jeErr || new Error('فشل قيد مبيعات نقطة البيع');
    }

    return success(data, 201);
  } catch (e) { return handleApiError(e); }
}
