import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import {
  relationshipUuid, tenderConversionSchema, tenderCostItemSchema, tenderExpenseSchema, tenderStatusSchema, tenderUpdateSchema,
} from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'read');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف المناقصة غير صالح');
    const s = sb();
    const { data: tender, error: tenderError } = await s.from('tenders').select('*, contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (tenderError) throw tenderError;
    if (!tender) return notFound();
    const { data: costItems, error: costsError } = await s.from('tender_cost_items').select('*')
      .eq('tender_id', id).eq('company_id', auth.companyId).order('created_at');
    if (costsError) throw costsError;
    const { data: expenses, error: expensesError } = await s.from('tender_expenses').select('*')
      .eq('tender_id', id).eq('company_id', auth.companyId).order('date', { ascending: false });
    if (expensesError) throw expensesError;
    const { data: linkedBonds, error: bondsError } = await s.from('bonds').select('id,title,type,amount,status,expiry_date')
      .eq('tender_id', id).eq('company_id', auth.companyId).order('created_at');
    if (bondsError) throw bondsError;
    const row = tender as Record<string, unknown>;
    const contact = row.contacts as { name?: string } | null;
    const totalCost = (costItems || []).reduce((sum: number, item: Record<string, unknown>) => sum + (Number(item.amount) || 0), 0);
    const bidAmount = Number(row.estimated_value) || 0;
    const profitMargin = bidAmount > 0 ? ((bidAmount - totalCost) / bidAmount) * 100 : 0;
    const totalExpenses = (expenses || []).reduce((sum: number, e: Record<string, unknown>) => sum + (Number(e.amount) || 0) + (Number(e.vat_amount) || 0), 0);
    return success({
      ...row,
      contact_name: contact?.name || null,
      cost_items: costItems || [], total_cost: totalCost, bid_amount: bidAmount, profit_margin: profitMargin,
      expenses: expenses || [], total_expenses: totalExpenses,
      bonds: linkedBonds || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'update');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف المناقصة غير صالح');
    const raw = await parseBody(request);
    const action = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).action : undefined;

    if (action === 'update_status') {
      const parsed = tenderStatusSchema.safeParse(raw);
      if (!parsed.success) return error(parsed.error.issues[0].message);
      const { data, error: transitionError } = await sb().rpc('transition_tender_atomic', {
        p_company_id: auth.companyId,
        p_tender_id: id,
        p_status: parsed.data.status,
        p_notes: parsed.data.notes || null,
        p_user_id: auth.userId,
      });
      if (transitionError) return tenderMutationError(transitionError);
      if (parsed.data.status === 'lost' || parsed.data.status === 'cancelled') {
        const { error: closeError } = await sb().rpc('close_lost_tender_atomic', {
          p_company_id: auth.companyId,
          p_tender_id: id,
          p_user_id: auth.userId,
        });
        if (closeError) return tenderMutationError(closeError);
      }
      return success(data);
    }

    if (action === 'convert_to_project') {
      const parsed = tenderConversionSchema.safeParse(raw);
      if (!parsed.success) return error(parsed.error.issues[0].message);
      const { data, error: conversionError } = await sb().rpc('convert_won_tender_with_accounting_atomic', {
        p_company_id: auth.companyId,
        p_tender_id: id,
        p_user_id: auth.userId,
      });
      if (conversionError) return tenderMutationError(conversionError);
      return success(data, 201);
    }

    const parsed = tenderUpdateSchema.safeParse(raw);
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_tender_atomic', {
      p_company_id: auth.companyId,
      p_tender_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) return tenderMutationError(updateError);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'delete');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف المناقصة غير صالح');
    const { data, error: deleteError } = await sb().rpc('delete_draft_tender_atomic', {
      p_company_id: auth.companyId,
      p_tender_id: id,
      p_user_id: auth.userId,
    });
    if (deleteError) return tenderMutationError(deleteError);
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/tenders/[id] — add an atomic, tenant-bound cost item. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'tenders', 'create');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف المناقصة غير صالح');
    const raw = await parseBody(request);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'expense_type' in raw) {
      const expenseParsed = tenderExpenseSchema.safeParse(raw);
      if (!expenseParsed.success) return error(expenseParsed.error.issues[0].message);
      const { data, error: expenseError } = await sb().rpc('record_tender_expense_atomic', {
        p_company_id: auth.companyId,
        p_tender_id: id,
        p_expense_type: expenseParsed.data.expense_type,
        p_amount: expenseParsed.data.amount,
        p_vat_amount: expenseParsed.data.vat_amount || 0,
        p_bank_safe_id: expenseParsed.data.bank_safe_id,
        p_description: expenseParsed.data.description || null,
        p_date: expenseParsed.data.date || null,
        p_user_id: auth.userId,
      });
      if (expenseError) return tenderMutationError(expenseError);
      return success(data, 201);
    }

    const parsed = tenderCostItemSchema.safeParse(raw);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data, error: createError } = await sb().rpc('create_tender_cost_item_atomic', {
      p_company_id: auth.companyId,
      p_tender_id: id,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) return tenderMutationError(createError);
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

function tenderMutationError(mutationError: { message?: string | null }) {
  const message = String(mutationError.message || 'تعذر تنفيذ عملية المناقصة');
  if (message.includes('غير موجودة')) return notFound();
  if (message.includes('لا يمكن') || message.includes('انتقال حالة') || message.includes('مسبقاً')) return error(message, 409);
  if (message.includes('غير صالحة') || message.includes('طويلة') || message.includes('غير موجود')) return error(message);
  throw mutationError;
}
