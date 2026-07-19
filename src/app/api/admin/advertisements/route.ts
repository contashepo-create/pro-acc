import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { verifyToken } from '@/lib/auth';

const sb = () => getSupabase();

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('admin_token')?.value;
  if (!token) throw new Error('Unauthorized');
  const payload = verifyToken(token);
  if (!payload || payload.role !== 'superadmin') throw new Error('Unauthorized');
  return payload;
}

export async function GET(req: NextRequest) {
  try {
    const activeParam = req.nextUrl.searchParams.get('active');
    
    let query = sb().from('advertisements').select('*');
    
    if (activeParam === 'true') {
      query = query.eq('is_active', true);
    }

    const { data: ads, error: err } = await query.order('created_at', { ascending: false });
    
    if (err) {
      console.error('Error fetching ads:', err);
      // إذا كان الجدول غير موجود
      if (err.code === '42P01') return success([]);
      throw err;
    }

    // للعملاء: إرجاع الإعلانات النشطة فقط التي لم تنتهِ
    if (activeParam === 'true') {
      const now = new Date().toISOString();
      const filtered = (ads || []).filter((ad: any) => {
        // يجب أن تكون نشطة
        if (!ad.is_active) return false;
        // إذا كان هناك تاريخ انتهاء، تحقق منه
        if (ad.expires_at && new Date(ad.expires_at) < new Date(now)) return false;
        // إذا كان هناك تاريخ بدء، تحقق منه
        if (ad.starts_at && new Date(ad.starts_at) > new Date(now)) return false;
        return true;
      });
      return success(filtered);
    }

    return success(ads || []);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = requireAdmin(req);
    const body = await parseBody(req);
    const { title, body: bodyText, type, linkUrl, linkText, showDuration, expiresAt } = body;

    if (!title || !bodyText) return error('العنوان والنص مطلوبان');

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
      link_url: linkUrl || null,
      link_text: linkText || null,
      is_active: true,
      expires_at: finalExpiresAt,
      show_until: finalExpiresAt, // نفس التاريخ للمستخدمين
    }).select().single();

    if (insertErr) throw insertErr;
    return success(data);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await parseBody(req);
    const { id, isActive } = body;

    if (!id) return error('id مطلوب');

    const { data, error: updateErr } = await sb().from('advertisements')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return success(data);
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await parseBody(req);
    const { id } = body;

    if (!id) return error('id مطلوب');

    await sb().from('advertisements').delete().eq('id', id);
    return success({ deleted: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return error('Unauthorized', 401);
    return serverError(e);
  }
}
