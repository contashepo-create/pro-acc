import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { hasAllowedMagicBytes } from '@/lib/safe-input';
import { contractDocumentSchema, contractUpdateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'read');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const s = sb();
    const { data: contract, error: contractError } = await s.from('contracts').select('*, projects(name), contacts(name)')
      .eq('id', id).eq('company_id', auth.companyId).maybeSingle();
    if (contractError) throw contractError;
    if (!contract) return notFound();
    const { data: documents, error: documentsError } = await s.from('contract_documents')
      .select('id, filename, content_type, file_size, description, uploaded_by, uploaded_at')
      .eq('contract_id', id).eq('company_id', auth.companyId).order('uploaded_at', { ascending: false });
    if (documentsError) throw documentsError;
    const row = contract as Record<string, unknown>;
    const project = row.projects as { name?: string } | null;
    const contact = row.contacts as { name?: string } | null;
    return success({
      ...row,
      project_name: project?.name || null,
      contact_name: contact?.name || null,
      documents: documents || [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'update');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const parsed = contractUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_contract_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: id,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) {
      const message = String(updateError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('لا يمكن') || message.includes('انتقال حالة')) return error(message, 409);
      if (message.includes('غير صالحة')) return error(message);
      throw updateError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'delete');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const s = sb();
    const { data, error: deleteError } = await s.rpc('delete_draft_contract_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: id,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || '');
      if (message.includes('غير موجود')) return notFound();
      if (message.includes('لا يمكن حذف')) return error(message, 409);
      throw deleteError;
    }

    const paths = Array.isArray((data as { storage_paths?: unknown })?.storage_paths)
      ? (data as { storage_paths: unknown[] }).storage_paths.filter((path): path is string =>
          typeof path === 'string' && path.startsWith(`${auth.companyId}/${id}/`) && !path.includes('..'))
      : [];
    if (paths.length && s.storage) {
      const { error: storageError } = await s.storage.from('contract-documents').remove(paths);
      if (storageError) console.error('Orphan contract document cleanup failed:', storageError);
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/contracts/[id] — upload private storage object, then atomically record tenant metadata. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModulePermission(request, 'contracts', 'create');
    const { id } = await params;
    if (!relationshipUuid.safeParse(id).success) return error('معرف العقد غير صالح');
    const parsed = contractDocumentSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const body = parsed.data;
    const raw = body.file_data.includes(',') ? body.file_data.slice(body.file_data.indexOf(',') + 1) : body.file_data;
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) return error('ترميز الملف غير صالح');
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return error('حجم الملف يجب ألا يتجاوز 10 ميجابايت');
    if (!hasAllowedMagicBytes(buffer, body.content_type)) return error('محتوى الملف لا يطابق نوعه');

    try {
      const { getCompanyPlanLimits, countUsedStorageBytes } = await import('@/lib/plan-limits');
      const limits = await getCompanyPlanLimits(auth.companyId);
      const capBytes = Number(limits?.max_storage_mb || 0) * 1024 * 1024;
      if (capBytes <= 0) return error('باقتك الحالية لا تتضمن مساحة تخزين للملفات', 403);
      const usedBytes = await countUsedStorageBytes(auth.companyId);
      if (usedBytes + buffer.length > capBytes) return error('لا تتوفر مساحة تخزين كافية لهذا المستند', 403);
    } catch (storageCheckError) {
      console.error('Contract storage quota check failed:', storageCheckError);
      return error('تعذر التحقق من مساحة التخزين. حاول لاحقاً.', 503);
    }

    const extension = body.content_type === 'application/pdf' ? 'pdf' : body.content_type === 'image/png' ? 'png' : 'jpg';
    const objectPath = `${auth.companyId}/${id}/${randomUUID()}.${extension}`;
    const s = sb();
    if (!s.storage) throw new Error('Storage unavailable');
    const { error: uploadError } = await s.storage.from('contract-documents')
      .upload(objectPath, buffer, { contentType: body.content_type, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error: metadataError } = await s.rpc('create_contract_document_atomic', {
      p_company_id: auth.companyId,
      p_contract_id: id,
      p_filename: body.filename,
      p_content_type: body.content_type,
      p_storage_reference: `storage:contract-documents/${objectPath}`,
      p_file_size: buffer.length,
      p_description: body.description || null,
      p_user_id: auth.userId,
    });
    if (metadataError) {
      if (s.storage) await s.storage.from('contract-documents').remove([objectPath]);
      if (String(metadataError.message || '').includes('غير صالحة')) return error('العقد غير موجود أو بيانات المستند غير صالحة', 404);
      throw metadataError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
