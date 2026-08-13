import { NextRequest } from 'next/server';
import { success } from '@/lib/api-helpers';
import { requireAdmin, adminJsonError } from '@/lib/admin-guard';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin(request);
    return success({
      id: ctx.adminId,
      name: ctx.name,
      email: ctx.email,
      role: 'superadmin',
    });
  } catch (err) {
    return adminJsonError(err);
  }
}
