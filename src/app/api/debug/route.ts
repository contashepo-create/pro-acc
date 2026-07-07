import { NextRequest } from 'next/server';
import { success, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const results: Record<string, any> = {};
  
  // Test 1: DB connection
  try {
    const r = await query('SELECT 1 as test');
    results.db = 'OK';
  } catch (e: any) {
    results.db = 'ERROR: ' + e.message;
  }

  // Test 2: users table
  try {
    const r = await query('SELECT id, email FROM users LIMIT 1');
    results.users_table = 'OK, rows: ' + r.rows.length;
  } catch (e: any) {
    results.users_table = 'ERROR: ' + e.message;
  }

  // Test 3: companies table
  try {
    const r = await query('SELECT id FROM companies LIMIT 1');
    results.companies_table = 'OK, rows: ' + r.rows.length;
  } catch (e: any) {
    results.companies_table = 'ERROR: ' + e.message;
  }

  // Test 4: login_attempts table
  try {
    const r = await query('SELECT id FROM login_attempts LIMIT 1');
    results.login_attempts_table = 'OK';
  } catch (e: any) {
    results.login_attempts_table = 'ERROR: ' + e.message;
  }

  // Test 5: subscriptions table
  try {
    const r = await query('SELECT id FROM subscriptions LIMIT 1');
    results.subscriptions_table = 'OK';
  } catch (e: any) {
    results.subscriptions_table = 'ERROR: ' + e.message;
  }

  // Test 6: TOKEN_SECRET
  results.token_secret = process.env.TOKEN_SECRET ? 'SET' : 'NOT SET';
  
  // Test 7: DATABASE_URL
  results.database_url = process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.substring(0, 30) + '...)' : 'NOT SET';

  // Test 8: NODE_ENV
  results.node_env = process.env.NODE_ENV;
  results.show_errors = process.env.SHOW_ERRORS;

  return success(results);
}
