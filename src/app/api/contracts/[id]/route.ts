import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';
import { hasAllowedMagicBytes } from '@/lib/safe-input';

const sb = () => getSupabase();

/**
 * GET /api/contracts/[id] — Get contract details + attached documents
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'read');
    const { id } = await params;
    const s = sb();

    const { data: contract } = await s.from('contracts')
      .select('*, projects(name), contacts(name)')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contract) return notFound();

    // Get attached documents
    const { data: documents } = await s.from('contract_documents')
      // Never embed base64/storage references in the contract response.
      .select('id, filename, content_type, file_size, description, uploaded_by, uploaded_at')
      .eq('contract_id', id)
      .eq('company_id', auth.companyId)
      .order('uploaded_at', { ascending: false });

    const c = contract as Record<string, unknown>;
    return success({
      ...c,
      project_name: (c.projects as { name?: string } | null)?.name || null,
      contact_name: (c.contacts as { name?: string } | null)?.name || null,
      documents: documents || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/contracts/[id] — Update contract details
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'update');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

    const { data: existing } = await s.from('contracts')
      .select('id, status, value, project_id, contact_id').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    if (body.project_id) {
      const { data: project } = await s.from('projects').select('id')
        .eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!project) return error('المشروع غير موجود', 404);
    }
    if (body.contact_id) {
      const { data: contact } = await s.from('contacts').select('id')
        .eq('id', body.contact_id).eq('company_id', auth.companyId).maybeSingle();
      if (!contact) return error('الطرف غير موجود', 404);
    }
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 0) return error('قيمة العقد غير صالحة');
      if ((existing as any).status !== 'draft' && value !== Number((existing as any).value)) {
        return error('لا يمكن تغيير قيمة عقد بعد تفعيله دون أمر تغيير موثق', 409);
      }
    }
    if (body.status !== undefined) {
      const transitions: Record<string, string[]> = {
        draft: ['active', 'terminated'], active: ['completed', 'expired', 'terminated'],
        completed: [], expired: ['terminated'], terminated: [],
      };
      if (!(transitions[(existing as any).status] || []).includes(String(body.status))) {
        return error('انتقال حالة العقد غير صالح', 409);
      }
    }

    const updateData: Record<string, unknown> = {};
    const allowedFields = ['title', 'type', 'project_id', 'contact_id', 'start_date', 'end_date', 'value', 'description', 'status'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    if (Object.keys(updateData).length === 0) return error('لا توجد بيانات للتحديث');

    const { data: updated, error: updateErr } = await s.from('contracts')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    return success(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/contracts/[id] — Delete contract
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'delete');
    const { id } = await params;
    const s = sb();

    const { data: contract } = await s.from('contracts')
      .select('id, status').eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (!contract) return notFound();
    if ((contract as any).status !== 'draft') {
      return error('لا يمكن حذف عقد فعّال أو منتهٍ؛ استخدم حالة الإنهاء للحفاظ على السجل', 409);
    }

    const { data: documents } = await s.from('contract_documents')
      .select('id, file_data').eq('contract_id', id).eq('company_id', auth.companyId);
    const paths = (documents || []).map((doc: any) => String(doc.file_data || ''))
      .filter((ref: string) => ref.startsWith('storage:contract-documents/'))
      .map((ref: string) => ref.slice('storage:contract-documents/'.length));
    if (paths.length) await s.storage.from('contract-documents').remove(paths);
    await s.from('contract_documents').delete().eq('contract_id', id).eq('company_id', auth.companyId);

    const { error: deleteErr } = await s.from('contracts')
      .delete().eq('id', id).eq('company_id', auth.companyId);

    if (deleteErr) throw deleteErr;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/contracts/[id]/documents — Upload a document for a contract
 * Accepts base64-encoded file data
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'create');
    const { id } = await params;
    const s = sb();
    const body = await parseBody<{
      filename: string;
      content_type: string;
      file_data: string; // base64 encoded
      description?: string;
    }>(request);

    if (!body.filename || !body.file_data) {
      return error('اسم الملف ومحتواه مطلوبان');
    }

    // Verify contract exists
    const { data: contract } = await s.from('contracts')
      .select('id')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (!contract) return notFound();

    if (body.filename.length > 255 || (body.description && body.description.length > 1000)) return error('بيانات الملف طويلة جداً');
    const mime = body.content_type;
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) return error('نوع الملف غير مدعوم');
    let buffer: Buffer;
    try {
      const raw = body.file_data.includes(',') ? body.file_data.slice(body.file_data.indexOf(',') + 1) : body.file_data;
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return error('ترميز الملف غير صالح');
      buffer = Buffer.from(raw, 'base64');
    } catch {
      return error('ترميز الملف غير صالح');
    }
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return error('حجم الملف يجب ألا يتجاوز 10 ميجابايت');
    if (!hasAllowedMagicBytes(buffer, mime)) return error('محتوى الملف لا يطابق نوعه');

    const docId = generateId();
    const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
    const objectPath = `${auth.companyId}/${id}/${randomUUID()}.${extension}`;
    const { error: uploadError } = await s.storage.from('contract-documents')
      .upload(objectPath, buffer, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;

    const { data: doc, error: docErr } = await s.from('contract_documents')
      .insert({
        id: docId, contract_id: id, company_id: auth.companyId,
        filename: body.filename.replace(/[\u0000-\u001f]/g, '').slice(0, 255),
        content_type: mime,
        file_data: `storage:contract-documents/${objectPath}`,
        file_size: buffer.length,
        description: body.description?.trim() || null,
        uploaded_by: auth.userId,
      })
      .select('id, filename, content_type, file_size, description, uploaded_at')
      .single();
    if (docErr) {
      await s.storage.from('contract-documents').remove([objectPath]);
      throw docErr;
    }

    return success(doc, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
