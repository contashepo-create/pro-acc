import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, error, parseBody, requireModulePermission } from '@/lib/api-helpers';

const sb = () => getSupabase();
const terminalSchema = z.object({
  code: z.string().trim().min(1, 'كود الطرفية مطلوب').max(100),
  name: z.string().trim().min(1, 'اسم الطرفية مطلوب').max(300),
  bank_safe_id: z.string().uuid('الخزينة غير صالحة'),
  branch_id: z.string().uuid('الفرع غير صالح').nullable().optional(),
}).strict();
const COLUMNS = 'id, branch_id, code, name, bank_safe_id, is_active, created_at, banks_safes!bank_safe_id(name), branches!branch_id(name)';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'read');
    const { data, error: queryError } = await sb().from('pos_terminals').select(COLUMNS)
      .eq('company_id', auth.companyId).order('code').range(0, 499);
    if (queryError) throw queryError;
    const terminals = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      bank_safe_name: (row.banks_safes as { name?: string } | null)?.name || null,
      branch_name: (row.branches as { name?: string } | null)?.name || null,
      banks_safes: undefined, branches: undefined,
    }));
    return success({ terminals, truncated: terminals.length === 500 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'pos', 'create');
    const parsed = terminalSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const value = parsed.data;
    const { data, error: createError } = await sb().rpc('create_pos_terminal_atomic', {
      p_company_id: auth.companyId,
      p_code: value.code,
      p_name: value.name,
      p_bank_safe_id: value.bank_safe_id,
      p_branch_id: value.branch_id || null,
      p_user_id: auth.userId,
    });
    const message = String(createError?.message || '');
    if (message.includes('غير موجود')) return error(message, 404);
    if (message.includes('مستخدم مسبقاً') || createError?.code === '23505') return error('كود الطرفية مستخدم مسبقاً', 409);
    if (createError) throw createError;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
