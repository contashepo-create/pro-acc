let configResult: any = { data: null, error: null };
let bankResult: any = { data: null, error: null };
let userResult: any = { data: null, error: null };
const rpc = jest.fn();

const db = {
  rpc,
  from: jest.fn((table: string) => {
    const api: any = {
      select: () => api, eq: () => api,
      maybeSingle: async () => table === 'company_telegram_configs' ? configResult : table === 'banks_safes' ? bankResult : userResult,
    };
    return api;
  }),
};

jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));
jest.mock('@/lib/telegram', () => ({ escapeTelegramHtml: (value: string) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }));

import {
  getTelegramConfig, getAccountBalance, checkBankBalance, requireApproval,
  sendApprovalRequestNotification, handleApprovalResponse, sendTelegramNotification,
  sendTransactionNotification, checkApprovalThreshold,
} from '@/lib/notifications';

const enabledConfig = {
  company_id: 'c1', chat_id: 'chat', is_enabled: true, approvals_enabled: true, approval_threshold: 100,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
  configResult = { data: enabledConfig, error: null };
  bankResult = { data: null, error: null };
  userResult = { data: { name: 'Ali <Admin>', email: 'a@test.com' }, error: null };
  global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any;
});

describe('notification configuration and balances', () => {
  test('loads tenant Telegram configuration and surfaces lookup errors', async () => {
    await expect(getTelegramConfig('c1')).resolves.toEqual(enabledConfig);
    configResult = { data: null, error: new Error('config') };
    await expect(getTelegramConfig('c1')).rejects.toThrow('config');
  });

  test('requires tenant context and normalizes account-balance RPC values', async () => {
    await expect(getAccountBalance('a1')).rejects.toThrow('companyId is required');
    rpc.mockResolvedValueOnce({ data: '125.50', error: null });
    await expect(getAccountBalance('a1', 'c1')).resolves.toBe(125.5);
    expect(rpc).toHaveBeenCalledWith('get_account_balance', { p_company_id: 'c1', p_account_id: 'a1', p_journal_type: null, p_as_of: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(getAccountBalance('a1', 'c1')).resolves.toBe(0);
    rpc.mockResolvedValueOnce({ data: null, error: new Error('balance') });
    await expect(getAccountBalance('a1', 'c1')).rejects.toThrow('balance');
  });

  test('checks missing, insufficient and sufficient bank balances', async () => {
    await expect(checkBankBalance('b1', 10, 'c1')).resolves.toMatchObject({ allowed: false, balance: 0, message: 'البنك/الخزينة غير موجود' });
    bankResult = { data: { account_id: 'a1', name: 'Bank' }, error: null };
    rpc.mockResolvedValueOnce({ data: 50, error: null });
    await expect(checkBankBalance('b1', 100, 'c1')).resolves.toMatchObject({ allowed: false, balance: 50, message: expect.stringContaining('الرصيد غير كافٍ') });
    rpc.mockResolvedValueOnce({ data: 150, error: null });
    await expect(checkBankBalance('b1', 100, 'c1')).resolves.toEqual({ allowed: true, balance: 150 });
    bankResult = { data: { account_id: null, name: 'Unlinked' }, error: null };
    await expect(checkBankBalance('b2', 1, 'c1')).resolves.toMatchObject({ allowed: false, balance: 0 });
  });
});

describe('approval notifications', () => {
  test('does not require approval when integration/policy/amount does not apply', async () => {
    for (const config of [null, { ...enabledConfig, is_enabled: false }, { ...enabledConfig, approvals_enabled: false }, { ...enabledConfig, approval_threshold: 0 }]) {
      configResult = { data: config, error: null };
      await expect(requireApproval('c1', 500, 'voucher_receipt', 'u1', 'v1')).resolves.toEqual({ requiresApproval: false, blocked: false });
    }
    configResult = { data: enabledConfig, error: null };
    await expect(requireApproval('c1', 100, 'voucher_receipt', 'u1', 'v1')).resolves.toEqual({ requiresApproval: false, blocked: false });
  });

  test('fails closed when approval creation or Telegram delivery fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(requireApproval('c1', 101, 'voucher_receipt', 'u1', 'v1')).resolves.toMatchObject({ message: expect.stringContaining('تعذر إنشاء') });
    rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc failed') });
    await expect(requireApproval('c1', 101, 'voucher_receipt', 'u1', 'v1')).resolves.toMatchObject({ requiresApproval: true, blocked: true, message: 'rpc failed' });

    rpc.mockResolvedValueOnce({ data: { id: 'approval-1' }, error: null });
    delete process.env.TELEGRAM_BOT_TOKEN;
    await expect(requireApproval('c1', 101, 'voucher_receipt', 'u1', 'v1')).resolves.toMatchObject({ blocked: true, message: expect.stringContaining('تعذر إرسال') });
  });

  test('creates approval and sends escaped requester/details with callback ids', async () => {
    rpc.mockResolvedValueOnce({ data: { id: 'approval-1' }, error: null });
    const result = await requireApproval('c1', 150, 'voucher_receipt', 'u1', '12345678-xxxx', 'desc');
    expect(result).toMatchObject({ requiresApproval: true, blocked: true, message: expect.stringContaining('تم إرسال') });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain('Ali &lt;Admin&gt;');
    expect(body.text).toContain('سند قبض');
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('approval:approve:approval-1');
  });

  test('explicit approval notification enforces config/requester and HTTP success', async () => {
    configResult = { data: null, error: null };
    await expect(sendApprovalRequestNotification('c1', 10, 'journal_entry', 'j1', 'u1', 'a1')).rejects.toThrow('not enabled');
    configResult = { data: enabledConfig, error: null };
    userResult = { data: null, error: null };
    await expect(sendApprovalRequestNotification('c1', 10, 'unknown_type', 'short', 'u1', 'a1')).rejects.toThrow('requester');
    userResult = { data: { name: null, email: 'fallback@test.com' }, error: null };
    global.fetch = jest.fn(async () => new Response('denied', { status: 403 })) as any;
    await expect(sendApprovalRequestNotification('c1', 10, 'journal_entry', 'j1', 'u1', 'a1')).rejects.toThrow('403');
  });

  test('maps legacy approval response errors, approvals and rejections', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: {} });
    await expect(handleApprovalResponse('approve', 'journal_entry', 'j1', 'untrusted', 'chat')).resolves.toMatchObject({ success: false, message: 'تعذر معالجة الاعتماد' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(handleApprovalResponse('approve', 'journal_entry', 'j1', 'untrusted', 'chat')).resolves.toEqual({ success: false, message: 'denied' });
    rpc.mockResolvedValueOnce({ data: { status: 'approved' }, error: null });
    await expect(handleApprovalResponse('approve', 'journal_entry', 'j1', 'untrusted', 'chat')).resolves.toMatchObject({ success: true, message: expect.stringContaining('الاعتماد') });
    rpc.mockResolvedValueOnce({ data: { status: 'rejected' }, error: null });
    await expect(handleApprovalResponse('reject', 'journal_entry', 'j1', 'untrusted', 'chat')).resolves.toMatchObject({ success: true, message: expect.stringContaining('الرفض') });
    expect(rpc).toHaveBeenLastCalledWith('respond_legacy_approval_by_telegram_atomic', expect.not.objectContaining({ requester: expect.anything() }));
  });
});

