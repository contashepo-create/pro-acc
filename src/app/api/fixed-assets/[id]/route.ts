import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { postReversalEntry } from '@/lib/voucher-utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'read');
    const { id } = await params;
    const { data, error: qErr } = await sb().from('fixed_assets')
      .select('*').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (qErr) throw qErr;
    if (!data) return notFound();
    const a = data as any;
    return success({
      ...a,
      net_book_value: (a.purchase_cost || 0) - (a.accumulated_depreciation || 0),
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
    const auth = await requireModulePermission(request, 'fixed_assets', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

    const { data: existing } = await s.from('fixed_assets')
      .select('id, status').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if ((existing as any).status === 'disposed') return error('لا يمكن تعديل أصل مستبعد',409);
    const financialFields = ['code','category','purchase_date','purchase_cost','useful_life_years','depreciation_rate','depreciation_method','asset_account_id','depreciation_account_id'];
    if (financialFields.some((field) => body[field]!==undefined)) return error('لا يمكن تعديل البيانات المالية لأصل مرحّل؛ استخدم استبعاداً وتصحيحاً محاسبياً',409);
    const updateData: any = {};
    for (const key of ['name','location','notes']) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || body[key].length > (key==='notes'?2000:500) || (key==='name' && !body[key].trim())) return error('بيانات الأصل غير صالحة');
        updateData[key] = body[key].trim() || null;
      }
    }
    if (!Object.keys(updateData).length) return error('لا توجد حقول قابلة للتعديل');

    const { data: updated, error: updErr } = await s.from('fixed_assets')
      .update(updateData).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (updErr) throw updErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'fixed_assets', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: existing } = await s.from('fixed_assets')
      .select('id, accumulated_depreciation, journal_entry_id, status')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    // أصل مُهلك (له إهلاك متراكم أو سجل إهلاك) لا يُحذف — عطّله بدلاً من ذلك
    if ((parseFloat((existing as any).accumulated_depreciation) || 0) > 0) {
      return error('لا يمكن حذف أصل مُهلك — عطّله بدلاً من الحذف');
    }
    const { data: logs } = await s.from('depreciation_log')
      .select('id').eq('asset_id', id).eq('company_id', auth.companyId).limit(1);
    if (logs && logs.length > 0) {
      return error('لا يمكن حذف أصل له سجل إهلاك — عطّله بدلاً من الحذف');
    }

    // Financial records are immutable: reverse the acquisition entry and mark
    // the asset disposed instead of deleting ledger history.
    if ((existing as any).status === 'disposed') return error('الأصل مستبعد بالفعل',409);
    if ((existing as any).journal_entry_id) {
      const { error: reversalError } = await postReversalEntry(auth.companyId, {
        journalEntryId: (existing as any).journal_entry_id,
        referenceType: 'fixed_asset_disposal_reversal',
        referenceId: id,
        description: 'عكس قيد شراء أصل ثابت عند استبعاده',
        userId: auth.userId,
      });
      if (reversalError) throw reversalError;
    }

    const { error: disposeError } = await s.from('fixed_assets')
      .update({ status: 'disposed' })
      .eq('id', id).eq('company_id', auth.companyId);
    if (disposeError) throw disposeError;
    return success({ disposed: true });
  } catch (err) {
    return handleApiError(err);
  }
}
