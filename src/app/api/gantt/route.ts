import { NextRequest } from 'next/server';
import { success, error, notFound, handleApiError, parseBody, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ganttCreateSchema, ganttUpdateSchema, relationshipUuid } from '@/lib/relationship-validation';

const sb = () => getSupabase();

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
    const { data: tasks, error: tasksError } = await s.from('project_tasks').select('*')
      .eq('project_id', projectId).eq('company_id', auth.companyId).order('start_date', { ascending: true });
    if (tasksError) throw tasksError;

    const taskMap: Record<string, Record<string, unknown>> = {};
    for (const task of tasks || []) {
      const row = task as Record<string, unknown>;
      taskMap[String(row.id)] = {
        ...row,
        duration_days: Math.ceil((new Date(String(row.end_date)).getTime() - new Date(String(row.start_date)).getTime()) / 86400000) + 1,
        progress_percent: Number(row.progress) || 0,
        isCritical: false,
      };
    }
    const allTasks = Object.values(taskMap);
    const starts = allTasks.map((task) => new Date(String(task.start_date)).getTime());
    const ends = allTasks.map((task) => new Date(String(task.end_date)).getTime());
    const projectStartTime = starts.length ? Math.min(...starts) : Date.now();
    const projectEndTime = ends.length ? Math.max(...ends) : projectStartTime;
    const totalProjectDays = Math.ceil((projectEndTime - projectStartTime) / 86400000) + 1;
    for (const task of allTasks) {
      if (Number(task.duration_days) >= totalProjectDays * 0.3 || Number(task.progress_percent) === 0) taskMap[String(task.id)].isCritical = true;
    }
    const now = Date.now();
    const summary = {
      totalTasks: allTasks.length,
      completed: allTasks.filter((task) => Number(task.progress_percent) >= 100).length,
      inProgress: allTasks.filter((task) => Number(task.progress_percent) > 0 && Number(task.progress_percent) < 100).length,
      notStarted: allTasks.filter((task) => Number(task.progress_percent) === 0).length,
      overdue: allTasks.filter((task) => Number(task.progress_percent) < 100 && new Date(String(task.end_date)).getTime() < now).length,
      projectStart: new Date(projectStartTime).toISOString().split('T')[0],
      projectEnd: new Date(projectEndTime).toISOString().split('T')[0],
      totalDays: totalProjectDays,
    };
    return success({ tasks: allTasks, summary, project: { id: projectId, start: summary.projectStart, end: summary.projectEnd, duration: totalProjectDays } });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'create');
    const parsed = ganttCreateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: createError } = await sb().rpc('create_project_task_atomic', {
      p_company_id: auth.companyId,
      p_payload: parsed.data,
      p_user_id: auth.userId,
    });
    if (createError) {
      const message = String(createError.message || '');
      if (message.includes('غير صالحة')) return error(message);
      throw createError;
    }
    return success(data, 201);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'update');
    const taskId = new URL(request.url).searchParams.get('task_id');
    if (!taskId || !relationshipUuid.safeParse(taskId).success) return error('معرف المهمة غير صالح');
    const parsed = ganttUpdateSchema.safeParse(await parseBody(request));
    if (!parsed.success) return error(parsed.error.issues[0].message);
    const { data, error: updateError } = await sb().rpc('update_project_task_atomic', {
      p_company_id: auth.companyId,
      p_task_id: taskId,
      p_patch: parsed.data,
      p_user_id: auth.userId,
    });
    if (updateError) {
      const message = String(updateError.message || '');
      if (message.includes('غير موجودة')) return notFound();
      if (message.includes('دورة')) return error(message, 409);
      if (message.includes('غير صالحة')) return error(message);
      throw updateError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'delete');
    const taskId = new URL(request.url).searchParams.get('task_id');
    if (!taskId || !relationshipUuid.safeParse(taskId).success) return error('معرف المهمة غير صالح');
    const { data, error: deleteError } = await sb().rpc('delete_unstarted_project_task_atomic', {
      p_company_id: auth.companyId,
      p_task_id: taskId,
      p_user_id: auth.userId,
    });
    if (deleteError) {
      const message = String(deleteError.message || 'تعذر حذف المهمة');
      if (message.includes('غير موجودة')) return notFound();
      if (message.includes('بدأ تنفيذها')) return error(message, 409);
      throw deleteError;
    }
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}
