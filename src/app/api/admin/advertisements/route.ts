import { NextRequest } from 'next/server';
import { success, error, serverError, requireAdminAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let sql = 'SELECT * FROM advertisements';
    const params: any[] = [];

    if (activeOnly) {
      sql += ` WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW()) AND starts_at <= NOW()`;
    }

    sql += ' ORDER BY created_at DESC';

    const res = await query(sql, params);
    return success(res.rows);
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

    const res = await query(
      `INSERT INTO advertisements (title, body, type, starts_at, expires_at, link_url, link_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        body.title.trim(), body.body.trim(), type,
        body.startsAt || new Date().toISOString(),
        body.expiresAt || null,
        body.linkUrl || null, body.linkText || null,
      ]
    );

    return success(res.rows[0], 201);
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

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (body.title !== undefined) { updates.push(`title = $${idx++}`); params.push(body.title); }
    if (body.body !== undefined) { updates.push(`body = $${idx++}`); params.push(body.body); }
    if (body.isActive !== undefined) { updates.push(`is_active = $${idx++}`); params.push(body.isActive); }
    if (body.expiresAt !== undefined) { updates.push(`expires_at = $${idx++}`); params.push(body.expiresAt); }

    if (updates.length === 0) return success({ message: 'لا توجد تحديثات' });

    updates.push('updated_at = NOW()');
    params.push(body.id);

    await query(`UPDATE advertisements SET ${updates.join(', ')} WHERE id = $${idx}`, params);
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
    await query('DELETE FROM advertisements WHERE id = $1', [body.id]);
    return success({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'غير مصرح به') return handleApiError(err);
    return serverError(err);
  }
}
