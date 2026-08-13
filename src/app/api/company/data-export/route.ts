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
    const s = sb();
    const { data, error: err } = await s.from('company_data_exports')
      .select('id, status, requested_at, completed_at, expires_at, file_size_bytes, error_message')
      .eq('company_id', auth.companyId)
      .order('requested_at', { ascending: false })
      .limit(10);
    if (err) throw err;
    return success({ exports: data || [] });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { requireApiAuth } = await import('@/lib/api-helpers');
    const auth = await requireApiAuth(req, { skipModuleGuard: true });
    const s = sb();

    // Rate-limit: at most one pending export per company at a time
    const { data: existing } = await s.from('company_data_exports')
      .select('id, status')
      .eq('company_id', auth.companyId)
      .in('status', ['pending', 'processing'])
      .limit(1)
      .maybeSingle();
    if (existing) {
      return error('يوجد طلب تصدير قيد المعالجة حالياً. يرجى الانتظار حتى اكتماله.', 409);
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
      await processPendingExports();
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
export async function processPendingExports() {
  const s = sb();
  const { data: pending } = await s.from('company_data_exports')
    .select('id, company_id')
    .eq('status', 'pending')
    .limit(5);
  if (!pending || pending.length === 0) return;

  for (const exp of pending as { id: string; company_id: string }[]) {
    try {
      await s.from('company_data_exports').update({ status: 'processing' }).eq('id', exp.id).eq('company_id', exp.company_id);
      const dump = await buildCompanyDump(exp.company_id);
      // Store the dump as a compact JSON string in download_url for
      // simplicity. In production, upload to S3/Blob storage and put a
      // signed URL here.
      const json = JSON.stringify(dump, null, 2);
      const size = Buffer.byteLength(json, 'utf8');
      await s.from('company_data_exports').update({
        status: 'ready',
        completed_at: new Date().toISOString(),
        download_url: `data:application/json;charset=utf-8;base64,${Buffer.from(json).toString('base64')}`,
        file_size_bytes: size,
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }).eq('id', exp.id).eq('company_id', exp.company_id);
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
    try {
      // Cheap safety: only export company-scoped tables.
      const { data } = await s.from(table).select('*').eq('company_id', companyId).limit(10000);
      out[table] = (data || []) as any[];
    } catch (e) {
      // Table may not exist in the current schema — skip.
      out[table] = [];
    }
  }
  return out;
}
