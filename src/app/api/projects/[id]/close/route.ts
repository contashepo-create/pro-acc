import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, projectCloseSchema } from '@/lib/project-delivery-validation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireManagerOrAbove(req);
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المشروع غير صالح', 422);
    const parsed = projectCloseSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات الإقفال غير صالحة', 422);
    const closeDate = parsed.data.close_date || new Date().toISOString().slice(0, 10);
    const supabase = getSupabase();
    const { data: closure, error: closeError } = await supabase.rpc('close_project', {
      p_company_id: auth.companyId, p_project_id: id, p_close_date: closeDate,
      p_notes: parsed.data.notes || '', p_user_id: auth.userId,
    });
    if (closeError) {
      if (String(closeError.message || '').includes('المشروع غير موجود')) return notFound();
      throw closeError;
    }
    const { data: updated, error: fetchError } = await supabase.from('projects')
      .select('id,name,client_id,contract_value,start_date,end_date,status,description,location,budget,closed_at,closed_by,closure_journal_entry_id,contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (fetchError) throw fetchError;
    if (!updated) return notFound();
    const summary = closure as Record<string, any>;
    const result = updated as Record<string, any>;
    result.client_name = result.contacts?.name || null;
    delete result.contacts;
    result.closure_summary = {
      total_revenue: Number(summary.total_revenue) || 0,
      total_expenses: Number(summary.total_expenses) || 0,
      net_profit: Number(summary.net_profit) || 0,
      profit_margin: Number(summary.total_revenue) > 0 ? (Number(summary.net_profit) / Number(summary.total_revenue)) * 100 : 0,
      closure_journal_entry_id: summary.closure_journal_entry_id || null,
    };
    return success(result);
  } catch (cause) {
    return handleApiError(cause);
  }
}
