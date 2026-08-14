import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const s = sb();
    const { data, error: err } = await s.from('payment_methods').select('*').order('sort_order');
    if (err) throw err;
    return success({ methods: data || [] });
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { code, name_ar, account_number, account_name, instructions, is_active } = body;
    if (!code || !name_ar) return error('code and name_ar required');

    const s = sb();
    const { data, error: err } = await s.from('payment_methods').insert({
      code,
      name_ar,
      account_number: account_number || '',
      account_name: account_name || '',
      instructions: instructions || '',
      is_active: is_active !== false,
    }).select().single();

    if (err) throw err;
    return success(data, 201);
  } catch (e) {
    return adminJsonError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { id, ...updates } = body;
    if (!id) return error('id required');

    // Whitelist updatable fields (never allow id/code tampering via spread).
    const allowed = ['name_ar', 'name_en', 'description', 'account_number', 'account_name', 'instructions', 'is_active', 'sort_order'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) patch[key] = updates[key];
    }
    if (Object.keys(patch).length === 0) return error('لا توجد حقول قابلة للتحديث');
    patch.updated_at = new Date().toISOString();

    const s = sb();
    const { data, error: err } = await s.from('payment_methods')
      .update(patch).eq('id', id).select().single();

    if (err) throw err;
    return success(data);
  } catch (e) {
    return adminJsonError(e);
  }
}

/**
 * DELETE /api/admin/payment-methods?id=<uuid>
 * Permanently removes a payment method. If historical upgrade/addon
 * requests reference its code (FK payment_method_code), deletion is
 * blocked with a clear message — deactivate it instead to preserve
 * the payment audit trail.
 */
export async function DELETE(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return error('id required');

    const s = sb();
    const { data: method, error: findErr } = await s.from('payment_methods')
      .select('id, code').eq('id', id).maybeSingle();
    if (findErr) throw findErr;
    if (!method) return error('طريقة الدفع غير موجودة', 404);

    // FK safety: upgrade_requests.payment_method_code REFERENCES payment_methods(code)
    const { count } = await s.from('upgrade_requests')
      .select('*', { count: 'exact', head: true })
      .eq('payment_method_code', (method as { code: string }).code);

    if (count && count > 0) {
      return error(
        `لا يمكن حذف هذه الطريقة نهائياً لوجود ${count} طلب دفع مرتبط بها في السجل. يمكنك إلغاء تفعيلها بدلاً من ذلك للحفاظ على سجل المدفوعات.`,
        409
      );
    }

    const { error: delErr } = await s.from('payment_methods').delete().eq('id', id);
    if (delErr) throw delErr;
    return success({ deleted: true });
  } catch (e) {
    return adminJsonError(e);
  }
}
