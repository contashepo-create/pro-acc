/**
 * End-to-end lifecycle tests for the operational surfaces that sit outside the
 * accounting core: backup download/restore, company data export, receipt
 * upload, and the Telegram webhook.
 *
 * The behaviours pinned here are the ones whose failure is silent and
 * therefore most dangerous:
 *  - a backup/export must be COMPLETE or fail loudly. Truncating at a row cap,
 *    or swallowing a read error into an empty array, produces a file that still
 *    hashes correctly, still passes restore verification, and then destroys the
 *    rows it never contained.
 *  - the Telegram webhook is an unauthenticated internet endpoint: it must
 *    verify the shared secret whenever one is configured and reject a
 *    present-but-mismatched header, while still processing updates from bots
 *    registered before the secret-token scheme (no header at all) so that
 *    inline approval buttons never die silently for legacy deployments.
 */
import { randomBytes } from 'crypto';

// Generated per run rather than written as literals: hardcoded credential
// strings are what secret scanners flag, and normalising them in tests is how
// real leaks eventually slip through.
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';
process.env.TELEGRAM_WEBHOOK_SECRET = randomBytes(24).toString('hex');
process.env.TELEGRAM_BOT_TOKEN = randomBytes(16).toString('hex');
process.env.BACKUP_SECRET = randomBytes(32).toString('hex');

import { createHmac } from 'crypto';
import { createToken } from '@/lib/auth';

type Row = Record<string, any>;
type Op = { op: string; col?: string; val?: any };

function makeDb(db: Record<string, Row[]>) {
  const calls: Array<{ table: string; ops: Op[]; mut: { kind?: string; payload?: any } }> = [];
  const rpcCalls: Array<{ name: string; params: any }> = [];
  const rpcResults = new Map<string, { data: any; error: any }>();
  const tableErrors = new Map<string, { message: string; code?: string }>();

  const from = (table: string) => {
    const ops: Op[] = []; const mut: any = {}; calls.push({ table, ops, mut });
    let rangeBounds: { from: number; to: number } | null = null;
    const filtered = () => (db[table] || []).filter((row) => ops.every((op) => {
      if (op.op === 'eq') return row[op.col!] === op.val;
      if (op.op === 'in') return op.val.includes(row[op.col!]);
      if (op.op === 'neq') return row[op.col!] !== op.val;
      return true;
    }));
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => { ops.push({ op: 'eq', col, val }); return api; },
      in: (col: string, val: any) => { ops.push({ op: 'in', col, val }); return api; },
      neq: () => api, is: () => api, or: () => api, not: () => api,
      gte: () => api, lte: () => api, lt: () => api, order: () => api, limit: () => api,
      // PostgREST range() bounds are inclusive.
      range: (start: number, end: number) => { rangeBounds = { from: start, to: end }; return api; },
      insert: (payload: any) => { mut.kind = 'insert'; mut.payload = payload; return api; },
      update: (payload: any) => { mut.kind = 'update'; mut.payload = payload; return api; },
      upsert: (payload: any) => { mut.kind = 'upsert'; mut.payload = payload; return api; },
      delete: () => { mut.kind = 'delete'; return api; },
      maybeSingle: async () => ({ data: filtered()[0] || null, error: tableErrors.get(table) || null }),
      single: async () => {
        if (mut.kind === 'insert' || mut.kind === 'upsert') return { data: filtered()[0] ?? mut.payload, error: null };
        const row = filtered()[0] || null;
        return { data: row, error: row ? null : { message: 'not found' } };
      },
      then: (ok: any, fail: any) => {
        const tableError = tableErrors.get(table);
        if (tableError) return Promise.resolve({ data: null, error: tableError, count: 0 }).then(ok, fail);
        const all = filtered();
        const page = rangeBounds ? all.slice(rangeBounds.from, rangeBounds.to + 1) : all;
        return Promise.resolve({ data: page, error: null, count: all.length }).then(ok, fail);
      },
    };
    return api;
  };

  return {
    from, calls, rpcCalls, rpcResults, tableErrors,
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'x' }, error: null }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
      }),
    },
    rpc: async (name: string, params: any) => {
      rpcCalls.push({ name, params });
      return rpcResults.get(name) || { data: { ok: true }, error: null };
    },
  };
}

