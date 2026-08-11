/**
 * محرك الحركات المخزنية الموحّد
 *
 * قبل هذا المحرك كان هناك مساران متباينان:
 * - api/inventory-transactions: يسجل الحركة فقط دون تحديث رصيد الصنف
 *   (الدفتر يفترق عن المخزون الفعلي — التسويات من الواجهة لم تفعل شيئاً)
 * - api/inventory/transactions: يحدّث الرصيد + قيوداً خاماً بلا company_id
 *   وبتسويات أحادية الطرف (غير متوازنة) وتحويلات تستبدل رصيد الوجهة
 *
 * القواعد المفروضة هنا:
 * 1. الصنف والمستودعات تُحَلّ مقيدة بالشركة — لا حركة متقاطعة بين المستأجرين.
 * 2. كل حركة مؤثرة محاسبياً تقيد بدخل/تكلفة متوازنة عبر insertJournalLines؛
 *    غياب حساب المخزون (1170) يفشل العملية صراحةً لا صامتاً.
 * 3. التحويل يجمع على رصيد الوجهة (لا يستبدله).
 * 4. الرصيد لا يُعدَّل إلا من هنا (أو من استلام أمر الشراء) — لا PUT مباشر.
 */

import { getSupabase } from '@/lib/supabase-client';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

const sb = () => getSupabase();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface MovementInput {
  item_id: string;
  warehouse_id: string;
  type: 'add' | 'issue' | 'adjust' | 'adjustment' | 'transfer' | 'return';
  quantity: number;
  unit_price?: number;
  date?: string;
  notes?: string;
  to_warehouse_id?: string | null;
}

export interface MovementResult {
  error: string | null;
  status?: number;
  transaction?: any;
}

async function postBalancedJE(
  companyId: string,
  userId: string,
  date: string,
  description: string,
  lines: Array<{ account_id: string; debit: number; credit: number; description?: string }>
): Promise<{ journalEntryId: string | null; error: string | null }> {
  const s = sb();
  const number = await getNextJournalNumber(companyId, date);
  const { data: je, error: jeErr } = await s.from('journal_entries')
    .insert({
      company_id: companyId,
      number,
      date,
      type: 'general',
      description,
      reference_type: 'inventory_movement',
      created_by: userId,
    })
    .select('id')
    .single();
  if (jeErr || !je) return { journalEntryId: null, error: 'فشل إنشاء قيد الحركة المخزنية' };

  const { error: linesErr } = await insertJournalLines(
    companyId,
    lines.map((line) => ({ journal_entry_id: je.id, ...line }))
  );
  if (linesErr) return { journalEntryId: null, error: String(linesErr?.message || linesErr) };
  return { journalEntryId: je.id, error: null };
}

