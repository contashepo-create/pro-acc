import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, getPaginationParams, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { bondCreateSchema, bondLifecycleStatus, bondType } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');
    if (status && !bondLifecycleStatus.safeParse(status).success) return error('حالة الضمان غير صالحة');
    if (type && !bondType.safeParse(type).success) return error('نوع الضمان غير صالح');

    let query = s.from('bonds').select('*, projects(name), contacts(name), banks_safes(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('expiry_date', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const now = Date.now();
    const bonds = (data || []).map((bond: Record<string, unknown>) => {
      const project = bond.projects as { name?: string } | null;
      const contact = bond.contacts as { name?: string } | null;
      const bank = bond.banks_safes as { name?: string } | null;
      return {
        ...bond,
        project_name: project?.name || null,
        contact_name: contact?.name || null,
        bank_name: bank?.name || null,
        daysUntilExpiry: bond.expiry_date
          ? Math.max(0, Math.ceil((new Date(String(bond.expiry_date)).getTime() - now) / 86400000)) : null,
        isExpiringSoon: !!bond.expiry_date && new Date(String(bond.expiry_date)).getTime() >= now
          && new Date(String(bond.expiry_date)).getTime() - now < 30 * 86400000,
        isExpired: !!bond.expiry_date && new Date(String(bond.expiry_date)).getTime() < now,
      };
    });
    const { data: summary, error: summaryError } = await s.rpc('get_bond_summary', { p_company_id: auth.companyId });
    if (summaryError) throw summaryError;
    return success({ bonds, total: count || 0, page, pageSize, summary });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'create');
    const parsed = bondCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_bond_atomic', {
      p_company_id: auth.companyId,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
