import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'read');
    const { id } = await params;
    const s = sb();

    const { data: tender } = await s.from('tenders')
      .select('*, tenders_contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!tender) return notFound();

    // Get cost breakdown
    const { data: costItems } = await s.from('tender_cost_items')
      .select('*')
      .eq('tender_id', id)
      .eq('company_id', auth.companyId);

    const t = tender as any;
    const totalCost = (costItems || []).reduce((sum: number, item: any) => sum + (parseFloat(item.amount) || 0), 0);
    const bidAmount = parseFloat(t.estimated_value) || 0;
    const profitMargin = bidAmount > 0 && totalCost > 0 ? ((bidAmount - totalCost) / bidAmount * 100) : 0;

    return success({
      ...t,
      contact_name: t.tenders_contacts?.name || null,
      cost_items: costItems || [],
      total_cost: totalCost,
      bid_amount: bidAmount,
      profit_margin: profitMargin,
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
    const auth = await requireModulePermission(request, 'tenders', 'update');
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action } = body;

    // Handle status change
    if (action === 'update_status') {
      const { status, notes } = body;
      const { data: current } = await s.from('tenders').select('id, status')
        .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
      if (!current) return notFound();
      const transitions: Record<string, string[]> = {
        draft: ['preparing', 'submitted', 'cancelled'], preparing: ['submitted', 'cancelled'],
        submitted: ['won', 'lost', 'cancelled'], won: [], lost: [], cancelled: [],
      };
      if (!(transitions[(current as any).status] || []).includes(String(status))) return error('انتقال حالة المناقصة غير صالح', 409);
      if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) return error('الملاحظات طويلة جداً');

      const { data, error: updateErr } = await s.from('tenders')
        .update({ status, notes: notes || null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return success(data);
    }

    // Handle conversion to project (when tender is won)
    if (action === 'convert_to_project') {
      const { data: tender } = await s.from('tenders')
        .select('*')
        .eq('id', id)
        .eq('company_id', auth.companyId)
        .maybeSingle();

      if (!tender) return notFound();
      const t = tender as any;

      if (t.status !== 'won') return error('يمكن تحويل العطاءات الرابحة فقط إلى مشروع');
      if (t.project_id) return error('تم تحويل هذه المناقصة إلى مشروع مسبقاً', 409);

      const { data: converted, error: conversionError } = await s.rpc('convert_won_tender_to_project_atomic', {
        p_company_id: auth.companyId,
        p_tender_id: id,
        p_user_id: auth.userId,
      });
      if (conversionError) throw conversionError;
      return success(converted, 201);
    }

    // Regular update
    const { data: currentTender } = await s.from('tenders').select('id, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!currentTender) return notFound();
    if (!['draft', 'preparing'].includes((currentTender as any).status)) {
      return error('لا يمكن تعديل بيانات مناقصة بعد تقديمها', 409);
    }
    if (body.contact_id) {
      const { data: contact } = await s.from('contacts').select('id')
        .eq('id', body.contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }
    for (const numericField of ['estimated_value', 'bid_bond_amount', 'project_duration_months', 'win_probability']) {
      if (body[numericField] !== undefined && (!Number.isFinite(Number(body[numericField])) || Number(body[numericField]) < 0)) {
        return error(`القيمة ${numericField} غير صالحة`);
      }
    }
    if (body.win_probability !== undefined && Number(body.win_probability) > 100) return error('احتمال الفوز يجب ألا يتجاوز 100');
    const allowedFields = ['title', 'client_name', 'contact_id', 'reference_number', 'description',
      'estimated_value', 'bid_bond_amount', 'submission_deadline', 'opening_date',
      'project_location', 'project_duration_months', 'win_probability', 'notes'];

    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('tenders')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select()
      .single();

    if (updateErr) throw updateErr;
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
    const auth = await requireModulePermission(request, 'tenders', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: result, error: deleteError } = await s.rpc('delete_draft_tender_atomic', {
      p_company_id: auth.companyId,
      p_tender_id: id,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || 'تعذر حذف المناقصة');
      if (/غير موجود/.test(message)) return notFound();
      if (/دورة العمل|ضمان/.test(message)) return error(message, 409);
      throw deleteError;
    }
    return success(result);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/tenders/[id]/cost-items — Add cost breakdown item
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'create');
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    const amount = Number(body.amount);
    const categories = ['materials', 'labor', 'equipment', 'subcontractor', 'overhead', 'other'];
    if (!categories.includes(body.category) || !Number.isFinite(amount) || amount <= 0) {
      return error('الفئة والمبلغ غير صالحين');
    }
    const { data: tender } = await s.from('tenders').select('id, status')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!tender) return notFound();
    if (!['draft', 'preparing'].includes((tender as any).status)) return error('لا يمكن تعديل تكاليف مناقصة بعد تقديمها', 409);

    const itemId = generateId();
    const { data, error: insertErr } = await s.from('tender_cost_items')
      .insert({
        id: itemId,
        tender_id: id,
        company_id: auth.companyId,
        category: body.category, // materials, labor, equipment, subcontractor, overhead, other
        description: body.description || null,
        amount,
        notes: body.notes || null,
        created_by: auth.userId,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
