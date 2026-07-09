import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    const s = sb();
    let queryBuilder = s.from('advertisements').select('*');

    if (activeOnly) {
      const now = new Date().toISOString();
      queryBuilder = queryBuilder
        .eq('is_active', true)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .lte('starts_at', now);
    }

    queryBuilder = queryBuilder.order('created_at', { ascending: false });

    const { data, error: err } = await queryBuilder;
    if (err) throw err;

    return success(data || []);
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const body = await parseBody<{
      title: string; body: string; type?: string;
      startsAt?: string; expiresAt?: string; linkUrl?: string; linkText?: string;
    }>(request);

    if (!body.title?.trim()) return error('العنوان مطلوب');
    if (!body.body?.trim()) return error('النص مطلوب');

    const type = body.type || 'announcement';
    if (!['announcement', 'banner', 'promotion'].includes(type)) return error('نوع غير صالح');

    const s = sb();
    const insertData: any = {
      title: body.title.trim(),
      body: body.body.trim(),
      type,
      starts_at: body.startsAt || new Date().toISOString(),
      expires_at: body.expiresAt || null,
      link_url: body.linkUrl || null,
      link_text: body.linkText || null,
    };

    const { data, error: insertErr } = await s.from('advertisements').insert(insertData).select().single();
    if (insertErr) throw insertErr;

    return success(data, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const body = await parseBody<{ id: string; title?: string; body?: string; isActive?: boolean; expiresAt?: string }>(request);

    if (!body.id) return error('المعرف مطلوب');

    const update: any = {};
    if (body.title !== undefined) update.title = body.title;
    if (body.body !== undefined) update.body = body.body;
    if (body.isActive !== undefined) update.is_active = body.isActive;
    if (body.expiresAt !== undefined) update.expires_at = body.expiresAt;

    if (Object.keys(update).length === 0) return success({ message: 'لا توجد تحديثات' });

    update.updated_at = new Date().toISOString();

    const s = sb();
    const { error: updateErr } = await s.from('advertisements').update(update).eq('id', body.id);
    if (updateErr) throw updateErr;

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdminAuth(request);
    const body = await parseBody<{ id: string }>(request);

    if (!body.id) return error('المعرف مطلوب');
    const s = sb();
    const { error: deleteErr } = await s.from('advertisements').delete().eq('id', body.id);
    if (deleteErr) throw deleteErr;

    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
