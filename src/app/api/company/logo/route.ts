import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, requireAdmin, handleApiError, parseBody } from '@/lib/api-helpers';
import { safeHttpsUrl } from '@/lib/safe-input';
import { getSupabase } from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

/**
 * GET /api/company/logo
 * Returns company logo URL
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const { data: company } = await s.from('companies')
      .select('logo_url, name')
      .eq('id', auth.companyId).maybeSingle();
    return success({ logo_url: (company as Row)?.logo_url || null, name: (company as Row)?.name || '' });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/company/logo
 * Upload logo URL (stored as text in companies table)
 */
export async function POST(request: NextRequest) {
  try {
    // Company identity is reserved for the company administrator.
    const auth = await requireAdmin(request);
    const body = await parseBody<{ logo_url?: string }>(request);
    const s = sb();

    const logoUrl = safeHttpsUrl(body.logo_url);
    if (!logoUrl) return error('رابط الشعار يجب أن يكون HTTPS صالحاً');

    const { error: updateError } = await s.from('companies').update({
      logo_url: logoUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', auth.companyId);
    if (updateError) throw updateError;
    const { error: auditError } = await s.from('audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'update_company_logo',
      entity_type: 'company',
      entity_id: auth.companyId,
      new_values: { logo_url: logoUrl },
    });
    if (auditError) console.error('Company logo audit write failed:', auditError);

    return success({ logo_url: logoUrl });
  } catch (err) {
    return handleApiError(err);
  }
}
