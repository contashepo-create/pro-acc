import { NextRequest } from 'next/server';
import { success, error, handleApiError, parseBody, requireApiAuth } from '@/lib/api-helpers';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);

    const settings = await query(
      `SELECT key, value FROM settings WHERE company_id = $1`,
      [auth.companyId]
    );

    const map: Record<string, string> = {};
    for (const row of settings.rows) {
      map[row.key] = row.value;
    }

    return success({ settings: map });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireApiAuth(req);
    const data = await parseBody(req);
    const { settings } = data;

    if (!settings) return error('settings are required');

    for (const [key, value] of Object.entries(settings)) {
      await query(
        `INSERT INTO settings (company_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (company_id, key) DO UPDATE SET value = $3`,
        [auth.companyId, key, String(value)]
      );
    }

    return success({ updated: true });
  } catch (err) {
    return handleApiError(err);
  }
}
