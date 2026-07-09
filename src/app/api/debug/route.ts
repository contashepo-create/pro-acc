import { NextRequest } from 'next/server';
import { success, serverError } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const results: Record<string, any> = {};
  
  // Strip BOM and show DB URL details
  const rawUrl = (process.env.DATABASE_URL || '').replace(/^\uFEFF/, '').trim();
  results.raw_db_url = rawUrl;
  try {
    const url = new URL(rawUrl);
    results.db_host = url.hostname;
    results.db_port = url.port;
  } catch {
    results.db_host = 'PARSE ERROR';
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

  // Test companies table
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
