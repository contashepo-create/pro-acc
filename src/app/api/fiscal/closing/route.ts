import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

/**
 * POST /api/fiscal/closing
 * إغلاق السنة المالية ونقل الأرباح/الخسائر إلى الأرباح المحتجزة
 * 
 * العملية:
 * 1. حساب صافي الدخل (الإيرادات - المصروفات) بدقة متضمنة نهاية تاريخ الإغلاق
 * 2. إنشاء قيد إقفال الإيرادات (مدين: الإيرادات، دائن: أرباح العام)
 * 3. إنشاء قيد إقفال المصروفات (مدين: أرباح العام، دائن: المصروفات)
 * 4. نقل صافي الدخل إلى الأرباح المحتجزة
 * 5. إغلاق السنة المالية
 * 
 * مع أمان المعاملات المحمية والتراجع اليدوي المتكامل (Transaction-like Manual Rollback)
 */
export async function POST(request: NextRequest) {
  const closingEntries: string[] = [];
  const s = sb();

  try {
    const auth = await requireApiAuth(request);
    const body = await request.json();
    const { fiscalYearId, closingDate } = body;

    if (!fiscalYearId || !closingDate) {
      return error('fiscalYearId و closingDate مطلوبان');
    }

    // التحقق من وجود السنة المالية
    const { data: fiscalYear } = await s.from('fiscal_years')
      .select('*')
      .eq('id', fiscalYearId)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!fiscalYear) {
      return error('السنة المالية غير موجودة');
    }

    const fy = fiscalYear as any;

    if (fy.status === 'closed') {
      return error('السنة المالية مغلقة بالفعل');
    }

    // الحصول على الحسابات المطلوبة
    const { data: revenueAccounts } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .eq('type', 'revenue')
      .eq('is_active', true);

    const { data: expenseAccounts } = await s.from('accounts')
      .select('id, code, name')
      .eq('company_id', auth.companyId)
      .eq('type', 'expense')
      .eq('is_active', true);

    const { data: retainedEarningsAcc } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', ACCOUNT_CODES.RETAINED_EARNINGS)
      .maybeSingle();

    const { data: currentYearEarningsAcc } = await s.from('accounts')
      .select('id')
      .eq('company_id', auth.companyId)
      .eq('code', '3300')
      .maybeSingle();

    if (!retainedEarningsAcc || !currentYearEarningsAcc) {
      return error('حسابات الأرباح المحتجزة أو أرباح العام غير موجودة');
    }

    // FIXED: ضمان إدراج المعاملات حتى نهاية يوم الإقفال بالكامل لتفادي خطأ اليوم المفقود
    const endOfClosingDay = closingDate.includes('T') ? closingDate : `${closingDate}T23:59:59.999Z`;

    // حساب أرصدة الحسابات حتى تاريخ الإقفال
    let totalRevenue = 0;
    let totalExpenses = 0;

    // حساب إجمالي الإيرادات
    for (const acc of (revenueAccounts || [])) {
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit')
        .eq('account_id', acc.id)
        .lte('created_at', endOfClosingDay);

      const balance = (lines || []).reduce((sum: number, l: any) => {
        return sum + (parseFloat(l.credit) - parseFloat(l.debit));
      }, 0);

      totalRevenue += balance;
    }

    // حساب إجمالي المصروفات
    for (const acc of (expenseAccounts || [])) {
      const { data: lines } = await s.from('journal_lines')
        .select('debit, credit')
        .eq('account_id', acc.id)
        .lte('created_at', endOfClosingDay);

      const balance = (lines || []).reduce((sum: number, l: any) => {
        return sum + (parseFloat(l.debit) - parseFloat(l.credit));
      }, 0);

      totalExpenses += balance;
    }

    const netIncome = totalRevenue - totalExpenses;

    if (netIncome === 0 && totalRevenue === 0 && totalExpenses === 0) {
      return error('لا توجد عمليات لإقفالها في هذه السنة المالية');
    }

    // 1. قيد إقفال الإيرادات
    if (totalRevenue > 0) {
      const jeNum = await getNextJournalNumber(auth.companyId, closingDate);
      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNum,
          date: closingDate,
          type: 'closing',
          description: `إقفال الإيرادات - السنة المالية ${fy.name}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      if (jeErr || !je) throw jeErr || new Error('Failed to create revenue closing journal entry');
      
      const jeId = je.id;
      closingEntries.push(jeId); // تسجيل القيد لغايات التراجع اليدوي في حال الفشل

      // مدين: كل حساب إيرادات برصيده
      for (const acc of (revenueAccounts || [])) {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', acc.id)
          .lte('created_at', endOfClosingDay);

        const balance = (lines || []).reduce((sum: number, l: any) => {
          return sum + (parseFloat(l.credit) - parseFloat(l.debit));
        }, 0);

        if (balance > 0) {
          const { error: lineErr } = await s.from('journal_lines').insert({
            journal_entry_id: jeId,
            account_id: acc.id,
            account_code: acc.code,
            debit: balance,
            credit: 0,
            description: `إقفال ${acc.name}`,
          });
          if (lineErr) throw lineErr;
        }
      }

      // دائن: أرباح العام
      const { error: revEarningsErr } = await s.from('journal_lines').insert({
        journal_entry_id: jeId,
        account_id: currentYearEarningsAcc.id,
        account_code: '3300',
        debit: 0,
        credit: totalRevenue,
        description: 'نقل الإيرادات إلى أرباح العام',
      });
      if (revEarningsErr) throw revEarningsErr;
    }

    // 2. قيد إقفال المصروفات
    if (totalExpenses > 0) {
      const jeNum = await getNextJournalNumber(auth.companyId, closingDate);
      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNum,
          date: closingDate,
          type: 'closing',
          description: `إقفال المصروفات - السنة المالية ${fy.name}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      if (jeErr || !je) throw jeErr || new Error('Failed to create expense closing journal entry');

      const jeId = je.id;
      closingEntries.push(jeId); // تسجيل القيد لغايات التراجع اليدوي في حال الفشل

      // مدين: أرباح العام
      const { error: expEarningsErr } = await s.from('journal_lines').insert({
        journal_entry_id: jeId,
        account_id: currentYearEarningsAcc.id,
        account_code: '3300',
        debit: totalExpenses,
        credit: 0,
        description: 'نقل المصروفات من أرباح العام',
      });
      if (expEarningsErr) throw expEarningsErr;

      // دائن: كل حساب مصروفات برصيده
      for (const acc of (expenseAccounts || [])) {
        const { data: lines } = await s.from('journal_lines')
          .select('debit, credit')
          .eq('account_id', acc.id)
          .lte('created_at', endOfClosingDay);

        const balance = (lines || []).reduce((sum: number, l: any) => {
          return sum + (parseFloat(l.debit) - parseFloat(l.credit));
        }, 0);

        if (balance > 0) {
          const { error: lineErr } = await s.from('journal_lines').insert({
            journal_entry_id: jeId,
            account_id: acc.id,
            account_code: acc.code,
            debit: 0,
            credit: balance,
            description: `إقفال ${acc.name}`,
          });
          if (lineErr) throw lineErr;
        }
      }
    }

    // 3. نقل صافي الدخل إلى الأرباح المحتجزة
    if (netIncome !== 0) {
      const jeNum = await getNextJournalNumber(auth.companyId, closingDate);
      const { data: je, error: jeErr } = await s.from('journal_entries')
        .insert({
          company_id: auth.companyId,
          number: jeNum,
          date: closingDate,
          type: 'closing',
          description: `نقل صافي الدخل إلى الأرباح المحتجزة - السنة المالية ${fy.name}`,
          created_by: auth.userId,
        })
        .select('id')
        .single();

      if (jeErr || !je) throw jeErr || new Error('Failed to create net income closing journal entry');

      const jeId = je.id;
      closingEntries.push(jeId); // تسجيل القيد لغايات التراجع اليدوي في حال الفشل

      if (netIncome > 0) {
        // ربح: مدين أرباح العام، دائن الأرباح المحتجزة
        const { error: profitErr } = await s.from('journal_lines').insert([
          {
            journal_entry_id: jeId,
            account_id: currentYearEarningsAcc.id,
            account_code: '3300',
            debit: netIncome,
            credit: 0,
            description: 'نقل صافي الربح',
          },
          {
            journal_entry_id: jeId,
            account_id: retainedEarningsAcc.id,
            account_code: ACCOUNT_CODES.RETAINED_EARNINGS,
            debit: 0,
            credit: netIncome,
            description: 'صافي الربح إلى الأرباح المحتجزة',
          },
        ]);
        if (profitErr) throw profitErr;
      } else {
        // خسارة: مدين الأرباح المحتجزة، دائن أرباح العام
        const loss = Math.abs(netIncome);
        const { error: lossErr } = await s.from('journal_lines').insert([
          {
            journal_entry_id: jeId,
            account_id: retainedEarningsAcc.id,
            account_code: ACCOUNT_CODES.RETAINED_EARNINGS,
            debit: loss,
            credit: 0,
            description: 'صافي الخسارة من الأرباح المحتجزة',
          },
          {
            journal_entry_id: jeId,
            account_id: currentYearEarningsAcc.id,
            account_code: '3300',
            debit: 0,
            credit: loss,
            description: 'نقل صافي الخسارة',
          },
        ]);
        if (lossErr) throw lossErr;
      }
    }

    // إغلاق السنة المالية
    const { error: updateErr } = await s.from('fiscal_years')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
      })
      .eq('id', fiscalYearId);

    if (updateErr) throw updateErr;

    return success({
      fiscalYearId,
      fiscalYearName: fy.name,
      closingDate,
      totalRevenue,
      totalExpenses,
      netIncome,
      closingEntries,
      message: `تم إغلاق السنة المالية ${fy.name} بنجاح`,
    }, 201);

  } catch (err) {
    // FIXED: تراجع يدوي آمن وموثوق (Manual Rollback) لحماية سلامة وتوازن الدفاتر المالية
    if (closingEntries.length > 0) {
      console.warn('Fiscal closing failed. Initiating manual rollback for entries:', closingEntries);
      try {
        await s.from('journal_lines').delete().in('journal_entry_id', closingEntries);
        await s.from('journal_entries').delete().in('id', closingEntries);
      } catch (rollbackErr) {
        console.error('Fiscal closing manual rollback critically failed:', rollbackErr);
      }
    }
    return handleApiError(err);
  }
}
