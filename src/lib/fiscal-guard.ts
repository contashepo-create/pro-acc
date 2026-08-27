import { getSupabase } from '@/lib/supabase-client';
import { BusinessRuleError } from '@/lib/api-helpers';

type FiscalYear = {
  id: string;
  name: string | null;
  start_date: string;
  end_date: string;
  status: string;
};

/**
 * يمنع الترحيل خارج سنة مالية مفتوحة أو داخل سنة مقفلة.
 *
 * The database trigger remains the final concurrency-safe authority; this
 * preflight supplies a useful Arabic reason before a financial RPC is called.
 */
export async function assertOpenFiscalPeriod(companyId: string, date: string): Promise<void> {
  const s = getSupabase();
  const { data, error } = await s.from('fiscal_years')
    .select('id, name, start_date, end_date, status')
    .eq('company_id', companyId);

  // Legacy installations may not have the table yet. Preserve compatibility;
  // migrated installations are still protected by the database trigger.
  if (error) return;

  const years = (data || []) as FiscalYear[];
  if (years.length === 0) {
    throw new BusinessRuleError(
      'لا توجد سنة مالية مفتوحة. أنشئ سنة مالية تغطي تاريخ العملية ثم أعد المحاولة.'
    );
  }

  const coveringYear = years.find((year) => date >= year.start_date && date <= year.end_date);
  if (!coveringYear) {
    const openYear = years.find((year) => year.status === 'open');
    const range = openYear ? ` (${openYear.start_date} إلى ${openYear.end_date})` : '';
    throw new BusinessRuleError(
      `تاريخ العملية ${date} خارج نطاق السنة المالية المفتوحة${range}. أنشئ أو افتح سنة مالية تغطي هذا التاريخ ثم أعد المحاولة.`
    );
  }

  if (coveringYear.status !== 'open') {
    throw new BusinessRuleError(
      `لا يمكن تسجيل العملية بتاريخ ${date} لأن السنة المالية «${coveringYear.name || coveringYear.start_date}» مقفلة. أعد فتح السنة أو اختر تاريخاً ضمن سنة مفتوحة.`
    );
  }
}
