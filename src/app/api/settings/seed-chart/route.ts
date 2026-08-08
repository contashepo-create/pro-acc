import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { createDefaultChartOfAccounts } from '@/lib/default-accounts';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const created = await createDefaultChartOfAccounts(s, auth.companyId);
    return success({ created, message: 'تم إنشاء شجرة الحسابات الافتراضية للشركة' });
  } catch (err) {
    return handleApiError(err);
  }
}
