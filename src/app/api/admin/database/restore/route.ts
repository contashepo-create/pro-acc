import { NextRequest } from 'next/server';
import { success, unauthorized, error, serverError } from '@/lib/api-helpers';
import { verifyAdminToken, auditLog } from '@/lib/admin-auth';
import { transaction } from '@/lib/db';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.sql', '.backup'];

export async function POST(request: NextRequest) {
  try {
    const admin = await verifyAdminToken(request);
    if (!admin) return unauthorized();

    const formData = await request.formData();
    const file = formData.get('backup') as File;

    if (!file) {
      return error('لم يتم رفع أي ملف');
    }

    const fileName = file.name.toLowerCase();
    const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    if (!hasValidExtension) {
      return error('يُسمح فقط بملفات .sql أو .backup');
    }

    if (file.size > MAX_FILE_SIZE) {
      return error('حجم الملف يتجاوز 50 ميجابايت');
    }

    const text = await file.text();

    const statements = text
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    try {
      await transaction(async (client) => {
        for (const stmt of statements) {
          await client.query(stmt);
        }
      });
    } catch (txErr) {
      await auditLog(admin.userId, 'restore', `Database restore failed: ${file.name}, ${statements.length} statements`);
      throw txErr;
    }

    await auditLog(admin.userId, 'restore', `Database restore succeeded: ${file.name}, ${statements.length} statements executed`);

    return success({
      message: 'تمت استعادة قاعدة البيانات بنجاح',
      statements: statements.length,
    });
  } catch (err) {
    return serverError(err);
  }
}
