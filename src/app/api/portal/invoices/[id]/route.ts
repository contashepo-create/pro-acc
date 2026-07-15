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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('x-portal-token');
    if (!token) return error('غير مصرح', 401);

    const auth = verifyPortalToken(token);
    if (!auth) return error('انتهت صلاحية الرابط', 401);

    const { id } = await params;
    const s = sb();

    // Get invoice with company info
    const { data: invoice } = await s.from('invoices')
      .select('id, number, date, due_date, subtotal, vat_rate, vat_amount, total, status, notes, zatca_qr, contact_id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!invoice) return error('الفاتورة غير موجودة');

    const inv = invoice as { id: string; number: number; date: string; due_date: string; subtotal: number; vat_rate: number; vat_amount: number; total: number; status: string; notes: string; zatca_qr: string | null; contact_id: string };

    // Verify this invoice belongs to this contact
    if (auth.contactId && inv.contact_id !== auth.contactId) {
      return error('الفاتورة غير موجودة', 404);
    }

    // Get items
    const { data: items } = await s.from('invoice_items')
      .select('id, description, quantity, unit_price, total')
      .eq('invoice_id', id);

    // Get company info for header
    const { data: company } = await s.from('companies')
      .select('name, tax_number, address, phone, logo_url')
      .eq('id', auth.companyId)
      .maybeSingle();

    return success({
      ...inv,
      items: items || [],
      company: company || {},
    });
  } catch (err) {
    return handleApiError(err);
  }
}
