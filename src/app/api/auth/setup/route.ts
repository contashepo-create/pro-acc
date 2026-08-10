import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword, createToken } from '@/lib/auth';
import { isCommonPassword } from '@/lib/validation';

const sb = () => getSupabase();


const DEFAULT_SETTINGS = [
  { key: 'currency', value: 'SAR' },
  { key: 'language', value: 'ar' },
  { key: 'date_format', value: 'YYYY-MM-DD' },
  { key: 'vat_rate', value: '0.15' },
];

export async function POST(request: NextRequest) {
  try {
    const { company: companyData, user: userData, setup_token } = await parseBody<{
      company: { name: string; commercialRegistration?: string; taxNumber?: string };
      user: { name: string; email: string; password: string };
      setup_token?: string;
    }>(request);

    if (!companyData?.name) {
      return error('اسم الشركة مطلوب');
    }

    if (!userData?.name || !userData?.email || !userData?.password) {
      return error('بيانات المستخدم غير مكتملة (الاسم، البريد الإلكتروني، كلمة المرور)');
    }

    if (userData.password.length < 8 || userData.password.length > 128 || isCommonPassword(userData.password)) {
      return error('كلمة المرور يجب أن تكون 8 أحرف على الأقل وغير شائعة');
    }

    const s = sb();
    const { count } = await s.from('companies').select('*', { count: 'exact', head: true });

    if ((count || 0) > 0) {
      return error('تم إعداد النظام مسبقاً. لا يمكن إعادة الإعداد', 409);
    }

    const setupToken = setup_token || request.nextUrl.searchParams.get('setup_token');
    // SETUP_TOKEN stays server-side. The public name is accepted temporarily for
    // existing deployments, but should be replaced because it exposes the value
    // to client bundles.
    const expectedSetupToken = process.env.SETUP_TOKEN || process.env.NEXT_PUBLIC_SETUP_TOKEN;
    if (expectedSetupToken && setupToken !== expectedSetupToken) {
      return error('رمز الإعداد غير صحيح', 403);
    }

    // Create company
    const { data: company, error: companyErr } = await s.from('companies')
      .insert({
        name: companyData.name,
        commercial_registration: companyData.commercialRegistration || null,
        tax_number: companyData.taxNumber || null,
        is_active: true,
      })
      .select('id')
      .single();

    if (companyErr) throw companyErr;
    const companyId = company.id;

    // Create admin user
    const passwordHash = await hashPassword(userData.password);
    const { data: user, error: userErr } = await s.from('users')
      .insert({
        company_id: companyId,
        name: userData.name,
        email: userData.email.toLowerCase(),
        password_hash: passwordHash,
        role: 'admin',
        is_active: true,
      })
      .select('id, name, email, role')
      .single();

    if (userErr) {
      // Cleanup company on user creation failure
      await s.from('companies').delete().eq('id', companyId);
      throw userErr;
    }

    // Create default chart of accounts — single source of truth shared with
    // /api/auth/register (previously this route used a different inline chart,
    // so companies seeded via setup ended up with divergent accounts/codes).
    try {
      const { createDefaultChartOfAccounts } = await import('@/lib/default-accounts');
      await createDefaultChartOfAccounts(s, companyId);
    } catch (e) {
      console.warn('Failed to create default chart of accounts:', e);
    }

    // Create default settings
    for (const setting of DEFAULT_SETTINGS) {
      await s.from('settings').insert({
        company_id: companyId,
        key: setting.key,
        value: setting.value,
      });
    }

    const token = createToken(user.id, 'admin');

    const response = success({
      message: 'تم إعداد النظام بنجاح',
      companyId,
      user,
      token,
      setupProtected: !!expectedSetupToken,
    }, 201);

    setAuthCookie(response, 'token', token, 86400 * 7);

    return response;
  } catch (err) {
    return serverError(err);
  }
}
