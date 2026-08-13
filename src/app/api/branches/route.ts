import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody, requireApiAuth, handleApiError, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'branches', 'read');
    const s = sb();
    const { page, pageSize } = getPaginationParams(req.url);

    const offset = (page - 1) * pageSize;
    const { data, error: err, count } = await s.from('branches')
      .select('*, users!manager_id(name)', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('code')
      .range(offset, offset + pageSize - 1);

    if (err) throw err;

    const branches = (data || []).map((b: any) => ({
      ...b,
      manager_name: b.users?.name || null,
    }));

    return success({ branches, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'branches', 'create');
    const s = sb();

    // Enforce branch/warehouse add-on limit — count includes warehouses too
    // since extra_branches is shared between branches and warehouses.
    try {
      const { getCompanyPlanLimits, checkPlanLimit } = await import('@/lib/plan-limits');
      const limits = await getCompanyPlanLimits(auth.companyId);
      if (!limits || !limits.features_modules.branches) {
        return error('إدارة الفروع والمستودعات غير مفعلة في باقتك. رجّع الباقة أو اشترِ إضافة فرع/مستودع.', 403);
      }
      const limit = await checkPlanLimit(auth.companyId, 'branches');
      if (!limit.allowed) {
        return error(
          `تم الوصول للحد الأقصى من الفروع/المستودعات (${limit.limit}) في باقتك. ` +
          `اشترِ إضافة فرع/مستودع ($10/شهر) لإضافة المزيد.`,
          403
        );
      }
    } catch (e: any) {
      if (e?.message?.includes('غير مُضمَّنة') || e?.message?.includes('انتهت')) throw e;
      console.warn('[branches] limit check failed:', e);
    }

    const body = await parseBody(req);
    const { code, name, address, phone, manager_id, is_main } = body;

    if (!code || !name) return error('الكود والاسم مطلوبان');

    // If is_main, unset previous main
    if (is_main) {
      await s.from('branches').update({ is_main: false }).eq('company_id', auth.companyId).eq('is_main', true);
    }

    const { data, error: err } = await s.from('branches')
      .insert({
        company_id: auth.companyId,
        code: code.toUpperCase(),
        name,
        address: address || null,
        phone: phone || null,
        manager_id: manager_id || null,
        is_main: is_main || false,
      })
      .select()
      .single();

    if (err) throw err;

    await s.from('financial_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'create_branch',
      table_name: 'branches',
      record_id: data.id,
      new_values: data,
    });

    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
