import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, validationError, requireApiAuth, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { projectSchema } from '@/lib/validation';
import { getNextJournalNumber } from '@/lib/numbering';

const sb = () => getSupabase();

const CASH_CUSTOMER_NAME = 'عميل نقدي';

/**
 * GET /api/projects
 * جلب جميع مشاريع الشركة
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'read');
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');

    let query = s.from('projects')
      .select('*, contacts(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (status) query = query.eq('status', status);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    // جلب بنود الكميات (BOQ) لكل مشروع وإدراجها مع الاستجابة لمزامنة الواجهة
    const rows = [];
    for (const p of data || []) {
      const { data: boqItems } = await s.from('boq_items')
        .select('*')
        .eq('project_id', p.id);
      
      rows.push({
        ...p,
        client_name: p.contacts?.name || null,
        boq_items: boqItems || [],
      });
    }

    return success({ rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/projects
 * إنشاء مشروع جديد وإدراج بنود جدول الكميات (BOQ) التابع له تلقائياً في عملية واحدة
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const s = sb();
    const body = await parseBody<any>(request);

    // FIXED: موائمة وتوحيد مسميات الحقول (snake_case للمتصفح مقابل camelCase للـ Zod Schema) لتلافي خطأ الفاليداشن
    const mappedBody = {
      name: body.name,
      clientId: body.client_id || body.clientId || null,
      contractValue: Number(body.contract_value || body.contractValue || 0),
      startDate: body.start_date || body.startDate,
      endDate: body.end_date || body.endDate || null,
      status: body.status || 'active',
      description: body.description || '',
      location: body.location || '',
    };

    // حساب إجمالي قيمة العقد تلقائياً من مجموع بنود جدول الكميات (BOQ) المرفقة إن وُجدت
    const items = body.items || [];
    if (items.length > 0 && mappedBody.contractValue === 0) {
      mappedBody.contractValue = items.reduce((sum: number, item: any) => sum + (Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0), 0);
    }

    const parsed = projectSchema.safeParse(mappedBody);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const projectId = generateId();
    let effectiveClientId = mappedBody.clientId;

    if (!effectiveClientId) {
      const { data: cashContact } = await s.from('contacts')
        .select('id').eq('name', CASH_CUSTOMER_NAME).eq('company_id', auth.companyId).eq('type', 'client').maybeSingle();

      if (cashContact) {
        effectiveClientId = cashContact.id;
      } else {
        const cashContactId = generateId();
        const cashAccountId = generateId();
        await s.from('accounts').insert({
          id: cashAccountId, company_id: auth.companyId, code: '1130',
          name: CASH_CUSTOMER_NAME, type: 'asset', is_active: true,
        });
        await s.from('contacts').insert({
          id: cashContactId, company_id: auth.companyId, name: CASH_CUSTOMER_NAME,
          type: 'client', account_id: cashAccountId, is_cash_customer: true,
        });
        effectiveClientId = cashContactId;
      }
    }

    // 1. إدخال سجل المشروع
    await s.from('projects').insert({
      id: projectId, 
      company_id: auth.companyId, 
      name: mappedBody.name, 
      client_id: effectiveClientId,
      contract_value: mappedBody.contractValue, 
      start_date: mappedBody.startDate, 
      end_date: mappedBody.endDate,
      status: mappedBody.status, 
      description: mappedBody.description || null,
      location: mappedBody.location || null, 
      created_by: auth.userId,
    });

    // 2. إدخال بنود جدول الكميات (BOQ) التابع للمشروع تلقائياً
    const createdBoqItems = [];
    if (items.length > 0) {
      for (const item of items) {
        const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
        const { data: boqItem } = await s.from('boq_items')
          .insert({
            company_id: auth.companyId,
            project_id: projectId,
            description: item.description,
            unit: item.unit || 'واحدة',
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
            total: itemTotal,
          })
          .select('*')
          .single();
        if (boqItem) createdBoqItems.push(boqItem);
      }
    }

    let invoice = null;

    // 3. التوليد التلقائي لفاتورة المشروع عند تمكين الخيار
    if (body.auto_invoice && effectiveClientId) {
      const invoiceId = generateId();
      const jeId = generateId();
      const invSeq = await getNextJournalNumber(auth.companyId, mappedBody.startDate);
      const invoiceNumber = `INV-${projectId.substring(0, 8).toUpperCase()}`;

      await s.from('journal_entries').insert({
        id: jeId, company_id: auth.companyId, number: invSeq, date: mappedBody.startDate,
        type: 'invoice', description: `فاتورة مشروع: ${mappedBody.name}`, project_id: projectId, created_by: auth.userId,
      });

      const { data: arContact } = await s.from('contacts').select('account_id').eq('id', effectiveClientId).maybeSingle();
      if (!arContact?.account_id) throw new Error('العميل ليس لديه حساب ذمم مدينة للترحيل');

      const { data: revAcc } = await s.from('accounts').select('id').eq('code', '4100').eq('company_id', auth.companyId).maybeSingle();

      await s.from('journal_lines').insert([
        { id: generateId(), journal_entry_id: jeId, account_id: arContact.account_id, debit: mappedBody.contractValue, credit: 0, description: `فاتورة مشروع: ${mappedBody.name}`, project_id: projectId, contact_id: effectiveClientId },
        { id: generateId(), journal_entry_id: jeId, account_id: revAcc?.id, debit: 0, credit: mappedBody.contractValue, description: `فاتورة مشروع: ${mappedBody.name}`, project_id: projectId, contact_id: effectiveClientId },
      ]);

      await s.from('invoices').insert({
        id: invoiceId, company_id: auth.companyId, number: invoiceNumber, contact_id: effectiveClientId,
        project_id: projectId, date: mappedBody.startDate, due_date: mappedBody.startDate, subtotal: mappedBody.contractValue,
        vat_rate: 0, vat_amount: 0, total: mappedBody.contractValue, paid_amount: 0, status: 'unpaid',
        journal_entry_id: jeId, created_by: auth.userId,
      });

      // إدراج البنود المفصلة في الفاتورة تلقائياً متطابقة تماماً مع جدول كميات المشروع (BOQ)
      if (items.length > 0) {
        for (const item of items) {
          const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
          await s.from('invoice_items').insert({
            id: generateId(), 
            invoice_id: invoiceId, 
            description: item.description,
            quantity: Number(item.quantity) || 1, 
            unit_price: Number(item.unit_price) || 0, 
            total: itemTotal,
          });
        }
      } else {
        await s.from('invoice_items').insert({
          id: generateId(), invoice_id: invoiceId, description: `أعمال مشروع: ${mappedBody.name}`,
          quantity: 1, unit_price: mappedBody.contractValue, total: mappedBody.contractValue,
        });
      }

      invoice = { id: invoiceId, number: invoiceNumber };
    }

    const { data: projectRes, error: fetchErr } = await s.from('projects')
      .select('*, contacts(name)').eq('id', projectId).single();
    if (fetchErr) throw fetchErr;

    const result = projectRes as Record<string, any>;
    return success({ 
      ...result, 
      client_name: result.contacts?.name || null, 
      boq_items: createdBoqItems,
      invoice 
    }, 201);

  } catch (err) {
    console.error('Project POST Error:', err);
    return handleApiError(err);
  }
}
