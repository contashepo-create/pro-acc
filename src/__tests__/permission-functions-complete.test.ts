let user: any = { id: 'u1', role: 'supervisor' };
let permissions: any[] = [];
let bypass: any = null;
const upserts: any[] = [];

const db = {
  from: jest.fn((table: string) => {
    let selectText = '';
    const api: any = {
      select: (text: string) => { selectText = text; return api; },
      eq: () => api,
      limit: () => api,
      maybeSingle: async () => {
        if (table === 'users') return { data: user, error: null };
        if (selectText.includes('bypass_telegram_confirmation') && !selectText.includes('module')) return { data: bypass, error: null };
        return { data: permissions[0] || null, error: null };
      },
      upsert: async (payload: any, options: any) => { upserts.push({ payload, options }); return { error: null }; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: permissions, error: null }).then(resolve, reject),
    };
    return api;
  }),
};
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { canBypassTelegramConfirmation, getUserPermissions, setUserPermission } from '@/lib/permissions';

beforeEach(() => { jest.clearAllMocks(); user = { id: 'u1', role: 'supervisor' }; permissions = []; bypass = null; upserts.length = 0; });

describe('remaining permission functions', () => {
  test('allows explicit bypass or admin role and denies ordinary users', async () => {
    bypass = { bypass_telegram_confirmation: true };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(true);
    bypass = null; user = { id: 'u1', role: 'admin' };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(true);
    user = { id: 'u1', role: 'supervisor' };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(false);
  });

  test('returns role defaults alongside all custom permissions', async () => {
    permissions = [{ module: 'journal', permissions: ['read'], bypass_telegram_confirmation: false }];
    user = { id: 'u1', role: 'accountant' };
    const result = await getUserPermissions('u1', 'c1');
    expect(result).toMatchObject({ role: 'accountant', customPermissions: permissions });
    expect(result.defaultPermissions['*']).toContain('create');
    user = null;
    await expect(getUserPermissions('u1', 'c1')).rejects.toThrow('does not belong');
  });

  test('upserts an explicit tenant/user/module permission atomically', async () => {
    await setUserPermission('u1', 'c1', 'journal', ['read', 'create'], true);
    expect(upserts[0]).toMatchObject({
      payload: { user_id: 'u1', company_id: 'c1', module: 'journal', permissions: ['read', 'create'], bypass_telegram_confirmation: true, updated_at: expect.any(String) },
      options: { onConflict: 'company_id,user_id,module' },
    });
    user = null;
    await expect(setUserPermission('u1', 'c1', 'journal', [])).rejects.toThrow('does not belong');
  });
});
