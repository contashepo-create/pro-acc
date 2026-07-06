import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody<{ email: string; password: string }>(request);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return error(parsed.error.issues[0].message);
    }

    const { email, password } = parsed.data;

    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';

    const { allowed, remainingMinutes } = await checkRateLimit(email, ipAddress);
    if (!allowed) {
      return error(
        `تم تجاوز عدد المحاولات المسموحة. الرجاء المحاولة بعد ${remainingMinutes} دقيقة`,
        429
      );
    }

    const res = await query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.is_active, u.company_id,
              c.name as company_name, c.commercial_registration, c.tax_number,
              c.vat_number, c.address, c.phone, c.email as company_email,
              c.logo, c.is_active as company_active
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.email = LOWER($1)`,
      [email]
    );

    if (res.rows.length === 0) {
      await query(
        `INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, false)`,
        [email, ipAddress]
      );
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const user = res.rows[0];

    if (!user.is_active) {
      await query(
        `INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`,
        [user.company_id, email, ipAddress]
      );
      return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);
    }

    if (!user.company_active) {
      await query(
        `INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`,
        [user.company_id, email, ipAddress]
      );
      return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await query(
        `INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`,
        [user.company_id, email, ipAddress]
      );
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const token = createToken(user.id, user.role);

    await query(
      `UPDATE users SET last_login = NOW()::timestamp WHERE id = $1`,
      [user.id]
    );

    await query(
      `INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, true)`,
      [user.company_id, email, ipAddress]
    );

    let subscriptionExpired = false;
    if (user.company_id) {
      try {
        const subRes = await query(
          `SELECT status, end_date FROM subscriptions WHERE company_id = $1 ORDER BY end_date DESC LIMIT 1`,
          [user.company_id]
        );
        if (subRes.rows.length > 0) {
          const sub = subRes.rows[0];
          const endDate = new Date(sub.end_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (endDate < today && sub.status !== 'trial') {
            subscriptionExpired = true;
          }
        }
      } catch {
        // Graceful degradation — do not block login on subscription check failure
      }
    }

    if (subscriptionExpired) {
      await query(
        `INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`,
        [user.company_id, email, ipAddress]
      );
      return error('انتهت صلاحية الاشتراك. يرجى تجديد الاشتراك للدخول', 403);
    }

    const { password_hash: _, ...safeUser } = user;

    const response = success({
      user: safeUser,
      company: {
        id: user.company_id,
        name: user.company_name,
        registrationNumber: user.commercial_registration,
        taxNumber: user.tax_number,
        vatNumber: user.vat_number,
        address: user.address,
        phone: user.phone,
        email: user.company_email,
        logo: user.logo,
      },
      token,
    });

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
