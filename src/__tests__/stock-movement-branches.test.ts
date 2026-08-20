const rpc = jest.fn();
jest.mock('@/lib/supabase-client', () => ({ getSupabase: () => ({ rpc }) }));
import { applyStockMovement } from '@/lib/stock-movements';

beforeEach(() => jest.clearAllMocks());
describe('stock movement gateway default/error branches', () => {
  const base = { item_id: 'i', warehouse_id: 'w', type: 'add' as const, quantity: 1 };
  test('normalizes optional fields and empty RPC payloads', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(applyStockMovement('c', 'u', base)).resolves.toEqual({ error: null, transaction: {} });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_unit_price: null, p_notes: '', p_to_warehouse_id: null, p_date: expect.any(String) });
  });
  test('maps safe missing/validation messages and throws unknown failures', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'prefix الصنف غير موجود suffix' } });
    await expect(applyStockMovement('c', 'u', base)).resolves.toEqual({ error: 'الصنف غير موجود', status: 404 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'تكلفة الإضافة غير صالحة' } });
    await expect(applyStockMovement('c', 'u', base)).resolves.toEqual({ error: 'تكلفة الإضافة غير صالحة', status: 400 });
    rpc.mockResolvedValueOnce({ data: null, error: { message: '' } });
    await expect(applyStockMovement('c', 'u', base)).rejects.toEqual({ message: '' });
  });
});
