import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, requireModulePermission, requireManagerOrAbove, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { accountUpdateSchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'accounts', 'read');
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
    const auth = await requireModulePermission(request, 'accounts', 'update');
    const { id } = await paramsPromise;
    const s = sb();

    const body = await parseBody(request);
    const parsed = accountUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }
    const fields = parsed.data;

    const { data: existing } = await s.from('accounts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!existing) return notFound();

    if (fields.code) {
      const { data: dup } = await s.from('accounts')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('code', fields.code)
        .neq('id', id)
        .maybeSingle();
      if (dup) {
        return error('رمز الحساب موجود مسبقاً لحساب آخر');
      }
    }

    const isActive = fields.is_active ?? fields.isActive;
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (fields.code !== undefined) updateData.code = fields.code;
    if (fields.name !== undefined) updateData.name = fields.name;
    if (fields.nameEn !== undefined) updateData.name_en = fields.nameEn;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data: updated, error: updateError } = await s.from('accounts')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('id, code, name, name_en, type, parent_id, is_active, currency, created_at')
      .single();

    if (updateError) throw updateError;

    // إعادة تسمية/ترقيم حساب مستخدم في القيود: حدّث الحقول المكررة في سطور
    // القيد (account_code/account_name) حتى تبقى التقارير متسقة بعد إعادة الترقيم.
    if (fields.code !== undefined || fields.name !== undefined) {
      const { data: used } = await s.from('journal_lines')
        .select('id')
        .eq('company_id', auth.companyId)
        .eq('account_id', id)
        .limit(1);
      if (used && used.length > 0) {
        const linePatch: Record<string, any> = {};
        if (fields.code !== undefined) linePatch.account_code = fields.code;
        if (fields.name !== undefined) linePatch.account_name = fields.name;
        await s.from('journal_lines')
          .update(linePatch)
          .eq('company_id', auth.companyId)
          .eq('account_id', id);
      }
    }

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

    // Journal usage check — journal_lines is company-scoped, so query it
    // directly. Check BOTH the FK (account_id) and the denormalized code:
    // lines store both, and old lines may only carry one of them.
    const { data: linesById } = await s.from('journal_lines')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('account_id', id)
      .limit(1);
    const { data: linesByCode } = await s.from('journal_lines')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('account_code', account.code)
      .limit(1);
    if ((linesById && linesById.length > 0) || (linesByCode && linesByCode.length > 0)) {
      return error('لا يمكن حذف حساب له قيود محاسبية. قم بإلغاء تنشيط الحساب بدلاً من حذفه');
    }

    // Operational linkage: a bank/safe or fixed asset pointing at this account
    // would be orphaned by the delete.
    const { data: linkedBanks } = await s.from('banks_safes')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('account_id', id)
      .limit(1);
    if (linkedBanks && linkedBanks.length > 0) {
      return error('لا يمكن حذف حساب مرتبط بخزينة أو بنك. افصل الارتباط أولاً');
    }

    const { data: linkedAssets } = await s.from('fixed_assets')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('asset_account_id', id)
      .limit(1);
    if (linkedAssets && linkedAssets.length > 0) {
      return error('لا يمكن حذف حساب مرتبط بأصل ثابت. افصل الارتباط أولاً');
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
