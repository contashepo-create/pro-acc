let user: any = { id: 'u1', role: 'supervisor' };
let permissions: any[] = [];
let bypass: any = null;
let userList: any[] | null = null;
let errors: Record<string, any> = {};
const upserts: any[] = [];

const db = {
  from: jest.fn((table: string) => {
    let selectText = '';
    const api: any = {
      select: (text: string) => { selectText = text; return api; },
      eq: () => api,
      limit: () => api,
      order: async () => ({ data: userList, error: errors.users || null }),
      maybeSingle: async () => {
        if (table === 'users') return { data: user, error: errors.users || null };
        if (selectText.includes('bypass_telegram_confirmation') && !selectText.includes('module')) return { data: bypass, error: errors.bypass || null };
        return { data: permissions[0] || null, error: errors.permissions || null };
      },
      upsert: async (payload: any, options: any) => { upserts.push({ payload, options }); return { error: errors.upsert || null }; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: table === 'users' ? userList : permissions, error: errors[table] || null }).then(resolve, reject),
    };
    return api;
  }),
};
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => db }));

import { canBypassTelegramConfirmation, hasModulePermission, getUserPermissions, setUserPermission, getCompanyUsersWithPermissions } from '@/lib/permissions';

beforeEach(() => { jest.clearAllMocks(); user = { id: 'u1', role: 'supervisor' }; userList = [user]; permissions = []; bypass = null; errors = {}; upserts.length = 0; });

describe('remaining permission functions', () => {
  test('allows explicit bypass or admin role and denies ordinary users', async () => {
    bypass = { bypass_telegram_confirmation: true };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(true);
    bypass = null; user = { id: 'u1', role: 'admin' };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(true);
    user = { id: 'u1', role: 'supervisor' };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(false);
  });

  test('fails closed when bypass permission or user role lookup errors', async () => {
    errors.bypass = new Error('perm');
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(false);
    errors = { users: new Error('user') };
    await expect(canBypassTelegramConfirmation('u1', 'c1')).resolves.toBe(false);
  });

  test('fails closed on permission lookup errors and unknown roles/actions', async () => {
    errors.users = new Error('user');
    await expect(hasModulePermission('u1', 'c1', 'journal', 'read')).resolves.toBe(false);
    errors = { permissions: new Error('custom') };
    await expect(hasModulePermission('u1', 'c1', 'journal', 'read')).resolves.toBe(false);
    errors = {}; user = { id: 'u1', role: 'unknown' }; permissions = [];
    await expect(hasModulePermission('u1', 'c1', 'journal', 'nonsense')).resolves.toBe(false);
  });

  test('returns role defaults alongside all custom permissions', async () => {
    permissions = [{ module: 'journal', permissions: ['read'], bypass_telegram_confirmation: false }];
    user = { id: 'u1', role: 'accountant' };
    const result = await getUserPermissions('u1', 'c1');
    expect(result).toMatchObject({ role: 'accountant', customPermissions: permissions });
    expect(result.defaultPermissions['*']).toContain('create');
    user = { id: 'u1', role: '' };
    expect((await getUserPermissions('u1', 'c1')).role).toBe('supervisor');
    user = null;
    await expect(getUserPermissions('u1', 'c1')).rejects.toThrow('does not belong');
    errors = { user_permissions: new Error('perms') };
    await expect(getUserPermissions('u1', 'c1')).rejects.toThrow('perms');
    errors = { users: new Error('user') };
    await expect(getUserPermissions('u1', 'c1')).rejects.toThrow('user');
  });

  test('upserts an explicit tenant/user/module permission atomically', async () => {
    await setUserPermission('u1', 'c1', 'journal', ['read', 'create'], true);
    expect(upserts[0]).toMatchObject({
      payload: { user_id: 'u1', company_id: 'c1', module: 'journal', permissions: ['read', 'create'], bypass_telegram_confirmation: true, updated_at: expect.any(String) },
      options: { onConflict: 'company_id,user_id,module' },
    });
    errors.upsert = new Error('upsert');
    await expect(setUserPermission('u1', 'c1', 'journal', [])).rejects.toThrow('upsert');
    errors = {}; user = null;
    await expect(setUserPermission('u1', 'c1', 'journal', [])).rejects.toThrow('does not belong');
    errors = { users: new Error('target') };
    await expect(setUserPermission('u1', 'c1', 'journal', [])).rejects.toThrow('target');
  });

  test('groups company users with permissions and handles empty/error results', async () => {
    userList = [{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }];
    permissions = [{ user_id: 'u1', module: 'journal', permissions: ['read'] }, { user_id: 'u1', module: 'cash', permissions: [] }];
    const result = await getCompanyUsersWithPermissions('c1');
    expect(result[0].permissions).toHaveLength(2);
    expect(result[1].permissions).toEqual([]);
    userList = null;
    await expect(getCompanyUsersWithPermissions('c1')).resolves.toEqual([]);
    userList = []; errors = { users: new Error('users') };
    await expect(getCompanyUsersWithPermissions('c1')).rejects.toThrow('users');
    errors = { user_permissions: new Error('permissions') }; userList = [{ id: 'u1' }];
    await expect(getCompanyUsersWithPermissions('c1')).rejects.toThrow('permissions');
  });
});
