import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'daily_workers', 'read');
    const { id } = await params;
    const s = sb();

    const { data } = await s.from('daily_workers')
      .select('id, name, phone, daily_wage, is_active, created_at')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!data) return notFound();
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'daily_workers', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json().catch(() => ({}));

    const { data: existing } = await s.from('daily_workers')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return error('اسم العامل مطلوب');
      update.name = name;
    }
    if (body.phone !== undefined) update.phone = String(body.phone).trim() || null;
    if (body.daily_wage !== undefined || body.dailyWage !== undefined) {
      const wage = Number(body.daily_wage ?? body.dailyWage ?? 0);
      if (!Number.isFinite(wage) || wage < 0) return error('الأجر اليومي يجب أن يكون صفراً أو موجباً');
      update.daily_wage = wage;
    }
    if (body.is_active !== undefined) update.is_active = !!body.is_active;

    const { data: updated, error: updErr } = await s.from('daily_workers')
      .update(update)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('id, name, phone, daily_wage, is_active, created_at')
      .single();
    if (updErr) throw updErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('daily_workers')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    // عامل له سجلات حضور/تسويات لا يُحذف — يُعطَّل بدلاً من ذلك
    const { data: recs } = await s.from('daily_worker_records')
      .select('id').eq('worker_id', id).limit(1);
    if (recs && recs.length > 0) {
      return error('لا يمكن حذف عامل له سجلات حضور — عطّله بدلاً من الحذف');
    }
    const { data: sett } = await s.from('daily_worker_settlements')
      .select('id').eq('worker_id', id).limit(1);
    if (sett && sett.length > 0) {
      return error('لا يمكن حذف عامل له تسويات — عطّله بدلاً من الحذف');
    }

    await s.from('daily_workers').delete().eq('id', id).eq('company_id', auth.companyId);
    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
