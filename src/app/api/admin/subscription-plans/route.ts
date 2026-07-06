import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { success, error, serverError, parseBody } from '@/lib/api-helpers';

export async function GET() {
  try {
    const result = await query('SELECT * FROM subscription_plans ORDER BY sort_order');
    return success({ plans: result.rows });
  } catch (e: any) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req);
    const { code, name, description, priceMonthly, priceYearly, maxUsers, maxProjects, features } = body;
    if (!code || !name) return error('code and name are required');

    const result = await query(
      `INSERT INTO subscription_plans (code, name, description, price_monthly, price_yearly, max_users, max_projects, features)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, name, description || '', priceMonthly || 0, priceYearly || null, maxUsers || 1, maxProjects || null, JSON.stringify(features || [])]
    );
    return success(result.rows[0]);
  } catch (e: any) {
    return serverError(e);
  }
}
