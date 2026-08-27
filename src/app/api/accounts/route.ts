import {NextRequest} from 'next/server';
import {success, error, requireModulePermission, handleApiError, parseBody} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';
import {accountSchema} from '@/lib/validation';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'accounts', 'read');
    const s = sb();

    const accountSelect = 'id, code, name, name_en, type, parent_id, is_active, is_header, created_at';
    let { data, error: queryError } = await s.from('accounts')
      .select(accountSelect)
      .eq('company_id', auth.companyId)
      .order('code');

    if (queryError && /is_header|42703|Could not find/i.test(queryError.message || '')) {
      const fallback = await s.from('accounts')
        .select('id, code, name, name_en, type, parent_id, is_active, created_at')
        .eq('company_id', auth.companyId)
        .order('code');
      data = fallback.data || [];
      queryError = fallback.error;
    }

    if (queryError) throw queryError;

    // AUTO-SEED: إذا لم تكن شجرة الحسابات موجودة للشركة، أنشئ الشجرة الافتراضية تلقائياً
    const { DEFAULT_CHART_OF_ACCOUNTS, createDefaultChartOfAccounts, ensureDefaultCashSafe } = await import('@/lib/default-accounts');
    const existingCodes = new Set((data || []).map((a: Row) => a.code));
    const missingDefaults = DEFAULT_CHART_OF_ACCOUNTS.some((a) => !existingCodes.has(a.code));

    if (!data || data.length === 0 || missingDefaults) {
      await createDefaultChartOfAccounts(s, auth.companyId);

      const refetch = await s.from('accounts')
        .select(accountSelect)
        .eq('company_id', auth.companyId)
        .order('code');
      data = refetch.data || [];
    } else {
      await ensureDefaultCashSafe(s, auth.companyId);
    }

    const { HEADER_ACCOUNT_CODES } = await import('@/lib/account-resolve');
    interface AccountNode extends Row {
      children: Row[];
    }
    const accounts: AccountNode[] = (data || []).map((a: Row) => ({
      ...a,
      is_header: a.is_header === true || HEADER_ACCOUNT_CODES.has(String(a.code)),
      children: [] as Row[],
    }));
    const accountMap = new Map<string, AccountNode>(
      accounts.map((a: AccountNode) => [String(a.id), a])
    );
    const roots: AccountNode[] = [];

    for (const acc of accounts) {
      const parentId = acc.parent_id == null ? null : String(acc.parent_id);
      if (parentId && accountMap.has(parentId)) {
        accountMap.get(parentId)!.children.push(acc);
      } else {
        roots.push(acc);
      }
    }

    for (const acc of accounts) {
      if (acc.children.length > 0) acc.is_header = true;
    }

    return success({ accounts: roots });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'accounts', 'create');
    const s = sb();

    const body = await parseBody(request);
    const parsed = accountSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { code, name, nameEn, type, parentId, isActive } = parsed.data;

    const depthLimit = 10;
    if (parentId) {
      const { data: parent } = await s.from('accounts')
        .select('id')
        .eq('id', parentId)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!parent) {
        return error('الحساب الأب غير موجود');
      }

      let depth = 1;
      let currentParent: string | null = parentId;
      while (currentParent) {
        const { data: p } = await s.from('accounts')
          .select('parent_id')
          .eq('id', currentParent)
          .eq('company_id', auth.companyId)
          .maybeSingle();
        if (!p) break;
        currentParent = p.parent_id == null ? null : String(p.parent_id);
        depth++;
        if (depth > depthLimit) {
          return error(`لا يمكن تجاوز ${depthLimit} مستويات في شجرة الحسابات`);
        }
      }
    }

    const { data: existing } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', code)
      .maybeSingle();
    if (existing) {
      return error('رمز الحساب موجود مسبقاً');
    }

    const { data: created, error: insertError } = await s.from('accounts')
      .insert({
        company_id: auth.companyId,
        code,
        name,
        name_en: nameEn || null,
        type,
        parent_id: parentId || null,
        is_active: isActive ?? true,
      })
      .select('id, code, name, name_en, type, parent_id, is_active, created_at')
      .single();

    if (insertError) throw insertError;

    return success(created, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
