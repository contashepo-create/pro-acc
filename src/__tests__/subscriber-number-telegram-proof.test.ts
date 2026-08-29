/**
 * Migrations 114/115 contract tests (SQL text assertions, same pattern as the
 * credit/debit-notes lock tests):
 *   1. 114 — subscriber numbers are random, 12-char, letters+digits, and all
 *      legacy sequential numbers are re-issued once. The number must never be
 *      enumerable by an attacker who learned a neighbour's number.
 *   2. 115 — payment-proof images are no longer stored or required:
 *      customers send the receipt on Telegram; approval no longer demands a
 *      stored file, and owners can cancel still-pending requests.
 */
import fs from 'fs';
import path from 'path';

const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
const read = (name: string) => fs.readFileSync(path.join(migrationsDir, name), 'utf8');

describe('migration 114 — unguessable subscriber numbers', () => {
  const sql = read('114-random-subscriber-numbers.sql');

  test('replaces the sequential allocator with a random 12-char code generator', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.next_subscriber_number()');
    // Unambiguous alphabet: no 0/O/1/I/L, letters + digits only.
    expect(sql).toContain("'ABCDEFGHJKMNPQRSTUVWXYZ23456789'");
    expect(sql).toContain('FOR v_i IN 1..12 LOOP');
    // Collision-checked against the live table.
    expect(sql).toContain('EXIT WHEN NOT EXISTS (SELECT 1 FROM subscriptions WHERE subscriber_number = v_code)');
  });

  test('re-issues every legacy sequential (all-digit) number exactly once', () => {
    expect(sql).toContain("OR btrim(subscriber_number) ~ '^[0-9]+$'");
    expect(sql).toContain('re-issued');
  });

  test('retires the sequence so sequential numbers can never come back', () => {
    expect(sql).toContain('DROP SEQUENCE IF EXISTS public.subscriber_number_seq');
  });

  test('no allocation path in the codebase still uses the dropped sequence', () => {
    // 112 created it, 114 drops it — 114 must come after and its function must
    // not reference nextval anymore.
    const idx112 = read('112-subscriber-numbers.sql');
    expect(idx112).toContain("nextval('public.subscriber_number_seq')");
    expect(sql).not.toContain('nextval');
  });
});

describe('migration 115 — Telegram payment-proof flow', () => {
  const sql = read('115-telegram-payment-proof.sql');

  test('creation RPCs reject any stored receipt reference', () => {
    // Exactly two occurrences: one in each creation RPC — the old flow accepted
    // a trusted storage path, the new flow rejects anything non-NULL.
    expect(sql.split('p_receipt_image_url IS NOT NULL')).toHaveLength(3); // 2 matches
  });

  test('review RPCs no longer require a stored receipt file for approval', () => {
    const upgradeReview = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.review_upgrade_request'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.review_addon_request'),
    );
    expect(upgradeReview).not.toContain('v_req.receipt_image_url');
    // Full-amount + transfer-date guards stay.
    expect(upgradeReview).toContain('v_req.payment_date IS NULL');
    expect(upgradeReview).toContain('COALESCE(v_req.payment_amount, 0) < v_expected');
    const addonReview = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.review_addon_request'),
      sql.indexOf('cancel_own_subscription_request'),
    );
    expect(addonReview).not.toContain('v_req.receipt_image_url');
    expect(addonReview).toContain('v_req.payment_date IS NULL');
  });

  test('owners can cancel their own still-pending requests', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.cancel_own_subscription_request(');
    expect(sql).toContain("status='cancelled', updated_at=now()");
    // Only the owner's own pending row is cancellable.
    expect(sql).toContain('AND user_id=p_user_id AND status=\'pending\'');
  });
});
