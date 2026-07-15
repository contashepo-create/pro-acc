import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createHmac } from 'crypto';

const sb = () => getSupabase();

function verifyPortalToken(token: string): { contactId: string; companyId: string; email: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const secret = process.env.PORTAL_SECRET || process.env.TOKEN_SECRET || 'portal-fallback-secret';
    const expectedSig = createHmac('sha256', secret).update(parts[0]).digest('base64url');

    if (expectedSig !== parts[1]) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * GET /api/portal/invoices — Get invoices for the authenticated customer
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-portal-token');
    if (!token) return error('غير مصرح', 401);

    const auth = verifyPortalToken(token);
    if (!auth) return error('انتهت صلاحية الرابط', 401);

    const s = sb();

    // Get invoices for this contact
    let query = s.from('invoices')
      .select('id, number, date, due_date, subtotal, vat_amount, total, status, zatca_qr, notes')
      .eq('company_id', auth.companyId)
      .order('date', { ascending: false });

    if (auth.contactId) {
      query = query.eq('contact_id', auth.contactId);
    } else {
      // Fallback: search by email in contact
      const { data: contactIds } = await s.from('contacts')
        .select('id')
        .eq('company_id', auth.companyId)
        .ilike('email', auth.email);
      
      const ids = (contactIds || []).map((c: { id: string }) => c.id);
      if (ids.length > 0) {
        query = query.in('contact_id', ids);
      } else {
        return success({ invoices: [] });
      }
    }

    const { data: invoices, error: qErr } = await query;
    if (qErr) throw qErr;

    return success({ invoices: invoices || [] });
  } catch (err) {
    return handleApiError(err);
  }
}
