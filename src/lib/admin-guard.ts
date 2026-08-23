import { NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

import type { CookieJarLike, RequestLike, Row } from './types';

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
export async function requireAdmin(request: RequestLike): Promise<AdminAuthContext> {
  const cookies = request?.cookies;
  const getCookie = typeof cookies?.get === 'function' ? (cookies as CookieJarLike).get : null;
  const token = getCookie ? getCookie('admin_token')?.value ?? null : null;
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
  const a = data as Row;
  if (!a.is_active) throw new AdminAuthError('Account inactive', 403);
  if (payload.ver !== (Number(a.token_version) || 0)) throw new AdminAuthError('Unauthorized');

  return { adminId: String(a.id), email: String(a.email || '').toLowerCase(), name: String(a.name || '') };
}

export function adminJsonError(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status });
  }
  // Only the safe, curated AdminAuthError messages are surfaced. Anything
  // else — Postgres/PostgREST internals included — stays in the server log;
  // the client gets a generic message plus a correlation id.
  const errorId = Math.random().toString(36).slice(2, 10);
  console.error(`[admin] error [${errorId}]:`, err);
  return NextResponse.json(
    { success: false, message: 'حدث خطأ غير متوقع', errorId },
    { status: 500 }
  );
}
