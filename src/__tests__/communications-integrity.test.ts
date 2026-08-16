import fs from 'node:fs';
import path from 'node:path';
import {
  approvalCreateSchema, companyMessageSchema, pushQueueSchema, telegramConfigSchema,
  tenantComplaintSchema,
} from '@/lib/communication-validation';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('communication input boundaries', () => {
  const id = '10000000-0000-4000-8000-000000000001';

  it('rejects injected tenant, actor, amount, and requester fields', () => {
    expect(approvalCreateSchema.safeParse({
      entity_type: 'journal_entry', entity_id: id, company_id: id,
    }).success).toBe(false);
    expect(approvalCreateSchema.safeParse({
      entity_type: 'journal_entry', entity_id: id, amount: 1, requester_id: id,
    }).success).toBe(false);
    expect(companyMessageSchema.safeParse({ subject: 'x', body: 'y', sender_id: id }).success).toBe(false);
    expect(tenantComplaintSchema.safeParse({ type: 'complaint', subject: 'x', body: 'y', user_id: id }).success).toBe(false);
  });

  it('accepts only internal push links and one target selector', () => {
    expect(pushQueueSchema.safeParse({ title: 'x', message: 'y', url: 'https://evil.test' }).success).toBe(false);
    expect(pushQueueSchema.safeParse({ title: 'x', message: 'y', url: '//evil.test' }).success).toBe(false);
    expect(pushQueueSchema.safeParse({ title: 'x', message: 'y', target_user_id: id, target_role: 'admin' }).success).toBe(false);
    expect(pushQueueSchema.safeParse({ title: 'x', message: 'y', url: '/dashboard' }).success).toBe(true);
  });

  it('requires a valid Telegram chat whenever either integration mode is enabled', () => {
    const base = {
      chat_id: '', is_enabled: true, notify_invoices: true, notify_cash_transactions: true,
      notify_user_logins: true, approvals_enabled: false, approval_threshold: '100.00',
    };
    expect(telegramConfigSchema.safeParse(base).success).toBe(false);
    expect(telegramConfigSchema.safeParse({ ...base, chat_id: '-123' }).success).toBe(true);
    expect(telegramConfigSchema.safeParse({ ...base, chat_id: '-123', company_id: id }).success).toBe(false);
  });
});

describe('atomic communication routes and database guards', () => {
  it('uses approval-id-only callbacks and resolves legacy identity inside PostgreSQL', () => {
    const notifications = read('src/lib/notifications.ts');
    const webhook = read('src/app/api/telegram/webhook/route.ts');
    expect(notifications).toContain('callback_data: `approval:approve:${approvalId}`');
    expect(notifications).not.toContain('callback_data: `approve_approve_${transactionType}_${transactionId}_${userId}`');
    expect(webhook).toContain("respond_legacy_approval_by_telegram_atomic");
    expect(webhook).not.toContain('requesterId');
  });

  it('keeps sensitive writes behind RPCs and disables the unprotected legacy callback', () => {
    const files = [
      'src/app/api/approvals/route.ts', 'src/app/api/messages/route.ts',
      'src/app/api/messages/[id]/route.ts', 'src/app/api/push-notifications/route.ts',
      'src/app/api/company/reset/route.ts', 'src/app/api/settings/telegram/route.ts',
      'src/app/api/complaints/[id]/route.ts',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/\.insert\(|\.upsert\(|\.delete\(\)/);
    }
    expect(read('src/app/api/telegram/callback/route.ts')).toContain('status: 410');
  });

  it('enforces unique chat binding, row locks, soft archive, and direct-write guards', () => {
    const migration = read('src/migrations/059-approval-communications-and-telegram-guards.sql');
    expect(migration).toContain('uq_enabled_company_telegram_chat');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('archive_company_message_atomic');
    expect(migration).toContain('archive_company_complaint_atomic');
    expect(migration).toContain('trg_guard_telegram_config_writes');
    expect(migration).toContain('trg_guard_push_subscription_writes');
    expect(migration).toContain('trg_guard_complaint_writes');
  });
});
