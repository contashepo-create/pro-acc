import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryUuid, progressBillingUpdateSchema } from '@/lib/project-delivery-validation';
import type { Row } from '@/lib/types';

async function findClaim(companyId: string, id: string): Promise<null | (Row & { total_amount: number })> {
  const { data, error: queryError } = await getSupabase().from('progress_billing')
    .select('id,project_id,claim_number,date,description,gross_amount,retention_rate,retention_amount,net_amount,tax_rate,tax_amount,status,is_final,created_at,updated_at,projects(name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle();
  if (queryError) throw queryError;
  if (!data) return null;
  return {
    ...data,
    total_amount: Number(data.net_amount || 0) + Number(data.tax_amount || 0),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'read');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المستخلص غير صالح');
    const claim = await findClaim(auth.companyId, id);
    return claim ? success(claim) : error('المستخلص غير موجود', 404);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'update');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المستخلص غير صالح');
    const parsed = progressBillingUpdateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات التعديل غير صالحة');
    const claim = await findClaim(auth.companyId, id);
    if (!claim) return error('المستخلص غير موجود', 404);
    if (parsed.data.status === 'cancelled') {
      const { data, error: rpcError } = await getSupabase().rpc('cancel_progress_billing_atomic', {
        p_company_id: auth.companyId, p_claim_id: id, p_user_id: auth.userId,
      });
      if (rpcError) throw rpcError;
      return success(data);
    }
    const { data, error: rpcError } = await getSupabase().rpc('update_progress_billing_metadata', {
      p_company_id: auth.companyId, p_claim_id: id,
      p_claim_number: parsed.data.claim_number ?? claim.claim_number,
      p_description: parsed.data.description ?? parsed.data.notes ?? claim.description ?? '',
      p_is_final: parsed.data.is_final ?? claim.is_final,
      p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'delete');
    const { id } = await params;
    if (!deliveryUuid.safeParse(id).success) return error('معرف المستخلص غير صالح');
    if (!await findClaim(auth.companyId, id)) return error('المستخلص غير موجود', 404);
    const { data, error: rpcError } = await getSupabase().rpc('cancel_progress_billing_atomic', {
      p_company_id: auth.companyId, p_claim_id: id, p_user_id: auth.userId,
    });
    if (rpcError) throw rpcError;
    return success(data);
  } catch (cause) {
    return handleApiError(cause);
  }
}