export async function applyStockMovement(
  companyId: string,
  userId: string,
  input: MovementInput
): Promise<MovementResult> {
  const s = sb();
  const type = (input.type === 'adjustment' ? 'adjust' : input.type) as MovementInput['type'];
  const qty = input.quantity;
  const date = input.date || new Date().toISOString().split('T')[0];

  // TENANT: الصنف ومصدر الحركة مقيدان بالشركة
  const { data: item } = await s.from('inventory_items')
    .select('*')
    .eq('id', input.item_id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!item) return { error: 'الصنف غير موجود', status: 404 };

  const { data: warehouse } = await s.from('warehouses')
    .select('id, name')
    .eq('id', input.warehouse_id)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!warehouse) return { error: 'المستودع غير موجود', status: 404 };

  const currentQty = parseFloat(item.quantity) || 0;
  const currentPrice = parseFloat(item.unit_price) || 0;
  let newQty = currentQty;
  let newPrice = currentPrice;
  let journalEntryId: string | null = null;
  let effectiveWarehouseId = input.warehouse_id;
  let movementNotes = input.notes || null;

  // حسابات القيود — تُطلب فقط للأنواع المؤثرة محاسبياً وتفشل بوضوح عند غيابها
  const needAccounts = type === 'issue' || type === 'adjust' || (type === 'return');
  let inventoryAccountId: string | null = null;
  let counterpartIncomeId: string | null = null;  // 4200 إيرادات أخرى (فائض جرد)
  let counterpartCostId: string | null = null;    // 5100 تكاليف مباشرة (عجز/صرف/مرتجع)
  if (needAccounts) {
    const { data: invAcc } = await s.from('accounts').select('id')
      .eq('company_id', companyId).eq('code', ACCOUNT_CODES.INVENTORY).maybeSingle();
    const { data: revAcc } = await s.from('accounts').select('id')
      .eq('company_id', companyId).eq('code', ACCOUNT_CODES.OTHER_REVENUE).maybeSingle();
    const { data: costAcc } = await s.from('accounts').select('id')
      .eq('company_id', companyId).eq('code', ACCOUNT_CODES.DIRECT_COSTS).maybeSingle();
    inventoryAccountId = invAcc?.id || null;
    counterpartIncomeId = revAcc?.id || null;
    counterpartCostId = costAcc?.id || null;
    if (!inventoryAccountId) {
      return { error: 'حساب المخزون (1170) مفقود — فعّل دليل الحسابات أولاً', status: 400 };
    }
  }

  switch (type) {
    case 'add': {
      const unitPrice = input.unit_price ?? currentPrice;
      newQty = round2(currentQty + qty);
      newPrice = currentQty === 0 ? unitPrice : round2(((currentQty * currentPrice) + (qty * unitPrice)) / newQty);
      break;
    }

    case 'issue': {
      if (currentQty < qty) return { error: 'الكمية غير متوفرة في المخزون', status: 400 };
      newQty = round2(currentQty - qty);
      const costAmount = round2(qty * currentPrice);
      if (costAmount > 0) {
        if (!counterpartCostId) return { error: 'حساب التكاليف المباشرة (5100) مفقود', status: 400 };
        const je = await postBalancedJE(companyId, userId, date, `صرف مخزون: ${item.name}`, [
          { account_id: counterpartCostId, debit: costAmount, credit: 0, description: `صرف ${item.name}` },
          { account_id: inventoryAccountId!, debit: 0, credit: costAmount, description: `صرف ${item.name}` },
        ]);
        if (je.error) return { error: je.error, status: 500 };
        journalEntryId = je.journalEntryId;
      }
      break;
    }

    case 'adjust': {
      // الجرد: الكمية = الرصيد المستهدف المطلق، والفرق يقيد بطرفين متوازنين
      const diff = round2(qty - currentQty);
      if (diff === 0) return { error: 'لا فرق عن الرصيد الحالي — لا حاجة لتسوية', status: 400 };
      newQty = qty;
      const adjustAmount = round2(Math.abs(diff) * currentPrice);
      if (adjustAmount > 0) {
        const counterpartId = diff > 0 ? counterpartIncomeId : counterpartCostId;
        if (!counterpartId) {
          return { error: diff > 0 ? 'حساب الإيرادات الأخرى (4200) مفقود' : 'حساب التكاليف المباشرة (5100) مفقود', status: 400 };
        }
        const je = await postBalancedJE(companyId, userId, date, `تسوية جرد: ${item.name}`,
          diff > 0
            ? [
                { account_id: inventoryAccountId!, debit: adjustAmount, credit: 0, description: `فائض جرد ${item.name}` },
                { account_id: counterpartId, debit: 0, credit: adjustAmount, description: `فائض جرد ${item.name}` },
              ]
            : [
                { account_id: counterpartId, debit: adjustAmount, credit: 0, description: `عجز جرد ${item.name}` },
                { account_id: inventoryAccountId!, debit: 0, credit: adjustAmount, description: `عجز جرد ${item.name}` },
              ]);
        if (je.error) return { error: je.error, status: 500 };
        journalEntryId = je.journalEntryId;
      }
      break;
    }

    case 'transfer': {
      if (!input.to_warehouse_id) return { error: 'مستودع الوجهة مطلوب', status: 400 };
      const { data: targetWarehouse } = await s.from('warehouses')
        .select('id, name')
        .eq('id', input.to_warehouse_id)
        .eq('company_id', companyId)
        .maybeSingle();
      if (!targetWarehouse) return { error: 'مستودع الوجهة غير موجود', status: 404 };
      if (currentQty < qty) return { error: 'الكمية غير متوفرة في المخزون', status: 400 };

      newQty = round2(currentQty - qty);

      // الوجهة: تجمع على الرصيد القائم — كانت تستبدله فتلغي التحويلات السابقة
      const { data: targetItem } = await s.from('inventory_items')
        .select('id, quantity, unit_price')
        .eq('company_id', companyId)
        .eq('warehouse_id', input.to_warehouse_id)
        .eq('code', item.code)
        .maybeSingle();

      if (targetItem) {
        const tgtQty = parseFloat(targetItem.quantity) || 0;
        const tgtPrice = parseFloat(targetItem.unit_price) || 0;
        const mergedQty = round2(tgtQty + qty);
        const mergedPrice = tgtQty === 0 ? currentPrice : round2(((tgtQty * tgtPrice) + (qty * currentPrice)) / mergedQty);
        const { error: tgtErr } = await s.from('inventory_items')
          .update({ quantity: mergedQty, unit_price: mergedPrice, updated_at: new Date().toISOString() })
          .eq('id', targetItem.id)
          .eq('company_id', companyId);
        if (tgtErr) return { error: 'فشل تحديث رصيد مستودع الوجهة', status: 500 };
      } else {
        const { error: tgtErr } = await s.from('inventory_items')
          .insert({
            company_id: companyId,
            code: item.code,
            name: item.name,
            unit: item.unit,
            warehouse_id: input.to_warehouse_id,
            quantity: qty,
            unit_price: currentPrice,
            category: item.category || null,
            is_active: true,
          });
        if (tgtErr) return { error: 'فشل إنشاء الصنف في مستودع الوجهة', status: 500 };
      }

      effectiveWarehouseId = input.to_warehouse_id;
      movementNotes = `${movementNotes ? movementNotes + ' — ' : ''}تحويل من مستودع «${warehouse.name}» إلى «${targetWarehouse.name}»`;
      break;
    }

    case 'return': {
      // مرتجع للمخزون: كمية + بالقيمة الدافترية الحالية، مع عكس تكلفة الصرف دفترياً
      newQty = round2(currentQty + qty);
      const returnAmount = round2(qty * currentPrice);
      if (returnAmount > 0) {
        if (!counterpartCostId) return { error: 'حساب التكاليف المباشرة (5100) مفقود', status: 400 };
        const je = await postBalancedJE(companyId, userId, date, `مرتجع مخزون: ${item.name}`, [
          { account_id: inventoryAccountId!, debit: returnAmount, credit: 0, description: `مرتجع ${item.name}` },
          { account_id: counterpartCostId, debit: 0, credit: returnAmount, description: `مرتجع ${item.name}` },
        ]);
        if (je.error) return { error: je.error, status: 500 };
        journalEntryId = je.journalEntryId;
      }
      break;
    }

    default:
      return { error: 'نوع العملية غير مدعوم', status: 400 };
  }

  // تحديث رصيد الصنف المصدر — مقيد بالشركة دائماً
  const { error: updErr } = await s.from('inventory_items')
    .update({ quantity: newQty, unit_price: newPrice, updated_at: new Date().toISOString() })
    .eq('id', input.item_id)
    .eq('company_id', companyId);
  if (updErr) return { error: 'فشل تحديث رصيد الصنف', status: 500 };

  const { data: txn, error: txnErr } = await s.from('inventory_transactions')
    .insert({
      company_id: companyId,
      item_id: input.item_id,
      warehouse_id: effectiveWarehouseId,
      type,
      quantity: qty,
      unit_price: input.unit_price ?? currentPrice,
      total_value: round2(qty * (input.unit_price ?? currentPrice)),
      date,
      notes: movementNotes,
      reference_type: journalEntryId ? 'journal_entry' : null,
      reference_id: journalEntryId,
      created_by: userId,
    })
    .select('*')
    .single();
  if (txnErr) return { error: 'فشل تسجيل الحركة', status: 500 };

  return { error: null, transaction: txn };
}
