import { NextRequest } from 'next/server';
import { success, error, serverError, parseBody, getPaginationParams, getDateRangeParams, requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

// @ts-ignore
const sb = () => getSupabase() as any;

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const { from, to } = getDateRangeParams(url);
    const itemId = url.searchParams.get('itemId');
    const warehouseId = url.searchParams.get('warehouseId');
    const type = url.searchParams.get('type');
    const s = sb();

    let query = s.from('inventory_transactions')
      .select('*, inventory_items!inner(name, code), warehouses!left(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (itemId) query = query.eq('item_id', itemId);
    if (warehouseId) query = query.eq('warehouse_id', warehouseId);
    if (type) query = query.eq('type', type);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const offset = (page - 1) * pageSize;
    const { data, count, error: queryError } = await query
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    const transactions = (data || []).map((txn: any) => ({
      ...txn,
      item_name: txn.inventory_items?.name || null,
      item_code: txn.inventory_items?.code || null,
      warehouse_name: txn.warehouses?.name || null,
    }));

    return success({ transactions, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { item_id, warehouse_id, type, quantity, unit_price, date, notes, reference_type, reference_id, to_warehouse_id } = data;

    if (!item_id || !warehouse_id || !type || !quantity || !date) {
      return error('company_id, item_id, warehouse_id, type, quantity, date are required');
    }

    const s = sb();

    // Get item
    const { data: item, error: itemErr } = await s.from('inventory_items')
      .select('*')
      .eq('id', item_id)
      .maybeSingle();

    if (itemErr || !item) return error('الصنف غير موجود');

    const currentQty = parseFloat(item.quantity) || 0;
    const currentPrice = parseFloat(item.unit_price) || 0;
    let newQty = currentQty;
    let newPrice = currentPrice;
    let effectiveWarehouse = warehouse_id;

    switch (type) {
      case 'add': {
        newQty = currentQty + quantity;
        newPrice = currentQty === 0 ? unit_price : ((currentQty * currentPrice) + (quantity * (unit_price || 0))) / newQty;
        break;
      }
      case 'issue': {
        if (currentQty < quantity) return error('الكمية غير متوفرة');
        newQty = currentQty - quantity;
        const costAmount = quantity * currentPrice;

        const { data: inventoryAccount } = await s.from('accounts')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('code', ACCOUNT_CODES.INVENTORY)
          .maybeSingle();

        const { data: costAccount } = await s.from('accounts')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('code', ACCOUNT_CODES.DIRECT_COSTS)
          .maybeSingle();

        if (inventoryAccount && costAccount) {
          const { data: maxJe } = await s.from('journal_entries')
            .select('number')
            .eq('company_id', auth.companyId)
            .order('number', { ascending: false })
            .limit(1)
            .maybeSingle();

          const nextNumber = (maxJe?.number || 0) + 1;

          const { data: je, error: jeErr } = await s.from('journal_entries')
            .insert({
              company_id: auth.companyId,
              number: nextNumber,
              date,
              type: 'general',
              description: `صرف مخزون: ${item.name}`,
              created_by: auth.userId,
            })
            .select('*')
            .single();

          if (!jeErr && je) {
            await s.from('journal_lines').insert([
              { journal_entry_id: je.id, account_id: costAccount.id, debit: costAmount, credit: 0 },
              { journal_entry_id: je.id, account_id: inventoryAccount.id, debit: 0, credit: costAmount },
            ]);
          }
        }
        break;
      }
      case 'adjust': {
        const diff = quantity - currentQty;
        newQty = quantity;
        const adjustAmount = Math.abs(diff) * currentPrice;

        const { data: inventoryAccount } = await s.from('accounts')
          .select('id')
          .eq('company_id', auth.companyId)
          .eq('code', ACCOUNT_CODES.INVENTORY)
          .maybeSingle();

        if (inventoryAccount && adjustAmount > 0) {
          const { data: maxJe } = await s.from('journal_entries')
            .select('number')
            .eq('company_id', auth.companyId)
            .order('number', { ascending: false })
            .limit(1)
            .maybeSingle();

          const nextNumber = (maxJe?.number || 0) + 1;

          const { data: je, error: jeErr } = await s.from('journal_entries')
            .insert({
              company_id: auth.companyId,
              number: nextNumber,
              date,
              type: 'general',
              description: `تسوية مخزون: ${item.name}`,
              created_by: auth.userId,
            })
            .select('*')
            .single();

          if (!jeErr && je) {
            if (diff > 0) {
              await s.from('journal_lines').insert({
                journal_entry_id: je.id, account_id: inventoryAccount.id, debit: adjustAmount, credit: 0,
              });
            } else {
              await s.from('journal_lines').insert({
                journal_entry_id: je.id, account_id: inventoryAccount.id, debit: 0, credit: adjustAmount,
              });
            }
          }
        }
        break;
      }
      case 'transfer': {
        if (!to_warehouse_id) return error('المستودع الوجهة مطلوب');
        if (currentQty < quantity) return error('الكمية غير متوفرة');
        newQty = currentQty - quantity;

        // Upsert item into target warehouse
        await s.from('inventory_items').upsert({
          company_id: auth.companyId,
          code: item.code,
          name: item.name,
          unit: item.unit,
          warehouse_id: to_warehouse_id,
          quantity,
          unit_price: currentPrice,
          category: item.category,
          is_active: true,
        }, { onConflict: 'company_id, code' });

        effectiveWarehouse = to_warehouse_id;
        break;
      }
      case 'return': {
        newQty = currentQty + quantity;
        break;
      }
      default:
        return error('نوع العملية غير مدعوم');
    }

    // Update item quantity
    await s.from('inventory_items')
      .update({ quantity: newQty, unit_price: newPrice, updated_at: new Date().toISOString() })
      .eq('id', item_id);

    // Insert transaction
    const { data: txn, error: txnErr } = await s.from('inventory_transactions')
      .insert({
        company_id: auth.companyId,
        item_id,
        warehouse_id: effectiveWarehouse,
        type,
        quantity,
        unit_price: unit_price || currentPrice,
        total_value: quantity * (unit_price || currentPrice),
        date,
        notes,
        reference_type,
        reference_id,
        created_by: auth.userId,
      })
      .select('*')
      .single();

    if (txnErr) throw txnErr;
    return success(txn, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
