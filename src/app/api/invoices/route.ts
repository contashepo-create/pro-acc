import { NextRequest } from 'next/server';
import { success, error, parseBody, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { invoiceSchema } from '@/lib/validation';
import { generateZatcaQRData, validateInvoiceForZatca } from '@/lib/zatca';

const sb = () => getSupabase();

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'read');
    const s = sb();
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50));
    const status = url.searchParams.get('status');
    const clientId = url.searchParams.get('client_id');
    const dateFrom = url.searchParams.get('from');
    const dateTo = url.searchParams.get('to');

    // Try with all columns first, fallback to basic columns if some don't exist
    let data, queryError, count;
    try {
      let query = s.from('invoices')
        .select('id, number, contact_id, project_id, date, due_date, subtotal, tax_rate, tax_amount, total, status, notes, journal_entry_id, created_at, contacts(name)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      
      if (status) query = query.eq('status', status);
      if (clientId) query = query.eq('contact_id', clientId);
      if (dateFrom) query = query.gte('date', dateFrom);
      if (dateTo) query = query.lte('date', dateTo);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      queryError = result.error;
      count = result.count;
    } catch (err) {
      // Fallback to basic columns if vat_rate, vat_amount don't exist
      console.warn('Invoice GET with extended columns failed, using basic columns:', err);
      let query = s.from('invoices')
        .select('id, number, contact_id, project_id, date, due_date, subtotal, tax_amount, tax_rate, total, status, notes, journal_entry_id, created_at, contacts(name)', { count: 'exact' })
        .eq('company_id', auth.companyId);
      
      if (status) query = query.eq('status', status);
      if (clientId) query = query.eq('contact_id', clientId);
      if (dateFrom) query = query.gte('date', dateFrom);
      if (dateTo) query = query.lte('date', dateTo);

      const offset = (page - 1) * pageSize;
      const result = await query
        .order('date', { ascending: false }).order('number', { ascending: false })
        .range(offset, offset + pageSize - 1);
      
      data = result.data;
      queryError = result.error;
      count = result.count;
    }

    if (queryError) throw queryError;

    const invoices = (data || []).map((i: any) => ({
      ...i, 
      client_name: i.contacts?.name || '',
      // Map tax columns to vat columns for consistency
      vat_rate: i.vat_rate || i.tax_rate || 0.15,
      vat_amount: i.vat_amount || i.tax_amount || 0,
    }));

    return success({ invoices, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) || 1 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'invoices', 'create');
    const s = sb();

    // Check usage limits for invoices
    try {
      const { checkUsageLimit } = await import('@/lib/usage-limits');
      const limitCheck = await checkUsageLimit(auth.companyId, 'invoices');
      if (!limitCheck.allowed) {
        return error(limitCheck.message || 'تم الوصول للحد الأقصى للفواتير', 403);
      }
    } catch (e) {
      console.warn('Usage limit check failed for invoices:', e);
    }

    const body = await parseBody(request);
    const parsed = invoiceSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { clientId, projectId, date, dueDate, items, subtotal, vatRate, vatAmount, total, notes, vatEnabled } = parsed.data;
    const year = date.substring(0, 4);

    // Get next invoice number
    let number: number;
    try {
      const { data: rpcData, error: rpcError } = await s.rpc('next_invoice_number', {
        p_company_id: auth.companyId,
        p_year: parseInt(year),
      });
      if (rpcError || rpcData == null) throw rpcError || new Error('RPC failed');
      number = rpcData as number;
    } catch {
      // Fallback to sequence table
      const { data: seqExisting } = await s.from('invoice_sequences')
        .select('last_number').eq('company_id', auth.companyId).eq('year', year).maybeSingle();
      if (seqExisting) {
        number = (seqExisting as any).last_number + 1;
        await s.from('invoice_sequences').update({ last_number: number }).eq('company_id', auth.companyId).eq('year', year);
      } else {
        number = 1;
        await s.from('invoice_sequences').insert({ company_id: auth.companyId, year: parseInt(year), last_number: 1 });
      }
    }

    const effectiveVatRate = vatEnabled === false ? 0 : (vatRate ?? 0.15);
    const computedVat = vatEnabled === false ? 0 : (vatAmount ?? subtotal * effectiveVatRate);
    const computedTotal = total ?? subtotal + computedVat;

    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;

    try {
      // Try with extended columns first
      let invoiceRes: any = null;
      let invErr: any = null;
      
      try {
        const result = await s.from('invoices')
          .insert({
            company_id: auth.companyId, 
            number, 
            contact_id: clientId, 
            project_id: projectId || null,
            date, 
            due_date: dueDate, 
            subtotal, 
            tax_rate: effectiveVatRate,
            tax_amount: computedVat,
            total: computedTotal, 
            status: 'unpaid', 
            notes: notes || null, 
            created_by: auth.userId,
          })
          .select('id, number, date, due_date, subtotal, tax_rate, tax_amount, total, status, notes')
          .single();
        
        invoiceRes = result.data;
        invErr = result.error;
      } catch {
        // Fallback to basic columns
        console.warn('Invoice insert with extended columns failed, using basic columns');
        const result = await s.from('invoices')
          .insert({
            company_id: auth.companyId, 
            number, 
            contact_id: clientId, 
            project_id: projectId || null,
            date, 
            due_date: dueDate, 
            subtotal, 
            tax_rate: effectiveVatRate,
            tax_amount: computedVat,
            total: computedTotal, 
            status: 'unpaid', 
            notes: notes || null,
          })
          .select('id, number, date, due_date, subtotal, tax_rate, tax_amount, total, status, notes')
          .single();
        
        invoiceRes = result.data;
        invErr = result.error;
      }

      if (invErr) throw invErr;
      invoiceId = invoiceRes.id;

      // Insert invoice items
      for (const item of items) {
        const itemTotal = item.total ?? item.quantity * item.unitPrice;

        let inventoryItemId: string | null = item.inventory_item_id || null;

        // Create inventory item if requested
        if (item.save_to_inventory && (item.item_type === 'product' || item.item_type === 'inventory')) {
          // Get or create a default warehouse
          let warehouseId: string | null = null;
          const { data: warehouse } = await s.from('warehouses')
            .select('id')
            .eq('company_id', auth.companyId)
            .order('created_at')
            .limit(1)
            .maybeSingle();

          if (warehouse) {
            warehouseId = (warehouse as any).id;
          } else {
            const whId = crypto.randomUUID();
            await s.from('warehouses').insert({
              id: whId,
              company_id: auth.companyId,
              name: 'المستودع الرئيسي',
              is_active: true,
            });
            warehouseId = whId;
          }

          if (warehouseId) {
            const itemCode = item.item_code || `PRD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const { data: newInvItem, error: invErr } = await s.from('inventory_items')
              .insert({
                company_id: auth.companyId,
                code: itemCode,
                name: item.description,
                unit: item.unit || 'وحدة',
                quantity: 0,
                unit_price: item.unitPrice,
                warehouse_id: warehouseId,
                category: 'product',
                is_active: true,
              })
              .select('id')
              .single();

            if (!invErr && newInvItem) {
              inventoryItemId = (newInvItem as any).id;
            }
          }
        }

        const { error: itemErr } = await s.from('invoice_items').insert({
          invoice_id: invoiceId,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: itemTotal,
        });
        if (itemErr) throw itemErr;
      }

      // Get accounts for journal entry
      const { data: arAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '1130').maybeSingle();
      const { data: revenueAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '4100').maybeSingle();
      const { data: vatAccount } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', '2120').maybeSingle();

      if (!arAccount || !revenueAccount) {
        throw new Error('الحسابات الأساسية مفقودة. يرجى التأكد من وجود حسابات العملاء (1130) والإيرادات (4100)');
      }

      // Try to create journal entry with extended columns
      let jeRes: any = null;
      let jeErr: any = null;

      try {
        const result = await s.from('journal_entries')
          .insert({
            company_id: auth.companyId, 
            number, 
            date, 
            type: 'general',
            description: `فاتورة مبيعات رقم ${number}`, 
            reference_type: 'invoice',
            reference_id: invoiceId,
            created_by: auth.userId,
          })
          .select('id')
          .single();
        
        jeRes = result.data;
        jeErr = result.error;
      } catch {
        // Fallback to basic columns
        const result = await s.from('journal_entries')
          .insert({
            company_id: auth.companyId, 
            number, 
            date, 
            type: 'general',
            description: `فاتورة مبيعات رقم ${number}`,
          })
          .select('id')
          .single();
        
        jeRes = result.data;
        jeErr = result.error;
      }

      if (jeErr) throw jeErr;
      journalEntryId = jeRes.id;

      // Create journal lines
      const journalLines: any[] = [
        { 
          journal_entry_id: journalEntryId, 
          account_id: arAccount.id, 
          account_code: '1130', 
          debit: computedTotal, 
          credit: 0, 
          description: `فاتورة مبيعات رقم ${number}` 
        },
        { 
          journal_entry_id: journalEntryId, 
          account_id: revenueAccount.id, 
          account_code: '4100', 
          debit: 0, 
          credit: subtotal, 
          description: `إيراد فاتورة رقم ${number}` 
        },
      ];
      
      if (computedVat > 0 && vatAccount) {
        journalLines.push({ 
          journal_entry_id: journalEntryId, 
          account_id: vatAccount.id, 
          account_code: '2120', 
          debit: 0, 
          credit: computedVat, 
          description: `ضريبة فاتورة رقم ${number}` 
        });
      }
      
      const { error: linesErr } = await s.from('journal_lines').insert(journalLines);
      if (linesErr) throw linesErr;

      // Update invoice with journal entry ID
      const { error: updateErr } = await s.from('invoices').update({ journal_entry_id: journalEntryId }).eq('id', invoiceId);
      if (updateErr) throw updateErr;

      // Get invoice items for response
      const { data: itemsRes } = await s.from('invoice_items')
        .select('id, description, quantity, unit_price, total')
        .eq('invoice_id', invoiceId);

      // Audit log
      try {
        await s.from('financial_audit_log').insert({
          company_id: auth.companyId,
          user_id: auth.userId,
          action: 'create_invoice',
          table_name: 'invoices',
          record_id: invoiceId,
          new_values: { number, total: computedTotal, client_id: clientId },
        });
      } catch {}

      // ZATCA QR code (optional)
      let zatcaQRData: string | null = null;
      try {
        const { data: company } = await s.from('companies')
          .select('name, tax_number')
          .eq('id', auth.companyId)
          .maybeSingle();
        
        const companyData = company as { name?: string; tax_number?: string } | null;
        const sellerName = companyData?.name || '';
        const vatNumber = companyData?.tax_number || '';
        
        if (sellerName && vatNumber && /^\d{15}$/.test(vatNumber)) {
          const qrPayload = {
            sellerName,
            vatNumber,
            timestamp: new Date(date).toISOString(),
            invoiceTotal: parseFloat(String(computedTotal)),
            vatTotal: parseFloat(String(computedVat)),
          };
          
          const validation = validateInvoiceForZatca(qrPayload);
          if (validation.valid) {
            zatcaQRData = generateZatcaQRData(qrPayload);
            
            try {
              await s.from('invoices')
                .update({ zatca_qr: zatcaQRData })
                .eq('id', invoiceId);
            } catch {
              // zatca_qr column might not exist
              console.warn('zatca_qr column not found, skipping QR storage');
            }
          }
        }
      } catch (zatcaErr) {
        console.warn('ZATCA QR generation failed:', zatcaErr);
      }

      return success({ 
        ...invoiceRes, 
        items: itemsRes || [], 
        journalEntryId, 
        zatcaQRData 
      }, 201);
    } catch (txErr) {
      // Rollback on failure
      console.error('Invoice creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId);
        }
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    if ((err as Error).message?.includes('مفقودة')) return error((err as Error).message);
    return handleApiError(err);
  }
}
