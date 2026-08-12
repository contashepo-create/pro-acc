import { getSupabase } from '@/lib/supabase-client';

/**
 * يمنع الترحيل في سنة مالية مقفلة (سلوك SAP / NetSuite / Odoo).
 */
export async function assertOpenFiscalPeriod(companyId: string, date: string): Promise<void> {
  const s = getSupabase();
  const { data, error } = await s.from('fiscal_years')
    .select('id, name, status')
    .eq('company_id', companyId)
    .lte('start_date', date)
    .gte('end_date', date)
    .eq('status', 'closed')
    .limit(1)
    .maybeSingle();
  if (error) {
    // الجدول قد لا يوجد بعد — لا نحجب الترحيل
    return;
  }
  if (data) {
    throw new Error(`لا يمكن الترحيل في سنة مالية مقفلة (${(data as any).name || date})`);
  }
}
