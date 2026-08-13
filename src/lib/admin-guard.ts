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
    .select('id, email, name, is_active')
    .eq('id', payload.userId)
    .maybeSingle();

  if (error || !data) throw new AdminAuthError('Unauthorized');
  const a = data as Record<string, any>;
  if (!a.is_active) throw new AdminAuthError('Account inactive', 403);

  return { adminId: a.id, email: String(a.email || '').toLowerCase(), name: String(a.name || '') };
}

export function adminJsonError(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status });
  }
  console.error('[admin] error:', err);
  let message = 'حدث خطأ في الخادم';
  let details: string | undefined;
  if (err instanceof Error && err.message) message = err.message;
  else if (err && typeof err === 'object') {
    const e = err as Record<string, any>;
    if (typeof e.message === 'string') message = e.message;
    if (typeof e.details === 'string') details = e.details;
    else if (typeof e.hint === 'string') details = e.hint;
  }
  return NextResponse.json(
    { success: false, message, ...(details ? { details } : {}) },
    { status: 500 }
  );
}
