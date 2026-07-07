import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { hashPassword, createToken } from '@/lib/auth';
import { registerSchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{
      companyName: string;
      name: string;
      email: string;
      password: string;
      phone?: string;
    }>(request);

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { companyName, name, email, password, phone } = parsed.data;

    const existing = await query('SELECT id FROM users WHERE email = LOWER($1)', [email]);
    if (existing.rows.length > 0) return error('البريد الإلكتروني مسجل مسبقاً', 409);

    const companyCheck = await query('SELECT id FROM companies WHERE name = $1', [companyName]);
    if (companyCheck.rows.length > 0) return error('اسم الشركة موجود مسبقاً', 409);

    const passwordHash = await hashPassword(password);

    const companyRes = await query(
      `INSERT INTO companies (id, name, email, phone, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, LOWER($2), $3, NOW(), NOW()) RETURNING id`,
      [companyName, email, phone || null]
    );
    const companyId = companyRes.rows[0].id;

    // Try with email_verified column, fall back without it
    let userRes;
    try {
      userRes = await query(
        `INSERT INTO users (id, company_id, name, email, password_hash, role, is_active, email_verified, last_activity, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, LOWER($3), $4, 'admin', true, true, NOW(), NOW(), NOW()) RETURNING id, name, email, role`,
        [companyId, name, email, passwordHash]
      );
    } catch {
      userRes = await query(
        `INSERT INTO users (id, company_id, name, email, password_hash, role, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, LOWER($3), $4, 'admin', true, NOW(), NOW()) RETURNING id, name, email, role`,
        [companyId, name, email, passwordHash]
      );
    }
    const user = userRes.rows[0];

    // Create trial subscription
    try {
      await query(
        `INSERT INTO subscription_plans (code, name, duration_days, price, currency, is_active)
         VALUES ('trial', 'تجريبي', 30, 0, 'SAR', true)
         ON CONFLICT (code) DO NOTHING`
      );
      const planRes = await query(`SELECT id FROM subscription_plans WHERE code = 'trial' AND is_active = true LIMIT 1`);
      if (planRes.rows.length > 0) {
        await query(
          `INSERT INTO subscriptions (company_id, plan_id, plan_code, status, start_date, end_date, trial_end_date, auto_renew)
           VALUES ($1, $2, 'trial', 'trial', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '30 days', false)
           ON CONFLICT (company_id) DO NOTHING`,
          [companyId, planRes.rows[0].id]
        );
      }
    } catch {}

    const token = createToken(user.id, user.role);

    const response = success({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      company: { id: companyId, name: companyName },
      token,
    }, 201);

    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 86400 * 7,
    });

    return response;
  } catch (err) {
    return serverError(err);
  }
}
