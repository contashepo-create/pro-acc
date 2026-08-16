import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'read');
    const { id } = await params;
    const s = sb();

    const { data: quotation, error: queryErr } = await s.from('quotations')
      .select('*, contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryErr) throw queryErr;
    if (!quotation) return notFound();

    const { data: items, error: itemsErr } = await s.from('quotation_items')
      .select('*')
      .eq('quotation_id', id)
      .eq('company_id',auth.companyId)
      .order('id');
    if (itemsErr) throw itemsErr;

    const result = quotation as Record<string, any>;
    result.items = items || [];
    result.contact_name = result.contacts?.name || null;

    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody(req);

    const allowed=new Set(['date','contact_id','valid_until','status','notes','terms','items','tax_rate','discount_amount']);
    if (Object.keys(body).some((key)=>!allowed.has(key))) return error('يتضمن الطلب حقولاً غير قابلة للتعديل');
    if (body.items!==undefined && (!Array.isArray(body.items) || body.items.length<1 || body.items.length>1000)) return error('بنود عرض السعر غير صالحة');
    const payload={...body};
    delete (payload as any).items;
    const { data: updated, error: rpcErr } = await s.rpc('update_draft_quotation', {
      p_company_id:auth.companyId,
      p_quotation_id:id,
      p_payload:payload,
      p_items:body.items===undefined?null:body.items,
    });
    if (rpcErr) throw rpcErr;
    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(req, 'quotations', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: deleted, error: rpcErr } = await s.rpc('delete_draft_quotation', {
      p_company_id:auth.companyId,
      p_quotation_id:id,
    });
    if (rpcErr) throw rpcErr;
    return success({deleted:deleted===true});
  } catch (err) {
    return handleApiError(err);
  }
}
