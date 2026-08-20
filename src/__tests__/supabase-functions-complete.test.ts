const signOutMock = jest.fn(async () => undefined);
const createClient = jest.fn((_url: string, _key: string, _opts: unknown) => ({ auth: { signOut: signOutMock } }));
jest.mock('@supabase/supabase-js', () => ({ createClient }));

const load = async () => {
  jest.resetModules();
  createClient.mockClear(); signOutMock.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = '\uFEFF https://project.supabase.co ';
  process.env.SUPABASE_SERVICE_ROLE_KEY = ' service ';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ' anon ';
  return import('@/lib/supabase');
};

beforeEach(() => { delete (globalThis as any).window; });

describe('canonical Supabase client factories', () => {
  test('creates and memoizes server and browser clients with correct auth policy', async () => {
    const module = await load();
    const server = module.createServerClient();
    expect(module.getServerClient()).toBe(server);
    expect(createClient).toHaveBeenNthCalledWith(1, 'https://project.supabase.co', 'service', expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } }));
    const browser = module.createClientClient();
    expect(module.getClientClient()).toBe(browser);
    expect(createClient).toHaveBeenNthCalledWith(2, 'https://project.supabase.co', 'anon', expect.objectContaining({ auth: { autoRefreshToken: true, persistSession: true } }));
    await module.signOut();
    expect(signOutMock).toHaveBeenCalled();
  });

  test('rejects missing server and browser credentials', async () => {
    let module = await load();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => module.createServerClient()).toThrow('must be set for server client');
    module = await load();
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => module.createClientClient()).toThrow('must be set for client client');
  });

  test('compatibility module exposes all canonical getters and remains server-only', async () => {
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const compatibility = await import('@/lib/supabase-client');
    expect(typeof compatibility.createServerClient).toBe('function');
    expect(typeof compatibility.createClientClient).toBe('function');
    expect(typeof compatibility.getServerClient).toBe('function');
    expect(typeof compatibility.getClientClient).toBe('function');
    expect(compatibility.getSupabase()).toBe(compatibility.getServerClient());
    (globalThis as any).window = {};
    expect(() => compatibility.getSupabase()).toThrow('server-only');
  });
});
