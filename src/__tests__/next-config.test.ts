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
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config without error when NEXT_PUBLIC_SUPABASE_URL is invalid URL string', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'invalid-url';
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config without error when NEXT_PUBLIC_SUPABASE_URL is redacted or malformed', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '[REDACTED]';
    expect(() => require('../../next.config.ts')).not.toThrow();
  });

  it('should load config correctly when NEXT_PUBLIC_SUPABASE_URL is a domain without scheme', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'myproject.supabase.co';
    let config: any;
    expect(() => {
      config = require('../../next.config.ts').default;
    }).not.toThrow();

    expect(config).toBeDefined();
  });

  it('should load config correctly when NEXT_PUBLIC_SUPABASE_URL is a valid URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://myproject.supabase.co';
    const config = require('../../next.config.ts').default;
    const headers = await config.headers();
    const csp = headers[0].headers.find((h: any) => h.key === 'Content-Security-Policy');

    expect(csp).toBeDefined();
    expect(csp.value).toContain('https://myproject.supabase.co');
  });
});
