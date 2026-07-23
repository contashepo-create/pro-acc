import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/clients/[id]/statement?from=&to=
 * كشف حساب عميل: كل الحركات + الرصيد
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const s = sb();
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // Get client info
    const { data: client } = await s.from('contacts')
      .select('id, name, phone, email, address, tax_number, commercial_registration, account_id')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!client) return error('العميل غير موجود', 404);

    const c = client as Record<string, any>;
    const accountId = c.account_id;

    // Get all journal lines for this client's account
    let lineQuery = s.from('journal_lines')
      .select(`
        id, debit, credit, description, project_id, contact_id, created_at,
        journal_entry_id,
        journal_entries(id, number, date, type, description, reference_type, reference_id, created_by)
      `)
      .eq('company_id', auth.companyId);

    if (accountId) {
      lineQuery = (lineQuery as any).eq('account_id', accountId);
    } else {
      // Fallback: filter by contact_id
      lineQuery = (lineQuery as any).eq('contact_id', id);
    }

    if (from) lineQuery = (lineQuery as any).gte('journal_entries.date', from);
    if (to) lineQuery = (lineQuery as any).lte('journal_entries.date', to);

    const { data: lines, error: lineErr } = await lineQuery.order('journal_entries.date', { ascending: true });
    if (lineErr) throw lineErr;

    // Build statement entries
    let runningBalance = 0;
    const entries = (lines || []).map((l: any) => {
      const je = l.journal_entries;
      const debit = parseFloat(l.debit) || 0;
      const credit = parseFloat(l.credit) || 0;
      runningBalance += debit - credit;

      // Determine transaction type
      let type = 'journal';
      let referenceId: string | null = null;
      if (je?.reference_type) {
        type = je.reference_type;
        referenceId = je.reference_id || null;
      }

      return {
        id: l.id,
        date: je?.date || '',
        entry_number: je?.number || '',
        type,
        reference_id: referenceId,
        description: l.description || je?.description || '',
        debit,
        credit,
        balance: runningBalance,
        entry_id: je?.id || null,
        created_by: je?.created_by || null,
      };
    });

    // Get invoices for this client
    const { data: invoices } = await s.from('invoices')
      .select('id, number, date, total, paid_amount, status')
      .eq('contact_id', id).eq('company_id', auth.companyId)
      .order('date', { ascending: true });

    // Get voucher receipts for this client
    const { data: receipts } = await s.from('voucher_receipts')
      .select('id, number, date, amount, status, reason')
      .eq('contact_id', id).eq('company_id', auth.companyId)
      .order('date', { ascending: true });

    // Get client name from users who created entries
    const creatorIds = [...new Set(entries.filter(e => e.created_by).map(e => e.created_by))];
    const creatorMap: Record<string, string> = {};
    if (creatorIds.length > 0) {
      const { data: users } = await s.from('users')
        .select('id, name').in('id', creatorIds);
      (users || []).forEach((u: any) => { creatorMap[u.id] = u.name; });
    }
    entries.forEach(e => { e.created_by_name = creatorMap[e.created_by] || null; });

    return success({
      client: {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        tax_number: c.tax_number,
        commercial_registration: c.commercial_registration,
      },
      entries,
      total_debit: entries.reduce((s: number, e: any) => s + e.debit, 0),
      total_credit: entries.reduce((s: number, e: any) => s + e.credit, 0),
      balance: runningBalance,
      invoices: invoices || [],
      receipts: receipts || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}
