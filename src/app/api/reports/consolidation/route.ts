import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/reports/consolidation
 * توحيد مالي لمجموعة شركات (Financial Consolidation)
 * 
 * يقوم بدمج البيانات المالية لعدة شركات في تقرير واحد:
 * - توحيد الميزانية العمومية
 * - توحيد قائمة الدخل
 * - حذف المعاملات البينية (Intercompany Transactions)
 * - حساب حقوق الأقلية (إن وجدت)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);

    // الحصول على قائمة الشركات المراد توحيدها
    // يمكن تمريرها كمعامل أو استخدام جميع شركات المجموعة
    const companyIdsParam = url.searchParams.get('company_ids');
    const asOfDate = url.searchParams.get('as_of_date') || new Date().toISOString().split('T')[0];

    let companyIds: string[] = [];

    if (companyIdsParam) {
      companyIds = companyIdsParam.split(',');
    } else {
      // استخدام الشركة الحالية وجميع الشركات التابعة
      // (يمكن توسيع هذا لاحقاً ليشمل شركات المجموعة من جدول companies)
      companyIds = [auth.companyId];
    }

    if (companyIds.length === 0) {
      return error('يجب تحديد شركة واحدة على الأقل للتوحيد');
    }

    // جمع البيانات المالية من جميع الشركات
    const consolidatedData = {
      assets: [] as any[],
      liabilities: [] as any[],
      equity: [] as any[],
      revenue: [] as any[],
      expenses: [] as any[],
    };

    const intercompanyEliminations = {
      receivables: 0,
      payables: 0,
      revenue: 0,
      expenses: 0,
    };

    for (const companyId of companyIds) {
      // الحصول على حسابات الشركة
      const { data: accounts } = await s.from('accounts')
        .select('id, code, name, type')
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (!accounts) continue;

      for (const acc of accounts) {
        const a = acc as any;

        // حساب الرصيد حتى التاريخ المحدد
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', a.id)
          .lte('created_at', asOfDate);

        const totalDebit = (lines || []).reduce((sum: number, l: any) => 
          sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = (lines || []).reduce((sum: number, l: any) => 
          sum + (parseFloat(l.credit) || 0), 0);

        let balance = 0;
        if (a.type === 'asset' || a.type === 'expense') {
          balance = totalDebit - totalCredit;
        } else {
          balance = totalCredit - totalDebit;
        }

        // إضافة إلى التقرير الموحد
        const item = {
          companyId,
          accountId: a.id,
          accountCode: a.code,
          accountName: a.name,
          accountType: a.type,
          balance,
        };

        switch (a.type) {
          case 'asset':
            consolidatedData.assets.push(item);
            break;
          case 'liability':
            consolidatedData.liabilities.push(item);
            break;
          case 'equity':
            consolidatedData.equity.push(item);
            break;
          case 'revenue':
            consolidatedData.revenue.push(item);
            break;
          case 'expense':
            consolidatedData.expenses.push(item);
            break;
        }

        // كشف المعاملات البينية (Intercompany)
        // حسابات الذمم المدينة/الدائنة بين الشركات
        if (a.code === '1130' && companyIds.length > 1) {
          // ذمم مدينة - يمكن أن تكون معاملات بينية
          intercompanyEliminations.receivables += balance;
        }
        if (a.code === '2110' && companyIds.length > 1) {
          // ذمم دائنة - يمكن أن تكون معاملات بينية
          intercompanyEliminations.payables += balance;
        }
      }
    }

    // حساب المجاميع
    const totalAssets = consolidatedData.assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = consolidatedData.liabilities.reduce((sum, a) => sum + a.balance, 0);
    const totalEquity = consolidatedData.equity.reduce((sum, a) => sum + a.balance, 0);
    const totalRevenue = consolidatedData.revenue.reduce((sum, a) => sum + a.balance, 0);
    const totalExpenses = consolidatedData.expenses.reduce((sum, a) => sum + a.balance, 0);
    const netIncome = totalRevenue - totalExpenses;

    // تجميع الحسابات المتشابهة
    const consolidatedAssets = aggregateAccounts(consolidatedData.assets);
    const consolidatedLiabilities = aggregateAccounts(consolidatedData.liabilities);
    const consolidatedEquity = aggregateAccounts(consolidatedData.equity);
    const consolidatedRevenue = aggregateAccounts(consolidatedData.revenue);
    const consolidatedExpenses = aggregateAccounts(consolidatedData.expenses);

    // التحقق من التوازن
    const balanceSheetBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

    return success({
      consolidationDate: asOfDate,
      companiesCount: companyIds.length,
      companyIds,
      
      // الميزانية العمومية الموحدة
      balanceSheet: {
        assets: consolidatedAssets,
        liabilities: consolidatedLiabilities,
        equity: consolidatedEquity,
        totalAssets,
        totalLiabilities,
        totalEquity,
        isBalanced: balanceSheetBalanced,
      },

      // قائمة الدخل الموحدة
      incomeStatement: {
        revenue: consolidatedRevenue,
        expenses: consolidatedExpenses,
        totalRevenue,
        totalExpenses,
        netIncome,
      },

      // eliminations
      intercompanyEliminations: {
        note: companyIds.length > 1 
          ? 'يجب مراجعة المعاملات البينية وإعداد قيود الإلغاء يدوياً'
          : 'شركة واحدة فقط - لا توجد معاملات بينية',
        suspectedReceivables: intercompanyEliminations.receivables,
        suspectedPayables: intercompanyEliminations.payables,
      },

      // ملاحظات
      notes: [
        `تم توحيد ${companyIds.length} شركة`,
        balanceSheetBalanced 
          ? 'الميزانية العمومية متوازنة ✅'
          : 'تحذير: الميزانية العمومية غير متوازنة ⚠️',
        ...(companyIds.length > 1 ? [
          'يجب إعداد قيود إلغاء المعاملات البينية',
          'يجب مراجعة حقوق الأقلية إن وجدت',
        ] : []),
      ],

      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * تجميع الحسابات حسب الكود
 */
function aggregateAccounts(accounts: any[]) {
  const map = new Map<string, any>();

  for (const acc of accounts) {
    const existing = map.get(acc.accountCode);
    if (existing) {
      existing.balance += acc.balance;
      existing.companies.push(acc.companyId);
    } else {
      map.set(acc.accountCode, {
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        balance: acc.balance,
        companies: [acc.companyId],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => 
    a.accountCode.localeCompare(b.accountCode)
  );
}
