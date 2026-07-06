import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { query } from '@/lib/db';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

if (!process.env.PRO_ACCOUNTANT_LICENSE_SALT) {
  throw new Error('PRO_ACCOUNTANT_LICENSE_SALT environment variable is required');
}
const SALT = process.env.PRO_ACCOUNTANT_LICENSE_SALT;

export async function GET(req: NextRequest) {
  try {
    const used = req.nextUrl.searchParams.get('used');
    let sql = `SELECT a.*, c.name as company_name
               FROM activation_codes a
               LEFT JOIN companies c ON c.id = a.used_by`;
    const params: any[] = [];
    if (used === 'true') { sql += ' WHERE a.is_used = true'; }
    else if (used === 'false') { sql += ' WHERE a.is_used = false'; }
    sql += ' ORDER BY a.created_at DESC';
    const result = await query(sql, params);
    return success(result.rows);
  } catch (e: any) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const { companyId, planCode, durationMonths } = body;
    if (!planCode || !durationMonths) return error('planCode and durationMonths required');

    const machineId = companyId || 'web-' + Date.now();
    const raw = `${planCode}-${machineId}-${durationMonths}`;
    const hmac = createHmac('sha256', SALT).update(raw).digest('hex').toUpperCase().slice(0, 16);
    const code = `${planCode}-${machineId.slice(0, 8)}-${durationMonths}-${hmac}`;

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + durationMonths);

    await query(
      `INSERT INTO activation_codes (code, plan_code, duration_months, expires_at) VALUES ($1, $2, $3, $4)`,
      [code, planCode, durationMonths, endDate.toISOString().split('T')[0]]
    );

    return success({ code, planCode, durationMonths });
  } catch (e: any) {
    return serverError(e);
  }
}
