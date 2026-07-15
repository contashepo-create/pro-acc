import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
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
      .eq('tender_id', id);

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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();
    const { action } = body;

    // Handle status change
    if (action === 'update_status') {
      const { status, notes } = body;
      if (!status) return error('الحالة مطلوبة');

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

      // Create project from tender
      const projectId = generateId();
      const { data: project, error: projErr } = await s.from('projects')
        .insert({
          id: projectId,
          company_id: auth.companyId,
          name: t.title,
          description: t.description || null,
          location: t.project_location || null,
          budget: t.estimated_value || 0,
          start_date: new Date().toISOString().split('T')[0],
          end_date: t.project_duration_months
            ? new Date(Date.now() + parseInt(t.project_duration_months) * 30 * 86400000).toISOString().split('T')[0]
            : null,
          status: 'active',
          tender_id: id,
          created_by: auth.userId,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (projErr) throw projErr;

      // Update tender with project reference
      await s.from('tenders')
        .update({ project_id: projectId, updated_at: new Date().toISOString() })
        .eq('id', id);

      return success({ project, tender_id: id }, 201);
    }

    // Regular update
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    await s.from('tender_cost_items').delete().eq('tender_id', id);
    await s.from('tenders').delete().eq('id', id).eq('company_id', auth.companyId);

    return success({ deleted: true });
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await request.json();

    if (!body.category || !body.amount) {
      return error('الفئة والمبلغ مطلوبان');
    }

    const itemId = generateId();
    const { data, error: insertErr } = await s.from('tender_cost_items')
      .insert({
        id: itemId,
        tender_id: id,
        company_id: auth.companyId,
        category: body.category, // materials, labor, equipment, subcontractor, overhead, other
        description: body.description || null,
        amount: body.amount,
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
