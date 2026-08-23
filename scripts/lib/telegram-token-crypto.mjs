// ============================================================
// Telegram bot token at-rest encryption — Node (ESM) reference
// implementation, used by the ops scripts (seed-admin.mjs,
// update-admin.mjs, update-supabase-admin.mjs) and the migration
// smoke suite.
//
// It MUST stay byte-compatible with src/lib/telegram-token-crypto.ts
// (the application-side implementation). The known-answer tests
// (KATs) pinned below — computed with THIS implementation — are also
// asserted by the Jest suite for the TS implementation, so any drift
// between the two breaks a gate:
//
//   * scripts/test-migrations.mjs → selfTestKats()
//   * src/__tests__/telegram-token-crypto.test.ts → same KAT constants
//
// Envelope format (v1):
//   enc:v1:<iv_b64>:<authtag_b64>:<ciphertext_b64>
//     cipher  = AES-256-GCM
//     key     = TELEGRAM_TOKEN_KEY env var, 64 hex chars (32 bytes),
//               e.g. `openssl rand -hex 32`
//     iv      = 12 random bytes
//     aad     = "pro-acc/admin-telegram-bot-token/v1" (purpose binding)
//
// Values WITHOUT the `enc:v1:` prefix are treated as legacy plaintext
// and passed through unchanged; migration 081 clears such values.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const TELEGRAM_TOKEN_PREFIX = 'enc:v1:';

const AAD = Buffer.from('pro-acc/admin-telegram-bot-token/v1');
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_TOKEN_LEN = 255;
const KEY_RE = /^[0-9a-f]{64}$/i;

export function isEncryptedToken(value) {
  return typeof value === 'string' && value.startsWith(TELEGRAM_TOKEN_PREFIX);
}

/** Parse and validate the 32-byte data encryption key (64 hex chars). */
export function parseTokenKey(key) {
  const k = String(key ?? '').trim();
  if (!KEY_RE.test(k)) {
    throw new Error('TELEGRAM_TOKEN_KEY must be 64 hex characters (32 bytes), e.g. `openssl rand -hex 32`');
  }
  return Buffer.from(k.toLowerCase(), 'hex');
}

/**
 * Encrypt a plaintext Telegram bot token into the `enc:v1:` envelope.
 * `opts.key` defaults to process.env.TELEGRAM_TOKEN_KEY.
 * `opts.iv` (12-byte Buffer) is test-only for deterministic KAT vectors.
 */
export function encryptTelegramToken(plaintext, opts = {}) {
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
    iv.toString('base64') + ':' +
    tag.toString('base64') + ':' +
    ciphertext.toString('base64')
  );
}

/**
 * Decrypt an `enc:v1:` envelope back to the plaintext token.
 * - null/'' → null (no per-admin token; the global env token is used).
 * - no `enc:v1:` prefix → returned as-is (legacy plaintext passthrough).
 * - malformed envelope or failed GCM auth → throws.
 * `opts.key` defaults to process.env.TELEGRAM_TOKEN_KEY.
 */
export function decryptTelegramToken(stored, opts = {}) {
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
  // final() throws if the ciphertext/tag was tampered with.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// ------------------------------------------------------------
// Known-answer test vector (KAT).
// Generated with THIS implementation; the TS implementation in
// src/lib/telegram-token-crypto.ts must produce/consume the exact
// same envelope for the same key/iv/token.
// ------------------------------------------------------------
export const KAT = {
  key: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  iv: '00112233445566778899aabb',
  token: '1234567890:AAKd8sTz4xQ9mPwRvUy2cE3fG5hJ6lN0bXy',
  envelope:
    'enc:v1:ABEiM0RVZneImaq7:0ZtcELkpsME3Ckshc86Z7A==:FN2oOYfI8nRm9ei0+Q+w3ubNA9qsJjO9WNnGNJ1G/inZNvR996U0dMhEhKWRYA==',
};

/** Self-test: the KAT vector must round-trip through this implementation. */
export function selfTestKats() {
  if (!KAT.envelope.startsWith(TELEGRAM_TOKEN_PREFIX)) {
    throw new Error('KAT envelope missing — generate it first');
  }
  const encrypted = encryptTelegramToken(KAT.token, {
    key: KAT.key,
    iv: Buffer.from(KAT.iv, 'hex'),
  });
  if (encrypted !== KAT.envelope) {
    throw new Error('KAT mismatch: encrypt() does not reproduce the pinned envelope');
  }
  const decrypted = decryptTelegramToken(KAT.envelope, { key: KAT.key });
  if (decrypted !== KAT.token) {
    throw new Error('KAT mismatch: decrypt() does not reproduce the pinned token');
  }
  return true;
}

// `node scripts/lib/telegram-token-crypto.mjs` regenerates the KAT
// envelope (only needed after a format change — requires the file to
// carry the vector, so this is a manual/dev convenience).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  KAT.envelope = encryptTelegramToken(KAT.token, {
    key: KAT.key,
    iv: Buffer.from(KAT.iv, 'hex'),
  });
  console.log(JSON.stringify(KAT, null, 2));
}