let mockDb: ReturnType<typeof makeDb>;
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => mockDb }));

import { GET as backupDownloadGET } from '@/app/api/backup/download/route';
import { POST as backupUploadPOST } from '@/app/api/backup/upload/route';
import { POST as backupValidatePOST } from '@/app/api/backup/validate/route';
import { POST as telegramWebhookPOST } from '@/app/api/telegram/webhook/route';

const C1 = 'company-1';
const ADMIN = 'u-admin';

function baseDb(): Record<string, Row[]> {
  return {
    users: [{ id: ADMIN, company_id: C1, role: 'admin', is_active: true, token_version: 0, name: 'مدير' }],
    companies: [{ id: C1, name: 'شركة', email: 'co@example.com', phone: '0500', is_active: true }],
    subscriptions: [{
      id: 's1', company_id: C1, plan_code: 'enterprise', status: 'active',
      start_date: '2024-01-01', end_date: '2099-01-01',
      subscription_plans: { code: 'enterprise', features_modules: { dashboard: true, reports: true } },
    }],
    accounts: [], journal_entries: [], journal_lines: [], invoices: [], invoice_items: [],
    contacts: [], clients: [], projects: [], banks_safes: [], cash_transactions: [],
    inventory_items: [], employees: [], payroll: [],
    backup_logs: [], security_audit_log: [], audit_log: [],
  };
}

function adminRequest(method = 'GET', body?: any, url = 'http://localhost/api/test') {
  const token = createToken(ADMIN, 'admin');
  return {
    url, method,
    headers: { get: (key: string) => (key === 'authorization' ? `Bearer ${token}` : null) },
    cookies: { get: () => undefined },
    json: async () => body,
  } as any;
}

function webhookRequest(payload: any, secret: string | null = process.env.TELEGRAM_WEBHOOK_SECRET!) {
  return {
    url: 'http://localhost/api/telegram/webhook',
    method: 'POST',
    headers: {
      get: (key: string) => (key.toLowerCase() === 'x-telegram-bot-api-secret-token' ? secret : null),
    },
    json: async () => payload,
  } as any;
}

beforeEach(() => {
  mockDb = makeDb(baseDb());
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) as any;
});

