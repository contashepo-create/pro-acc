import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword } from '@/lib/admin-auth';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const __admin = await requireAdmin(request);
    const { id: companyId } = await params;
    // Validate UUID shape to prevent path-based filter injection
    if (!UUID.test(companyId)) return error('معرّف الشركة غير صالح', 400);

    const body = await parseBody(request);
    const { days = 7, reason, masterPassword } = body;

    // Sensitive monetary action: require master password re-entry
    if (!masterPassword) return error('كلمة المرور الرئيسية مطلوبة', 401);
    const ok = await verifyMasterPassword(__admin.adminId, String(masterPassword));
    if (!ok) return error('كلمة المرور الرئيسية غير صحيحة', 401);

    if (days !== 7) {
      return error('التمديد المسموح به هو 7 أيام فقط', 400);
    }
    if (reason && String(reason).length > 500) return error('السبب طويل جداً', 400);

    const { data: result, error: extendError } = await sb().rpc('extend_company_trial_atomic', {
      p_company_id: companyId,
      p_admin_id: __admin.adminId,
      p_days: days,
      p_reason: typeof reason === 'string' ? reason.trim() : '',
    });
    if (extendError) {
      const message = String(extendError.message || 'تعذر تمديد الفترة التجريبية');
      if (/الشركة غير موجودة|لا يوجد اشتراك/.test(message)) return error(message, 404);
      if (/تمديد|مسبق|صالح/.test(message)) return error(message, 409);
      throw extendError;
    }
    const row = result as Record<string, unknown>;
    return success({
      subscription: row,
      message: row.already_extended
        ? 'تم تمديد هذه الفترة التجريبية مسبقاً'
        : `تم تمديد الفترة التجريبية 7 أيام. تنتهي الآن في ${row.end_date}`,
    });
  } catch (e) {
    return adminJsonError(e);
  }
}
