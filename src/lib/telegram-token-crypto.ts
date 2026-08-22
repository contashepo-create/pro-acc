// ============================================================
// Telegram bot token at-rest encryption — application side.
//
// admin_users.telegram_bot_token is stored ONLY in this envelope
// (migration 081 cleared the legacy plaintext values):
//
//   enc:v1:<iv_b64>:<authtag_b64>:<ciphertext_b64>
//     cipher  = AES-256-GCM
//     key     = TELEGRAM_TOKEN_KEY env var, 64 hex chars (32 bytes)
//     iv      = 12 random bytes (CSPRNG)
//     aad     = "pro-acc/admin-telegram-bot-token/v1" (purpose binding)
//
// The ops scripts use the byte-identical format in
// scripts/lib/telegram-token-crypto.mjs; both implementations are
// pinned to the same known-answer vector (see the KAT test) so
// values written by either side decrypt in the other.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const TELEGRAM_TOKEN_PREFIX = 'enc:v1:';

const AAD = Buffer.from('pro-acc/admin-telegram-bot-token/v1');
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_TOKEN_LEN = 255;
const KEY_RE = /^[0-9a-f]{64}$/i;

/** True when the stored value is an `enc:v1:` envelope. */
export function isEncryptedToken(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(TELEGRAM_TOKEN_PREFIX);
}

/** Parse and validate the 32-byte data encryption key (64 hex chars). */
export function parseTokenKey(key: unknown): Buffer {
  const k = String(key ?? '').trim();
  if (!KEY_RE.test(k)) {
    throw new Error('TELEGRAM_TOKEN_KEY must be 64 hex characters (32 bytes), e.g. `openssl rand -hex 32`');
  }
  return Buffer.from(k.toLowerCase(), 'hex');
}

/** The data encryption key from the environment, or null when unset/invalid. */
export function getTokenKeyFromEnv(): Buffer | null {
  try {
    return parseTokenKey(process.env.TELEGRAM_TOKEN_KEY);
  } catch {
    return null;
  }
}

export interface TelegramTokenCryptoOptions {
  /** 32-byte key (64 hex chars). Defaults to process.env.TELEGRAM_TOKEN_KEY. */
  key?: string;
  /** Test-only deterministic IV (12 bytes) for KAT vectors. */
  iv?: Buffer;
}

/**
 * Encrypt a plaintext Telegram bot token into the `enc:v1:` envelope.
 * Throws when the key is missing/invalid or the token is empty/too long.
 */
export function encryptTelegramToken(plaintext: unknown, opts: TelegramTokenCryptoOptions = {}): string {
  const text = String(plaintext ?? '').trim();
  if (!text) throw new Error('Telegram token must not be empty');
  if (text.length > MAX_TOKEN_LEN) throw new Error('Telegram token too long (max 255 chars)');
  const key = parseTokenKey(opts.key ?? process.env.TELEGRAM_TOKEN_KEY);
  const iv = opts.iv && opts.iv.length === IV_LEN ? opts.iv : randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    TELEGRAM_TOKEN_PREFIX +
    iv.toString('base64') +
    ':' +
    tag.toString('base64') +
    ':' +
    ciphertext.toString('base64')
  );
}

/**
 * Decrypt an `enc:v1:` envelope back to the plaintext token.
 * - null/undefined/'' → null (no per-admin token; the global env token is used).
 * - no `enc:v1:` prefix → returned as-is (legacy plaintext passthrough;
 *   migration 081 clears such values, this keeps older reads safe).
 * - malformed envelope, missing/invalid key, or failed GCM auth → throws.
 */
export function decryptTelegramToken(stored: unknown, opts: TelegramTokenCryptoOptions = {}): string | null {
  if (stored == null || stored === '') return null;
  const value = String(stored);
  if (!isEncryptedToken(value)) return value;

  const parts = value.slice(TELEGRAM_TOKEN_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted Telegram token');
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Malformed encrypted Telegram token');
  }
  const key = parseTokenKey(opts.key ?? process.env.TELEGRAM_TOKEN_KEY);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  // final() throws when the ciphertext or auth tag was tampered with.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
