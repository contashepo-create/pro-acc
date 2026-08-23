import { NextRequest } from 'next/server';
import { success, error, parseBody, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { loadCustodyFile, assertFileOpen } from '@/lib/custody';
import { custodyExpenseSchema, custodyUuid } from '@/lib/custody-validation';

import type { Row } from '@/lib/types';

/** Posts an expense against account 1150; any explicitly approved excess is
 * accrued to the employee and is not paid in cash a second time. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'update');
    const { id } = await params;
    if (!custodyUuid.safeParse(id).success) return error('معرف ملف العهدة غير صالح');
    const parsed = custodyExpenseSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات مصروف العهدة غير صالحة');
    const input = parsed.data;

    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return error('ملف العهدة غير موجود', 404);
    assertFileOpen(file);
    const s = getSupabase();

    let projectId: string | null | undefined = file.project_id as string | null | undefined;
    if (input.link_to_project === false) {
      projectId = null;
    } else if (input.project_id) {
      const { data: project } = await s.from('projects').select('id').eq('id', input.project_id)
        .eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع غير موجود', 404);
      projectId = String(project.id);
    }

    const expenseCode = input.expense_account_code || ACCOUNT_CODES.DIRECT_COSTS;
    const { data: expenseAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId)
      .eq('code', expenseCode).eq('type', 'expense').eq('is_active', true).eq('is_header', false).maybeSingle();
    if (!expenseAccount?.id) return error('حساب المصروف غير موجود أو غير صالح');

    const { data: updated, error: rpcError } = await s.rpc('post_custody_expense', {
      p_company_id: auth.companyId,
      p_custody_id: id,
      p_date: input.date || new Date().toISOString().slice(0, 10),
      p_amount: input.amount,
      p_description: input.description,
      p_expense_account_id: expenseAccount.id,
      p_project_id: projectId,
      p_allow_excess: input.allow_excess === true,
      p_invoice_id: input.invoice_id || null,
      p_purchase_invoice_id: input.purchase_invoice_id || null,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    const result = updated as Row;
    return success({
      ...result,
      message: Number(result.excess) > 0
        ? `خُصم ${result.applied_from_custody} من الملف وسُجّل ${result.excess} مستحقاً للموظف`
        : `خُصم ${result.applied_from_custody} من الملف دون تكرار الصرف`,
    }, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
