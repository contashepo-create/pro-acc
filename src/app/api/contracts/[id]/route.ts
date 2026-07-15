import { NextRequest } from 'next/server';
import { success, error, notFound, requireApiAuth, handleApiError, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/contracts/[id] — Get contract details + attached documents
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth(request);
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
      .select('*')
      .eq('contract_id', id)
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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();
    const body = await parseBody<Record<string, unknown>>(request);

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
    const auth = await requireApiAuth(request);
    const { id } = await params;
    const s = sb();

    // Delete attached documents first
    await s.from('contract_documents').delete().eq('contract_id', id);

    const { error: deleteErr } = await s.from('contracts')
      .delete()
      .eq('id', id)
      .eq('company_id', auth.companyId);

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
    const auth = await requireApiAuth(request);
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

    // Check file size (max 10MB base64 = ~7.5MB actual)
    const sizeBytes = Math.ceil((body.file_data.length * 3) / 4);
    if (sizeBytes > 10 * 1024 * 1024) {
      return error('حجم الملف يتجاوز 10 ميجابايت');
    }

    // Store document metadata (file data stored as base64 in DB for simplicity)
    // In production, use Supabase Storage or S3 for large files
    const docId = generateId();
    const { data: doc, error: docErr } = await s.from('contract_documents')
      .insert({
        id: docId,
        contract_id: id,
        company_id: auth.companyId,
        filename: body.filename,
        content_type: body.content_type || 'application/octet-stream',
        file_data: body.file_data,
        file_size: sizeBytes,
        description: body.description || null,
        uploaded_by: auth.userId,
      })
      .select('id, filename, content_type, file_size, description, uploaded_at')
      .single();

    if (docErr) throw docErr;

    return success(doc, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
