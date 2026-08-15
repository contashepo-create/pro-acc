import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { trustedReceiptReference } from '@/lib/safe-input';

const sb = () => getSupabase();

const VALID_CATEGORIES = ['billing','payment','technical','account','data_request','other'] as const;

/** GET /api/support - list current user's tickets */
export async function GET(req: NextRequest) {
  try {
    // Even expired users must be able to reach this endpoint.
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const s = sb();
    const { data, error: err } = await s.from('support_tickets')
      .select('id, subject, category, status, created_at, updated_at, admin_notes')
      .eq('company_id', auth.companyId)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (err) throw err;
    return success({ tickets: data || [] });
  } catch (e) {
    return handleApiError(e);
  }
}

/** POST /api/support - open a new support ticket (allowed even for expired users) */
export async function POST(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const body = await parseBody<{ subject?: string; message?: string; category?: string; attachment_url?: string }>(req);
    const subject = (body.subject || '').trim();
    const message = (body.message || '').trim();
    const category = (body.category || 'other').trim();

    if (!subject || subject.length < 3) return error('عنوان الرسالة مطلوب (3 أحرف على الأقل)');
    if (!message || message.length < 10) return error('نص الرسالة مطلوب (10 أحرف على الأقل)');
    if (subject.length > 200) return error('العنوان طويل جداً (حد أقصى 200 حرف)');
    if (message.length > 5000) return error('نص الرسالة طويل جداً (حد أقصى 5000 حرف)');
    if (!VALID_CATEGORIES.includes(category as any)) return error('فئة الرسالة غير صالحة');

    // Attachments must have been uploaded into this tenant's private receipt
    // namespace. Arbitrary external URLs would expose administrators to
    // tracking/phishing links and bypass the company's storage accounting.
    const attachment = body.attachment_url
      ? trustedReceiptReference(body.attachment_url, auth.companyId)
      : null;
    if (body.attachment_url && !attachment) {
      return error('يجب رفع المرفق عبر التخزين الآمن للشركة أولاً');
    }

    const s = sb();
    const { data, error: insErr } = await s.from('support_tickets')
      .insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        subject,
        message,
        category,
        attachment_url: attachment,
        status: 'open',
      })
      .select('id, subject, category, status, created_at')
      .single();
    if (insErr) throw insErr;

    // Also write a company_message so existing admin UI surfaces it.
    try {
      await s.from('company_messages').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        subject: `[دعم/${category}] ${subject}`,
        body: message,
        type: 'support',
        status: 'open',
      });
    } catch {}

    return success({ ticket: data, message: 'تم إرسال الرسالة. سنتواصل معك قريباً.' }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
