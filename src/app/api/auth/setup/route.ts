import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hashPassword, createToken } from '@/lib/auth';

// @ts-ignore
const sb = () => getSupabase() as any;

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'الأصول', type: 'asset' },
  { code: '1110', name: 'النقدية', type: 'asset', parentCode: '1000' },
  { code: '1120', name: 'البنوك', type: 'asset', parentCode: '1000' },
  { code: '1130', name: 'عملاء', type: 'asset', parentCode: '1000' },
  { code: '1140', name: 'مصروفات مدفوعة مقدماً', type: 'asset', parentCode: '1000' },
  { code: '1150', name: 'عهد الموظفين', type: 'asset', parentCode: '1000' },
  { code: '1160', name: 'سلف الموظفين', type: 'asset', parentCode: '1000' },
  { code: '1170', name: 'المخزون', type: 'asset', parentCode: '1000' },
  { code: '1180', name: 'ضريبة المشتريات', type: 'asset', parentCode: '1000' },
  { code: '1190', name: 'سلف الموردين', type: 'asset', parentCode: '1000' },
  { code: '1200', name: 'الأصول الثابتة', type: 'asset', parentCode: '1000' },
  { code: '1230', name: 'مجمع الإهلاك', type: 'asset', parentCode: '1000' },
  { code: '2000', name: 'الخصوم', type: 'liability' },
  { code: '2110', name: 'الموردون', type: 'liability', parentCode: '2000' },
  { code: '2120', name: 'ضريبة المبيعات', type: 'liability', parentCode: '2000' },
  { code: '2130', name: 'القروض', type: 'liability', parentCode: '2000' },
  { code: '2140', name: 'الرواتب المستحقة', type: 'liability', parentCode: '2000' },
  { code: '2150', name: 'مقاولو الباطن', type: 'liability', parentCode: '2000' },
  { code: '2160', name: 'الاحتجازات', type: 'liability', parentCode: '2000' },
  { code: '2170', name: 'عمال اليومية', type: 'liability', parentCode: '2000' },
  { code: '2180', name: 'سلف العملاء', type: 'liability', parentCode: '2000' },
  { code: '3000', name: 'حقوق الملكية', type: 'equity' },
  { code: '3100', name: 'رأس المال', type: 'equity', parentCode: '3000' },
  { code: '3200', name: 'الأرباح المحتجزة', type: 'equity', parentCode: '3000' },
  { code: '4000', name: 'الإيرادات', type: 'revenue' },
  { code: '4100', name: 'إيرادات العقود', type: 'revenue', parentCode: '4000' },
  { code: '4200', name: 'إيرادات أخرى', type: 'revenue', parentCode: '4000' },
  { code: '5000', name: 'المصروفات', type: 'expense' },
  { code: '5100', name: 'التكاليف المباشرة', type: 'expense', parentCode: '5000' },
  { code: '5110', name: 'المواد', type: 'expense', parentCode: '5000' },
  { code: '5210', name: 'الرواتب', type: 'expense', parentCode: '5000' },
  { code: '5260', name: 'الإهلاك', type: 'expense', parentCode: '5000' },
  { code: '5330', name: 'الديون المعدومة', type: 'expense', parentCode: '5000' },
];

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

    if (userData.password.length < 6) {
      return error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    }

    const s = sb();
    const { count } = await s.from('companies').select('*', { count: 'exact', head: true });

    if ((count || 0) > 0) {
      return error('تم إعداد النظام مسبقاً. لا يمكن إعادة الإعداد', 409);
    }

    const setupToken = setup_token || request.nextUrl.searchParams.get('setup_token');
    if (process.env.NEXT_PUBLIC_SETUP_TOKEN && setupToken !== process.env.NEXT_PUBLIC_SETUP_TOKEN) {
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

    // Create parent accounts
    const parentIds: Record<string, string> = {};
    for (const acc of DEFAULT_ACCOUNTS.filter(a => !a.parentCode)) {
      const { data: created, error: accErr } = await s.from('accounts')
        .insert({
          company_id: companyId,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          is_active: true,
        })
        .select('id, code')
        .single();

      if (!accErr && created) {
        parentIds[acc.code] = created.id;
      }
    }

    // Create child accounts
    for (const acc of DEFAULT_ACCOUNTS.filter(a => a.parentCode)) {
      const parentId = parentIds[acc.parentCode];
      if (!parentId) continue;
      await s.from('accounts').insert({
        company_id: companyId,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        parent_id: parentId,
        is_active: true,
      });
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
      setupProtected: !!process.env.NEXT_PUBLIC_SETUP_TOKEN,
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 86400 * 7,
      path: '/',
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
