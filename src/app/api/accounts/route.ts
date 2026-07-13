import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { accountSchema } from '@/lib/validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    const { data, error: queryError } = await s.from('accounts')
      .select('id, code, name, name_en, type, parent_id, is_active, created_at')
      .eq('company_id', auth.companyId)
      .order('code');

    if (queryError) throw queryError;

    const accounts: any[] = (data || []).map((a: any) => ({ ...a, children: [] as any[] }));
    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));
    const roots: any[] = [];

    for (const acc of accounts) {
      if (acc.parent_id && accountMap.has(acc.parent_id)) {
        accountMap.get(acc.parent_id)!.children.push(acc);
      } else {
        roots.push(acc);
      }
    }

    return success({ accounts: roots });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
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
        const { data: p }: any = await s.from('accounts')
          .select('parent_id')
          .eq('id', currentParent)
          .eq('company_id', auth.companyId)
          .maybeSingle();
        if (!p) break;
        currentParent = p.parent_id;
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
