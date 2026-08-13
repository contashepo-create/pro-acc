import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/daily-workers
 * سجل العمال اليوميين (الجدول الرئيسي daily_workers) — مقيد بالشركة.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'daily_workers', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await s.from('daily_workers')
      .select('id, name, phone, daily_wage, is_active, created_at', { count: 'exact' })
      .eq('company_id', auth.companyId)
      .order('name')
      .range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;

    return success({ workers: data || [], total: count || 0, page, pageSize });
  } catch (err) { return handleApiError(err); }
}

/**
 * POST /api/daily-workers
 * إضافة عامل يومي (الاسم + الأجر اليومي). سابقاً كانت الحقول المرسلة
 * (project_id/worker_name/daily_rate…) لا تطابق أعمدة الجدول إطلاقاً.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'daily_workers', 'create');
    const s = sb();
    const data = await parseBody<any>(req);

    const name = String(data.name || '').trim();
    const phone = String(data.phone || '').trim();
    const dailyWage = Number(data.daily_wage ?? data.dailyWage ?? 0);

    if (!name) return error('اسم العامل مطلوب');
    if (!Number.isFinite(dailyWage) || dailyWage < 0) return error('الأجر اليومي يجب أن يكون صفراً أو موجباً');

    const { data: result, error: insertError } = await s.from('daily_workers')
      .insert({
        company_id: auth.companyId,
        name,
        phone: phone || null,
        daily_wage: dailyWage,
        is_active: true,
      })
      .select('id, name, phone, daily_wage, is_active, created_at')
      .single();
    if (insertError) throw insertError;
    return success(result, 201);
  } catch (err) { return handleApiError(err); }
}
