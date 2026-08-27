describe('next.config.ts environment configuration resilience', () => {
  const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    }
    jest.resetModules();
  });

  it('should load config without error when NEXT_PUBLIC_SUPABASE_URL is undefined', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: fresh require() after env change / module-init test
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config without error when NEXT_PUBLIC_SUPABASE_URL is invalid URL string', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'invalid-url';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: fresh require() after env change / module-init test
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config without error when NEXT_PUBLIC_SUPABASE_URL is redacted or malformed', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '[REDACTED]';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: fresh require() after env change / module-init test
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config correctly when NEXT_PUBLIC_SUPABASE_URL is a domain without scheme', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'myproject.supabase.co';
    let config: { headers?: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> } | undefined;
    expect(() => {
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: fresh require() after env change
      config = require('../../next.config.ts').default;
    }).not.toThrow();

    expect(config).toBeDefined();
  });

  it('should load config correctly when NEXT_PUBLIC_SUPABASE_URL is a valid URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: fresh require() after env change
    const config = require('../../next.config.ts').default;
    const headers = await config.headers();
    const csp = headers[0].headers.find((h: { key: string; value: string }) => h.key === 'Content-Security-Policy');

    expect(csp).toBeDefined();
    // Hardening: connect-src no longer ships the Supabase origin (the
    // browser never calls it directly — all traffic goes through same-origin
    // route handlers) and never ships a bare 'https:' wildcard.
    expect(csp.value).not.toContain('https://myproject.supabase.co');
    expect(csp.value).toContain("connect-src 'self' https://api.moyasar.com;");
    expect(csp.value).not.toContain("https://api.moyasar.com https:");
  });
});
