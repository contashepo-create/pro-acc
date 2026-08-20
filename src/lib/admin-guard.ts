import { NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

export interface AdminAuthContext {
  adminId: string;
  email: string;
  name: string;
}

export class AdminAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AdminAuthError';
    this.status = status;
  }
}

/**
 * Centralized admin authentication guard.
 *
 * SECURITY:
 *  - Only accepts JWTs signed with ADMIN_TOKEN_SECRET (separate from TOKEN_SECRET).
 *  - Enforces role === 'superadmin'.
 *  - Cross-checks admin_users row exists + is_active = true (no trust of JWT claims alone).
 *  - Never reads Authorization header — admin_token cookie is HttpOnly, SameSite=Lax.
 */
export async function requireAdmin(request: Request | any): Promise<AdminAuthContext> {
  const cookies = (request as any)?.cookies;
  const token = typeof cookies?.get === 'function' ? cookies.get('admin_token')?.value : null;
  if (!token) throw new AdminAuthError('Unauthorized');

  const payload = verifyAdminToken(token);
  if (!payload) throw new AdminAuthError('Unauthorized');

  let s;
  try {
    s = getSupabase();
  } catch {
    throw new AdminAuthError('Server error', 500);
  }

  const { data, error } = await s
    .from('admin_users')
    .select('id, email, name, is_active, token_version')
    .eq('id', payload.userId)
    .maybeSingle();

  if (error || !data) throw new AdminAuthError('Unauthorized');
  const a = data as Record<string, any>;
  if (!a.is_active) throw new AdminAuthError('Account inactive', 403);
  if (payload.ver !== (Number(a.token_version) || 0)) throw new AdminAuthError('Unauthorized');

  return { adminId: a.id, email: String(a.email || '').toLowerCase(), name: String(a.name || '') };
}

export function adminJsonError(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status });
  }
  // Surface the real error message so admin failures show their actual cause.
  // The correlation id stays on the payload and full detail is logged below.
  const message = err instanceof Error && err.message
    ? err.message
    : (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? String((err as { message: string }).message)
        : 'حدث خطأ غير متوقع');
  const errorId = Math.random().toString(36).slice(2, 10);
  console.error(`[admin] error [${errorId}]:`, err);
  return NextResponse.json(
    { success: false, message, errorId },
    { status: 500 }
  );
}
