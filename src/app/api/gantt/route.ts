import { NextRequest } from 'next/server';
import { success, error, notFound, parseBody, handleApiError, requireModulePermission } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { generateId } from '@/lib/utils';

const sb = () => getSupabase();

/**
 * GET /api/gantt?project_id=... — Get tasks for Gantt chart
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'read');
    const s = sb();
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');

    if (!projectId) return error('project_id مطلوب');
    const { data: project } = await s.from('projects').select('id')
      .eq('id', projectId).eq('company_id', auth.companyId).maybeSingle();
    if (!project) return notFound();

    // Get project tasks
    const { data: tasks } = await s.from('project_tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('company_id', auth.companyId)
      .order('start_date', { ascending: true });

    // Calculate dependencies and critical path
    const taskMap: Record<string, any> = {};
    for (const task of (tasks || [])) {
      const t = task as any;
      taskMap[t.id] = {
        ...t,
        duration_days: t.start_date && t.end_date
          ? Math.ceil((new Date(t.end_date).getTime() - new Date(t.start_date).getTime()) / 86400000) + 1
          : 0,
        progress_percent: parseFloat(t.progress || 0),
        isCritical: false,
      };
    }

    // Calculate early/late start for critical path
    const allTasks = Object.values(taskMap);
    const projectStart = allTasks.length > 0
      ? allTasks.reduce((min: Date, t: any) => {
          const d = new Date(t.start_date);
          return d < min ? d : min;
        }, new Date(allTasks[0].start_date))
      : new Date();

    const projectEnd = allTasks.length > 0
      ? allTasks.reduce((max: Date, t: any) => {
          const d = new Date(t.end_date);
          return d > max ? d : max;
        }, new Date(allTasks[0].end_date))
      : new Date();

    const totalProjectDays = Math.ceil((projectEnd.getTime() - projectStart.getTime()) / 86400000) + 1;

    // Find critical tasks (longest path / no slack)
    for (const task of allTasks) {
      // Simple heuristic: tasks with 0 progress on the longest path are critical
      const t = task as any;
      if (t.duration_days >= totalProjectDays * 0.3 || t.progress_percent === 0) {
        taskMap[t.id].isCritical = true;
      }
    }

    // Summary
    const summary = {
      totalTasks: allTasks.length,
      completed: allTasks.filter((t: any) => t.progress_percent >= 100).length,
      inProgress: allTasks.filter((t: any) => t.progress_percent > 0 && t.progress_percent < 100).length,
      notStarted: allTasks.filter((t: any) => t.progress_percent === 0).length,
      overdue: allTasks.filter((t: any) => t.progress_percent < 100 && new Date(t.end_date) < new Date()).length,
      projectStart: projectStart.toISOString().split('T')[0],
      projectEnd: projectEnd.toISOString().split('T')[0],
      totalDays: totalProjectDays,
    };

    return success({
      tasks: Object.values(taskMap),
      summary,
      project: {
        id: projectId,
        start: summary.projectStart,
        end: summary.projectEnd,
        duration: totalProjectDays,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/gantt — Create a task
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'create');
    const s = sb();
    const body = await parseBody<any>(request);

    if (!body.project_id || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200 || !body.start_date || !body.end_date) {
      return error('المشروع والاسم وتاريخ البداية والنهاية مطلوبة');
    }
    if (!Number.isFinite(Date.parse(body.start_date)) || !Number.isFinite(Date.parse(body.end_date)) || Date.parse(body.start_date) > Date.parse(body.end_date)) return error('تواريخ المهمة غير صالحة');
    const progress = body.progress === undefined ? 0 : Number(body.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) return error('نسبة التقدم غير صالحة');
    if (body.status && !['not_started', 'in_progress', 'completed', 'blocked', 'on_hold'].includes(body.status)) return error('حالة المهمة غير صالحة');
    if (body.priority && !['low', 'medium', 'high', 'critical'].includes(body.priority)) return error('أولوية المهمة غير صالحة');
    for (const field of ['estimated_hours', 'actual_hours']) if (body[field] !== undefined && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) return error('عدد الساعات غير صالح');
    const { data: project } = await s.from('projects').select('id')
      .eq('id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
    if (!project) return error('المشروع غير موجود', 404);
    if (body.parent_task_id) {
      const { data: parent } = await s.from('project_tasks').select('id')
        .eq('id', body.parent_task_id).eq('project_id', body.project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!parent) return error('المهمة الأم غير موجودة', 404);
    }
    if (body.assigned_to) {
      const { data: assignee } = await s.from('users').select('id')
        .eq('id', body.assigned_to).eq('company_id', auth.companyId).eq('is_active', true).maybeSingle();
      if (!assignee) return error('المستخدم المسند إليه غير موجود', 404);
    }

    const taskId = generateId();
    const { data, error: insertErr } = await s.from('project_tasks')
      .insert({
        id: taskId,
        company_id: auth.companyId,
        project_id: body.project_id,
        name: body.name.trim(),
        description: body.description || null,
        start_date: body.start_date,
        end_date: body.end_date,
        progress,
        status: body.status || 'not_started', // not_started, in_progress, completed, blocked
        priority: body.priority || 'medium', // low, medium, high, critical
        parent_task_id: body.parent_task_id || null, // For sub-tasks
        assigned_to: body.assigned_to || null,
        estimated_hours: body.estimated_hours || null,
        actual_hours: body.actual_hours || null,
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

/**
 * PUT /api/gantt — Update task (progress, dates, etc.)
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'update');
    const s = sb();
    const url = new URL(request.url);
    const taskId = url.searchParams.get('task_id');

    if (!taskId) return error('task_id مطلوب');

    const body = await parseBody<any>(request);
    const { data: existing } = await s.from('project_tasks').select('id, project_id, start_date, end_date')
      .eq('id', taskId).eq('company_id', auth.companyId).maybeSingle();
    if (!existing) return notFound();
    const startDate = body.start_date ?? (existing as any).start_date;
    const endDate = body.end_date ?? (existing as any).end_date;
    if (!Number.isFinite(Date.parse(startDate)) || !Number.isFinite(Date.parse(endDate)) || Date.parse(startDate) > Date.parse(endDate)) return error('تواريخ المهمة غير صالحة');
    if (body.progress !== undefined && (!Number.isFinite(Number(body.progress)) || Number(body.progress) < 0 || Number(body.progress) > 100)) return error('نسبة التقدم غير صالحة');
    if (body.status && !['not_started', 'in_progress', 'completed', 'blocked', 'on_hold'].includes(body.status)) return error('حالة المهمة غير صالحة');
    if (body.priority && !['low', 'medium', 'high', 'critical'].includes(body.priority)) return error('أولوية المهمة غير صالحة');
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200)) return error('اسم المهمة غير صالح');
    for (const field of ['estimated_hours', 'actual_hours']) if (body[field] !== undefined && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) return error('عدد الساعات غير صالح');
    if (body.parent_task_id) {
      if (body.parent_task_id === taskId) return error('لا يمكن أن تكون المهمة أمّاً لنفسها');
      const { data: parent } = await s.from('project_tasks').select('id')
        .eq('id', body.parent_task_id).eq('project_id', (existing as any).project_id).eq('company_id', auth.companyId).maybeSingle();
      if (!parent) return error('المهمة الأم غير موجودة', 404);
    }
    if (body.assigned_to) {
      const { data: assignee } = await s.from('users').select('id')
        .eq('id', body.assigned_to).eq('company_id', auth.companyId).eq('is_active', true).maybeSingle();
      if (!assignee) return error('المستخدم المسند إليه غير موجود', 404);
    }
    const allowedFields = ['name', 'description', 'start_date', 'end_date', 'progress',
      'status', 'priority', 'parent_task_id', 'assigned_to', 'estimated_hours', 'actual_hours'];

    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    // Auto-update status based on progress
    if (body.progress !== undefined) {
      if (body.progress >= 100) updateData.status = 'completed';
      else if (body.progress > 0) updateData.status = 'in_progress';
    }

    updateData.updated_at = new Date().toISOString();

    const { data, error: updateErr } = await s.from('project_tasks')
      .update(updateData)
      .eq('id', taskId)
      .eq('company_id', auth.companyId)
      .select()
      .single();

    if (updateErr) throw updateErr;
    return success(data);
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/gantt — Delete a task
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireModulePermission(request, 'gantt', 'delete');
    const s = sb();
    const url = new URL(request.url);
    const taskId = url.searchParams.get('task_id');

    if (!taskId) return error('task_id مطلوب');

    const { data: task } = await s.from('project_tasks').select('id, progress')
      .eq('id', taskId).eq('company_id', auth.companyId).maybeSingle();
    if (!task) return notFound();
    if (Number((task as any).progress) > 0) return error('لا يمكن حذف مهمة بدأ تنفيذها؛ حدّث حالتها بدلاً من ذلك', 409);

    const { data: startedChildren } = await s.from('project_tasks').select('id')
      .eq('parent_task_id', taskId).eq('company_id', auth.companyId).gt('progress', 0).limit(1);
    if (startedChildren?.length) return error('لا يمكن حذف مهمة لها مهام فرعية بدأ تنفيذها', 409);
    await s.from('project_tasks').delete().eq('parent_task_id', taskId).eq('company_id', auth.companyId);
    const { error: deleteError } = await s.from('project_tasks').delete().eq('id', taskId).eq('company_id', auth.companyId);
    if (deleteError) throw deleteError;

    return success({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
