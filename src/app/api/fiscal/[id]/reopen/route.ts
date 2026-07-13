import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiAuth(req);
    const { id } = await params;
    const s = sb();

    const { data: fy } = await s.from('fiscal_years').select('*').eq('id', id).maybeSingle();
    if (!fy) return notFound();
    if (fy.status !== 'closed') return error('السنة المالية غير مقفلة');

    const companyId = fy.company_id;

    const { data: newerClosed } = await s.from('fiscal_years')
      .select('id').eq('company_id', companyId).eq('status', 'closed').gt('start_date', fy.start_date);

    for (const newer of (newerClosed || [])) {
      await s.from('fiscal_years').update({ status: 'open', closed_at: null, closed_by: null }).eq('id', newer.id);
    }

    const { data: closingJes } = await s.from('journal_entries')
      .select('id').eq('company_id', companyId).eq('type', 'closing').gte('date', fy.start_date).lte('date', fy.end_date);
    const closingJeIds = (closingJes || []).map((je: any) => je.id);

    if (closingJeIds.length > 0) {
      await s.from('journal_lines').delete().in('journal_entry_id', closingJeIds);
      await s.from('journal_entries').delete().in('id', closingJeIds);
    }

    const { error: updErr } = await s.from('fiscal_years')
      .update({ status: 'open', closed_at: null, closed_by: null }).eq('id', id);
    if (updErr) throw updErr;

    return success({ ...fy, status: 'open' });
  } catch (err) {
    return handleApiError(err);
  }
}
