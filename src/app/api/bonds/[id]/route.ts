import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'read');
    const { id } = await params;
    const s = sb();

    const { data: bond } = await s.from('bonds')
      .select('*, projects(name), contacts(name), tenders(title)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!bond) return notFound();

    const b = bond as any;
    return success({
      ...b,
      project_name: b.projects?.name || null,
      contact_name: b.contacts?.name || null,
      tender_title: b.tenders?.title || null,
      daysUntilExpiry: b.expiry_date
        ? Math.max(0, Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000))
        : null,
      daysActive: b.issue_date
        ? Math.floor((Date.now() - new Date(b.issue_date).getTime()) / 86400000)
        : null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action, notes } = body;
    const { data: existing, error: existingErr } = await s.from('bonds')
      .select('id, status, issue_date').eq('id',id).eq('company_id',auth.companyId).maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return notFound();

    if (action === 'release' || action === 'cancel') {
      if ((existing as any).status !== 'active') return error('لا يمكن تغيير حالة ضمان غير نشط',409);
      const { data, error: updateErr } = await s.from('bonds')
        .update({
          status: action === 'release' ? 'released' : 'cancelled',
          released_at: action === 'release' ? new Date().toISOString() : null,
          notes: typeof notes === 'string' ? notes.trim() || null : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .eq('status', 'active')
        .select()
        .maybeSingle();

      if (updateErr) throw updateErr;
      if (!data) return error('تغيرت حالة الضمان بواسطة طلب آخر',409);
      return success(data);
    }

    if ((existing as any).status !== 'active') return error('لا يمكن تعديل ضمان غير نشط',409);
    // Regular update
    const allowedFields = ['title', 'amount', 'expiry_date', 'notes', 'beneficiary_name'];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) return error('العنوان مطلوب');
    if (body.amount !== undefined && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)) return error('المبلغ يجب أن يكون موجباً');
    if (body.expiry_date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.expiry_date)) || body.expiry_date < (existing as any).issue_date)) {
      return error('تاريخ الانتهاء غير صالح أو يسبق تاريخ الإصدار');
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('bonds')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .eq('status', 'active')
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!data) return error('تغيرت حالة الضمان بواسطة طلب آخر',409);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'bonds', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: cancelled, error: cancelErr } = await s.from('bonds')
      .update({status:'cancelled',updated_at:new Date().toISOString()})
      .eq('id',id).eq('company_id',auth.companyId).eq('status','active')
      .select('id,status').maybeSingle();
    if (cancelErr) throw cancelErr;
    if (!cancelled) {
      const { data: existing } = await s.from('bonds').select('status')
        .eq('id',id).eq('company_id',auth.companyId).maybeSingle();
      if (!existing) return notFound();
      return error('لا يمكن إلغاء ضمان غير نشط',409);
    }
    return success({ cancelled: true, bond: cancelled });
  } catch (err) {
    return handleApiError(err);
  }
}
