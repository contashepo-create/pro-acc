import { requireAdmin, adminJsonError } from '@/lib/admin-guard';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { success, error, notFound, parseBody } from '@/lib/api-helpers';
import { verifyMasterPassword, auditLog } from '@/lib/admin-auth';
import { encryptTelegramToken, isEncryptedToken } from '@/lib/telegram-token-crypto';

const sb = () => getSupabase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Real Telegram bot tokens: <8-10 digit bot id>:A<base64url>. Same shape the
// 081 migration uses to recognize (and clear) legacy plaintext values, so
// anything stored through this endpoint can never be mistaken for plaintext.
const TELEGRAM_TOKEN_SHAPE = /^[0-9]{8,10}:A[A-Za-z0-9_-]{30,100}$/;

/**
 * Per-admin Telegram bot token management (admin_users.telegram_bot_token).
 *
 * SECURITY:
 *  - Cookie-based superadmin session (requireAdmin) + master password
 *    (the same gate as the other admin_users mutations).
 *  - The plaintext token crosses the wire EXACTLY ONCE (PUT body) and is
 *    immediately wrapped in an AES-256-GCM envelope (key = TELEGRAM_TOKEN_KEY)
 *    before it touches the database. No response ever contains the token.
 *  - GET only reports whether an (encrypted) token is configured.
 *  - Every mutation is written to admin_audit_log.
 */

type TargetCheck =
  | { ok: true; row: { id: string; telegram_bot_token: string | null } }
  | { ok: false; response: ReturnType<typeof error> };

async function findAdminTarget(id: string): Promise<TargetCheck> {
  if (!UUID.test(id)) return { ok: false, response: error('معرّف غير صالح', 400) };
  const { data, error: findErr } = await sb()
    .from('admin_users')
    .select('id, telegram_bot_token')
    .eq('id', id)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!data) return { ok: false, response: notFound() };
  return { ok: true, row: data as { id: string; telegram_bot_token: string | null } };
}

async function assertMaster(req: NextRequest, adminId: string) {
  const masterHeader = req.headers.get('x-master-password');
  if (!masterHeader) return error('كلمة المرور الرئيسية مطلوبة في ترويسة x-master-password', 401);
  const valid = await verifyMasterPassword(adminId, masterHeader);
  if (!valid) return error('كلمة المرور الرئيسية غير صحيحة', 401);
  return null;
}

export async function GET(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await paramsPromise;
    const target = await findAdminTarget(id);
    if (!target.ok) return target.response;
    return success({ configured: isEncryptedToken(target.row.telegram_bot_token) });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const __admin = await requireAdmin(req);
    const { id } = await paramsPromise;
    const target = await findAdminTarget(id);
    if (!target.ok) return target.response;
    const masterCheck = await assertMaster(req, __admin.adminId);
    if (masterCheck) return masterCheck;

    const body = await parseBody<{ token?: string }>(req);
    const token = String(body.token ?? '').trim();
    if (!token || token.length > 255) {
      return error('التوكن مطلوب (نص غير فارغ بطول ≤ 255)');
    }
    if (!TELEGRAM_TOKEN_SHAPE.test(token)) {
      return error('شكل التوكن غير صحيح — يجب أن يكون توكن بوت تيليجرام صالحاً');
    }

    // Throws when TELEGRAM_TOKEN_KEY is unset/invalid — surfaced by
    // adminJsonError as a generic 500 (details stay in the server log).
    const encrypted = encryptTelegramToken(token);

    const { error: updateErr } = await sb()
      .from('admin_users')
      .update({ telegram_bot_token: encrypted })
      .eq('id', id);
    if (updateErr) throw updateErr;

    await auditLog(__admin.adminId, 'admin_telegram_token_set', 'Per-admin bot token stored encrypted (AES-256-GCM)', 'admin', id);

    return success({ message: 'تم حفظ توكن البوت مشفراً', configured: true });
  } catch (err) {
    return adminJsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> }
) {
  try {
    const __admin = await requireAdmin(req);
    const { id } = await paramsPromise;
    const target = await findAdminTarget(id);
    if (!target.ok) return target.response;
    const masterCheck = await assertMaster(req, __admin.adminId);
    if (masterCheck) return masterCheck;

    const { error: updateErr } = await sb()
      .from('admin_users')
      .update({ telegram_bot_token: null })
      .eq('id', id);
    if (updateErr) throw updateErr;

    await auditLog(__admin.adminId, 'admin_telegram_token_cleared', 'Per-admin bot token removed', 'admin', id);

    return success({ message: 'تم حذف توكن البوت', configured: false });
  } catch (err) {
    return adminJsonError(err);
  }
}
