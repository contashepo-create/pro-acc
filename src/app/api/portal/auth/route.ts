import { NextRequest } from 'next/server';
import { error, handleApiError, parseBody, success } from '@/lib/api-helpers';
import { sendEmail } from '@/lib/email';
import { createPortalToken, portalTokenTtlSeconds } from '@/lib/portal-auth';
import { getSupabase } from '@/lib/supabase-client';
import { z } from 'zod';

const requestSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
const sb = () => getSupabase();
const GENERIC_MESSAGE = 'إذا كان البريد مسجلاً، أرسلنا رابط دخول آمن إليه.';

function getAppUrl(request: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (configured) {
    const url = new URL(configured);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS in production');
    }
    return url.origin;
  }
  // In development only, use the request origin. Production must set an
  // explicit canonical URL so a forged Host header cannot enter email links.
  if (process.env.NODE_ENV !== 'production') return request.nextUrl.origin;
  throw new Error('NEXT_PUBLIC_APP_URL is required for portal magic links');
}

/**
 * Requests a customer-portal magic link.
 *
 * The previous implementation treated knowledge of an email address as
 * authentication and returned invoices immediately. This endpoint deliberately
 * returns the same response for every address and sends the credential only to
 * the mailbox owner.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = requestSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error('بريد إلكتروني صالح مطلوب');
    const email = parsed.data.email.toLowerCase();

    const { hitRateLimit } = await import('@/lib/memory-rate-limit');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const limited = hitRateLimit(`portal-link:${ip}:${email}`, { max: 5, windowMs: 15 * 60 * 1000 });
    if (!limited.allowed) return success({ message: GENERIC_MESSAGE });

    // A contact may legitimately use the same email with more than one company.
    // Send a separate capability per contact rather than picking an arbitrary
    // tenant (the old maybeSingle behavior was both unreliable and unsafe).
    const { data: contacts, error: contactsError } = await sb().from('contacts')
      .select('id, name, email, company_id')
      .ilike('email', email)
      .limit(10);
    if (contactsError) throw contactsError;

    const appUrl = getAppUrl(request);
    for (const contact of contacts || []) {
      const c = contact as { id: string; name: string | null; email: string; company_id: string };
      if (!c.id || !c.company_id || String(c.email).toLowerCase() !== email) continue;
      const token = createPortalToken({ contactId: c.id, companyId: c.company_id, email });
      const link = `${appUrl}/portal?token=${encodeURIComponent(token)}`;
      const safeName = String(c.name || 'عميل').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string));
      await sendEmail(
        email,
        'رابط الدخول إلى بوابة العملاء',
        `<div dir="rtl"><p>مرحباً ${safeName}،</p><p>استخدم الرابط الآمن التالي لعرض فواتيرك. تنتهي صلاحيته خلال 15 دقيقة.</p><p><a href="${link}">فتح بوابة العملاء</a></p><p>إذا لم تطلب هذا الرابط، تجاهل هذه الرسالة.</p></div>`
      );
    }

    return success({ message: GENERIC_MESSAGE });
  } catch (err) {
    return handleApiError(err);
  }
}
