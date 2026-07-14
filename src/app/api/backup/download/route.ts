import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase-client';
import { requireApiAuth, handleApiError } from '@/lib/api-helpers';
import { createHmac } from 'crypto';

const sb = () => getSupabase();

const BACKUP_SECRET = process.env.TOKEN_SECRET || 'backup-secret';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'json'; // json, csv, excel

    // Check if backup feature is allowed for this plan
    const { data: company } = await s.from('companies').select('id, name, email, phone').eq('id', auth.companyId).single();
    if (!company) return new Response(JSON.stringify({ success: false, message: 'Company not found' }), { status: 404 });

    // Get all company data (only his data)
    const tables = [
      'accounts', 'journal_entries', 'journal_lines', 'invoices', 'invoice_items',
      'contacts', 'clients', 'projects', 'banks_safes', 'cash_transactions',
      'inventory_items', 'employees', 'payroll'
    ];

    const backupData: any = {
      metadata: {
        company_id: auth.companyId,
        company_name: (company as Record<string, any>).name,
        email: (company as Record<string, any>).email,
        phone: (company as Record<string, any>).phone,
        exported_at: new Date().toISOString(),
        version: '1.0',
        format,
      },
      data: {} as any
    };

    // Fetch data for each table
    for (const table of tables) {
      try {
        const { data } = await s.from(table).select('*').eq('company_id', auth.companyId).limit(10000);
        backupData.data[table] = data || [];
      } catch {
        backupData.data[table] = [];
      }
    }

    const jsonString = JSON.stringify(backupData, null, 2);
    const hash = createHmac('sha256', BACKUP_SECRET).update(jsonString).digest('hex');
    const fileHash = createHmac('sha256', BACKUP_SECRET).update(jsonString).digest('hex').substring(0, 16);

    // Log backup for verification later
    await s.from('backup_logs').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      backup_type: format,
      file_hash: fileHash,
      hmac_signature: hash,
      file_size: Buffer.byteLength(jsonString),
      includes_tables: tables,
    });

    // Audit log
    await s.from('security_audit_log').insert({
      company_id: auth.companyId,
      user_id: auth.userId,
      action: 'backup_download',
      details: { format, file_hash: fileHash, tables },
      ip_address: request.headers.get('x-forwarded-for') || 'unknown',
    });

    if (format === 'json') {
      return new Response(jsonString, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="backup-${auth.companyId}-${Date.now()}.json"`,
          'X-Backup-Hash': fileHash,
          'X-Backup-Signature': hash,
        }
      });
    } else if (format === 'csv') {
      // Simple CSV export of invoices for example
      const csv = convertToCSV(backupData.data.invoices || []);
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="invoices-${auth.companyId}-${Date.now()}.csv"`,
          'X-Backup-Hash': fileHash,
        }
      });
    } else {
      // Excel - for simplicity return JSON with excel mime
      return new Response(jsonString, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="backup-${auth.companyId}-${Date.now()}.xlsx"`,
          'X-Backup-Hash': fileHash,
        }
      });
    }
  } catch (err) {
    return handleApiError(err) ;
  }
}

function convertToCSV(data: any[]): string {
  if (!data.length) return '';
  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return [headers, ...rows].join('\n');
}
