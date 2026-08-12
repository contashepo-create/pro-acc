import { NextRequest } from 'next/server';
import { success, error, notFound, requireModulePermission, requireManagerOrAbove, handleApiError } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { loadCustodyFile, assertFileOpen } from '@/lib/custody';
import { postReversalEntry } from '@/lib/voucher-utils';

const sb = () => getSupabase();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'read');
    const { id } = await params;
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    return success(file);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireModulePermission(request, 'custodies', 'update');
    const { id } = await params;
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    assertFileOpen(file);

    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.reason !== undefined || body.description !== undefined) {
      update.reason = body.reason ?? body.description;
      update.description = body.description ?? body.reason;
    }
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.project_id !== undefined) {
      if (body.project_id) {
        const { data: p } = await sb().from('projects').select('id').eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
        if (!p) return error('المشروع غير موجود', 404);
      }
      update.project_id = body.project_id || null;
    }
    if (body.amount !== undefined || body.employee_id !== undefined) {
      return error('لا يُعدَّل مبلغ الملف أو الموظف بعد الصرف — استخدم تعزيز أو قيد عكسي');
    }

    const { data, error: uErr } = await sb().from('custodies')
      .update(update).eq('id', id).eq('company_id', auth.companyId).select('*').single();
    if (uErr) throw uErr;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireManagerOrAbove(request);
    const { id } = await params;
    const file = await loadCustodyFile(auth.companyId, id);
    if (!file) return notFound();
    if (file.is_closed) return error('لا يمكن حذف ملف مغلق');
    if (file.total_expenses > 0.005) return error('لا يمكن حذف ملف عليه إثباتات مصروف — اعكس المصروفات أولاً');

    if (file.journal_entry_id) {
      const { error: revErr } = await postReversalEntry(auth.companyId, {
        journalEntryId: file.journal_entry_id,
        referenceType: 'custody_reversal',
        referenceId: id,
        description: `عكس افتتاح عهدة ${file.file_number || id}`,
        userId: auth.userId,
      });
      if (revErr) throw revErr;
    }

    await sb().from('custodies').update({
      status: 'settled',
      remaining_amount: 0,
      notes: `${file.notes || ''} [ملغى]`.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('company_id', auth.companyId);

    return success({ cancelled: true });
  } catch (err) {
    return handleApiError(err);
  }
}
