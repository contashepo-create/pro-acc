import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { PROJECT_EXPENSE_CODES } from '@/lib/constants';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');
    const expenseType = url.searchParams.get('expense_type');

    let query = s.from('project_expenses')
      .select('*, projects(name), contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (projectId) query = query.eq('project_id', projectId);
    if (expenseType) query = query.eq('expense_type', expenseType);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const expenses = (data || []).map((e: any) => ({
      ...e,
      project_name: e.projects?.name || null,
      contact_name: e.contacts?.name || null,
    }));

    return success({ expenses, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'projects', 'create');
    const s = sb();
    const body = await parseBody(req);

    const { project_id, expense_type, description, amount, date, contact_id, bank_safe_id, notes, tax_rate, tax_enabled } = body;

    if (!project_id || !expense_type || !description || !amount || !date) {
      return error('project_id, expense_type, description, amount, date are required');
    }

    const expenseAmount = Number(amount);
    if (!Number.isFinite(expenseAmount) || expenseAmount <= 0 || Math.abs(expenseAmount * 100 - Math.round(expenseAmount * 100)) > 1e-8) {
      return error('المبلغ يجب أن يكون موجباً وبمنزلتين عشريتين كحد أقصى');
    }

    if (!PROJECT_EXPENSE_CODES[expense_type]) {
      return error('expense_type must be one of: materials, labor, subcontractor, equipment, other');
    }

    const { data: project } = await s.from('projects')
      .select('id, name, status')
      .eq('id', project_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!project) return error('المشروع غير موجود', 404);

    if ((project as any).status === 'completed' || (project as any).status === 'cancelled') {
      return error('لا يمكن تسجيل مصروفات على مشروع مكتمل أو ملغى');
    }

    // الطرف المحدد (إن وُجد) يجب أن ينتمي للشركة
    if (contact_id) {
      const { data: contact } = await s.from('contacts')
        .select('id').eq('id', contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف المحدد غير موجود', 404);
    }

    const accountCode = PROJECT_EXPENSE_CODES[expense_type];

    const { data: expenseAcc } = await s.from('accounts')
      .select('id')
      .eq('code', accountCode)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!expenseAcc) return error(`حساب المصروف برمز ${accountCode} غير موجود`);

    const vRate=(tax_enabled && tax_rate!==undefined) ? Number(tax_rate) : 0;
    if (!Number.isFinite(vRate) || vRate<0 || vRate>1 || Math.abs(vRate*10000-Math.round(vRate*10000))>1e-8) return error('نسبة الضريبة غير صالحة');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || typeof description!=='string' || !description.trim() || description.length>2000) return error('التاريخ أو الوصف غير صالح');
    if (notes!==undefined && (typeof notes!=='string' || notes.length>2000)) return error('الملاحظات غير صالحة');
    const { data: expense, error: rpcErr } = await s.rpc('post_project_expense', {
      p_company_id: auth.companyId,
      p_project_id: project_id,
      p_expense_type: expense_type,
      p_description: description.trim(),
      p_amount: expenseAmount,
      p_date: date,
      p_contact_id: contact_id || null,
      p_bank_safe_id: bank_safe_id || null,
      p_expense_account_id: expenseAcc.id,
      p_notes: typeof notes==='string' ? notes.trim() : '',
      p_tax_rate: vRate,
      p_created_by: auth.userId,
    });
    if (rpcErr) throw rpcErr;
    return success(expense,201);
  } catch (err) {
    return handleApiError(err);
  }
}
