import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { taskDependencyCreateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

/**
 * Finish-to-start task dependencies that drive the Gantt critical path.
 *
 * Every write goes through an audited SECURITY DEFINER function that re-checks
 * the tenant, verifies both tasks belong to the SAME project, and rejects
 * cycles. A direct-write trigger blocks any attempt to bypass those checks.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'read');
    const projectId = new URL(request.url).searchParams.get('project_id');
    if (!projectId || !relationshipUuid.safeParse(projectId).success) return error('معرف المشروع غير صالح');
    const s = sb();

    const { data: project, error: projectError } = await s.from('projects').select('id')
      .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return notFound();

    const { data, error: listError } = await s.from('project_task_dependencies')
      .select('id, project_id, successor_task_id, predecessor_task_id, lag_days, created_at')
      .eq('company_id', auth.companyId).eq('project_id', projectId)
      .order('created_at', { ascending: true });
    if (listError) throw listError;

    return success(data || []);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'create');
    const parsed = taskDependencyCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);

    const { data, error: createError } = await sb().rpc('create_task_dependency_atomic', {
      p_company_id: auth.companyId,
      p_successor_task_id: parsed.data.successor_task_id,
      p_predecessor_task_id: parsed.data.predecessor_task_id,
      p_lag_days: parsed.data.lag_days ?? 0,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('دورة')) return error(message, 409);
      if (message.includes('غير موجودة')) return notFound();
      if (message.includes('غير صالحة')) return error(message);
      // A duplicate edge is a client conflict, not a server fault.
      if (/duplicate key|project_task_dependencies_unique/i.test(message)) {
        return error('الاعتمادية موجودة بالفعل', 409);
      }
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'delete');
    const dependencyId = new URL(request.url).searchParams.get('dependency_id');
    if (!dependencyId || !relationshipUuid.safeParse(dependencyId).success) {
      return error('معرف الاعتمادية غير صالح');
    }

    const { data, error: deleteError } = await sb().rpc('delete_task_dependency_atomic', {
      p_company_id: auth.companyId,
      p_dependency_id: dependencyId,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || '');
      if (message.includes('غير موجودة')) return notFound();
      throw deleteError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