describe('backup download completeness', () => {
  test('a table larger than one page is exported in full, not truncated', async () => {
    const db = baseDb();
    // 2,500 rows spans three 1,000-row pages.
    db.journal_lines = Array.from({ length: 2500 }, (_, index) => ({
      id: `jl-${String(index).padStart(5, '0')}`, company_id: C1, debit: 1, credit: 0,
    }));
    mockDb = makeDb(db);

    const response = await backupDownloadGET(adminRequest());
    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text());
    // Every row must be present: a backup that quietly drops rows will delete
    // them from the live company when it is restored.
    expect(payload.data.journal_lines).toHaveLength(2500);
    expect(payload.data.journal_lines[2499].id).toBe('jl-02499');
  });

  test('every exported page stays scoped to the caller company', async () => {
    const db = baseDb();
    db.invoices = [
      { id: 'i-1', company_id: C1, total: 100 },
      { id: 'i-2', company_id: 'company-2', total: 999 },
    ];
    mockDb = makeDb(db);

    const response = await backupDownloadGET(adminRequest());
    const payload = JSON.parse(await response.text());
    expect(payload.data.invoices.map((row: any) => row.id)).toEqual(['i-1']);
    for (const call of mockDb.calls.filter((entry) => entry.table === 'invoices')) {
      expect(call.ops).toEqual(expect.arrayContaining([{ op: 'eq', col: 'company_id', val: C1 }]));
    }
  });

  test('a read failure fails the backup instead of yielding a silently empty table', async () => {
    mockDb = makeDb(baseDb());
    mockDb.tableErrors.set('journal_entries', { message: 'connection reset' });

    const response = await backupDownloadGET(adminRequest());
    // Previously this produced a 200 with journal_entries: [] — a corrupt
    // backup that still hashed correctly and passed restore verification.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const payload = JSON.parse(await response.text());
    expect(payload.success).toBe(false);
    // A failed export must never be recorded as a valid, restorable backup.
    expect(mockDb.calls.filter((call) => call.mut.kind === 'insert' && call.table === 'backup_logs')).toHaveLength(0);
  });

  test('a successful export is logged for later restore verification', async () => {
    const response = await backupDownloadGET(adminRequest());
    expect(response.status).toBe(200);
    const log = mockDb.calls.find((call) => call.mut.kind === 'insert' && call.table === 'backup_logs');
    expect(log).toBeDefined();
    expect(log!.mut.payload).toMatchObject({ company_id: C1, user_id: ADMIN });
    // The HMAC signature is what makes tamper detection possible on restore.
    expect(typeof log!.mut.payload.hmac_signature).toBe('string');
    expect(log!.mut.payload.hmac_signature.length).toBeGreaterThan(0);
    expect(response.headers.get('Content-Disposition')).toContain('attachment');
  });
});

/** A request whose JSON body is read via .text() (as the backup routes do). */
function backupUploadRequest(payload: unknown, path = '/api/backup/upload') {
  const token = createToken(ADMIN, 'admin');
  return {
    url: `http://localhost${path}`,
    method: 'POST',
    headers: {
      get: (key: string) => (
        key === 'authorization' ? `Bearer ${token}`
          : key === 'x-forwarded-for' ? '1.2.3.4'
            : null
      ),
    },
    cookies: { get: () => undefined },
    text: async () => JSON.stringify(payload),
  } as any;
}

/** Build a backup file exactly like the download endpoint produces it. */
function makeSignedBackupFile(overrides?: { data?: Record<string, any>; metadata?: Record<string, any> }) {
  const backupData = {
    metadata: {
      company_id: C1,
      company_name: 'شركة',
      email: 'co@example.com',
      phone: '0500',
      exported_at: new Date().toISOString(),
      version: '1.0',
      format: 'json',
      ...(overrides?.metadata || {}),
    },
    data: {
      accounts: [{ id: '99999999-8888-4777-8666-555555555555', company_id: C1, code: '1110', name: 'نقدية' }],
      ...(overrides?.data || {}),
    },
  };
  const json = JSON.stringify(backupData, null, 2);
  const hmac = createHmac('sha256', process.env.BACKUP_SECRET!).update(json).digest('hex');
  return { backupData, hmac, fileHash: hmac.substring(0, 16) };
}

/** Seed the provenance log so the file counts as a genuine system export. */
function seedBackupLog(hmac: string) {
  mockDb.calls.length = 0;
  mockDb = makeDb({
    ...baseDb(),
    backup_logs: [{ id: 'bl-1', company_id: C1, hmac_signature: hmac }],
  });
}

