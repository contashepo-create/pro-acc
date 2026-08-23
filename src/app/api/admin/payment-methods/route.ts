import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const CODE = /^[a-z0-9][a-z0-9_-]{1,49}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMITS: Record<string, number> = {
  name_ar: 120, name_en: 120, description: 500,
  account_number: 200, account_name: 200, instructions: 2000,
};

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value.trim();
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { data, error: queryError } = await getSupabase().from('payment_methods')
      .select('id, code, name_ar, name_en, description, account_number, account_name, instructions, is_active, sort_order, created_at, updated_at')
      .order('sort_order');
    if (queryError) throw queryError;
    return success({ methods: data || [] });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const code = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
    const nameAr = typeof input.name_ar === 'string' ? input.name_ar.trim() : '';
    if (!CODE.test(code)) return error('كود طريقة الدفع غير صالح');
    if (!nameAr || nameAr.length > LIMITS.name_ar) return error('اسم طريقة الدفع مطلوب ضمن 120 حرفاً');

    const payload: Record<string, unknown> = { code, name_ar: nameAr };
    for (const field of ['name_en','description','account_number','account_name','instructions']) {
      const value = optionalText(input[field], LIMITS[field]);
      if (input[field] !== undefined && value === undefined) return error(`قيمة ${field} غير صالحة`);
      payload[field] = value ?? null;
    }
    if (input.is_active !== undefined && typeof input.is_active !== 'boolean') return error('حالة طريقة الدفع غير صالحة');
    payload.is_active = input.is_active !== false;
    const sortOrder = input.sort_order === undefined ? 0 : Number(input.sort_order);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) return error('ترتيب طريقة الدفع غير صالح');
    payload.sort_order = sortOrder;

    const { data, error: createError } = await getSupabase().rpc('admin_manage_payment_method', {
      p_admin_id: admin.adminId,
      p_action: 'create',
      p_method_id: null,
      p_payload: payload,
    });
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const id = typeof input.id === 'string' ? input.id : '';
    if (!UUID.test(id)) return error('id غير صالح');

    const patch: Record<string, unknown> = {};
    for (const field of Object.keys(LIMITS)) {
      if (input[field] === undefined) continue;
      const value = optionalText(input[field], LIMITS[field]);
      if (value === undefined || (field === 'name_ar' && !value)) return error(`قيمة ${field} غير صالحة`);
      patch[field] = value;
    }
    if (input.is_active !== undefined) {
      if (typeof input.is_active !== 'boolean') return error('حالة طريقة الدفع غير صالحة');
      patch.is_active = input.is_active;
    }
    if (input.sort_order !== undefined) {
      const sortOrder = Number(input.sort_order);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) return error('الترتيب غير صالح');
      patch.sort_order = sortOrder;
    }
    if (!Object.keys(patch).length) return error('لا توجد حقول قابلة للتحديث');

    const { data, error: updateError } = await getSupabase().rpc('admin_manage_payment_method', {
      p_admin_id: admin.adminId,
      p_action: 'update',
      p_method_id: id,
      p_payload: patch,
    });
    if (updateError) throw updateError;
    if ((data as Row)?.not_found) return error('طريقة الدفع غير موجودة', 404);
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}

/** Preserve payment history: "delete" deactivates instead of removing the row. */
export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const id = req.nextUrl.searchParams.get('id') || '';
    if (!UUID.test(id)) return error('id غير صالح');
    const { data, error: deactivateError } = await getSupabase().rpc('admin_manage_payment_method', {
      p_admin_id: admin.adminId,
      p_action: 'deactivate',
      p_method_id: id,
      p_payload: {},
    });
    if (deactivateError) throw deactivateError;
    if ((data as Row)?.not_found) return error('طريقة الدفع غير موجودة', 404);
    return success({ deleted: true, deactivated: true });
  } catch (err) {
    return adminJsonError(err);
  }
}
