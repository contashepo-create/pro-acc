import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status');
    let sql = `SELECT s.*, c.name as company_name, p.name as plan_name
               FROM subscriptions s
               LEFT JOIN companies c ON c.id = s.company_id
               LEFT JOIN subscription_plans p ON p.id = s.plan_id`;
    const params: any[] = [];
    if (status) {
      sql += ' WHERE s.status = $1';
      params.push(status);
    }
    sql += ' ORDER BY s.created_at DESC';
    const result = await query(sql, params);
    return success(result.rows);
  } catch (e: any) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const { companyId, planCode, startDate, endDate, status, autoRenew } = body;
    if (!companyId || !planCode || !endDate) return error('companyId, planCode, endDate required');

    const result = await query(
      `INSERT INTO subscriptions (company_id, plan_code, status, start_date, end_date, auto_renew)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id) DO UPDATE SET plan_code = $2, status = $3, end_date = $5, auto_renew = $6
       RETURNING *`,
      [companyId, planCode, status || 'active', startDate || new Date().toISOString().split('T')[0], endDate, autoRenew ?? false]
    );
    return success(result.rows[0]);
  } catch (e: any) {
    return serverError(e);
  }
}
