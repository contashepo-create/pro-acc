import { NextRequest } from 'next/server';
import { success, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

interface SmartNotification {
  id: string;
  type: 'warning' | 'info' | 'danger' | 'success';
  title: string;
  message: string;
  action?: { label: string; href: string };
  createdAt: string;
}

/**
 * GET /api/notifications/smart
 * Returns smart notifications based on business logic analysis
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const notifications: SmartNotification[] = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // 1. Overdue invoices check
    try {
      const { data: overdue } = await s.from('invoices')
        .select('id, number, total, due_date, contact_id, contacts(name)')
        .eq('company_id', auth.companyId)
        .eq('status', 'unpaid')
        .lt('due_date', today)
        .limit(5);

      if (overdue && overdue.length > 0) {
        const totalOverdue = (overdue as Array<{ total: number }>).reduce((sum, inv) => sum + parseFloat(String(inv.total)), 0);
        notifications.push({
          id: 'overdue-invoices',
          type: 'danger',
          title: 'فواتير متأخرة',
          message: `لديك ${overdue.length} فاتورة متأخرة بإجمالي ${totalOverdue.toFixed(2)} ر.س`,
          action: { label: 'عرض الفواتير', href: '/invoices?status=unpaid' },
          createdAt: now.toISOString(),
        });
      }
    } catch { /* ignore */ }

    // 2. Fiscal year end approaching
    try {
      const fiscalEndDate = `${now.getFullYear()}-12-31`;
      const daysToFiscalEnd = Math.ceil((new Date(fiscalEndDate).getTime() - now.getTime()) / 86400000);
      
      if (daysToFiscalEnd <= 30 && daysToFiscalEnd > 0) {
        notifications.push({
          id: 'fiscal-year-end',
          type: 'warning',
          title: 'اقتراب نهاية السنة المالية',
          message: `باقي ${daysToFiscalEnd} يوم على نهاية السنة المالية. تأكد من مراجعة القيود والإقفالات.`,
          action: { label: 'مراجعة القيود', href: '/journal' },
          createdAt: now.toISOString(),
        });
      }
    } catch { /* ignore */ }

    // 3. Low bank balance warning
    try {
      const { data: banks } = await s.from('banks_safes')
        .select('id, name, account_id')
        .eq('company_id', auth.companyId);

      if (banks && banks.length > 0) {
        for (const bank of banks as Array<{ account_id: string; name: string }>) {
          if (!bank.account_id) continue;
          const { data: balance } = await s.rpc('get_account_balance', { p_account_id: bank.account_id, p_company_id: auth.companyId });
          const bal = typeof balance === 'number' ? balance : 0;
          if (bal < 1000 && bal >= 0) {
            notifications.push({
              id: `low-balance-${bank.account_id}`,
              type: 'warning',
              title: `رصيد منخفض: ${bank.name}`,
              message: `الرصيد الحالي: ${bal.toFixed(2)} ر.س`,
              action: { label: 'عرض الحساب', href: '/banks' },
              createdAt: now.toISOString(),
            });
          }
        }
      }
    } catch { /* ignore - RPC may not exist */ }

    // 4. Unposted journal entries (> 7 days old)
    try {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
      const { count: unposted } = await s.from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId)
        .lt('date', sevenDaysAgo);

      if (unposted && unposted > 5) {
        notifications.push({
          id: 'unposted-entries',
          type: 'info',
          title: 'قيود قديمة غير معالجة',
          message: `يوجد ${unposted} قيد أقدم من 7 أيام. يُنصح بمراجعتها.`,
          action: { label: 'عرض القيود', href: '/journal' },
          createdAt: now.toISOString(),
        });
      }
    } catch { /* ignore */ }

    // 5. Subscription expiring soon
    try {
      const { data: sub } = await s.from('subscriptions')
        .select('end_date, status')
        .eq('company_id', auth.companyId)
        .eq('status', 'active')
        .maybeSingle();

      if (sub) {
        const subData = sub as { end_date: string };
        const daysToExpire = Math.ceil((new Date(subData.end_date).getTime() - now.getTime()) / 86400000);
        if (daysToExpire <= 14 && daysToExpire > 0) {
          notifications.push({
            id: 'subscription-expiring',
            type: 'danger',
            title: 'الاشتراك ينتهي قريباً',
            message: `ينتهي اشتراكك بعد ${daysToExpire} يوم. يرجى التجديد لتجنب انقطاع الخدمة.`,
            action: { label: 'تجديد الاشتراك', href: '/subscription' },
            createdAt: now.toISOString(),
          });
        }
      }
    } catch { /* ignore */ }

    // 6. Pending employee salaries
    try {
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data: pending } = await s.from('salary_sheets')
        .select('id')
        .eq('company_id', auth.companyId)
        .ilike('month', `${currentMonth}%`)
        .eq('status', 'draft')
        .limit(1);

      if (pending && pending.length > 0 && now.getDate() >= 25) {
        notifications.push({
          id: 'pending-salary',
          type: 'info',
          title: 'رواتب الشهر الحالي',
          message: 'لم يتم اعتماد راتب الشهر الحالي بعد. نهاية الشهر قريبة.',
          action: { label: 'إعداد الرواتب', href: '/salary-sheets' },
          createdAt: now.toISOString(),
        });
      }
    } catch { /* ignore */ }

    // 7. Inventory low stock
    try {
      const { data: lowStock } = await s.from('inventory_items')
        .select('id, name, quantity')
        .eq('company_id', auth.companyId)
        .lt('quantity', 5)
        .eq('is_active', true)
        .limit(5);

      if (lowStock && lowStock.length > 0) {
        notifications.push({
          id: 'low-stock',
          type: 'warning',
          title: 'أصناف منخفضة المخزون',
          message: `${lowStock.length} صنف رصيده أقل من 5 وحدات`,
          action: { label: 'عرض المخزون', href: '/inventory' },
          createdAt: now.toISOString(),
        });
      }
    } catch { /* ignore */ }

    // Sort by severity
    const severity = { danger: 0, warning: 1, info: 2, success: 3 };
    notifications.sort((a, b) => severity[a.type] - severity[b.type]);

    return success({ notifications, count: notifications.length });
  } catch (err) {
    return handleApiError(err);
  }
}
