import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'read');
    const s = sb();

    const { data: warehouses } = await s.from('warehouses')
      .select('*')
      .eq('company_id', auth.companyId)
      .order('name');

    return success({ warehouses: warehouses || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'warehouses', 'create');
    const s = sb();

    // Enforce shared branch+warehouse cap.
    try {
      const { getCompanyPlanLimits, checkPlanLimit } = await import('@/lib/plan-limits');
      const limits = await getCompanyPlanLimits(auth.companyId);
      if (!limits || !limits.features_modules.warehouses) {
        return error('إدارة المستودعات غير مفعلة في باقتك. رجّع الباقة أو اشترِ إضافة فرع/مستودع.', 403);
      }
      const limit = await checkPlanLimit(auth.companyId, 'warehouses');
      if (!limit.allowed) {
        return error(
          `تم الوصول للحد الأقصى من الفروع/المستودعات (${limit.limit}) في باقتك. ` +
          `اشترِ إضافة فرع/مستودع ($10/شهر) لإضافة المزيد.`,
          403
        );
      }
    } catch (e: any) {
      if (e?.message?.includes('غير مُضمَّنة') || e?.message?.includes('انتهت')) throw e;
      console.warn('[warehouses] limit check failed:', e);
    }

    const body = await request.json();

    if (!body.name) return error('اسم المستودع مطلوب');

    const { data: warehouse, error: insertErr } = await s.from('warehouses')
      .insert({
        id: generateId(),
        company_id: auth.companyId,
        name: body.name,
        location: body.location || null,
        is_active: true,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    return success(warehouse, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
