import { NextRequest } from 'next/server';
import { success, serverError, clearAuthCookie } from '@/lib/api-helpers';
import { verifyToken, extractToken } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Invalidate the session server-side by bumping token_version,
    // so the JWT we are about to discard cannot be replayed after logout.
    const token = extractToken(request);
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        try {
          const { data: cur } = await sb().from('users')
            .select('token_version')
            .eq('id', payload.userId)
            .maybeSingle();
          const nextVersion = (Number((cur as Row)?.token_version) || 0) + 1;
          await sb().from('users')
            .update({ token_version: nextVersion })
            .eq('id', payload.userId);
        } catch {
          // Non-fatal: cookie is still cleared regardless.
        }
      }
    }

    const response = success({ message: 'تم تسجيل الخروج بنجاح' });
    clearAuthCookie(response, 'token');
    return response;
  } catch (err) {
    return serverError(err);
  }
}
