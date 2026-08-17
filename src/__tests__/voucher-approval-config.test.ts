/** Regression tests for the additional-user voucher approval lookup. */

type ConfigResult = { data: Record<string, unknown> | null; error: unknown };

let result: ConfigResult;
let selectedColumns = '';

jest.mock('@/lib/supabase-client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'company_telegram_configs') throw new Error(`unexpected table: ${table}`);
      return {
        select: (columns: string) => {
          selectedColumns = columns;
          return {
            eq: () => ({
              maybeSingle: async () => result,
            }),
          };
        },
      };
    },
  }),
}));

import { checkApprovalThreshold } from '@/lib/notifications';

beforeEach(() => {
  selectedColumns = '';
  result = { data: null, error: null };
});

describe('additional-user voucher approval configuration', () => {
  test('reads only fields required by the approval runtime', async () => {
    result = {
      data: {
        company_id: 'company-1', chat_id: '1', is_enabled: true,
        approvals_enabled: true, approval_threshold: 100,
      },
      error: null,
    };

    await expect(checkApprovalThreshold('company-1', 101, 'voucher_receipt', 'user-2'))
      .resolves.toEqual({ requiresApproval: true });
    expect(selectedColumns).toBe('company_id,chat_id,is_enabled,approvals_enabled,approval_threshold');
    expect(selectedColumns).not.toContain('notify_user_logins');
  });

  test('fails closed instead of returning a generic server error when config lookup fails', async () => {
    result = { data: null, error: { code: '42703', message: 'legacy optional column is missing' } };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(checkApprovalThreshold('company-1', 10, 'voucher_receipt', 'user-2'))
      .resolves.toEqual({ requiresApproval: true, configurationUnavailable: true });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('holding transaction for approval'),
      expect.objectContaining({ code: '42703' }),
    );
    consoleSpy.mockRestore();
  });

  test('does not require approval when the integration is absent or disabled', async () => {
    await expect(checkApprovalThreshold('company-1', 10, 'voucher_receipt', 'user-2'))
      .resolves.toEqual({ requiresApproval: false });

    result = {
      data: {
        company_id: 'company-1', chat_id: '', is_enabled: false,
        approvals_enabled: true, approval_threshold: 1,
      },
      error: null,
    };
    await expect(checkApprovalThreshold('company-1', 10, 'voucher_receipt', 'user-2'))
      .resolves.toEqual({ requiresApproval: false });
  });
});
