import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, parseBody } from '@/lib/api-helpers';

import type { Row } from '@/lib/types';

const AD_TYPES = new Set(['announcement','banner','promotion','upgrade','alert','info','feature','premium']);
const DISPLAY_MODES = new Set(['top_bar','banner','popup','modal','inline']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const activeParam = req.nextUrl.searchParams.get('active');
    const displayMode = req.nextUrl.searchParams.get('display_mode');
    const q = req.nextUrl.searchParams.get('q') || '';
    if (displayMode && !DISPLAY_MODES.has(displayMode)) return error('نوع العرض غير صالح');

    let query = getSupabase().from('advertisements')
      .select('id, title, body, type, display_mode, priority, link_url, link_text, is_active, starts_at, expires_at, show_until, created_at, updated_at');
    if (activeParam === 'true') query = query.eq('is_active', true);
    else if (activeParam === 'false') query = query.eq('is_active', false);
    if (displayMode) query = query.eq('display_mode', displayMode);

    const { data: ads, error: queryError } = await query
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (queryError) {
      if (queryError.code === '42P01') return success([]);
      throw queryError;
    }

    let result = ads || [];
    const needle = q.replace(/[%_]/g, '').toLowerCase().slice(0, 64);
    if (needle) {
      result = result.filter((ad: Row) =>
        String(ad.title || '').toLowerCase().includes(needle) ||
        String(ad.body || '').toLowerCase().includes(needle)
      );
    }
    return success(result);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    const type = typeof input.type === 'string' ? input.type : 'announcement';
    const displayMode = typeof input.display_mode === 'string' ? input.display_mode : 'top_bar';
    if (!title || title.length > 300 || !body || body.length > 5000) return error('العنوان والنص مطلوبان ضمن الحدود المسموحة');
    if (!AD_TYPES.has(type)) return error('نوع الإعلان غير صالح');
    if (!DISPLAY_MODES.has(displayMode)) return error('نوع العرض غير صالح');

    const linkUrl = safeUrl(input.linkUrl);
    if (input.linkUrl !== undefined && linkUrl === undefined) return error('رابط غير صالح');
    if (input.linkText !== undefined && (typeof input.linkText !== 'string' || input.linkText.length > 200)) return error('نص الرابط طويل جداً');
    const priority = input.priority === undefined ? 0 : Number(input.priority);
    if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) return error('أولوية الإعلان غير صالحة');

    let expiresAt = safeDate(input.expiresAt);
    if (input.expiresAt !== undefined && expiresAt === undefined) return error('تاريخ الانتهاء غير صالح');
    if (expiresAt === undefined && input.showDuration !== undefined) {
      const days = Number(input.showDuration);
      if (!Number.isInteger(days) || days < 1 || days > 365) return error('مدة العرض غير صالحة');
      expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    }

    const { data, error: createError } = await getSupabase().rpc('admin_manage_advertisement', {
      p_admin_id: admin.adminId,
      p_action: 'create',
      p_ad_id: null,
      p_payload: {
        title, body, type, display_mode: displayMode, priority,
        link_url: linkUrl ?? null,
        link_text: typeof input.linkText === 'string' ? input.linkText.trim() : null,
        is_active: true,
        expires_at: expiresAt ?? null,
      },
    });
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const id = typeof input.id === 'string' ? input.id : '';
    if (!UUID.test(id)) return error('id غير صالح');

    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 300) return error('العنوان غير صالح');
      patch.title = input.title.trim();
    }
    if (input.body !== undefined) {
      if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > 5000) return error('النص غير صالح');
      patch.body = input.body.trim();
    }
    if (input.type !== undefined) {
      if (typeof input.type !== 'string' || !AD_TYPES.has(input.type)) return error('نوع الإعلان غير صالح');
      patch.type = input.type;
    }
    if (input.display_mode !== undefined) {
      if (typeof input.display_mode !== 'string' || !DISPLAY_MODES.has(input.display_mode)) return error('نوع العرض غير صالح');
      patch.display_mode = input.display_mode;
    }
    if (input.priority !== undefined) {
      const priority = Number(input.priority);
      if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) return error('الأولوية غير صالحة');
      patch.priority = priority;
    }
    if (input.isActive !== undefined) {
      if (typeof input.isActive !== 'boolean') return error('حالة الإعلان غير صالحة');
      patch.is_active = input.isActive;
    }
    if (input.linkUrl !== undefined) {
      const linkUrl = safeUrl(input.linkUrl);
      if (linkUrl === undefined) return error('رابط غير صالح');
      patch.link_url = linkUrl;
    }
    if (input.linkText !== undefined) {
      if (input.linkText !== null && (typeof input.linkText !== 'string' || input.linkText.length > 200)) return error('نص الرابط غير صالح');
      patch.link_text = typeof input.linkText === 'string' ? input.linkText.trim() : null;
    }
    if (input.expiresAt !== undefined) {
      const expiresAt = safeDate(input.expiresAt);
      if (expiresAt === undefined) return error('تاريخ الانتهاء غير صالح');
      patch.expires_at = expiresAt;
    }
    if (!Object.keys(patch).length) return error('لا توجد حقول قابلة للتحديث');

    const { data, error: updateError } = await getSupabase().rpc('admin_manage_advertisement', {
      p_admin_id: admin.adminId,
      p_action: 'update',
      p_ad_id: id,
      p_payload: patch,
    });
    if (updateError) throw updateError;
    if ((data as Row)?.not_found) return error('الإعلان غير موجود', 404);
    return success(data);
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const input = await parseBody<Record<string, unknown>>(req);
    const id = typeof input.id === 'string' ? input.id : '';
    if (!UUID.test(id)) return error('id غير صالح');
    const { data, error: deleteError } = await getSupabase().rpc('admin_manage_advertisement', {
      p_admin_id: admin.adminId,
      p_action: 'delete',
      p_ad_id: id,
      p_payload: {},
    });
    if (deleteError) throw deleteError;
    if ((data as Row)?.not_found) return error('الإعلان غير موجود', 404);
    return success({ deleted: true });
  } catch (err) {
    return adminJsonError(err);
  }
}
