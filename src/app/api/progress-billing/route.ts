import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'read');
    const s = sb();
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const projectId = url.searchParams.get('projectId');

    let query = s.from('progress_billing')
      .select('*, projects(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);
    if (projectId) query = query.eq('project_id', projectId);

    const offset = (page - 1) * pageSize;
    const { data, error: queryError, count } = await query
      .order('date', { ascending: false }).range(offset, offset + pageSize - 1);

    if (queryError) {
      // Table might not exist, return empty result
      console.warn('Progress billing table query error:', queryError);
      return success({ claims: [], total: 0, page, pageSize });
    }

    const claims = (data || []).map((pb: any) => ({ ...pb, project_name: pb.projects?.name || null }));
    return success({ claims, total: count || 0, page, pageSize });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'progress_billing', 'create');
    const s = sb();
    const data = await parseBody(req);
    const { project_id, date, claim_number, description, gross_amount, retention_rate, retention_percentage, is_final, notes, tax_rate, tax_enabled } = data;
    if (!project_id || !date || !gross_amount)
      return error('project_id, date, gross_amount are required');

    const grossAmount = Number(gross_amount);
    if (!(grossAmount > 0)) return error('المبلغ الإجمالي يجب أن يكون موجباً');

    const rate = retention_rate !== undefined
      ? Number(retention_rate)
      : (retention_percentage !== undefined ? Number(retention_percentage) / 100 : 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      return error('نسبة الاستقطاع يجب أن تكون بين 0 و1');
    }
    const vRate = tax_enabled !== false && tax_rate !== undefined ? Number(tax_rate) : 0;
    if (!Number.isFinite(vRate) || vRate < 0 || vRate > 1) return error('نسبة الضريبة غير صالحة');
    if (typeof claim_number === 'string' && claim_number.length > 80) return error('رقم المستخلص طويل جداً');
    const details = String(description || notes || '');
    if (details.length > 2000) return error('وصف المستخلص طويل جداً');

    // The project row serializes contract/change-order/previous-claim checks;
    // claim and required journal then commit together.
    const { data: claim, error: createError } = await s.rpc('create_progress_billing_atomic', {
      p_company_id: auth.companyId,
      p_project_id: project_id,
      p_date: date,
      p_claim_number: typeof claim_number === 'string' ? claim_number.trim() : '',
      p_description: details.trim(),
      p_gross_amount: grossAmount,
      p_retention_rate: rate,
      p_tax_rate: vRate,
      p_is_final: Boolean(is_final),
      p_user_id: auth.userId,
    });
    if (createError) throw createError;
    return success(claim, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
