import { NextRequest } from 'next/server';
import { success, error, requireApiAuth, handleApiError, getPaginationParams } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/bonds — List all bonds/guarantees
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const url = new URL(request.url);
    const { page, pageSize } = getPaginationParams(url);
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');

    let query = s.from('bonds')
      .select('*, projects(name), contacts(name), banks_safes(name)', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);

    const offset = (page - 1) * pageSize;
    const { data, error: qErr, count } = await query
      .order('expiry_date', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (qErr) throw qErr;

    const bonds = (data || []).map((b: any) => ({
      ...b,
      project_name: b.projects?.name || null,
      contact_name: b.contacts?.name || null,
      bank_name: b.banks_safes?.name || null,
      daysUntilExpiry: b.expiry_date
        ? Math.max(0, Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000))
        : null,
      isExpiringSoon: b.expiry_date && new Date(b.expiry_date).getTime() - Date.now() < 30 * 86400000,
      isExpired: b.expiry_date && new Date(b.expiry_date) < new Date(),
    }));

    // Summary
    const summary = {
      total: count || 0,
      active: bonds.filter((b: any) => b.status === 'active').length,
      expiringSoon: bonds.filter((b: any) => b.isExpiringSoon).length,
      expired: bonds.filter((b: any) => b.isExpired).length,
      totalValue: bonds.reduce((sum: number, b: any) => sum + (parseFloat(b.amount) || 0), 0),
    };

    return success({ bonds, total: count || 0, page, pageSize, summary });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/bonds — Create a new bond/guarantee
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(request);
    const s = sb();
    const body = await request.json();

    if (!body.title || !body.type || !body.amount || !body.issue_date || !body.expiry_date) {
      return error('العنوان والنوع والمبلغ وتاريخا الإصدار والانتهاء مطلوبة');
    }

    const validTypes = ['bid_bond', 'performance_bond', 'advance_payment', 'retention', 'warranty', 'insurance', 'other'];
    if (!validTypes.includes(body.type)) {
      return error(`النوع غير صالح. الأنواع المتاحة: ${validTypes.join('، ')}`);
    }

    const bondId = generateId();
    const { data, error: insertErr } = await s.from('bonds')
      .insert({
        id: bondId,
        company_id: auth.companyId,
        title: body.title,
        type: body.type,
        amount: body.amount,
        currency: body.currency || 'SAR',
        issue_date: body.issue_date,
        expiry_date: body.expiry_date,
        issuing_bank: body.issuing_bank || null,
        bank_safe_id: body.bank_safe_id || null,
        beneficiary_name: body.beneficiary_name || null,
        project_id: body.project_id || null,
        tender_id: body.tender_id || null,
        contact_id: body.contact_id || null,
        reference_number: body.reference_number || null,
        status: body.status || 'active', // active, expired, released, cancelled
        notes: body.notes || null,
        created_by: auth.userId,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) throw insertErr;
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
