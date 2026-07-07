import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyPassword, createToken } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';

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

    // Rate limiting — wrapped in try-catch in case login_attempts table doesn't exist
    let rateLimited = false;
    let remainingMinutes = 0;
    try {
      const rateRes = await query(
        `SELECT COUNT(*)::int as count, MIN(attempted_at) as earliest
         FROM login_attempts
         WHERE (email = $1 OR ip_address = $2) AND success = false AND attempted_at > NOW() - INTERVAL '15 minutes'`,
        [email, ipAddress]
      );
      const { count, earliest } = rateRes.rows[0];
      if (count >= 5 && earliest) {
        const elapsedMs = Date.now() - new Date(earliest).getTime();
        const remainingMs = 15 * 60 * 1000 - elapsedMs;
        remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
        rateLimited = true;
      }
    } catch {}
    if (rateLimited) {
      return error(`تم تجاوز عدد المحاولات المسموحة. الرجاء المحاولة بعد ${remainingMinutes} دقيقة`, 429);
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
      try { await query(`INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, false)`, [email, ipAddress]); } catch {}
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    const user = res.rows[0];

    if (!user.is_active) {
      try { await query(`INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`, [user.company_id, email, ipAddress]); } catch {}
      return error('هذا الحساب غير نشط. تواصل مع مدير النظام', 403);
    }

    if (!user.company_active) {
      try { await query(`INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`, [user.company_id, email, ipAddress]); } catch {}
      return error('الشركة غير نشطة. تواصل مع مدير النظام', 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      try { await query(`INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, false)`, [user.company_id, email, ipAddress]); } catch {}
      return error('البريد الإلكتروني أو كلمة المرور غير صحيحة', 401);
    }

    // Check email_verified only if the column exists
    try {
      const verifiedRes = await query(`SELECT email_verified FROM users WHERE id = $1`, [user.id]);
      if (verifiedRes.rows.length > 0 && verifiedRes.rows[0].email_verified === false) {
        return error('يرجى تأكيد بريدك الإلكتروني أولاً', 403);
      }
    } catch {}

    const token = createToken(user.id, user.role);

    // Update last_login (and last_activity if column exists)
    try {
      await query(`UPDATE users SET last_login = NOW()::timestamp WHERE id = $1`, [user.id]);
    } catch {}
    try {
      await query(`UPDATE users SET last_activity = NOW() WHERE id = $1`, [user.id]);
    } catch {}

    try { await query(`INSERT INTO login_attempts (company_id, email, ip_address, success) VALUES ($1, $2, $3, true)`, [user.company_id, email, ipAddress]); } catch {}

    // Check subscription (non-blocking on failure)
    let subscriptionExpired = false;
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
        if (endDate < today && sub.status !== 'trial') subscriptionExpired = true;
      }
    } catch {}

    if (subscriptionExpired) {
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
