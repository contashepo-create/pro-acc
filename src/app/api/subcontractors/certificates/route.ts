import {NextRequest} from 'next/server';
import {success, error, parseBody, getPaginationParams, handleApiError, requireModulePermission} from '@/lib/api-helpers';
import {getSupabase} from '@/lib/supabase-client';

import type { Row } from '@/lib/types';

const sb = () => getSupabase();

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'read');
    const url = new URL(req.url);
    const { page, pageSize } = getPaginationParams(url);
    const contractId = url.searchParams.get('contractId');
    const s = sb();

    let query = s.from('subcontractor_certificates')
      .select('*, subcontractor_contracts!contract_id(contract_number, contacts!contact_id(name))', { count: 'exact' })
      .eq('company_id', auth.companyId);

    if (contractId) {
      query = query.eq('contract_id', contractId);
    }

    const offset = (page - 1) * pageSize;
    const { data: certs, count, error: queryError } = await query
      .order('date', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (queryError) throw queryError;

    return success({
      certificates: (certs || []).map((c: Row) => ({
        ...c,
        certificate_number: c.number,
        gross_amount: c.amount,
        contract_number: c.subcontractor_contracts ? String(((c.subcontractor_contracts as Row).contract_number)) || null : null,
        subcontractor_name: c.subcontractor_contracts ? (c.subcontractor_contracts as Row).contacts ? String(((c.subcontractor_contracts as Row).contacts as Row).name) || null : null : null,
      })),
      total: count || 0,
      page,
      pageSize,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireModulePermission(req, 'subcontractors', 'create');
    const data = await parseBody(req);
    const { contract_id, date, certificate_number, description, gross_amount, retention_rate } = data;
    const number = Number(certificate_number);
    const amount = Number(gross_amount);
    const rate = retention_rate === undefined ? 0 : Number(retention_rate);
    if (!contract_id || typeof contract_id !== 'string' || !date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return error('العقد والتاريخ مطلوبان');
    }
    if (!Number.isSafeInteger(number) || number <= 0) return error('رقم الشهادة غير صالح');
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) return error('قيمة الشهادة غير صالحة');
    if (!Number.isFinite(rate) || rate < 0 || rate > 1 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-8) return error('نسبة الحجز غير صالحة');
    if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) return error('الوصف غير صالح');

    const { data: certificate, error: rpcError } = await sb().rpc('create_subcontractor_certificate_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: contract_id,
      p_date: date,
      p_certificate_number: number,
      p_description: description?.trim() || null,
      p_gross_amount: amount,
      p_retention_rate: rate,
      p_user_id: auth.userId,
    });
    if (rpcError) {
      const message = String(rpcError.message || '');
      if (message.includes('العقد غير موجود')) return error(message, 404);
      if (message.includes('يتجاوز') || message.includes('غير نشط')) return error(message, 409);
      throw rpcError;
    }
    return success(certificate, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
