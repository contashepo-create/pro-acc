import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, validationError, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { projectSchema } from '@/lib/validation';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

const CASH_CUSTOMER_NAME = 'عميل نقدي';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('projects')
      .select('*, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const rows = (data || []).map((p: any) => ({ ...p, client_name: p.contacts?.name || null }));
    return success({ projects: rows, rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const s = sb();
    const body = await parseBody<{
      name: string; client_id?: string | null; contract_value: number;
      start_date: string; end_date?: string | null; status?: string;
      description?: string; location?: string; auto_invoice?: boolean;
      tax_enabled?: boolean; tax_rate?: number;
    }>(request);

    const parsed = projectSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    // Check plan limits
    try {
      const { checkPlanLimit } = await import('@/lib/plan-limits');
      const limitCheck = await checkPlanLimit(auth.companyId, 'projects');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى من المشاريع', 403);
      }
    } catch (e) {
      console.warn('Plan limit check failed:', e);
    }

    const projectId = generateId();
    let effectiveClientId = body.client_id || null;

    if (!effectiveClientId) {
      const { data: cashContact } = await s.from('contacts')
        .select('id').eq('name', CASH_CUSTOMER_NAME).eq('company_id', auth.companyId).eq('type', 'client').maybeSingle();

      if (cashContact) {
        effectiveClientId = cashContact.id;
      } else {
        const cashContactId = generateId();
        const cashAccountId = generateId();
        await s.from('accounts').insert({
          id: cashAccountId, company_id: auth.companyId, code: '1130',
          name: CASH_CUSTOMER_NAME, type: 'asset', is_active: true,
        });
        await s.from('contacts').insert({
          id: cashContactId, company_id: auth.companyId, name: CASH_CUSTOMER_NAME,
          type: 'client', account_id: cashAccountId, is_cash_customer: true,
        });
        effectiveClientId = cashContactId;
      }
    }

    await s.from('projects').insert({
      id: projectId, company_id: auth.companyId, name: body.name, client_id: effectiveClientId,
      contract_value: body.contract_value, start_date: body.start_date, end_date: body.end_date || null,
      status: body.status || 'active', description: body.description || null,
      location: body.location || null, created_by: auth.userId,
      tax_enabled: body.tax_enabled || false, tax_rate: body.tax_rate || 0,
    });

    // لا يتم إنشاء فاتورة تلقائية — الفواتير تُصدر يدوياً من صفحة الفواتير
    // المشروع يسجل قيمة العقد كتقدير فقط بدون قيد محاسبي

    const { data: projectRes, error: fetchErr } = await s.from('projects')
      .select('*, contacts(name)').eq('id', projectId).single();
    if (fetchErr) throw fetchErr;

    const result = projectRes as Record<string, any>;
    return success({ ...result, client_name: result.contacts?.name || null }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
