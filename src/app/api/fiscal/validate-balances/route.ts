import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/fiscal/validate-balances
 * التحقق من جميع الحسابات واكتشاف الأرصدة السالبة غير الصحيحة
 * 
 * قواعد التحقق:
 * - الأصول: يجب أن يكون الرصيد >= 0 (مدين)
 * - الخصوم: يجب أن يكون الرصيد <= 0 (دائن)
 * - حقوق الملكية: يجب أن يكون الرصيد <= 0 (دائن)
 * - الإيرادات: يجب أن يكون الرصيد <= 0 (دائن)
 * - المصروفات: يجب أن يكون الرصيد >= 0 (مدين)
 * 
 * بعض الحسابات يمكن أن يكون لها رصيد عكسي (contra accounts):
 * - مجمع الإهلاك (1290): رصيد دائن (عكس الأصول)
 * - مخصص الديون المشكوك فيها: رصيد دائن (عكس الذمم المدينة)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // الحصول على جميع الحسابات النشطة
    const { data: accounts } = await s.from('accounts')
      .select('id, code, name, type, parent_id')
      .eq('company_id', auth.companyId)
      .eq('is_active', true)
      .order('code');

    if (!accounts || accounts.length === 0) {
      return success({ accounts: [], issues: [], totalIssues: 0 });
    }

    // حساب أرصدة الحسابات
    const issues: any[] = [];

    for (const acc of accounts) {
      const a = acc as any;

      // حساب الرصيد من journal_lines
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit')
        .eq('account_id', a.id);

      const totalDebit = (lines || []).reduce((sum: number, l: any) => 
        sum + (parseFloat(l.debit) || 0), 0);
      const totalCredit = (lines || []).reduce((sum: number, l: any) => 
        sum + (parseFloat(l.credit) || 0), 0);

      // الرصيد = مدين - دائن
      const balance = totalDebit - totalCredit;

      // التحقق من القواعد
      let isValid = true;
      let issueType = null;
      let message = null;

      switch (a.type) {
        case 'asset':
          // الأصول يجب أن يكون رصيدها >= 0 (مدين)
          // ما عدا حسابات contra مثل مجمع الإهلاك
          if (a.code === '1290' || a.code.startsWith('129')) {
            // مجمع الإهلاك: يجب أن يكون رصيد دائن (<= 0)
            if (balance > 0.01) {
              isValid = false;
              issueType = 'contra_asset_positive';
              message = `حساب مجمع إهلاك يجب أن يكون رصيد دائن، الرصيد الحالي: ${balance.toFixed(2)}`;
            }
          } else {
            // الأصول العادية: يجب أن يكون رصيد مدين (>= 0)
            if (balance < -0.01) {
              isValid = false;
              issueType = 'asset_negative';
              message = `رصيد الأصل سالب: ${balance.toFixed(2)}`;
            }
          }
          break;

        case 'liability':
          // الخصوم يجب أن يكون رصيدها <= 0 (دائن)
          if (balance > 0.01) {
            isValid = false;
            issueType = 'liability_positive';
            message = `رصيد الخصم موجب: ${balance.toFixed(2)} (يجب أن يكون دائن)`;
          }
          break;

        case 'equity':
          // حقوق الملكية يجب أن يكون رصيدها <= 0 (دائن)
          if (balance > 0.01) {
            isValid = false;
            issueType = 'equity_positive';
            message = `رصيد حقوق الملكية موجب: ${balance.toFixed(2)} (يجب أن يكون دائن)`;
          }
          break;

        case 'revenue':
          // الإيرادات يجب أن يكون رصيدها <= 0 (دائن)
          if (balance > 0.01) {
            isValid = false;
            issueType = 'revenue_positive';
            message = `رصيد الإيراد موجب: ${balance.toFixed(2)} (يجب أن يكون دائن)`;
          }
          break;

        case 'expense':
          // المصروفات يجب أن يكون رصيدها >= 0 (مدين)
          if (balance < -0.01) {
            isValid = false;
            issueType = 'expense_negative';
            message = `رصيد المصروف سالب: ${balance.toFixed(2)} (يجب أن يكون مدين)`;
          }
          break;
      }

      if (!isValid) {
        issues.push({
          accountId: a.id,
          accountCode: a.code,
          accountName: a.name,
          accountType: a.type,
          totalDebit,
          totalCredit,
          balance,
          issueType,
          message,
          severity: balance > 10000 || balance < -10000 ? 'high' : 'medium',
        });
      }
    }

    // ترتيب المشاكل حسب الخطورة
    issues.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity as keyof typeof severityOrder] - 
             severityOrder[b.severity as keyof typeof severityOrder];
    });

    return success({
      accounts: accounts.map((a: any) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        type: a.type,
      })),
      issues,
      totalIssues: issues.length,
      highSeverity: issues.filter((i: any) => i.severity === 'high').length,
      mediumSeverity: issues.filter((i: any) => i.severity === 'medium').length,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/fiscal/validate-balances
 * التحقق من رصيد حساب محدد قبل إنشاء قيد جديد
 * يُستخدم كـ pre-validation قبل إدخال القيد
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();
    const { accountId, proposedDebit, proposedCredit } = body;

    if (!accountId || proposedDebit === undefined || proposedCredit === undefined) {
      return error('accountId, proposedDebit, proposedCredit مطلوبة');
    }

    // الحصول على معلومات الحساب
    const { data: account } = await s.from('accounts')
      .select('id, code, name, type')
      .eq('id', accountId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!account) {
      return error('الحساب غير موجود');
    }

    const acc = account as any;

    // حساب الرصيد الحالي
    const { data: lines } = await s.from('journal_lines')
      .select('debit, credit')
      .eq('account_id', accountId);

    const totalDebit = (lines || []).reduce((sum: number, l: any) => 
      sum + (parseFloat(l.debit) || 0), 0);
    const totalCredit = (lines || []).reduce((sum: number, l: any) => 
      sum + (parseFloat(l.credit) || 0), 0);

    const currentBalance = totalDebit - totalCredit;

    // حساب الرصيد المقترح بعد القيد
    const proposedBalance = currentBalance + (parseFloat(proposedDebit) || 0) - (parseFloat(proposedCredit) || 0);

    // التحقق من القواعد
    let isValid = true;
    let warning = null;

    switch (acc.type) {
      case 'asset':
        if (acc.code !== '1290' && !acc.code.startsWith('129')) {
          if (proposedBalance < -0.01) {
            isValid = false;
            warning = `الرصيد المقترح للأصل سيكون سالب: ${proposedBalance.toFixed(2)}`;
          }
        }
        break;

      case 'liability':
      case 'equity':
      case 'revenue':
        if (proposedBalance > 0.01) {
          isValid = false;
          warning = `الرصيد المقترح سيكون موجب: ${proposedBalance.toFixed(2)} (يجب أن يكون دائن)`;
        }
        break;

      case 'expense':
        if (proposedBalance < -0.01) {
          isValid = false;
          warning = `الرصيد المقترح للمصروف سيكون سالب: ${proposedBalance.toFixed(2)}`;
        }
        break;
    }

    return success({
      accountId,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.type,
      currentBalance,
      proposedBalance,
      isValid,
      warning,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
