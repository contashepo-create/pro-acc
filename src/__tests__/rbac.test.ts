/**
 * Tests for RBAC (Role-Based Access Control) system
 */

const mockVerifyToken = jest.fn();
const mockExtractToken = jest.fn();

jest.mock('../lib/auth', () => ({
  extractToken: mockExtractToken,
  verifyToken: mockVerifyToken,
}));

let mockUsersData: Record<string, unknown> | null = null;
let mockCompanyData: Record<string, unknown> | null = null;

jest.mock('../lib/supabase-client', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          eq: (_col2: string, _val2: string) => ({
            single: jest.fn().mockImplementation(() => {
              if (table === 'users') return Promise.resolve({ data: mockUsersData, error: mockUsersData ? null : 'not found' });
              if (table === 'companies') return Promise.resolve({ data: mockCompanyData, error: null });
              return Promise.resolve({ data: null, error: 'not found' });
            }),
          }),
          single: jest.fn().mockImplementation(() => {
            if (table === 'users') return Promise.resolve({ data: mockUsersData, error: mockUsersData ? null : 'not found' });
            if (table === 'companies') return Promise.resolve({ data: mockCompanyData, error: null });
            return Promise.resolve({ data: null, error: 'not found' });
          }),
        }),
      }),
    }),
  }),
}));

// The DB-backed share of the per-user rate limit is out of scope for these
// suites (the memory fast path is what they exercise); the authoritative
// store is covered by shared-rate-limit.test.ts + the 077 migration smoke.
jest.mock('@/lib/shared-rate-limit', () => ({ hitSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));
import { requireRole, requireAdmin, requireManagerOrAbove, requireAccountantOrAbove, AuthError } from '../lib/api-helpers';

const mockRequest = {} as Request;

function setupMocks(role: string, companyId = 'company-123') {
  mockExtractToken.mockReturnValue('valid-token');
  mockVerifyToken.mockReturnValue({ userId: 'user-123', role: 'admin', ver: 0 });
  mockUsersData = { company_id: companyId, is_active: true, role, token_version: 0 };
  mockCompanyData = { is_active: true };
}

describe('requireRole', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should allow admin when admin is in allowed roles', async () => {
    setupMocks('admin');
    const auth = await requireRole(mockRequest, ['admin', 'manager']);
    expect(auth.role).toBe('admin');
    expect(auth.companyId).toBe('company-123');
  });

  test('should allow manager when manager is in allowed roles', async () => {
    setupMocks('manager');
    const auth = await requireRole(mockRequest, ['admin', 'manager']);
    expect(auth.role).toBe('manager');
  });

  test('should reject supervisor when only admin/manager allowed', async () => {
    setupMocks('supervisor');
    await expect(requireRole(mockRequest, ['admin', 'manager']))
      .rejects.toThrow(AuthError);
  });

  test('should reject accountant when only admin allowed', async () => {
    setupMocks('accountant');
    await expect(requireRole(mockRequest, ['admin']))
      .rejects.toThrow(AuthError);
  });
});

describe('requireAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should allow admin', async () => {
    setupMocks('admin');
    const auth = await requireAdmin(mockRequest);
    expect(auth.role).toBe('admin');
  });

  test('should reject manager', async () => {
    setupMocks('manager');
    await expect(requireAdmin(mockRequest)).rejects.toThrow(AuthError);
  });

  test('should reject accountant', async () => {
    setupMocks('accountant');
    await expect(requireAdmin(mockRequest)).rejects.toThrow(AuthError);
  });

  test('should reject supervisor', async () => {
    setupMocks('supervisor');
    await expect(requireAdmin(mockRequest)).rejects.toThrow(AuthError);
  });
});

describe('requireManagerOrAbove', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should allow admin', async () => {
    setupMocks('admin');
    const auth = await requireManagerOrAbove(mockRequest);
    expect(auth.role).toBe('admin');
  });

  test('should allow manager', async () => {
    setupMocks('manager');
    const auth = await requireManagerOrAbove(mockRequest);
    expect(auth.role).toBe('manager');
  });

  test('should reject accountant', async () => {
    setupMocks('accountant');
    await expect(requireManagerOrAbove(mockRequest)).rejects.toThrow(AuthError);
  });

  test('should reject supervisor', async () => {
    setupMocks('supervisor');
    await expect(requireManagerOrAbove(mockRequest)).rejects.toThrow(AuthError);
  });
});

describe('requireAccountantOrAbove', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should allow admin', async () => {
    setupMocks('admin');
    const auth = await requireAccountantOrAbove(mockRequest);
    expect(auth.role).toBe('admin');
  });

  test('should allow manager', async () => {
    setupMocks('manager');
    const auth = await requireAccountantOrAbove(mockRequest);
    expect(auth.role).toBe('manager');
  });

  test('should allow accountant', async () => {
    setupMocks('accountant');
    const auth = await requireAccountantOrAbove(mockRequest);
    expect(auth.role).toBe('accountant');
  });

  test('should reject supervisor', async () => {
    setupMocks('supervisor');
    await expect(requireAccountantOrAbove(mockRequest)).rejects.toThrow(AuthError);
  });
});

describe('Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should reject when no token provided', async () => {
    mockExtractToken.mockReturnValue(null);
    await expect(requireAdmin(mockRequest)).rejects.toThrow('غير مصرح به');
  });

  test('should reject when token is invalid', async () => {
    mockExtractToken.mockReturnValue('bad-token');
    mockVerifyToken.mockReturnValue(null);
    await expect(requireAdmin(mockRequest)).rejects.toThrow('غير مصرح به');
  });

  test('should reject when user is not active', async () => {
    mockExtractToken.mockReturnValue('valid-token');
    mockVerifyToken.mockReturnValue({ userId: 'user-123', role: 'admin', ver: 0 });
    mockUsersData = { company_id: 'company-123', is_active: false, role: 'admin', token_version: 0 };
    mockCompanyData = { is_active: true };
    await expect(requireAdmin(mockRequest)).rejects.toThrow('المستخدم غير نشط');
  });

  test('should use database role, not JWT role', async () => {
    mockExtractToken.mockReturnValue('valid-token');
    mockVerifyToken.mockReturnValue({ userId: 'user-123', role: 'admin', ver: 0 });
    // DB says supervisor despite JWT saying admin
    mockUsersData = { company_id: 'company-123', is_active: true, role: 'supervisor', token_version: 0 };
    mockCompanyData = { is_active: true };
    
    await expect(requireAdmin(mockRequest)).rejects.toThrow(AuthError);
  });
});
