import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, validationError, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { projectSchema } from '@/lib/validation';

const sb = () => getSupabase();


/**
 * GET /api/projects
 * جلب جميع مشاريع الشركة
 */
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

    // جلب بنود الكميات (BOQ) دفعة واحدة لتفادي N+1 لكل مشروع
    const projectIds = (data || []).map((p: any) => p.id);
    let boqByProject: Record<string, any[]> = {};
    if (projectIds.length > 0) {
      const { data: allBoq } = await s.from('boq_items')
        .select('*').in('project_id', projectIds).eq('company_id', auth.companyId);
      for (const b of allBoq || []) {
        (boqByProject[b.project_id] = boqByProject[b.project_id] || []).push(b);
      }
    }

    const rows = (data || []).map((p: any) => ({
      ...p,
      client_name: p.contacts?.name || null,
      boq_items: boqByProject[p.id] || [],
    }));

    return success({ rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/projects
 * إنشاء مشروع + بنود جدول الكميات (BOQ)، مع توليد اختياري لفاتورة المشروع.
 *
 * FIXES الجوهرية:
 * - لم يعد يُنشئ حساباً فرعياً بكود مكرر (1130) للعميل النقدي — كان يُفسد
 *   الدليل المحاسبي ويكسر resolveAccountId. النموذج: حسابات تحكم + contact_id.
 * - مسار الفاتورة التلقائية كان يُدرج سطور قيد يدوياً بلا company_id ولا
 *   كود/اسم حساب، ويستخدم contact.account_id (المعطّل) — الآن يُرحَّل عبر
 *   createJournalEntry (سطور مُثراة + متوازنة) بحساب التحكم 1130 الموسوم
 *   بـ contact_id، مع تراجع آلي وعزل مستأجرين.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const s = sb();
    const body = await parseBody<any>(request);

    // موائمة snake_case ↔ camelCase قبل التحقق
    const mappedBody = {
      name: body.name,
      clientId: body.client_id || body.clientId || null,
      contractValue: Number(body.contract_value || body.contractType || body.contractValue || 0),
      startDate: body.start_date || body.startDate,
      endDate: body.end_date || body.endDate || null,
      status: body.status || 'active',
      description: body.description || '',
      location: body.location || '',
    };

    // حساب إجمالي العقد من بنود BOQ إن لم يُمرَّر صراحةً
    const items = body.items || [];
    if (items.length > 0 && mappedBody.contractValue === 0) {
      mappedBody.contractValue = items.reduce((sum: number, item: any) => sum + ((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)), 0);
    }

    const parsed = projectSchema.safeParse(mappedBody);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const normalizedItems = Array.isArray(items) ? items.map((item: any) => ({
      description: typeof item.description === 'string' ? item.description.trim() : '',
      unit: typeof item.unit === 'string' ? item.unit.trim() : 'واحدة',
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    })) : [];
    if (normalizedItems.some((item: any) => !item.description
      || !Number.isFinite(item.quantity) || item.quantity <= 0
      || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      return error('أحد بنود جدول الكميات غير صالح');
    }

    const { data: project, error: createError } = await s.rpc('create_project_atomic', {
      p_company_id: auth.companyId,
      p_name: parsed.data.name,
      p_client_id: parsed.data.clientId || null,
      p_contract_value: parsed.data.contractValue,
      p_start_date: parsed.data.startDate,
      p_end_date: parsed.data.endDate || null,
      p_status: parsed.data.status,
      p_description: parsed.data.description || '',
      p_location: parsed.data.location || '',
      p_items: normalizedItems,
      p_auto_invoice: body.auto_invoice === true,
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    return success(project, 201);
  } catch (err) {
    console.error('Project POST Error:', err);
    return handleApiError(err);
  }
}