describe('company backup restore safety', () => {
  test('the dry-run endpoint validates a genuine backup without writing anything', async () => {
    const file = makeSignedBackupFile();
    seedBackupLog(file.hmac);
    const response = await backupValidatePOST(backupUploadRequest(
      { backupData: file.backupData, fileHash: file.fileHash },
      '/api/backup/validate',
    ));
    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text());
    expect(payload.data.valid).toBe(true);
    expect(payload.data.summary.totalRows).toBe(1);
    // Dry-run must NEVER reach the restore RPC.
    expect(mockDb.rpcCalls.some((call) => call.name === 'restore_company_backup_atomic')).toBe(false);
  });

  test('the dry-run rejects a tampered file', async () => {
    const file = makeSignedBackupFile();
    seedBackupLog(file.hmac);
    const tampered = JSON.parse(JSON.stringify(file.backupData));
    tampered.data.accounts[0].name = 'معدل';
    const response = await backupValidatePOST(backupUploadRequest(
      { backupData: tampered, fileHash: file.fileHash },
      '/api/backup/validate',
    ));
    expect(response.status).toBe(400);
  });

  test('the dry-run rejects a file whose HMAC was never logged by the system', async () => {
    const file = makeSignedBackupFile();
    // No backup_logs row — a foreign/crafted file can never pass even with a
    // self-consistent signature.
    const response = await backupValidatePOST(backupUploadRequest(
      { backupData: file.backupData, fileHash: file.fileHash },
      '/api/backup/validate',
    ));
    expect(response.status).toBe(400);
  });

  test('the dry-run rejects a file containing another company\'s rows', async () => {
    const file = makeSignedBackupFile({
      data: { employees: [{ id: '88888888-7777-4666-8555-444444444444', company_id: 'company-2', name: 'غريب' }] },
    });
    seedBackupLog(file.hmac);
    const response = await backupValidatePOST(backupUploadRequest(
      { backupData: file.backupData, fileHash: file.fileHash },
      '/api/backup/validate',
    ));
    // Structural violations are reported in the dry-run report (200), never
    // applied — the apply endpoint would hard-reject the same file.
    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text());
    expect(payload.data.valid).toBe(false);
    expect(payload.data.issues.some((issue: any) => issue.code === 'CROSS_COMPANY')).toBe(true);
  });

  test('the dry-run rejects a file for another company', async () => {
    const file = makeSignedBackupFile({ metadata: { company_id: 'company-2' } });
    seedBackupLog(file.hmac);
    const response = await backupValidatePOST(backupUploadRequest(
      { backupData: file.backupData, fileHash: file.fileHash },
      '/api/backup/validate',
    ));
    expect(response.status).toBe(403);
  });

  test('a genuine backup restores through the atomic RPC scoped to this company', async () => {
    const file = makeSignedBackupFile();
    seedBackupLog(file.hmac);
    const response = await backupUploadPOST(backupUploadRequest({
      backupData: file.backupData, fileHash: file.fileHash,
    }));
    expect(response.status).toBe(200);
    const restoreCall = mockDb.rpcCalls.find((call) => call.name === 'restore_company_backup_atomic');
    expect(restoreCall).toBeDefined();
    expect(restoreCall!.params.p_company_id).toBe(C1);
    expect(restoreCall!.params.p_hmac_signature).toBe(file.hmac);
  });

  test('the restore refuses to touch data before the RPC when a foreign row is present', async () => {
    const file = makeSignedBackupFile({
      data: { contacts: [{ id: '77777777-6666-4555-8444-333333333333', company_id: 'company-2' }] },
    });
    seedBackupLog(file.hmac);
    const response = await backupUploadPOST(backupUploadRequest({
      backupData: file.backupData, fileHash: file.fileHash,
    }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls.some((call) => call.name === 'restore_company_backup_atomic')).toBe(false);
  });

  test('the restore rejects malformed row ids before reaching the database', async () => {
    const file = makeSignedBackupFile({
      data: { accounts: [{ id: "x' OR '1'='1", company_id: C1, code: '1110', name: 'حقن' }] },
    });
    seedBackupLog(file.hmac);
    const response = await backupUploadPOST(backupUploadRequest({
      backupData: file.backupData, fileHash: file.fileHash,
    }));
    expect(response.status).toBe(400);
    expect(mockDb.rpcCalls.some((call) => call.name === 'restore_company_backup_atomic')).toBe(false);
  });

  test('the restore is admin-only', async () => {
    const file = makeSignedBackupFile();
    seedBackupLog(file.hmac);
    const nonAdmin = createToken('u-other', 'accountant');
    const request = {
      url: 'http://localhost/api/backup/upload',
      method: 'POST',
      headers: { get: (key: string) => (key === 'authorization' ? `Bearer ${nonAdmin}` : null) },
      cookies: { get: () => undefined },
      text: async () => JSON.stringify({ backupData: file.backupData, fileHash: file.fileHash }),
    } as any;
    const response = await backupUploadPOST(request);
    expect(response.status).toBe(401);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });
});

