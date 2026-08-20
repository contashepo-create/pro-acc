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
    expect(global.fetch).not.toHaveBeenCalled;
    expect(createTransport).not.toHaveBeenCalled();
  });

  test('sends through Brevo with configured sender and payload', async () => {
    global.fetch = jest.fn(async () => new Response('', { status: 201 })) as any;
    const { sendEmail } = await loadEmail({ BREVO_API_KEY: 'brevo', FROM_EMAIL: 'sender@test.com', FROM_NAME: 'Pro Acc' });
    await expect(sendEmail('to@test.com', 'Subject', '<p>Hello</p>')).resolves.toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('brevo');
    expect(JSON.parse(init.body)).toMatchObject({ sender: { email: 'sender@test.com', name: 'Pro Acc' }, to: [{ email: 'to@test.com' }], subject: 'Subject' });
  });

  test('reports Brevo HTTP/network failures when SMTP is unavailable', async () => {
    global.fetch = jest.fn(async () => new Response('denied', { status: 401 })) as any;
    let module = await loadEmail({ BREVO_API_KEY: 'bad' });
    await expect(module.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
    global.fetch = jest.fn(async () => { throw new Error('network'); }) as any;
    module = await loadEmail({ BREVO_API_KEY: 'bad' });
    await expect(module.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
  });

  test('falls back to configured SMTP and returns false on SMTP errors', async () => {
    global.fetch = jest.fn(async () => new Response('down', { status: 503 })) as any;
    sendMail.mockResolvedValueOnce({ messageId: 'm1' });
    let module = await loadEmail({ BREVO_API_KEY: 'bad', SMTP_HOST: 'smtp.test', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', FROM_EMAIL: 'from@test.com', FROM_NAME: 'App' });
    await expect(module.sendEmail('to@test.com', 'S', '<p>H</p>')).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.test', port: 465, secure: true, requireTLS: false }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'App <from@test.com>', to: 'to@test.com' }));

    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    module = await loadEmail({ SMTP_HOST: 'smtp.test', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    await expect(module.sendEmail('to@test.com', 'S', 'H')).resolves.toBe(false);
  });

  test('builds reset and verification emails with escaped attribute URLs', async () => {
    global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      return new Response(JSON.stringify(payload), { status: 201 });
    }) as any;
    const module = await loadEmail({ BREVO_API_KEY: 'key' });
    await expect(module.sendPasswordResetEmail('a@test.com', `https://app.test/reset?a=1&x="<bad>`)).resolves.toBe(true);
    let body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.subject).toContain('إعادة تعيين');
    expect(body.htmlContent).toContain('&amp;');
    expect(body.htmlContent).toContain('&quot;&lt;bad&gt;');
    expect(body.htmlContent).not.toContain('"<bad>');

    await expect(module.sendVerificationEmail('a@test.com', `https://app.test/verify?a=1&x="<bad>`)).resolves.toBe(true);
    body = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(body.subject).toContain('تأكيد البريد');
    expect(body.htmlContent).toContain('&quot;&lt;bad&gt;');
  });
});