describe('general and transaction notifications', () => {
  test('rejects disabled/missing tokens, handles HTTP/network, and succeeds', async () => {
    configResult = { data: null, error: null };
    await expect(sendTelegramNotification('c1', 'hello')).resolves.toMatchObject({ success: false });
    configResult = { data: enabledConfig, error: null };
    process.env.TELEGRAM_BOT_TOKEN = 'sk_not_a_bot';
    await expect(sendTelegramNotification('c1', 'hello')).resolves.toMatchObject({ success: false, error: expect.stringContaining('غير محدد') });
    process.env.TELEGRAM_BOT_TOKEN = 'bot';
    global.fetch = jest.fn(async () => new Response('bad', { status: 500 })) as any;
    await expect(sendTelegramNotification('c1', 'hello')).resolves.toEqual({ success: false, error: 'فشل الإرسال: 500' });
    global.fetch = jest.fn(async () => { throw new Error('network'); }) as any;
    await expect(sendTelegramNotification('c1', 'hello')).resolves.toEqual({ success: false, error: 'خطأ في الاتصال' });
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any;
    await expect(sendTelegramNotification('c1', 'hello')).resolves.toEqual({ success: true });
  });

  test('applies transaction thresholds and escapes transaction details', async () => {
    configResult = { data: { ...enabledConfig, approval_threshold: 200 }, error: null };
    await expect(sendTransactionNotification('c1', 'receipt', { amount: 100, reason: 'x', date: '2026-08-20' })).resolves.toEqual({ notified: false });
    configResult = { data: enabledConfig, error: null };
    await expect(sendTransactionNotification('c1', 'disbursement', { amount: 150, reason: '<rent>', bankName: '<bank>', userName: '<user>', date: '2026-08-20' }))
      .resolves.toEqual({ notified: true, message: 'تم إرسال الإشعار' });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.text).toContain('&lt;rent&gt;');
    expect(body.text).toContain('سند صرف');
    configResult = { data: { ...enabledConfig, approval_threshold: 0 }, error: null };
    global.fetch = jest.fn(async () => new Response('bad', { status: 500 })) as any;
    await expect(sendTransactionNotification('c1', 'receipt', { amount: 1, reason: 'x', date: 'd' }))
      .resolves.toMatchObject({ notified: false, message: 'فشل الإرسال: 500' });
  });

  test('checks approval thresholds and fails closed on configuration errors', async () => {
    await expect(checkApprovalThreshold('c1', 101, 'voucher', 'u')).resolves.toEqual({ requiresApproval: true });
    await expect(checkApprovalThreshold('c1', 100, 'voucher', 'u')).resolves.toEqual({ requiresApproval: false });
    configResult = { data: { ...enabledConfig, approvals_enabled: false }, error: null };
    await expect(checkApprovalThreshold('c1', 999, 'voucher', 'u')).resolves.toEqual({ requiresApproval: false });
    configResult = { data: null, error: new Error('db') };
    await expect(checkApprovalThreshold('c1', 1, 'voucher', 'u')).resolves.toEqual({ requiresApproval: true, configurationUnavailable: true });
  });
});