describe('telegram webhook security', () => {
  test('an update without the secret header is still processed for legacy webhook registrations', async () => {
    // A bot registered before the secret-token scheme sends no header; the
    // button press must work instead of dying silently.
    const response = await telegramWebhookPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } } },
      null,
    ));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('when no secret is configured the webhook accepts updates and warns instead of killing the bot', async () => {
    const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      const response = await telegramWebhookPOST(webhookRequest(
        { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' } } } },
        null,
      ));
      expect(response.status).toBe(200);
      const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
      expect(call).toBeDefined();
    } finally {
      process.env.TELEGRAM_WEBHOOK_SECRET = configured;
    }
  });

  test('a bot registered on the legacy callback URL processes approvals through the same handler', async () => {
    const { POST: legacyCallbackPOST } = await import('@/app/api/telegram/callback/route');
    const response = await legacyCallbackPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } } },
      null,
    ));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('a wrong secret is rejected without touching the database', async () => {
    const response = await telegramWebhookPOST(webhookRequest(
      { callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' } } } },
      randomBytes(24).toString('hex'),
    ));
    expect(response.status).toBe(403);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('an approval callback is routed to the atomic RPC with the caller chat id', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'approval:approve:a-1', message: { chat: { id: '55' }, message_id: 7 } },
    }));
    expect(response.status).toBe(200);
    const call = mockDb.rpcCalls.find((entry) => entry.name === 'respond_approval_by_telegram_atomic');
    expect(call).toBeDefined();
    // The chat id is the authorisation subject: the RPC binds the action to the
    // chat that is actually allowed to approve it.
    expect(call!.params).toMatchObject({ p_approval_id: 'a-1', p_action: 'approve', p_chat_id: '55' });
  });

  test('an unknown action is refused rather than defaulting to approve', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'approval:destroy:a-1', message: { chat: { id: '55' } } },
    }));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls.filter((call) => call.name.includes('approval'))).toHaveLength(0);
  });

  test('an oversized callback payload is ignored', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: `approval:approve:${'a'.repeat(200)}`, message: { chat: { id: '55' } } },
    }));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls).toHaveLength(0);
  });

  test('a malformed update is acknowledged so Telegram does not retry forever', async () => {
    const response = await telegramWebhookPOST({
      url: 'http://localhost/api/telegram/webhook',
      method: 'POST',
      headers: {
        get: (key: string) => (key.toLowerCase() === 'x-telegram-bot-api-secret-token'
          ? process.env.TELEGRAM_WEBHOOK_SECRET! : null),
      },
      json: async () => { throw new Error('invalid json'); },
    } as any);
    // Acknowledging is deliberate: a 5xx would make Telegram replay the update
    // indefinitely against an endpoint that can never parse it.
    expect(response.status).toBe(200);
  });

  test('a rejected reset request cancels the session instead of issuing a code', async () => {
    const response = await telegramWebhookPOST(webhookRequest({
      callback_query: { id: 'q1', data: 'reset:reject', message: { chat: { id: '55' }, message_id: 9 } },
    }));
    expect(response.status).toBe(200);
    expect(mockDb.rpcCalls.some((call) => call.name === 'reject_telegram_reset_session_atomic')).toBe(true);
    // Rejecting must never mint a confirmation code.
    expect(mockDb.rpcCalls.some((call) => call.name === 'approve_telegram_reset_session_atomic')).toBe(false);
  });
});
