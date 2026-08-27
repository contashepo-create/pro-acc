/**
 * Tests for Telegram webhook secret verification.
 * Pure function — no external dependencies beyond Node's crypto.
 *
 * Verifies fail-closed behavior in production and fail-open in development,
 * plus timing-safe comparison.
 */

import { verifyWebhookSecret } from '@/lib/webhook-guard';

describe('verifyWebhookSecret', () => {
  describe('production mode', () => {
    const isProd = true;

    test('rejects when no secret is configured', () => {
      const result = verifyWebhookSecret('any-value', '', isProd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not configured');
    });

    test('rejects when secret is configured but not supplied in request', () => {
      const result = verifyWebhookSecret(null, 'my-secret', isProd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('no secret header');
    });

    test('rejects when supplied secret does not match', () => {
      const result = verifyWebhookSecret('wrong-secret', 'correct-secret', isProd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('mismatch');
    });

    test('accepts when supplied secret matches', () => {
      const result = verifyWebhookSecret('correct-secret', 'correct-secret', isProd);
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('verified');
    });

    test('rejects empty supplied against configured secret', () => {
      const result = verifyWebhookSecret('', 'my-secret', isProd);
      expect(result.ok).toBe(false);
    });

    test('handles whitespace-only configured secret as unconfigured', () => {
      const result = verifyWebhookSecret('any', '  ', isProd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('not configured');
    });
  });

  describe('development mode', () => {
    const isProd = false;

    test('accepts when no secret is configured', () => {
      const result = verifyWebhookSecret(null, '', isProd);
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('development');
    });

    test('accepts when secret is configured but not supplied', () => {
      const result = verifyWebhookSecret(null, 'my-secret', isProd);
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('development');
    });

    test('accepts when secret matches', () => {
      const result = verifyWebhookSecret('my-secret', 'my-secret', isProd);
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('verified');
    });

    test('rejects when secret is configured and supplied but wrong', () => {
      const result = verifyWebhookSecret('wrong', 'correct', isProd);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('mismatch');
    });
  });

  describe('timing-safe comparison', () => {
    test('different length secrets are rejected', () => {
      const result = verifyWebhookSecret('short', 'much-longer-secret', true);
      expect(result.ok).toBe(false);
    });

    test('same length but different content is rejected', () => {
      const result = verifyWebhookSecret('aaaa', 'bbbb', true);
      expect(result.ok).toBe(false);
    });
  });
});
