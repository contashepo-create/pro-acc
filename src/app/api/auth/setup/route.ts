import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query, transaction } from '@/lib/db';
import { hashPassword, createToken } from '@/lib/auth';

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

    const existing = await query('SELECT id FROM companies LIMIT 1');
    if (existing.rows.length > 0) {
      return error('تم إعداد النظام مسبقاً. لا يمكن إعادة الإعداد', 409);
    }

    const setupToken = setup_token || request.nextUrl.searchParams.get('setup_token');
    if (process.env.NEXT_PUBLIC_SETUP_TOKEN && setupToken !== process.env.NEXT_PUBLIC_SETUP_TOKEN) {
      return error('رمز الإعداد غير صحيح', 403);
    }

    const result = await transaction(async (client) => {
      const companyRes = await client.query(
        `INSERT INTO companies (name, commercial_registration, tax_number, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id`,
        [companyData.name, companyData.commercialRegistration || null, companyData.taxNumber || null]
      );
      const companyId = companyRes.rows[0].id;

      const passwordHash = await hashPassword(userData.password);

      const userRes = await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role, is_active)
         VALUES ($1, $2, LOWER($3), $4, 'admin', true)
         RETURNING id, name, email, role`,
        [companyId, userData.name, userData.email, passwordHash]
      );

      const inserted: Array<{ code: string; id: string }> = [];
      for (const acc of DEFAULT_ACCOUNTS) {
        if (!acc.parentCode) {
          const r = await client.query(
            `INSERT INTO accounts (company_id, code, name, type, is_active)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, code`,
            [companyId, acc.code, acc.name, acc.type]
          );
          inserted.push(r.rows[0]);
        }
      }

      const parentMap = new Map(DEFAULT_ACCOUNTS.filter(a => !a.parentCode).map(a => [a.code, a]));
      for (const acc of DEFAULT_ACCOUNTS) {
        if (acc.parentCode) {
          const parentAcc = parentMap.get(acc.parentCode);
          if (!parentAcc) continue;
          const parentRow = inserted.find(i => i.code === acc.parentCode);
          if (!parentRow) continue;
          await client.query(
            `INSERT INTO accounts (company_id, code, name, type, parent_id, is_active)
             VALUES ($1, $2, $3, $4, $5, true)`,
            [companyId, acc.code, acc.name, acc.type, parentRow.id]
          );
        }
      }

      for (const s of DEFAULT_SETTINGS) {
        await client.query(
          `INSERT INTO settings (company_id, key, value)
           VALUES ($1, $2, $3)`,
          [companyId, s.key, s.value]
        );
      }

      return { companyId, user: userRes.rows[0] };
    });

    const token = createToken(result.user.id, 'admin');

    const response = success({
      message: 'تم إعداد النظام بنجاح',
      companyId: result.companyId,
      user: result.user,
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
