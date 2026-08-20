/** Atomic, tenant-bound stock movement gateway. */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export interface MovementInput {
  item_id: string;
  warehouse_id: string;
  type: 'add' | 'issue' | 'adjust' | 'adjustment' | 'transfer' | 'return';
  quantity: number;
  unit_price?: number;
  date?: string;
  notes?: string;
  to_warehouse_id?: string | null;
  /** Optional project the movement is allocated to (e.g. materials issued to a project). */
  project_id?: string | null;
}

export interface MovementResult {
  error: string | null;
  status?: number;
  transaction?: Record<string, unknown>;
}

const SAFE_MESSAGES = [
  'الصنف غير موجود', 'الصنف غير نشط', 'مستودع المصدر غير موجود',
  'مستودع الوجهة غير موجود', 'مستودع الوجهة غير صالح',
  'الصنف لا ينتمي إلى مستودع المصدر', 'صنف الوجهة غير نشط',
  'الكمية غير متوفرة في المخزون', 'لا فرق عن الرصيد الحالي',
  'بيانات الحركة المخزنية غير صالحة', 'تكلفة الإضافة غير صالحة',
  'حساب المخزون 1170 غير موجود', 'حساب مقابل حركة المخزون غير موجود',
];

/**
 * Quantity, moving-average cost, destination stock, journal, transaction row,
 * and audit record are committed by one PostgreSQL transaction. The RPC also
 * locks by tenant+item code, preventing lost updates and transfer races.
 */
export async function applyStockMovement(
  companyId: string,
  userId: string,
  input: MovementInput
): Promise<MovementResult> {
  const { data, error } = await sb().rpc('post_inventory_movement_atomic', {
    p_company_id: companyId,
    p_item_id: input.item_id,
    p_warehouse_id: input.warehouse_id,
    p_type: input.type,
    p_quantity: input.quantity,
    p_unit_price: input.unit_price ?? null,
    p_date: input.date || new Date().toISOString().slice(0, 10),
    p_notes: input.notes || '',
    p_to_warehouse_id: input.to_warehouse_id || null,
    p_user_id: userId,
    p_project_id: input.project_id || null,
  });
  if (error) {
    const message = String(error.message || '');
    const safeMessage = SAFE_MESSAGES.find((candidate) => message.includes(candidate));
    if (safeMessage) {
      const status = safeMessage.includes('غير موجود') ? 404 : 400;
      return { error: safeMessage, status };
    }
    throw error;
  }
  const result = (data || {}) as Record<string, unknown>;
  return { error: null, transaction: (result.transaction || {}) as Record<string, unknown> };
}
