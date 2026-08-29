const loadTelegram = async (token?: string, chatId?: string) => {
  jest.resetModules();
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = token;
  if (chatId === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID; else process.env.TELEGRAM_ADMIN_CHAT_ID = chatId;
  return import('@/lib/telegram');
};

beforeEach(() => jest.restoreAllMocks());

describe('Telegram transport functions', () => {
  test('cleans BOM/whitespace from the configured bot token', async () => {
    const mod = await loadTelegram('\uFEFF  token  ', '1');
    expect(mod.getBotToken()).toBe('token');
  });

  test('fails safely when admin Telegram is not configured', async () => {
    const mod = await loadTelegram();
    await expect(mod.sendTelegramCode('123456')).resolves.toBe(false);
    await expect(mod.sendAdminNotification('hello')).resolves.toBe(false);
    await expect(mod.sendTelegramMessage('', 'hello')).resolves.toBe(false);
  });

  test('sends escaped OTP codes to the configured admin chat', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const mod = await loadTelegram('token', 'admin-chat');
    await expect(mod.sendTelegramCode('<123&>')).resolves.toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottoken/sendMessage');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('admin-chat');
    expect(body.text).toContain('&lt;123&amp;&gt;');
    expect(body.parse_mode).toBe('HTML');
  });

  test('aborts slow OTP delivery after ten seconds', async () => {
    jest.useFakeTimers();
    let resolveFetch!: (response: Response) => void;
    global.fetch = jest.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => { resolveFetch = resolve; expect(init.signal).toBeDefined(); })) as unknown as typeof fetch;
    const telegramModule = await loadTelegram('token', 'admin');
    const pending = telegramModule.sendTelegramCode('123');
    jest.advanceTimersByTime(10_000);
    const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    resolveFetch(new Response('{}', { status: 200 }));
    await expect(pending).resolves.toBe(true);
    jest.useRealTimers();
  });

  test('aborts a hung admin notification after ten seconds', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      // Simulate real fetch: rejects when the caller's signal aborts.
      init.signal!.addEventListener('abort', () => reject(new Error('The operation was aborted')));
    })) as unknown as typeof fetch;
    const mod = await loadTelegram('token', 'admin');
    const pending = mod.sendAdminNotification('hello');
    jest.advanceTimersByTime(10_000);
    const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    await expect(pending).resolves.toBe(false);
    jest.useRealTimers();
  });

  test('returns false for HTTP and network failures', async () => {
    global.fetch = jest.fn(async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    let mod = await loadTelegram('token', 'admin');
    await expect(mod.sendTelegramCode('123')).resolves.toBe(false);
    await expect(mod.sendAdminNotification('hello')).resolves.toBe(false);
    await expect(mod.sendTelegramMessage('chat', 'hello')).resolves.toBe(false);

    global.fetch = jest.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    mod = await loadTelegram('token', 'admin');
    await expect(mod.sendTelegramCode('123')).resolves.toBe(false);
    await expect(mod.sendAdminNotification('hello')).resolves.toBe(false);
    await expect(mod.sendTelegramMessage('chat', 'hello')).resolves.toBe(false);
  });

  test('sends admin/direct messages and escapes all Telegram HTML metacharacters', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const mod = await loadTelegram('token', 'admin');
    await expect(mod.sendAdminNotification('<b>trusted</b>')).resolves.toBe(true);
    await expect(mod.sendTelegramMessage('chat', 'hello')).resolves.toBe(true);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toMatchObject({ chat_id: 'chat', text: 'hello', parse_mode: 'HTML' });
    expect(mod.escapeTelegramHtml(`<tag a='1'>&`)).toBe(`&lt;tag a='1'&gt;&amp;`);
  });
});
