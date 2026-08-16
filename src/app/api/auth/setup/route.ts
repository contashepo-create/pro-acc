import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, setAuthCookie } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword, createToken } from '@/lib/auth';
import { isCommonPassword } from '@/lib/validation';
import { DEFAULT_CHART_OF_ACCOUNTS } from '@/lib/default-accounts';
import { timingSafeEqual } from 'crypto';

const sb = () => getSupabase();

export async function POST(request: NextRequest) {
  try {
    const { company: companyData, user: userData, setup_token } = await parseBody<{
      company: { name: string; commercialRegistration?: string; taxNumber?: string };
      user: { name: string; email: string; password: string };
      setup_token?: string;
    }>(request);
    if (!companyData?.name?.trim()) return error('اسم الشركة مطلوب');
    if (!userData?.name?.trim() || !userData?.email?.trim() || !userData?.password) {
      return error('بيانات المستخدم غير مكتملة (الاسم، البريد الإلكتروني، كلمة المرور)');
    }
    if (userData.password.length < 8 || userData.password.length > 128 || isCommonPassword(userData.password)) {
      return error('كلمة المرور يجب أن تكون 8 أحرف على الأقل وغير شائعة');
    }

    // Verify the bootstrap capability before disclosing database state.
    const suppliedToken = setup_token || request.nextUrl.searchParams.get('setup_token') || '';
    const expectedToken = (process.env.SETUP_TOKEN || '').trim();
    if (process.env.NODE_ENV === 'production' && expectedToken.length < 32) {
      return error('الإعداد الأولي غير مهيأ بأمان', 503);
    }
    if (expectedToken) {
      const supplied = Buffer.from(suppliedToken);
      const expected = Buffer.from(expectedToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return error('رمز الإعداد غير صحيح', 403);
      }
    }

    const passwordHash = await hashPassword(userData.password);
    const accounts = DEFAULT_CHART_OF_ACCOUNTS.map((account) => ({
      code: account.code, name: account.name, name_en: account.nameEn, type: account.type,
      parent_code: account.parentCode || null, is_header: account.isHeader === true,
    }));
    // The RPC serializes the global "first company" check and creates the
    // company, admin, chart, safe, settings and trial in one transaction.
    const { data, error: setupErr } = await sb().rpc('setup_initial_company', {
      p_company_name: companyData.name.trim(),
      p_commercial_registration: companyData.commercialRegistration || '',
      p_tax_number: companyData.taxNumber || '',
      p_email: userData.email.trim().toLowerCase(),
      p_user_name: userData.name.trim(),
      p_password_hash: passwordHash,
      p_accounts: accounts,
    });
    if (setupErr) {
      if (String(setupErr.message || '').includes('تم إعداد النظام مسبقاً')) {
        return error('تم إعداد النظام مسبقاً. لا يمكن إعادة الإعداد', 409);
      }
      throw setupErr;
    }

    const created = data as { company: { id: string; name: string }; user: { id: string; name: string; email: string; role: string } };
    const token = createToken(created.user.id, created.user.role);
    const response = success({
      message: 'تم إعداد النظام بنجاح',
      companyId: created.company.id,
      user: created.user,
      token,
      setupProtected: !!expectedToken,
    }, 201);
    setAuthCookie(response, 'token', token, 86400 * 7);
    return response;
  } catch (err) {
    return serverError(err);
  }
}
