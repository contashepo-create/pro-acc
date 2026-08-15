import { NextRequest } from 'next/server';
import { success, error, parseBody, getPaginationParams, requireModulePermission, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';

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

    // عزل مستأجرين: المشروع يجب أن ينتمي لهذه الشركة
    const { data: project } = await s.from('projects')
      .select('id, name, status, contract_value')
      .eq('id', project_id)
      .eq('company_id', auth.companyId)
      .maybeSingle();
    if (!project) return error('المشروع غير موجود', 404);
    if ((project as any).status === 'completed' || (project as any).status === 'cancelled') {
      return error('لا يمكن إصدار فواتير مرحلية على مشروع مكتمل أو ملغى');
    }

    const rate = retention_rate !== undefined ? Number(retention_rate) : (retention_percentage !== undefined ? Number(retention_percentage) / 100 : 0);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return error('نسبة الاستقطاع يجب أن تكون بين 0 و1');
    const retentionAmount = Math.round(grossAmount * rate * 100) / 100;
    const netAmount = Math.round((grossAmount - retentionAmount) * 100) / 100;
    const claimNumber = claim_number || `PB-${Date.now()}`;

    // A claim cannot exceed the original contract plus approved change orders.
    const { data: approvedChanges } = await s.from('change_orders')
      .select('change_amount').eq('project_id', project_id).eq('company_id', auth.companyId).eq('status', 'approved');
    const adjustedContract = Number((project as any).contract_value || 0)
      + (approvedChanges || []).reduce((sum: number, row: any) => sum + (Number(row.change_amount) || 0), 0);
    const { data: priorClaims } = await s.from('progress_billing')
      .select('gross_amount').eq('project_id', project_id).eq('company_id', auth.companyId).neq('status', 'cancelled');
    const alreadyClaimed = (priorClaims || []).reduce((sum: number, row: any) => sum + (Number(row.gross_amount) || 0), 0);
    if (adjustedContract <= 0 || alreadyClaimed + grossAmount > adjustedContract + 0.005) {
      return error('قيمة المستخلص تتجاوز الرصيد المتبقي من العقد المعدل', 409);
    }

    // VAT calculation
    const vRate = tax_enabled !== false && tax_rate !== undefined ? Number(tax_rate) : 0;
    if (!Number.isFinite(vRate) || vRate < 0 || vRate > 1) return error('نسبة الضريبة غير صالحة');
    const taxAmount = Math.round(netAmount * vRate * 100) / 100;

    // حل جميع الحسابات قبل أي كتابة — القيد إلزامي متوازن
    const { data: arAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.ACCRUED_REVENUE).maybeSingle();
    const { data: revAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.CONTRACT_REVENUE).maybeSingle();
    if (!arAcc || !revAcc) {
      return error('حسابات الإيرادات المستحقة (1135) أو إيرادات العقود (4100) غير موجودة — راجع دليل الحسابات');
    }
    if (retentionAmount > 0) {
      const { data: retAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.RETENTIONS).maybeSingle();
      if (!retAcc) return error('حساب محجوزات الضمان (2160) غير موجود');
    }
    if (taxAmount > 0) {
      const { data: vatAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_SALES).maybeSingle();
      if (!vatAcc) return error('حساب ضريبة المبيعات (2120) غير موجود');
    }

    const { data: claim, error: claimErr } = await s.from('progress_billing')
      .insert({ company_id: auth.companyId, project_id, date, claim_number: claimNumber, description: description || notes || null, gross_amount: grossAmount, retention_rate: rate, retention_amount: retentionAmount, net_amount: netAmount, status: 'approved', is_final: is_final || false, tax_rate: vRate, tax_amount: taxAmount })
      .select('*').single();
    if (claimErr) throw claimErr;

    // القيد: مدين المستحقات (1135) بالمبلغ الشامل / دائن الإيراد + المحجوز + الضريبة
    const lines: Array<{ account_id: string; debit: number; credit: number; description?: string | null; project_id?: string | null }> = [
      { account_id: arAcc.id, debit: grossAmount + taxAmount, credit: 0, project_id: project_id },
      { account_id: revAcc.id, debit: 0, credit: netAmount, project_id: project_id },
    ];
    if (retentionAmount > 0) {
      const { data: retAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.RETENTIONS).maybeSingle();
      lines.push({ account_id: retAcc.id, debit: 0, credit: retentionAmount, project_id: project_id });
    }
    if (taxAmount > 0) {
      const { data: vatAcc } = await s.from('accounts').select('id').eq('company_id', auth.companyId).eq('code', ACCOUNT_CODES.VAT_SALES).maybeSingle();
      lines.push({ account_id: vatAcc.id, debit: 0, credit: taxAmount, project_id: project_id });
    }

    const { createJournalEntry } = await import('@/lib/journal-utils');
    const je = await createJournalEntry(auth.companyId, {
      date,
      type: 'general',
      description: `فاتورة مرحلية: ${claimNumber}`,
      lines,
      reference_type: 'progress_billing',
      reference_id: claim.id,
      created_by: auth.userId,
    });

    if (je.error || !je.journalId) {
      await s.from('progress_billing').delete().eq('id', claim.id).eq('company_id', auth.companyId);
      throw je.error || new Error('فشل قيد الفاتورة المرحلية');
    }

    const { data: linked, error: linkErr } = await s.from('progress_billing')
      .update({ journal_entry_id: je.journalId })
      .eq('id', claim.id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();
    if (linkErr) {
      await s.from('journal_lines').delete().eq('journal_entry_id', je.journalId);
      await s.from('journal_entries').delete().eq('id', je.journalId).eq('company_id', auth.companyId);
      await s.from('progress_billing').delete().eq('id', claim.id).eq('company_id', auth.companyId);
      throw linkErr;
    }

    return success(linked, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
