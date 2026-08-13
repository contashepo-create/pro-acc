import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

const sb = () => getSupabase();



export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const s = sb();
    const activeParam = req.nextUrl.searchParams.get('active');
    const displayMode = req.nextUrl.searchParams.get('display_mode');
    const q = req.nextUrl.searchParams.get('q') || '';

    // Admin listing: select only display columns (no internal fields beyond what UI needs)
    let query = s.from('advertisements')
      .select('id, title, body, type, display_mode, priority, link_url, link_text, is_active, starts_at, expires_at, show_until, created_at, updated_at');

    if (activeParam === 'true') query = query.eq('is_active', true);
    else if (activeParam === 'false') query = query.eq('is_active', false);
    if (displayMode) query = query.eq('display_mode', displayMode);

    const { data: ads, error: err } = await query
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);

    if (err) {
      if (err.code === '42P01') return success([]);
      throw err;
    }

    let result = ads || [];
    if (q) {
      const needle = q.replace(/[%_]/g, '').toLowerCase().slice(0, 64);
      if (needle) {
        result = result.filter((a: any) =>
          String(a.title || '').toLowerCase().includes(needle) ||
          String(a.body || '').toLowerCase().includes(needle)
        );
      }
    }

    return success(result);
  } catch (e: any) {
    return adminJsonError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { title, body: bodyText, type, display_mode, priority, linkUrl, linkText, showDuration, expiresAt } = body;

    if (!title || typeof title !== 'string' || !bodyText || typeof bodyText !== 'string') {
      return error('العنوان والنص مطلوبان');
    }
    if (title.length > 300) return error('العنوان طويل جداً');
    if (bodyText.length > 5000) return error('نص الإعلان طويل جداً');
    if (linkUrl) {
      try {
        const u = new URL(String(linkUrl));
        if (!['http:', 'https:'].includes(u.protocol)) return error('رابط غير صالح');
      } catch {
        return error('رابط غير صالح');
      }
    }
    if (display_mode && !['top_bar', 'banner', 'popup', 'modal', 'inline'].includes(display_mode)) {
      return error('نوع العرض غير صالح');
    }

    // حساب تاريخ انتهاء العرض بناءً على مدة العرض
    let finalExpiresAt = expiresAt || null;
    if (!finalExpiresAt && showDuration) {
      const durationDays = parseInt(showDuration) || 7;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + durationDays);
      finalExpiresAt = endDate.toISOString().split('T')[0];
    }

    const s = sb();
    const { data, error: insertErr } = await s.from('advertisements').insert({
      title: title.trim(),
      body: bodyText.trim(),
      type: type || 'announcement',
      display_mode: display_mode || 'top_bar',
      priority: priority || 0,
      link_url: linkUrl || null,
      link_text: linkText || null,
      is_active: true,
      expires_at: finalExpiresAt,
      show_until: finalExpiresAt,
    }).select().single();

    if (insertErr) throw insertErr;
    return success(data);
  } catch (e: any) {
    return adminJsonError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await parseBody(req);
    const { id, isActive, title, body: bodyText, type, display_mode, priority, linkUrl, linkText, expiresAt } = body;

    if (!id || typeof id !== 'string' || id.length > 64) return error('id غير صالح');
    // Validate URL if provided
    if (linkUrl !== undefined && linkUrl !== null && linkUrl !== '') {
      try {
        const u = new URL(String(linkUrl));
        if (!['http:', 'https:'].includes(u.protocol)) return error('رابط غير صالح');
      } catch {
        return error('رابط غير صالح');
      }
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (isActive !== undefined) updateData.is_active = isActive;
    if (title !== undefined) updateData.title = title.trim();
    if (bodyText !== undefined) updateData.body = bodyText.trim();
    if (type !== undefined) updateData.type = type;
    if (display_mode !== undefined) updateData.display_mode = display_mode;
    if (priority !== undefined) updateData.priority = priority;
    if (linkUrl !== undefined) updateData.link_url = linkUrl;
    if (linkText !== undefined) updateData.link_text = linkText;
    if (expiresAt !== undefined) {
      updateData.expires_at = expiresAt;
      updateData.show_until = expiresAt;
    }

    const { data, error: updateErr } = await sb().from('advertisements')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return success(data);
  } catch (e: any) {
    return adminJsonError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const __admin = await requireAdmin(req);
    const body = await parseBody(req);
    const { id } = body;

    if (!id) return error('id مطلوب');

    await sb().from('advertisements').delete().eq('id', id);
    return success({ deleted: true });
  } catch (e: any) {
    return adminJsonError(e);
  }
}
