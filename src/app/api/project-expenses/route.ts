import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { deliveryDate, deliveryUuid, projectExpenseCreateSchema } from '@/lib/project-delivery-validation';
import { PROJECT_EXPENSE_CODES } from '@/lib/constants';

const EXPENSE_COLUMNS = `id,project_id,expense_type,description,amount,date,contact_id,journal_entry_id,status,
  approved_by,approved_at,notes,created_at,updated_at,projects(name),contacts(name),users(name)`;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('project_id') || url.searchParams.get('projectId');
    const fromDate = url.searchParams.get('from_date');
    const toDate = url.searchParams.get('to_date');
    if (projectId && !deliveryUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    if (fromDate && !deliveryDate.safeParse(fromDate).success) return error('تاريخ البداية غير صالح');
    if (toDate && !deliveryDate.safeParse(toDate).success) return error('تاريخ النهاية غير صالح');
    if (fromDate && toDate && fromDate > toDate) return error('نطاق التاريخ غير صالح');
    let query = getSupabase().from('project_expenses').select(EXPENSE_COLUMNS, { count: 'exact' }).eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);
    if (fromDate) query = query.gte('date', fromDate);
    if (toDate) query = query.lte('date', toDate);
    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query.order('date', { ascending: false }).range(offset, offset + pageSize - 1);
    if (queryError) throw queryError;
    const expenses = (data || []).map((row: any) => ({ ...row, project_name: row.projects?.name || null, projects: undefined }));
    return success({ expenses, total: count || 0, page, pageSize });
  } catch (cause) {
    return handleApiError(cause);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'create');
    const parsed = projectExpenseCreateSchema.safeParse(await parseBody(req));
    if (!parsed.success) return error(parsed.error.issues[0]?.message || 'بيانات المصروف غير صالحة');
    const input = parsed.data;
    const supabase = getSupabase();
    const [projectResult, expenseAccountResult, bankResult] = await Promise.all([
      supabase.from('projects').select('id').eq('id', input.project_id).eq('company_id', auth.companyId).maybeSingle(),
      supabase.from('accounts').select('id').eq('company_id', auth.companyId)
        .eq('code', PROJECT_EXPENSE_CODES[input.expense_type]).eq('is_active', true).maybeSingle(),
      input.bank_safe_id
        ? supabase.from('banks_safes').select('id').eq('id', input.bank_safe_id).eq('company_id', auth.companyId).eq('is_active', true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (projectResult.error) throw projectResult.error;
    if (expenseAccountResult.error) throw expenseAccountResult.error;
    if (bankResult.error) throw bankResult.error;
    const project = projectResult.data;
    const expenseAccount = expenseAccountResult.data;
    if (!project) return error('المشروع غير موجود');
    if (!expenseAccount) return error('حساب مصروفات المشاريع غير موجود');
    if (input.bank_safe_id && !bankResult.data) return error('الخزينة أو البنك غير موجود');
    if (input.contact_id) {
      const { data: contact, error: contactError } = await supabase.from('contacts').select('id').eq('id', input.contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (contactError) throw contactError;
      if (!contact) return error('جهة الاتصال غير موجودة');
    }
    const taxRate = input.tax_enabled === false ? 0 : (input.tax_rate || 0);
    const { data, error: rpcError } = await supabase.rpc('post_project_expense', {
      p_company_id: auth.companyId, p_project_id: input.project_id, p_expense_type: input.expense_type,
      p_description: input.description, p_amount: input.amount, p_date: input.date,
      p_contact_id: input.contact_id || null, p_bank_safe_id: input.bank_safe_id || null,
      p_expense_account_id: expenseAccount.id, p_notes: input.notes || '', p_tax_rate: taxRate,
      p_created_by: auth.userId,
    });
    if (rpcError) throw rpcError;
    try {
      const { logAudit } = await import('@/lib/audit');
      await logAudit({
        company_id: auth.companyId, user_id: auth.userId, entity_type: 'project_expense',
        entity_id: String((data as any)?.id || ''), action: 'create',
        after: {
          id: (data as any)?.id, project_id: input.project_id, expense_type: input.expense_type,
          amount: input.amount, date: input.date, status: (data as any)?.status,
        },
        summary: `مصروف مشروع (${input.expense_type}) بقيمة ${input.amount}`,
      });
    } catch (auditError) {
      console.error('Project expense audit write failed:', auditError);
    }
    return success(data, 201);
  } catch (cause) {
    return handleApiError(cause);
  }
}
