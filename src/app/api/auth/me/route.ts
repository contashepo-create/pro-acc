import { NextRequest } from 'next/server';
import { success, error, unauthorized, serverError, notFound } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('token')?.value;
    if (!token) {
      return unauthorized();
    }

    const payload = verifyToken(token);
    if (!payload) {
      return unauthorized();
    }

    const res = await query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.last_login,
              u.company_id, u.created_at,
              c.name as company_name, c.commercial_registration, c.tax_number,
              c.vat_number, c.address, c.phone, c.email as company_email,
              c.logo, c.is_active as company_active
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [payload.userId]
    );

    if (res.rows.length === 0) {
      return notFound();
    }

    const user = res.rows[0];

    if (!user.is_active) {
      return error('هذا الحساب غير نشط', 403);
    }

    return success({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.is_active,
        lastLogin: user.last_login,
        createdAt: user.created_at,
      },
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
        isActive: user.company_active,
      },
    });
  } catch (err) {
    return serverError(err);
  }
}
