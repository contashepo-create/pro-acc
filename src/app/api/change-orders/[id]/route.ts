import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { changeOrderUpdateSchema } from '@/lib/validation';
import { applyChangeOrder } from '@/lib/construction';
import { logAudit } from '@/lib/audit';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const { id } = await params;
    const s = sb();
    const { data, error: qErr } = await s.from('change_orders')
      .select('*, projects(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (qErr || !data) return error('أمر التغيير غير موجود', 404);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'update');
    const { id } = await params;
    const body = await parseBody(request);
    const parsed = changeOrderUpdateSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const s = sb();
    const { data: existing, error: exErr } = await s.from('change_orders')
      .select('id, number, project_id, change_amount, new_contract_amount, base_contract_amount, status, title')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (exErr || !existing) return error('أمر التغيير غير موجود', 404);

    const updates: Record<string, any> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.change_amount !== undefined) {
      updates.change_amount = parsed.data.change_amount;
      // الأساس الصحيح لقيمة العقد قبل هذا الأمر هو base_contract_amount
      // (وليس القيمة الحالية للمشروع التي قد تشمل أوامر تغيير أخرى).
      const base = parseFloat(String((existing as any).base_contract_amount ?? 0)) || 0;
      const { adjustedContractAmount } = applyChangeOrder({ baseContractAmount: base, changeAmount: parsed.data.change_amount });
      updates.new_contract_amount = adjustedContractAmount;
    }

    if (Object.keys(updates).length === 0) return error('لا توجد تغييرات');

    const { data: updated, error: upErr } = await s.from('change_orders')
      .update(updates).eq('id', id).eq('company_id', auth.companyId).select('id, number, title, status, change_amount, new_contract_amount').single();
    if (upErr || !updated) return error('فشل تحديث أمر التغيير', 500);

    await logAudit({
      company_id: auth.companyId, user_id: auth.userId,
      entity_type: 'change_order', entity_id: id, action: 'update',
      before: existing, after: updated, summary: `تعديل أمر التغيير ${existing.number}`,
    });

    return success({ row: updated });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'delete');
    const { id } = await params;
    const s = sb();
    const { data: existing, error: exErr } = await s.from('change_orders')
      .select('id, number').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (exErr || !existing) return error('أمر التغيير غير موجود', 404);

    const { error: delErr } = await s.from('change_orders').delete().eq('id', id).eq('company_id', auth.companyId);
    if (delErr) return error('فشل حذف أمر التغيير', 500);

    await logAudit({
      company_id: auth.companyId, user_id: auth.userId,
      entity_type: 'change_order', entity_id: id, action: 'delete',
      before: existing, summary: `حذف أمر التغيير ${existing.number}`,
    });

    return success({ message: 'تم الحذف' });
  } catch (err) {
    return handleApiError(err);
  }
}
