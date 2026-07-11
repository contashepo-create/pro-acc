import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';

export async function GET(request: NextRequest) {
  const checks: any = {
    timestamp: new Date().toISOString(),
    env: {},
    supabase: {},
    admin_users: {},
    telegram: {},
  };

  function clean(s: string): string {
    return (s || '').replace(/^\uFEFF/, '').trim();
  }

  // Check env vars
  checks.env.NEXT_PUBLIC_SUPABASE_URL = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  checks.env.SUPABASE_SERVICE_ROLE_KEY = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  checks.env.TOKEN_SECRET = !!process.env.TOKEN_SECRET;
  checks.env.TELEGRAM_BOT_TOKEN = !!process.env.TELEGRAM_BOT_TOKEN;
  checks.env.TELEGRAM_ADMIN_CHAT_ID = !!process.env.TELEGRAM_ADMIN_CHAT_ID;

  // Check Supabase connection
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    
    if (!url || !key) {
      checks.supabase.error = 'Missing URL or Service Role Key';
      checks.supabase.ok = false;
    } else {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const { data, error } = await supabase.from('admin_users').select('id').limit(1);
      if (error) {
        checks.supabase.error = error.message;
        checks.supabase.ok = false;
      } else {
        checks.supabase.ok = true;
        checks.supabase.count = data?.length || 0;
      }
    }
  } catch (e: any) {
    checks.supabase.error = e.message + (e.stack ? ' ' + e.stack.substring(0,200) : '');
    checks.supabase.ok = false;
  }

  // Check admin_users table structure and user
  try {
    const supabase = getSupabase() as any;
    const s = supabase;

    // Check table exists and columns
    const { data: tableCheck, error: tableErr } = await s.from('admin_users').select('id, email, password_hash, is_active').limit(1);
    checks.admin_users.tableExists = !tableErr;
    checks.admin_users.tableError = tableErr?.message || null;

    // Check specific user
    const { data: user, error: userErr } = await s.from('admin_users')
      .select('id, email, is_active, telegram_code, login_session_data')
      .eq('email', 'conta.moha@gmail.com')
      .maybeSingle();

    checks.admin_users.userExists = !!user;
    checks.admin_users.userError = userErr?.message || null;
    if (user) {
      checks.admin_users.user = {
        id: user.id,
        email: user.email,
        is_active: user.is_active,
        has_telegram_code_column: user.telegram_code !== undefined,
        has_login_session_data: user.login_session_data !== undefined,
      };
    }

    // Check columns exist
    try {
      const { error: colErr } = await s.from('admin_users').select('telegram_code, login_session_data').limit(1);
      checks.admin_users.columnsOk = !colErr;
      checks.admin_users.columnsError = colErr?.message || null;
    } catch (e: any) {
      checks.admin_users.columnsOk = false;
      checks.admin_users.columnsError = e.message;
    }

  } catch (e: any) {
    checks.admin_users.error = e.message;
  }

  // Check Telegram
  checks.telegram.bot_token = !!process.env.TELEGRAM_BOT_TOKEN;
  checks.telegram.chat_id = !!process.env.TELEGRAM_ADMIN_CHAT_ID;
  try {
    const { sendTelegramCode } = await import('@/lib/telegram');
    checks.telegram.moduleLoaded = true;
  } catch (e: any) {
    checks.telegram.moduleError = e.message;
  }

  // Overall status
  const allOk = checks.env.NEXT_PUBLIC_SUPABASE_URL && 
                checks.env.SUPABASE_SERVICE_ROLE_KEY && 
                checks.env.TOKEN_SECRET &&
                checks.supabase.ok &&
                checks.admin_users.userExists;

  checks.overall = allOk ? 'READY - Admin login should work' : 'NOT READY - Check errors above';

  return new Response(JSON.stringify(checks, null, 2), {
    headers: { 'Content-Type': 'application/json' },
    status: allOk ? 200 : 500,
  });
}
