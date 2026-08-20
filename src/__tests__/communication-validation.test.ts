/**
 * Tests for communication/messaging validation schemas.
 * Pure Zod schemas — no external dependencies.
 * Focuses on security boundaries: strict mode, injection, size limits.
 */

import {
  approvalCreateSchema,
  approvalDecisionSchema,
  companyMessageSchema,
  telegramConfigSchema,
  pushSubscriptionSchema,
  pushQueueSchema,
  publicComplaintSchema,
  supportTicketCreateSchema,
} from '@/lib/communication-validation';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

describe('approvalCreateSchema', () => {
  test('accepts valid approval request', () => {
    expect(approvalCreateSchema.safeParse({
      entity_type: 'journal_entry',
      entity_id: VALID_UUID,
    }).success).toBe(true);
  });

  test('rejects invalid entity_type', () => {
    expect(approvalCreateSchema.safeParse({
      entity_type: 'hacked_entity',
      entity_id: VALID_UUID,
    }).success).toBe(false);
  });

  test('rejects extra fields (strict)', () => {
    expect(approvalCreateSchema.safeParse({
      entity_type: 'journal_entry',
      entity_id: VALID_UUID,
      malicious: true,
    }).success).toBe(false);
  });

  test.each(['journal_entry', 'purchase_invoice', 'payroll', 'cash_transaction'] as const)(
    'accepts entity_type: %s',
    (type) => {
      expect(approvalCreateSchema.safeParse({ entity_type: type, entity_id: VALID_UUID }).success).toBe(true);
    },
  );
});

describe('approvalDecisionSchema', () => {
  test('accepts approve/reject', () => {
    expect(approvalDecisionSchema.safeParse({ action: 'approve' }).success).toBe(true);
    expect(approvalDecisionSchema.safeParse({ action: 'reject' }).success).toBe(true);
  });

  test('rejects invalid actions', () => {
    expect(approvalDecisionSchema.safeParse({ action: 'delete' }).success).toBe(false);
  });
});

describe('companyMessageSchema', () => {
  test('accepts valid messages', () => {
    expect(companyMessageSchema.safeParse({
      subject: 'عنوان الرسالة',
      body: 'نص الرسالة',
    }).success).toBe(true);
  });

  test('rejects empty subject', () => {
    expect(companyMessageSchema.safeParse({ subject: '', body: 'text' }).success).toBe(false);
  });

  test('rejects subject over 200 chars', () => {
    expect(companyMessageSchema.safeParse({
      subject: 'x'.repeat(201),
      body: 'text',
    }).success).toBe(false);
  });

  test('rejects body over 5000 chars', () => {
    expect(companyMessageSchema.safeParse({
      subject: 'ok',
      body: 'x'.repeat(5001),
    }).success).toBe(false);
  });
});

