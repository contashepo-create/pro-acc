import { NextRequest } from 'next/server';
import { success, error, parseBody, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { trustedReceiptReference } from '@/lib/safe-input';
import { supportTicketCreateSchema } from '@/lib/communication-validation';

const sb = () => getSupabase();

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
    const parsed = supportTicketCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات تذكرة الدعم غير صالحة');
    const { subject, message, category } = parsed.data;

    // Attachments must have been uploaded into this tenant's private receipt
    // namespace. Arbitrary external URLs would expose administrators to
    // tracking/phishing links and bypass the company's storage accounting.
    const attachment = parsed.data.attachment_url
      ? trustedReceiptReference(parsed.data.attachment_url, auth.companyId)
      : null;
    if (parsed.data.attachment_url && !attachment) {
      return error('يجب رفع المرفق عبر التخزين الآمن للشركة أولاً');
    }

    // Ticket, admin-facing message and tenant audit either all commit or all
    // roll back. The RPC revalidates the authenticated user/company relation.
    const { data, error: createError } = await sb().rpc('create_support_ticket_atomic', {
      p_company_id: auth.companyId,
      p_user_id: auth.userId,
      p_subject: subject,
      p_message: message,
      p_category: category,
      p_attachment_url: attachment,
    });
    if (createError) throw createError;

    return success({ ticket: data, message: 'تم إرسال الرسالة. سنتواصل معك قريباً.' }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
