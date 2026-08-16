import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { token } = await parseBody<{ token?: unknown }>(request);
    if (typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
      return error('رمز التحقق غير صالح أو منتهي الصلاحية', 400);
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    // Lock and consume in one transaction so a verification link is a true
    // one-time capability even under concurrent requests.
    const { data, error: verifyErr } = await getSupabase().rpc('consume_email_verification_token', {
      p_token_hash: tokenHash,
    });
    if (verifyErr) {
      if (verifyErr.code === 'P0001' || String(verifyErr.message || '').includes('رمز التحقق')) {
        return error('رمز التحقق غير صالح أو منتهي الصلاحية', 400);
      }
      throw verifyErr;
    }
    return success({ message: 'تم تأكيد البريد الإلكتروني بنجاح', email: (data as Record<string, any>)?.email });
  } catch (err) {
    return serverError(err);
  }
}
