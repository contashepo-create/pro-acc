import { NextRequest } from 'next/server';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';
import { signPrivateReceiptReference } from '@/lib/storage-references';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected', 'cancelled', 'all'].includes(status)) {
      return error('حالة غير صالحة');
    }

    let query = sb().from('upgrade_requests')
      .select(`
        id, company_id, user_id, current_plan_id, requested_plan_id,
        duration_type, status, payment_method_code, payment_amount,
        payment_date, payment_time, receipt_image_url, receipt_text, notes,
        admin_notes, reviewed_by, reviewed_at, created_at, updated_at
      `)
      .order('created_at', { ascending: false })
      .limit(300);
    if (status !== 'all') query = query.eq('status', status);
    const { data: requests, error: requestError } = await query;
    if (requestError) throw requestError;

    const companyIds = [...new Set((requests || []).map((r: Row) => r.company_id).filter(Boolean))];
    const planIds = [...new Set((requests || []).map((r: Row) => r.requested_plan_id).filter(Boolean))];
    const userIds = [...new Set((requests || []).map((r: Row) => r.user_id).filter(Boolean))];
    const s = sb();
    const [companiesResult, plansResult, usersResult] = await Promise.all([
      companyIds.length ? s.from('companies').select('id,name,email,phone').in('id', companyIds) : Promise.resolve({ data: [], error: null }),
      planIds.length ? s.from('subscription_plans').select('id,name,code,price_monthly,price_yearly,currency').in('id', planIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? s.from('users').select('id,name,email').in('id', userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (companiesResult.error) throw companiesResult.error;
    if (plansResult.error) throw plansResult.error;
    if (usersResult.error) throw usersResult.error;
    const companyMap = new Map((companiesResult.data || []).map((row: Row) => [row.id, row]));
    const planMap = new Map((plansResult.data || []).map((row: Row) => [row.id, row]));
    const userMap = new Map((usersResult.data || []).map((row: Row) => [row.id, row]));

    return success({
      requests: await Promise.all((requests || []).map(async (row: Row) => ({
        ...row,
        receipt_image_url: await signPrivateReceiptReference(s, row.receipt_image_url == null ? null : String(row.receipt_image_url)),
        companies: companyMap.get(row.company_id) || null,
        subscription_plans: planMap.get(row.requested_plan_id) || null,
        users: userMap.get(row.user_id) || null,
      }))),
    });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await parseBody<{ id?: string; status?: 'approved' | 'rejected'; admin_notes?: string }>(req);
    if (!body.id || !UUID.test(body.id)) return error('id غير صالح');
    if (body.status !== 'approved' && body.status !== 'rejected') return error('حالة غير صالحة');
    if (body.admin_notes && body.admin_notes.length > 2000) return error('ملاحظات الإدارة طويلة جداً');

    // Plan activation and the request transition are a single locked database
    // operation. The RPC recomputes the required amount from the selected plan
    // and refuses manual approval without full payment proof.
    const { data, error: reviewError } = await sb().rpc('review_upgrade_request', {
      p_request_id: body.id,
      p_admin_id: admin.adminId,
      p_decision: body.status,
      p_notes: body.admin_notes || null,
    });
    if (reviewError) {
      const message = String(reviewError.message || '');
      if (/not found/i.test(message)) return error('الطلب غير موجود', 404);
      if (/already reviewed/i.test(message)) return error('تمت مراجعة هذا الطلب مسبقاً', 409);
      if (/payment proof|full plan amount/i.test(message)) {
        return error('لا يمكن تفعيل باقة مدفوعة دون إيصال صالح وإثبات سداد كامل', 409);
      }
      if (/plan is unavailable/i.test(message)) return error('الباقة المطلوبة غير متاحة', 409);
      throw reviewError;
    }

    // The reviewed-request trigger writes the user-scoped notification in the
    // same transaction as entitlement activation and the admin audit record.
    return success({ result: data || {} });
  } catch (err) {
    return adminJsonError(err);
  }
}

/** Payment evidence and review history are immutable records, not deletable UI data. */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    return error('لا يمكن حذف طلبات الدفع. ارفض الطلب أو احتفظ به كسجل تدقيق.', 405);
  } catch (err) {
    return adminJsonError(err);
  }
}
