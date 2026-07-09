import { NextRequest } from 'next/server';
import { success, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const results: Record<string, any> = {};
  
  // Show full DATABASE_URL host
  const dbUrl = process.env.DATABASE_URL || 'NOT SET';
  try {
    const url = new URL(dbUrl);
    results.db_host = url.hostname;
    results.db_port = url.port;
    results.db_user = url.username;
  } catch {
    results.db_host = 'PARSE ERROR';
    results.raw_db_url = dbUrl;
  }

  // Test DB
  try {
    const r = await query('SELECT 1 as test');
    results.db = 'OK';
  } catch (e: any) {
    results.db = 'ERROR: ' + e.message;
  }

  // Test users table
  try {
    const r = await query('SELECT id, email FROM users LIMIT 1');
    results.users = 'OK, rows: ' + r.rows.length;
  } catch (e: any) {
    results.users = 'ERROR: ' + e.message;
  }

  // Test register
  try {
    const r = await query('SELECT id FROM companies LIMIT 1');
    results.companies = 'OK';
  } catch (e: any) {
    results.companies = 'ERROR: ' + e.message;
  }

  results.token_secret = process.env.TOKEN_SECRET ? 'SET' : 'NOT SET';
  results.node_env = process.env.NODE_ENV;

  return success(results);
}
