import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success, error, parseBody } from '@/lib/api-helpers';
import { getNextJournalNumber } from '@/lib/numbering';
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const s = sb();
    const { data, error: err } = await s.from('pos_sales').select('*').eq('company_id', auth.companyId).order('date', { ascending: false }).limit(50);
    if (err) throw err;
    return success({ sales: data || [] });
  } catch (e) { return handleApiError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
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

    // Create journal entry for POS sale
    try {
      const jeNum = await getNextJournalNumber(auth.companyId, new Date().toISOString());
      const { data: je } = await s.from('journal_entries').insert({
        company_id: auth.companyId,
        number: jeNum,
        date: new Date().toISOString().split('T')[0],
        type: 'general',
        description: `مبيعات POS #${number}`,
        created_by: auth.userId,
      }).select('id').single();

      // Get cash account and revenue account
      const { data: cashAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1110').maybeSingle();
      const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();

      if (cashAcc && revAcc) {
        await s.from('journal_lines').insert([
          { journal_entry_id: je.id, account_id: cashAcc.id, account_code: '1110', debit: total, credit: 0, description: `مبيعات POS ${number}` },
          { journal_entry_id: je.id, account_id: revAcc.id, account_code: '4100', debit: 0, credit: total, description: `إيراد POS ${number}` },
        ]);
      }
    } catch (jeErr) {
      console.warn('POS journal creation failed:', jeErr);
    }

    return success(data, 201);
  } catch (e) { return handleApiError(e); }
}
