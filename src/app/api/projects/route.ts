import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, validationError, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { projectSchema } from '@/lib/validation';
import { createJournalEntry } from '@/lib/journal-utils';
import { resolveAccountId } from '@/lib/voucher-utils';
import { ACCOUNT_CODES } from '@/lib/constants';

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

    // جلب بنود الكميات (BOQ) دفعة واحدة لتفادي N+1 لكل مشروع
    const projectIds = (data || []).map((p: any) => p.id);
    let boqByProject: Record<string, any[]> = {};
    if (projectIds.length > 0) {
      const { data: allBoq } = await s.from('boq_items')
        .select('*').in('project_id', projectIds);
      for (const b of allBoq || []) {
        (boqByProject[b.project_id] = boqByProject[b.project_id] || []).push(b);
      }
    }

    const rows = (data || []).map((p: any) => ({
      ...p,
      client_name: p.contacts?.name || null,
      boq_items: boqByProject[p.id] || [],
    }));

    return success({ rows, total: count || 0, page, pageSize, totalPages: Math.ceil((count || 0) / pageSize) });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/projects
 * إنشاء مشروع + بنود جدول الكميات (BOQ)، مع توليد اختياري لفاتورة المشروع.
 *
 * FIXES الجوهرية:
 * - لم يعد يُنشئ حساباً فرعياً بكود مكرر (1130) للعميل النقدي — كان يُفسد
 *   الدليل المحاسبي ويكسر resolveAccountId. النموذج: حسابات تحكم + contact_id.
 * - مسار الفاتورة التلقائية كان يُدرج سطور قيد يدوياً بلا company_id ولا
 *   كود/اسم حساب، ويستخدم contact.account_id (المعطّل) — الآن يُرحَّل عبر
 *   createJournalEntry (سطور مُثراة + متوازنة) بحساب التحكم 1130 الموسوم
 *   بـ contact_id، مع تراجع آلي وعزل مستأجرين.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'projects', 'create');
    const s = sb();
    const body = await parseBody<any>(request);

    // موائمة snake_case ↔ camelCase قبل التحقق
    const mappedBody = {
      name: body.name,
      clientId: body.client_id || body.clientId || null,
      contractValue: Number(body.contract_value || body.contractType || body.contractValue || 0),
      startDate: body.start_date || body.startDate,
      endDate: body.end_date || body.endDate || null,
      status: body.status || 'active',
      description: body.description || '',
      location: body.location || '',
    };

    // حساب إجمالي العقد من بنود BOQ إن لم يُمرَّر صراحةً
    const items = body.items || [];
    if (items.length > 0 && mappedBody.contractValue === 0) {
      mappedBody.contractValue = items.reduce((sum: number, item: any) => sum + (Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0), 0);
    }

    const parsed = projectSchema.safeParse(mappedBody);
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    let effectiveClientId = mappedBody.clientId;

    // العميل النقدي الافتراضي — دون إنشاء حساب مكرر (نموذج حسابات التحكم)
    if (!effectiveClientId) {
      const { data: cashContact } = await s.from('contacts')
        .select('id').eq('name', CASH_CUSTOMER_NAME).eq('company_id', auth.companyId).eq('type', 'client').maybeSingle();
      if (cashContact) {
        effectiveClientId = cashContact.id;
      } else {
        const { data: newCash, error: cashErr } = await s.from('contacts')
          .insert({ company_id: auth.companyId, name: CASH_CUSTOMER_NAME, type: 'client', is_active: true, created_by: auth.userId })
          .select('id').single();
        if (cashErr) throw cashErr;
        effectiveClientId = newCash.id;
      }
    } else {
      // TENANT CHECK: العميل المحدد يجب أن ينتمي لهذه الشركة
      const { data: client } = await s.from('contacts')
        .select('id').eq('id', effectiveClientId).eq('company_id', auth.companyId).maybeSingle();
      if (!client) return error('العميل المحدد غير موجود', 404);
    }

    const projectId = generateId();
    let invoiceId: string | null = null;
    let journalEntryId: string | null = null;
    const createdBoqItemIds: string[] = [];

    try {
      // 1. سجل المشروع (نُعيد الصف المُدرج مباشرة بدل جلب منفصل)
      const { data: projectRes, error: projErr } = await s.from('projects').insert({
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
      }).select('*').single();
      if (projErr) throw projErr;

      // 2. بنود BOQ
      for (const item of items) {
        const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
        const { data: boqItem, error: boqErr } = await s.from('boq_items')
          .insert({
            company_id: auth.companyId,
            project_id: projectId,
            description: item.description,
            unit: item.unit || 'واحدة',
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
            total: itemTotal,
          })
          .select('id, description, unit, quantity, unit_price, total')
          .single();
        if (boqErr) throw boqErr;
        createdBoqItemIds.push(boqItem.id);
      }

      let invoice: any = null;

      // 3. التوليد التلقائي لفاتورة المشروع عند التمكين
      if (body.auto_invoice && mappedBody.contractValue > 0) {
        const arAccountId = await resolveAccountId(auth.companyId, ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
        const revAccountId = await resolveAccountId(auth.companyId, ACCOUNT_CODES.CONTRACT_REVENUE);
        if (!arAccountId || !revAccountId) {
          throw new Error('الحسابات الأساسية للترحيل مفقودة (العملاء 1130 / الإيرادات 4100) — فعّل دليل الحسابات أولاً');
        }

        const { data: inv, error: invErr } = await s.from('invoices').insert({
          company_id: auth.companyId,
          number: `INV-${projectId.substring(0, 8).toUpperCase()}`,
          contact_id: effectiveClientId,
          project_id: projectId,
          date: mappedBody.startDate,
          due_date: mappedBody.startDate,
          subtotal: mappedBody.contractValue,
          vat_rate: 0,
          vat_amount: 0,
          total: mappedBody.contractValue,
          paid_amount: 0,
          status: 'unpaid',
          created_by: auth.userId,
        }).select('id, number').single();
        if (invErr) throw invErr;
        invoiceId = inv.id;

        // بنود الفاتورة مطابقة لـ BOQ (أو بند واحد إن لم توجد بنود)
        if (items.length > 0) {
          for (const item of items) {
            const itemTotal = Number(item.total) || (Number(item.quantity) * Number(item.unit_price)) || 0;
            const { error: iiErr } = await s.from('invoice_items').insert({
              invoice_id: invoiceId,
              description: item.description,
              quantity: Number(item.quantity) || 1,
              unit_price: Number(item.unit_price) || 0,
              total: itemTotal,
            });
            if (iiErr) throw iiErr;
          }
        } else {
          const { error: iiErr } = await s.from('invoice_items').insert({
            invoice_id: invoiceId,
            description: `أعمال مشروع: ${mappedBody.name}`,
            quantity: 1,
            unit_price: mappedBody.contractValue,
            total: mappedBody.contractValue,
          });
          if (iiErr) throw iiErr;
        }

        // ترحيل القيد عبر createJournalEntry (سطور مُثراة + متوازنة + company_id)
        const { journalId, error: jeErr } = await createJournalEntry(auth.companyId, {
          date: mappedBody.startDate,
          type: 'general',
          description: `فاتورة مشروع: ${mappedBody.name}`,
          lines: [
            { account_id: arAccountId, debit: mappedBody.contractValue, credit: 0, contact_id: effectiveClientId, project_id: projectId },
            { account_id: revAccountId, debit: 0, credit: mappedBody.contractValue, project_id: projectId },
          ],
          reference_type: 'invoice',
          reference_id: invoiceId,
          created_by: auth.userId,
        });
        if (jeErr) throw jeErr;
        journalEntryId = journalId;

        await s.from('invoices').update({ journal_entry_id: journalEntryId }).eq('id', invoiceId).eq('company_id', auth.companyId);

        invoice = { id: invoiceId, number: inv.number };
      }

      const result = projectRes as Record<string, any>;
      return success({
        ...result,
        client_name: result.contacts?.name || null,
        boq_items: createdBoqItemIds,
        invoice,
      }, 201);
    } catch (txErr) {
      // تراجع آلي: لا مشروع بلا قيده/فواتيره
      console.error('Project creation failed, rolling back:', txErr);
      try {
        if (journalEntryId) {
          await s.from('journal_lines').delete().eq('journal_entry_id', journalEntryId);
          await s.from('journal_entries').delete().eq('id', journalEntryId).eq('company_id', auth.companyId);
        }
        if (invoiceId) {
          await s.from('invoice_items').delete().eq('invoice_id', invoiceId);
          await s.from('invoices').delete().eq('id', invoiceId).eq('company_id', auth.companyId);
        }
        if (createdBoqItemIds.length > 0) {
          await s.from('boq_items').delete().in('id', createdBoqItemIds);
        }
        await s.from('projects').delete().eq('id', projectId).eq('company_id', auth.companyId);
      } catch (rollbackErr) {
        console.error('Project rollback failed:', rollbackErr);
      }
      throw txErr;
    }
  } catch (err) {
    console.error('Project POST Error:', err);
    return handleApiError(err);
  }
}
