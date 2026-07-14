import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import type { } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data, error: queryError } = await s.from('accounts')
      .select('id, code, name, name_en, type, parent_id, is_active, currency, created_at')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (queryError || !data) return notFound();

    const { data: children } = await s.from('accounts')
      .select('id, code, name, type, parent_id, is_active')
      .eq('parent_id', id)
      .eq('company_id', auth.companyId)
      .order('code');

    return success({ ...(data as Record<string, any>), children: children || [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
    const { id } = await paramsPromise;
    const s = sb();

    const body = await parseBody<{ code?: string; name?: string; is_active?: boolean }>(request);

    const { data: existing } = await s.from('accounts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    if (body.code) {
      if (!/^\d{4}$/.test(body.code)) {
        return error('رمز الحساب يجب أن يكون 4 أرقام');
      }
      const { data: dup } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', body.code)
        .neq('id', id)
        .maybeSingle();
      if (dup) {
        return error('رمز الحساب موجود مسبقاً لحساب آخر');
      }
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.code !== undefined) updateData.code = body.code;
    if (body.name !== undefined) updateData.name = body.name;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    const { data: updated, error: updateError } = await s.from('accounts')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('id, code, name, name_en, type, parent_id, is_active, currency, created_at')
      .single();

    if (updateError) throw updateError;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await paramsPromise;
    const s = sb();

    const { data: account } = await s.from('accounts')
      .select('id, code, name')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!account) return notFound();

    const { data: children } = await s.from('accounts')
      .select('id')
      .eq('parent_id', id)
      .eq('company_id', auth.companyId)
      .limit(1);
    if (children && children.length > 0) {
      return error('لا يمكن حذف حساب له حسابات فرعية. قم بنقل أو حذف الحسابات الفرعية أولاً');
    }

    const { data: jes } = await s.from('journal_entries')
      .select('id')
      .eq('company_id', auth.companyId);
    const jeIds = (jes || []).map((je: any) => je.id);
    if (jeIds.length > 0) {
      const { data: lines } = await s.from('journal_lines')
        .select('id')
        .eq('account_code', account.code)
        .in('journal_entry_id', jeIds)
        .limit(1);
      if (lines && lines.length > 0) {
        return error('لا يمكن حذف حساب له قيود محاسبية. قم بإلغاء تنشيط الحساب بدلاً من حذفه');
      }
    }

    const { error: deleteError } = await s.from('accounts')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);
    if (deleteError) throw deleteError;

    return success({ message: 'تم حذف الحساب بنجاح' });
  } catch (err) {
    return handleApiError(err);
  }
}
