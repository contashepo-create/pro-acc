import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createHmac } from 'crypto';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * POST /api/portal/auth — Authenticate a customer by email
 * Returns a short-lived portal token
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body as { email?: string };

    if (!email) return error('البريد الإلكتروني مطلوب');

    const s = sb();

    // Find the contact/client by email
    const { data: contact } = await s.from('contacts')
      .select('id, name, email, company_id')
      .ilike('email', email.toLowerCase())
      .maybeSingle();

    if (!contact) {
      // Also check invoices directly for the email (some systems store email only on invoice)
      const { data: invoice } = await s.from('invoices')
        .select('company_id')
        .eq('contact_email', email.toLowerCase())
        .limit(1)
        .maybeSingle();

      if (!invoice) {
        return error('لم يتم العثور على حساب بهذا البريد الإلكتروني');
      }
    }

    const c = contact as { id: string; name: string; email: string; company_id: string } | null;
    const companyId = c?.company_id || '';

    // Generate portal token (HMAC-based, 24h expiry)
    const secret = process.env.PORTAL_SECRET || process.env.TOKEN_SECRET || 'portal-fallback-secret';
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      contactId: c?.id || null,
      companyId,
      email: email.toLowerCase(),
      iat: now,
      exp: now + 86400, // 24 hours
    });

    const token = Buffer.from(payload).toString('base64url') + '.' +
      createHmac('sha256', secret).update(payload).digest('base64url');

    // Log portal access
    try {
      await s.from('portal_access_log').insert({
        id: generateId(),
        company_id: companyId,
        contact_id: c?.id || null,
        email: email.toLowerCase(),
        accessed_at: new Date().toISOString(),
        ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      });
    } catch {
      // Ignore log errors — table might not exist yet
    }

    return success({
      token,
      expiresIn: 86400,
      contactName: c?.name || 'عميل',
    });
  } catch (err) {
    return handleApiError(err);
  }
}
