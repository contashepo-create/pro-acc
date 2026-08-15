import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/** POST /api/projects/[id]/close — atomically close a project and its P&L. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return error('معرف المشروع غير صالح', 422);
    }
    const body = await parseBody<{ close_date?: string; notes?: string }>(req);
    const closeDate = body.close_date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate) || (body.notes !== undefined && typeof body.notes !== 'string')) {
      return error('بيانات الإقفال غير صالحة', 422);
    }

    const s = sb();
    // The RPC locks the project, computes balances from tenant-scoped ledger
    // lines, posts the closure journal, changes status, and audits in one DB
    // transaction. Concurrent closes cannot post duplicate journals.
    const { data: closure, error: closeErr } = await s.rpc('close_project', {
      p_company_id: auth.companyId,
      p_project_id: id,
      p_close_date: closeDate,
      p_notes: body.notes || '',
      p_user_id: auth.userId,
    });
    if (closeErr) {
      if (String(closeErr.message || '').includes('المشروع غير موجود')) return notFound();
      throw closeErr;
    }

    const { data: updated, error: fetchErr } = await s.from('projects')
      .select('*, contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!updated) return notFound();

    const summary = closure as Record<string, any>;
    const result = updated as Record<string, any>;
    result.client_name = result.contacts?.name || null;
    result.closure_summary = {
      total_revenue: Number(summary.total_revenue) || 0,
      total_expenses: Number(summary.total_expenses) || 0,
      net_profit: Number(summary.net_profit) || 0,
      profit_margin: Number(summary.total_revenue) > 0
        ? (Number(summary.net_profit) / Number(summary.total_revenue)) * 100 : 0,
      closure_journal_entry_id: summary.closure_journal_entry_id || null,
    };
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}