describe('telegramConfigSchema', () => {
  const validConfig = {
    chat_id: '123456789',
    is_enabled: true,
    notify_invoices: true,
    notify_cash_transactions: false,
    notify_user_logins: false,
    approvals_enabled: false,
    approval_threshold: 1000,
  };

  test('accepts valid config', () => {
    expect(telegramConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  test('requires chat_id when enabled', () => {
    expect(telegramConfigSchema.safeParse({
      ...validConfig,
      chat_id: '',
      is_enabled: true,
    }).success).toBe(false);
  });

  test('allows empty chat_id when disabled', () => {
    expect(telegramConfigSchema.safeParse({
      ...validConfig,
      chat_id: '',
      is_enabled: false,
      approvals_enabled: false,
    }).success).toBe(true);
  });

  test('accepts negative chat_id (group chats)', () => {
    expect(telegramConfigSchema.safeParse({
      ...validConfig,
      chat_id: '-1001234567890',
    }).success).toBe(true);
  });

  test('rejects non-numeric chat_id', () => {
    expect(telegramConfigSchema.safeParse({
      ...validConfig,
      chat_id: 'not-a-number',
    }).success).toBe(false);
  });

  test('rejects 3-decimal approval_threshold', () => {
    expect(telegramConfigSchema.safeParse({
      ...validConfig,
      approval_threshold: 100.123,
    }).success).toBe(false);
  });
});

describe('pushSubscriptionSchema', () => {
  test('accepts valid subscription', () => {
    expect(pushSubscriptionSchema.safeParse({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/push/v1/token123',
        keys: { p256dh: 'publickey', auth: 'authkey' },
      },
    }).success).toBe(true);
  });

  test('rejects HTTP endpoint (must be HTTPS)', () => {
    expect(pushSubscriptionSchema.safeParse({
      subscription: {
        endpoint: 'http://insecure.com/push',
        keys: { p256dh: 'key', auth: 'key' },
      },
    }).success).toBe(false);
  });

  test('rejects extra keys in subscription (strict)', () => {
    expect(pushSubscriptionSchema.safeParse({
      subscription: {
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'key', auth: 'key', extra: 'bad' },
      },
    }).success).toBe(false);
  });
});

describe('pushQueueSchema', () => {
  test('rejects both target_user_id and target_role', () => {
    expect(pushQueueSchema.safeParse({
      title: 'إشعار',
      message: 'نص',
      target_user_id: VALID_UUID,
      target_role: 'admin',
    }).success).toBe(false);
  });

  test('accepts single target', () => {
    expect(pushQueueSchema.safeParse({
      title: 'إشعار',
      message: 'نص',
      target_user_id: VALID_UUID,
    }).success).toBe(true);
  });

  test('rejects protocol-relative URL in link', () => {
    expect(pushQueueSchema.safeParse({
      title: 'إشعار',
      message: 'نص',
      url: '//evil.com',
    }).success).toBe(false);
  });

  test('accepts internal path URL', () => {
    expect(pushQueueSchema.safeParse({
      title: 'إشعار',
      message: 'نص',
      url: '/dashboard/invoices',
    }).success).toBe(true);
  });
});

describe('publicComplaintSchema', () => {
  test('accepts valid complaint', () => {
    expect(publicComplaintSchema.safeParse({
      name: 'أحمد',
      email: 'ahmed@example.com',
      subject: 'مشكلة',
      message: 'تفاصيل المشكلة',
    }).success).toBe(true);
  });

  test('defaults type to complaint', () => {
    const result = publicComplaintSchema.parse({
      name: 'أحمد',
      email: 'ahmed@example.com',
      subject: 'مشكلة',
      message: 'تفاصيل',
    });
    expect(result.type).toBe('complaint');
  });

  test('rejects invalid email', () => {
    expect(publicComplaintSchema.safeParse({
      name: 'أحمد',
      email: 'not-an-email',
      subject: 'مشكلة',
      message: 'تفاصيل',
    }).success).toBe(false);
  });
});

describe('supportTicketCreateSchema', () => {
  test('accepts valid ticket', () => {
    expect(supportTicketCreateSchema.safeParse({
      subject: 'مشكلة تقنية',
      message: 'لا أستطيع الوصول للوحة التحكم بشكل كامل',
      category: 'technical',
    }).success).toBe(true);
  });

  test('rejects subject under 3 chars', () => {
    expect(supportTicketCreateSchema.safeParse({
      subject: 'ab',
      message: 'enough message text here',
    }).success).toBe(false);
  });

  test('rejects message under 10 chars', () => {
    expect(supportTicketCreateSchema.safeParse({
      subject: 'valid subject',
      message: 'short',
    }).success).toBe(false);
  });

  test.each(['billing', 'payment', 'technical', 'account', 'data_request', 'other'] as const)(
    'accepts category: %s',
    (cat) => {
      expect(supportTicketCreateSchema.safeParse({
        subject: 'valid subject',
        message: 'valid message text here',
        category: cat,
      }).success).toBe(true);
    },
  );
});
