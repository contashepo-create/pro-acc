import { NextRequest } from 'next/server';
import { success, error, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/company/data-export
 *   Returns the list of exports for the current company.
 *
 * POST /api/company/data-export
 *   Creates a new "download my data" request. Available to ALL
 *   authenticated users (even expired/trial-ended ones) — this is
 *   required for GDPR-style data portability and gives churned
 *   customers a clean exit path.
 *
 *   The endpoint only ENQUEUES the export; actual file generation
 *   runs out-of-band (see processPendingExports below).
 */
export async function GET(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    if (auth.role !== 'admin') return error('تصدير جميع بيانات الشركة متاح لمدير الشركة فقط', 403);
    const s = sb();

    // Self-healing: if an export got stuck in pending/processing (e.g. the
    // serverless instance died mid-generation), retry it when the user
    // refreshes the list. Without this, rows stayed "قيد التجهيز..." forever.
    try {
      const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
      const { data: stuck } = await s.from('company_data_exports')
        .select('id')
        .eq('company_id', auth.companyId)
        .in('status', ['pending', 'processing'])
        .lt('requested_at', twoMinAgo)
        .limit(1);
      if (stuck && stuck.length > 0) {
        // Reset processing → pending so processPendingExports picks it up.
        await s.from('company_data_exports')
          .update({ status: 'pending' })
          .eq('company_id', auth.companyId)
          .eq('status', 'processing')
          .lt('requested_at', twoMinAgo);
        await processPendingExports(auth.companyId);
      }
    } catch (e) {
      console.warn('[data-export] stuck-export recovery failed:', e);
    }

    // NOTE: download_url was previously omitted from this select, so the UI
    // rendered every export as "قيد التجهيز..." forever even after the file
    // was ready. We avoid shipping the (potentially large) inline payload in
    // the list; instead we expose a has_file flag and a dedicated download
    // endpoint (GET /api/company/data-export/[id]/download).
    const { data, error: err } = await s.from('company_data_exports')
      .select('id, status, requested_at, completed_at, expires_at, file_size_bytes, error_message, download_url')
      .eq('company_id', auth.companyId)
      .order('requested_at', { ascending: false })
      .limit(10);
    if (err) throw err;

    const now = Date.now();
    const exports = (data || []).map((e: Record<string, unknown>) => {
      const expired = e.expires_at ? new Date(String(e.expires_at)).getTime() < now : false;
      return {
        id: e.id,
        status: expired && e.status === 'ready' ? 'expired' : e.status,
        requested_at: e.requested_at,
        completed_at: e.completed_at,
        expires_at: e.expires_at,
        file_size_bytes: e.file_size_bytes,
        error_message: e.error_message,
        has_file: !!e.download_url && !expired,
      };
    });
    return success({ exports });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    if (auth.role !== 'admin') return error('تصدير جميع بيانات الشركة متاح لمدير الشركة فقط', 403);
    const s = sb();

    // Rate-limit 1: at most one pending export per company at a time
    const { data: existing } = await s.from('company_data_exports')
      .select('id, status')
      .eq('company_id', auth.companyId)
      .in('status', ['pending', 'processing'])
      .limit(1)
      .maybeSingle();
    if (existing) {
      return error('يوجد طلب تصدير قيد المعالجة حالياً. يرجى الانتظار حتى اكتماله.', 409);
    }

    // Rate-limit 2: at most 3 exports per company per 24h — previously a
    // user could enqueue unlimited requests (each triggering a full DB dump).
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: recentCount } = await s.from('company_data_exports')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', auth.companyId)
      .gte('requested_at', dayAgo);
    if ((recentCount || 0) >= 3) {
      return error('تم الوصول للحد الأقصى (3 طلبات تصدير خلال 24 ساعة). حاول لاحقاً.', 429);
    }

    const { data: ticket, error: insErr } = await s.from('company_data_exports')
      .insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        status: 'pending',
      })
      .select('id, requested_at, status')
      .single();
    if (insErr) throw insErr;

    // Kick off generation synchronously for small/medium companies.
    // For larger datasets you'd push to a queue. We do it in-process
    // but guarded by try/catch so a failure never crashes the request.
    try {
      await processPendingExports(auth.companyId);
    } catch (e) {
      console.warn('[data-export] background generation failed:', e);
    }

    return success({ export: ticket, message: 'تم بدء تصدير بياناتك. سيكون التحميل جاهزاً خلال دقائق.' }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * Process all pending exports, building a JSON dump of company data.
 * This is invoked inline after each POST and can also be called from
 * a cron job if desired.
 */
export async function processPendingExports(companyId?: string) {
  const s = sb();
  let pendingQuery = s.from('company_data_exports')
    .select('id, company_id')
    .eq('status', 'pending');
  // A user-triggered export must never process another tenant's queue. A
  // trusted cron worker may omit companyId to process a bounded global batch.
  if (companyId) pendingQuery = pendingQuery.eq('company_id', companyId);
  const { data: pending } = await pendingQuery.limit(5);
  if (!pending || pending.length === 0) return;

  for (const exp of pending as { id: string; company_id: string }[]) {
    try {
      await s.from('company_data_exports').update({ status: 'processing' }).eq('id', exp.id).eq('company_id', exp.company_id);
      const dump = await buildCompanyDump(exp.company_id);
      const json = JSON.stringify(dump, null, 2);
      const payload = Buffer.from(json, 'utf8');
      const size = payload.byteLength;
      const objectPath = `${exp.company_id}/${exp.id}.json`;
      const { error: uploadError } = await s.storage.from('company-exports').upload(
        objectPath,
        payload,
        { contentType: 'application/json; charset=utf-8', upsert: false },
      );
      if (uploadError) throw uploadError;

      const { error: readyError } = await s.from('company_data_exports').update({
        status: 'ready',
        completed_at: new Date().toISOString(),
        // Store an opaque private object reference, never a giant data URL or
        // long-lived public/signed URL.
        download_url: `storage:company-exports/${objectPath}`,
        file_size_bytes: size,
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }).eq('id', exp.id).eq('company_id', exp.company_id);
      if (readyError) {
        await s.storage.from('company-exports').remove([objectPath]);
        throw readyError;
      }
    } catch (e: any) {
      await s.from('company_data_exports').update({
        status: 'failed',
        error_message: e?.message || 'unknown error',
      }).eq('id', exp.id).eq('company_id', exp.company_id);
    }
  }
}

/** Tables to include in the export (company-scoped only; no admin tables). */
const EXPORT_TABLES = [
  'accounts', 'journal_entries', 'journal_lines', 'clients', 'contacts',
  'invoices', 'invoice_items', 'quotations', 'quotation_items',
  'purchase_invoices', 'custodies', 'custody_transactions',
  'employees', 'employee_advances', 'projects', 'project_expenses',
  'fixed_assets', 'inventory', 'inventory_transactions', 'warehouses',
  'branches', 'banks', 'cash_transactions', 'bonds', 'vouchers',
  'budgets', 'cost_centers', 'notifications', 'settings', 'tax_returns',
];

async function buildCompanyDump(companyId: string): Promise<Record<string, any[]>> {
  const s = sb();
  const out: Record<string, any[]> = {};
  for (const table of EXPORT_TABLES) {
    // A data-portability export must be complete. Previously every table was
    // capped at 10,000 rows and ANY error became an empty array, so a churning
    // customer could be handed a silently truncated copy of their own data and
    // never know. Missing tables are still tolerated (the schema evolves), but
    // a real read failure now fails the export so it is retried/reported.
    const rows: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error: pageError } = await s.from(table)
        .select('*')
        .eq('company_id', companyId)
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (pageError) {
        // 42P01 = undefined_table: the table genuinely does not exist here.
        const missingTable = pageError.code === '42P01'
          || /does not exist|Could not find/i.test(pageError.message || '');
        if (missingTable) { rows.length = 0; break; }
        throw new Error(`تعذر تصدير الجدول ${table}: ${pageError.message}`);
      }
      const page = (data || []) as any[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    out[table] = rows;
  }
  return out;
}
