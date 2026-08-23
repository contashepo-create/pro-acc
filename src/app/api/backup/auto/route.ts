import {NextRequest} from 'next/server';
import {success, requireAdmin, handleApiError} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * GET /api/backup/auto - Get automatic backup status and history
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();

    // Get recent backup history
    const { data: backups } = await s
      .from('audit_log')
      .select('*')
      .eq('company_id', auth.companyId)
      .eq('action', 'auto_backup')
      .order('created_at', { ascending: false })
      .limit(10);

    // Get company data summary for backup size estimation
    const tables = ['invoices', 'journal_entries', 'journal_lines', 'cash_transactions', 'clients', 'contacts', 'accounts'];
    const sizes: Record<string, number> = {};
    
    for (const table of tables) {
      const { count } = await s.from(table)
        .select('*', { count: 'exact', head: true })
        .eq('company_id', auth.companyId);
      sizes[table] = count || 0;
    }

    return success({
      backups: backups || [],
      dataSummary: sizes,
      lastBackup: backups?.[0]?.created_at || null,
      recommendedFrequency: 'daily',
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/backup/auto - Trigger an automatic backup export
 * Generates a JSON export of all company data
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    const s = sb();

    // Export all company data
    const exportData: Record<string, unknown[]> = {};
    const tables = [
      'accounts', 'clients', 'contacts', 'banks_safes', 'projects',
      'invoices', 'invoice_items', 'journal_entries', 'journal_lines',
      'cash_transactions', 'voucher_receipts', 'voucher_disbursements',
      'employees', 'inventory_items', 'fixed_assets', 'quotations',
      'purchase_invoices', 'purchase_orders', 'subcontractors',
      'custodies', 'boq_items', 'daily_workers', 'salary_sheets',
    ];

    // The reported size/record counts are what the operator uses to judge
    // whether the backup is healthy. Swallowing a read error into an empty
    // array made a broken backup look like an empty-but-successful one, and
    // PostgREST's default row ceiling silently capped large tables.
    for (const table of tables) {
      const rows: unknown[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error: pageError } = await s.from(table)
          .select('*')
          .eq('company_id', auth.companyId)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (pageError) {
          const missingTable = pageError.code === '42P01'
            || /does not exist|Could not find/i.test(pageError.message || '');
          if (missingTable) { rows.length = 0; break; }
          throw new Error(`تعذر قراءة الجدول ${table}: ${pageError.message}`);
        }
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      exportData[table] = rows;
    }

    const backupPayload = {
      version: '1.0',
      companyId: auth.companyId,
      exportedAt: new Date().toISOString(),
      exportedBy: auth.userId,
      data: exportData,
    };

    const jsonString = JSON.stringify(backupPayload, null, 2);
    const sizeBytes = Buffer.byteLength(jsonString, 'utf-8');

    // Log the backup
    try {
      await s.from('audit_log').insert({
        company_id: auth.companyId,
        user_id: auth.userId,
        action: 'auto_backup',
        entity_type: 'backup',
        new_values: {
          timestamp: new Date().toISOString(),
          tablesExported: tables.length,
          totalRecords: Object.values(exportData).reduce((sum: number, arr) => sum + (arr?.length || 0), 0),
          sizeBytes,
        },
      });
    } catch {
      // ignore audit log failure
    }

    return success({
      // Never embed an entire financial export in a URL: URLs leak through
      // browser history, proxies, analytics and server logs. The authenticated
      // download endpoint generates the protected attachment on demand.
      backupUrl: '/api/backup/download',
      sizeBytes,
      totalRecords: Object.values(exportData).reduce((sum: number, arr) => sum + (arr?.length || 0), 0),
      tablesExported: tables.length,
      exportedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
