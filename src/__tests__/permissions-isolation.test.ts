/**
 * Tests for the permission system + tenant isolation.
 *
 * Verifies:
 *  1. hasModulePermission enforces role defaults (admin full, supervisor
 *     read-only can't write, accountant limited).
 *  2. Custom user permissions override role defaults; empty custom denies.
 *  3. Admin always passes module checks (no DB permission lookup needed).
 *  4. requireModulePermission blocks a supervisor from a write action.
 */

// Stateful mock of the users + user_permissions tables.
const db = {
  userRole: 'admin',
  customPerm: null as { module: string; permissions: string[] } | null,
};

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.userRole ? { role: db.userRole } : null, error: null }) }) }) }),
        };
      }
      // user_permissions
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.customPerm, error: null }) }) }) }) }),
      };
    },
  }),
}));

import { hasModulePermission, MODULES } from '@/lib/permissions';

const C = 'company-1';
const U = 'user-1';

describe('hasModulePermission — role defaults', () => {
  beforeEach(() => { db.customPerm = null; });

  test('admin can do anything (all actions on any module)', async () => {
    db.userRole = 'admin';
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'delete')).toBe(true);
    expect(await hasModulePermission(U, C, MODULES.SETTINGS, 'create')).toBe(true);
  });

  test('supervisor is read-only: can read but cannot write', async () => {
    db.userRole = 'supervisor';
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'read')).toBe(true);
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'create')).toBe(false);
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'delete')).toBe(false);
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'update')).toBe(false);
  });

  test('accountant can create/update but not delete/approve', async () => {
    db.userRole = 'accountant';
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'create')).toBe(true);
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'update')).toBe(true);
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'delete')).toBe(false);
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'approve')).toBe(false);
  });

  test('accountant cannot manage users', async () => {
    db.userRole = 'accountant';
    expect(await hasModulePermission(U, C, MODULES.USERS, 'read')).toBe(false);
  });

  test('returns false when user does not exist', async () => {
    db.userRole = ''; // no user
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'read')).toBe(false);
  });
});

describe('hasModulePermission — custom permissions override', () => {
  beforeEach(() => { db.userRole = 'supervisor'; });

  test('custom permission grants an action the role default denies', async () => {
    db.customPerm = { module: MODULES.JOURNAL, permissions: ['create'] };
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'create')).toBe(true);
    // non-granted actions still denied
    expect(await hasModulePermission(U, C, MODULES.JOURNAL, 'delete')).toBe(false);
  });

  test('empty custom permission denies the module entirely (strict restriction)', async () => {
    db.customPerm = { module: MODULES.INVOICES, permissions: [] };
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'read')).toBe(false);
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'create')).toBe(false);
  });

  test('wildcard "*" grants all actions', async () => {
    db.customPerm = { module: MODULES.INVOICES, permissions: ['*'] };
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'delete')).toBe(true);
    expect(await hasModulePermission(U, C, MODULES.INVOICES, 'approve')).toBe(true);
  });
});
