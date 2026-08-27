const insert = jest.fn();
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => ({ from: () => ({ insert }) }) }));
import { logAudit } from '@/lib/audit';

beforeEach(() => jest.clearAllMocks());

describe('financial audit logging branches', () => {
  test('compacts allowed snapshots and defaults summary/null snapshots', async () => {
    insert.mockResolvedValueOnce({ error: null });
    await logAudit({ company_id: 'c', user_id: 'u', entity_type: 'invoice', entity_id: 'i', action: 'create', before: null, after: { unknown: 1 } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ before_data: null, after_data: null, summary: null }));
  });
  test('never breaks the business operation when audit storage throws', async () => {
    insert.mockRejectedValueOnce(new Error('down'));
    await expect(logAudit({ company_id: 'c', user_id: 'u', entity_type: 'x', entity_id: 'i', action: 'create' })).resolves.toBeUndefined();
  });
});
