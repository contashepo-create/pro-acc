import { NextRequest } from 'next/server';
import { success, error, parseBody, requireRole, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { validateOverheadRule } from '@/lib/project-overhead';

const sb = () => getSupabase();
const ROW_COLUMNS = 'id, name, allocation_basis, rate, is_active, created_at, updated_at';

/** PUT /api/projects/overhead/[id] — update a rule. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(req, ['admin', 'manager']);
    const { id } = await params;
    const body = await parseBody(req);
    const check = validateOverheadRule(body);
    if (typeof check === 'string') return error(check);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name.trim();
    if (body.allocation_basis !== undefined) update.allocation_basis = body.allocation_basis;
    if (body.rate !== undefined) update.rate = Number(body.rate);
    if (body.is_active !== undefined) update.is_active = body.is_active;
    if (!Object.keys(update).length) return error('لا توجد تغييرات');

    const { data, error: err } = await sb().from('overhead_allocations')
      .update(update).eq('id', id).eq('company_id', auth.companyId)
      .select(ROW_COLUMNS).maybeSingle();
    if (err) throw err;
    if (!data) return error('القاعدة غير موجودة', 404);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** DELETE /api/projects/overhead/[id] — remove a rule. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(req, ['admin', 'manager']);
    const { id } = await params;
    const { data, error: err } = await sb().from('overhead_allocations')
      .delete().eq('id', id).eq('company_id', auth.companyId)
      .select('id').maybeSingle();
    if (err) throw err;
    if (!data) return error('القاعدة غير موجودة', 404);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
