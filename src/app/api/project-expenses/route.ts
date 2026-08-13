import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireApiAuth, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createJournalEntry } from '@/lib/journal-utils';
import { ACCOUNT_CODES, PROJECT_EXPENSE_CODES } from '@/lib/constants';

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

    if (queryError) {
      console.warn('Project expenses table query error:', queryError);
      return success({ expenses: [], total: 0, page, pageSize });
    }

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
    if (!(expenseAmount > 0)) return error('المبلغ يجب أن يكون موجباً');

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

    let paymentAccountId: string | null = null;
    if (bank_safe_id) {
      const { data: bankSafe } = await s.from('banks_safes')
        .select('account_id')
        .eq('id', bank_safe_id)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!bankSafe?.account_id) return error('الخزينة/البنك غير موجود أو بلا حساب محاسبي', 404);
      paymentAccountId = (bankSafe as any).account_id;
    }

    if (!paymentAccountId) {
      const { data: cashAcc } = await s.from('accounts')
        .select('id')
        .eq('code', ACCOUNT_CODES.CASH)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (cashAcc) paymentAccountId = (cashAcc as any).id;
    }

    if (!paymentAccountId) return error('لم يتم العثور على حساب النقدية أو البنك');

    // VAT calculation (input VAT)
    const vRate = (tax_enabled && tax_rate) ? Number(tax_rate) : 0;
    const taxAmount = expenseAmount * vRate;
    const totalPayment = expenseAmount + taxAmount;

    // Build journal lines: debit expense (net) + debit VAT_PURCHASES + credit cash (total)
    const journalLines: any[] = [
      {
        account_id: expenseAcc.id,
        debit: expenseAmount,
        credit: 0,
        description: `${description} (${expense_type})`,
        project_id: project_id,
        contact_id: contact_id || null,
      },
      {
        account_id: paymentAccountId,
        debit: 0,
        credit: totalPayment,
        description: `دفع مصروف مشروع: ${description}`,
        project_id: project_id,
        contact_id: contact_id || null,
      },
    ];

    // إلزامي وجود حساب ضريبة المدخلات عند احتساب ضريبة — وإلا قيد غير متوازن
    if (taxAmount > 0) {
      const { data: vatPurchAcc } = await s.from('accounts')
        .select('id')
        .eq('code', ACCOUNT_CODES.VAT_PURCHASES)
        .eq('company_id', auth.companyId)
        .maybeSingle();
      if (!vatPurchAcc) return error('حساب ضريبة المشتريات (1180) غير موجود');
      journalLines.push({
        account_id: (vatPurchAcc as any).id,
        debit: taxAmount,
        credit: 0,
        description: `ضريبة مدخلات: ${description}`,
        project_id: project_id,
        contact_id: contact_id || null,
      });
    }

    // 1. سجل المصروف أولاً (journal_entry_id مؤقتاً null)
    const { data: expense, error: insertErr } = await s.from('project_expenses')
      .insert({
        company_id: auth.companyId,
        project_id,
        expense_type,
        description,
        amount: expenseAmount,
        date,
        contact_id: contact_id || null,
        account_code: accountCode,
        journal_entry_id: null,
        notes: notes || null,
        tax_rate: vRate,
        tax_amount: taxAmount,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    // 2. قيد المحاسبة — فشله يلغي المصروف بالكامل (لا مصروف بلا قيد)
    const je = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: `مصروف مشروع: ${description} - ${(project as any).name}`,
      lines: journalLines,
      reference_type: 'project_expense',
      reference_id: expense.id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('project_expenses').delete().eq('id', expense.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد مصروف المشروع');
    }

    // 3. اربط القيد بالمصروف
    const { data: linked, error: linkErr } = await s.from('project_expenses')
      .update({ journal_entry_id: je.journalId })
      .eq('id', expense.id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) {
      // تراجع: احذف القيد والمصروف معاً
      await s.from('journal_lines').delete().eq('journal_entry_id', je.journalId);
      await s.from('journal_entries').delete().eq('id', je.journalId).eq('company_id', auth.companyId);
      await s.from('project_expenses').delete().eq('id', expense.id).eq('company_id', auth.companyId);
      throw linkErr;
    }

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
