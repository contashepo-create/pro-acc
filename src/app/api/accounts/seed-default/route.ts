import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError, success } from '@/lib/api-helpers';
import { createDefaultChartOfAccounts } from '@/lib/default-accounts';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();

    // Check if company already has accounts
    const { count } = await s.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);
    
    if (count && count > 0) {
      return success({ 
        message: 'الشركة لديها حسابات بالفعل',
        existingCount: count,
        created: 0 
      });
    }

    const createdCount = await createDefaultChartOfAccounts(s, auth.companyId);

    // Audit log
    await s.from('financial_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'seed_default_accounts',
      table_name: 'accounts',
      new_values: { count: createdCount },
    });

    return success({ 
      message: `تم إنشاء ${createdCount} حساب افتراضي بنجاح`,
      created: createdCount 
    }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
