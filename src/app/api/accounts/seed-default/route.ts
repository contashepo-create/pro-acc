import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { handleApiError, success, requireAdmin } from '@/lib/api-helpers';
import { createDefaultChartOfAccounts } from '@/lib/default-accounts';
import { logAudit } from '@/lib/audit';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();

    // Always try to create missing default accounts, even if some exist
    const { count: existingCount } = await s.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);

    const createdCount = await createDefaultChartOfAccounts(s, auth.companyId);

    // Get new total
    const { count: newTotal } = await s.from('accounts').select('id', { count: 'exact', head: true }).eq('company_id', auth.companyId);

    // Audit log
    await logAudit({
      company_id: auth.companyId,
      user_id: auth.userId,
      entity_type: 'accounts',
      entity_id: 'batch',
      action: 'create',
      after: { created: createdCount, before: existingCount, after: newTotal } as Record<string, unknown>,
      summary: 'seed_default_accounts',
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
