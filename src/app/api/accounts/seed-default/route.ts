import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success } from '@/lib/api-helpers';
import { createDefaultChartOfAccounts } from '@/lib/default-accounts';

// @ts-ignore
const sb = () => getSupabase() ;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // Always try to create missing default accounts, even if some exist
    const { count: existingCount } = await s.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);

    const createdCount = await createDefaultChartOfAccounts(s, auth.companyId);

    // Get new total
    const { count: newTotal } = await s.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);

    // Audit log
    await s.from('financial_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'seed_default_accounts',
      table_name: 'accounts',
      new_values: { created: createdCount, before: existingCount, after: newTotal },
    });

    return success({ 
      message: existingCount && existingCount > 0 
        ? `كان عندك ${existingCount} حساب، تم إضافة ${createdCount} حساب جديد، الإجمالي الآن ${newTotal}`
        : `تم إنشاء ${createdCount} حساب افتراضي بنجاح`,
      created: createdCount,
      before: existingCount || 0,
      after: newTotal || 0
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
