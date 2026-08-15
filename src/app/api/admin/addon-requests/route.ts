import { NextRequest } from 'next/server';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { success, error, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { signPrivateReceiptReference } from '@/lib/storage-references';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected', 'cancelled', 'all'].includes(status)) {
      return error('حالة غير صالحة');
    }
    let query = sb().from('addon_requests')
      .select(`
        id, company_id, user_id, addon_type, quantity, duration_type,
        unit_price_usd, total_amount_usd, payment_method_code, payment_amount,
        payment_date, payment_time, receipt_image_url, notes, status,
        admin_notes, reviewed_by, reviewed_at, created_at, updated_at,
        companies(id,name,email,phone), users(id,name,email)
      `)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status !== 'all') query = query.eq('status', status);
    const { data, error: queryError } = await query;
    if (queryError) throw queryError;
    const requests = await Promise.all((data || []).map(async (row: any) => ({
      ...row,
      receipt_image_url: await signPrivateReceiptReference(sb(), row.receipt_image_url),
    })));
    return success({ requests });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await parseBody<{
      id?: string;
      status?: 'approved' | 'rejected';
      admin_notes?: string;
    }>(req);
    if (!body.id || !/^[0-9a-fA-F-]{8,}$/.test(body.id)) return error('id غير صالح');
    if (body.status !== 'approved' && body.status !== 'rejected') return error('حالة غير صالحة');
    if (body.admin_notes && body.admin_notes.length > 2000) return error('ملاحظات الإدارة طويلة جداً');

    // The RPC locks the pending request and commits its entitlement, review
    // state and grant audit together. It also refuses approval without a full
    // amount and a receipt/payment date.
    const { data, error: reviewError } = await sb().rpc('review_addon_request', {
      p_request_id: body.id,
      p_admin_id: admin.adminId,
      p_decision: body.status,
      p_notes: body.admin_notes || null,
    });
    if (reviewError) {
      const message = String(reviewError.message || '');
      if (/not found/i.test(message)) return error('الطلب غير موجود', 404);
      if (/already reviewed/i.test(message)) return error('تمت مراجعة هذا الطلب مسبقاً', 409);
      if (/payment proof|full amount/i.test(message)) {
        return error('لا يمكن منح الإضافة دون إيصال صالح وإثبات سداد كامل', 409);
      }
      throw reviewError;
    }

    const result = (data || {}) as Record<string, any>;
    // Customer notification is intentionally after the atomic grant. A failed
    // notification cannot duplicate or roll back a paid entitlement.
    if (body.status === 'approved' && result.company_id) {
      try {
        await sb().from('company_messages').insert({
          company_id: result.company_id,
          subject: 'تم تفعيل الإضافة',
          body: `تمت الموافقة على الإضافة ${result.addon_type || ''} بكمية ${result.quantity || 0}.`,
          type: 'addon_granted',
          status: 'open',
        });
      } catch { /* entitlement remains authoritative */ }
    }

    return success({ result });
  } catch (err) {
    return adminJsonError(err);
  }
}
