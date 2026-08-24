const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport } }));

const loadEmail = async (env: Record<string, string | undefined> = {}) => {
  jest.resetModules();
  for (const key of ['BREVO_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'FROM_NAME']) delete process.env[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) process.env[key] = value;
  return import('@/lib/email');
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('email delivery functions', () => {
  test('fails safely when no provider is configured', async () => {
    const { sendEmail } = await loadEmail();
    await expect(sendEmail('a@test.com', 'Subject', '<b>Hello</b>')).resolves.toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });

  test('sends through Brevo with configured sender and payload', async () => {
    global.fetch = jest.fn(async () => new Response('', { status: 201 })) as unknown as typeof fetch;
    const { sendEmail } = await loadEmail({ BREVO_API_KEY: 'brevo', FROM_EMAIL: 'sender@test.com', FROM_NAME: 'Pro Acc' });
    await expect(sendEmail('to@test.com', 'Subject', '<p>Hello</p>')).resolves.toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('brevo');
    expect(JSON.parse(init.body)).toMatchObject({ sender: { email: 'sender@test.com', name: 'Pro Acc' }, to: [{ email: 'to@test.com' }], subject: 'Subject' });
  });

  test('reports Brevo HTTP/network failures when SMTP is unavailable', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, text: async () => { throw new Error('body read'); } })) as unknown as typeof fetch;
    let mod = await loadEmail({ BREVO_API_KEY: 'bad' });
    await expect(mod.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
    global.fetch = jest.fn(async () => new Response('denied', { status: 401 })) as unknown as typeof fetch;
    mod = await loadEmail({ BREVO_API_KEY: 'bad' });
    await expect(mod.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
    global.fetch = jest.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    mod = await loadEmail({ BREVO_API_KEY: 'bad' });
    await expect(mod.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
  });

  test('falls back to configured SMTP and returns false on SMTP errors', async () => {
    global.fetch = jest.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    sendMail.mockResolvedValueOnce({ messageId: 'm1' });
    let mod = await loadEmail({ BREVO_API_KEY: 'bad', SMTP_HOST: 'smtp.test', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', FROM_EMAIL: 'from@test.com', FROM_NAME: 'App' });
    await expect(mod.sendEmail('to@test.com', 'S', '<p>H</p>')).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test', port: 465, secure: true, requireTLS: false }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'App <from@test.com>', to: 'to@test.com' }));
    sendMail.mockResolvedValueOnce({ messageId: 'm2' });
    await expect(mod.sendEmail('second@test.com', 'S2', 'H2')).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledTimes(1);

    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    mod = await loadEmail({ SMTP_HOST: 'smtp.test', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    await expect(mod.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
  });

  test('builds reset and verification emails with escaped attribute URLs', async () => {
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return new Response(JSON.stringify(payload), { status: 201 });
    }) as unknown as typeof fetch;
    const mod = await loadEmail({ BREVO_API_KEY: 'key' });
    await expect(mod.sendPasswordResetEmail('a@test.com', `https://app.test/reset?a=1&x="<bad>`)).resolves.toBe(true);
    let body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.subject).toContain('إعادة تعيين');
    expect(body.htmlContent).toContain('&amp;');
    expect(body.htmlContent).toContain('&quot;&lt;bad&gt;');
    expect(body.htmlContent).not.toContain('"<bad>');

    await expect(mod.sendVerificationEmail('a@test.com', `https://app.test/verify?a=1&x="<bad>`)).resolves.toBe(true);
    body = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(body.subject).toContain('تأكيد البريد');
    expect(body.htmlContent).toContain('&quot;&lt;bad&gt;');
  });
});
