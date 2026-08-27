'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, GanttChartSquare, Link2, Trash2, ZoomIn, ZoomOut, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { GanttChart } from '@/components/gantt/GanttChart';
import {
  type GanttResponse, type GanttTask, type GanttDependency,
  statusMeta, priorityMeta,
} from '@/lib/gantt-types';

interface ProjectOption { id: string; name: string; }
interface TaskForm {
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  progress: number;
  status: string;
  priority: string;
}

const emptyTask: TaskForm = {
  name: '', description: '', start_date: '', end_date: '',
  progress: 0, status: 'not_started', priority: 'medium',
};

const zoomLevels = [8, 12, 18, 26, 36];

export default function GanttPage() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<GanttResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(2);

  const [taskModal, setTaskModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(emptyTask);
  const [saving, setSaving] = useState(false);

  const [depModal, setDepModal] = useState(false);
  const [depForm, setDepForm] = useState({ successor_task_id: '', predecessor_task_id: '', lag_days: 0 });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/projects?pageSize=200');
        const json = await response.json();
        if (json.success) {
          const rows = json.data.rows || [];
          setProjects(rows);
          if (rows.length > 0) setProjectId(rows[0].id);
        } else setError(json.message || 'فشل تحميل المشاريع');
      } catch { setError('فشل تحميل المشاريع'); }
      finally { setLoading(false); }
    })();
  }, []);

  const fetchGantt = useCallback(async (id: string) => {
    if (!id) { setData(null); return; }
    try {
      setChartLoading(true); setError('');
      const response = await fetch(`/api/gantt?project_id=${id}`);
      const json = await response.json();
      if (json.success) setData(json.data);
      else { setData(null); setError(json.message || 'فشل تحميل المخطط'); }
    } catch { setError('فشل تحميل المخطط'); }
    finally { setChartLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch pattern
  useEffect(() => { fetchGantt(projectId); }, [projectId, fetchGantt]);

  const tasks = useMemo(() => data?.tasks || [], [data]);
  const dependencies = useMemo(() => data?.dependencies || [], [data]);
  const summary = data?.summary;

  // Sorting by the CPM early start (not the typed date) makes the dependency
  // arrows read top-to-bottom in execution order.
  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => {
      const byEarly = (a.earliest_start ?? 0) - (b.earliest_start ?? 0);
      return byEarly !== 0 ? byEarly : Date.parse(a.start_date) - Date.parse(b.start_date);
    }),
    [tasks],
  );

  const selectedTask = orderedTasks.find((task) => task.id === selectedTaskId) || null;

  const taskOptions = orderedTasks.map((task) => ({ value: task.id, label: task.name }));

  const openNewTask = () => {
    setEditingId(null);
    const today = new Date().toISOString().split('T')[0];
    setForm({ ...emptyTask, start_date: today, end_date: today });
    setTaskModal(true);
  };

  const openEditTask = (task: GanttTask) => {
    setEditingId(task.id);
    setForm({
      name: task.name, description: task.description || '',
      start_date: task.start_date, end_date: task.end_date,
      progress: Number(task.progress_percent) || 0,
      status: task.status, priority: task.priority,
    });
    setTaskModal(true);
  };

  const saveTask = async () => {
    if (!form.name.trim()) { toast.error('اسم المهمة مطلوب'); return; }
    if (!form.start_date || !form.end_date) { toast.error('تاريخا البداية والنهاية مطلوبان'); return; }
    if (form.start_date > form.end_date) { toast.error('تاريخ نهاية المهمة يسبق بدايتها'); return; }
    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description?.trim() || null,
        start_date: form.start_date, end_date: form.end_date,
        progress: Number(form.progress) || 0,
        status: form.status, priority: form.priority,
      };
      const url = editingId ? `/api/gantt?task_id=${editingId}` : '/api/gantt';
      if (!editingId) payload.project_id = projectId;
      const response = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!json.success) { toast.error(json.message || 'فشل الحفظ'); return; }
      toast.success(editingId ? 'تم تحديث المهمة' : 'تمت إضافة المهمة');
      setTaskModal(false);
      await fetchGantt(projectId);
    } catch { toast.error('فشل الحفظ'); }
    finally { setSaving(false); }
  };

  const deleteTask = async (task: GanttTask) => {
    if (!confirm(`حذف المهمة "${task.name}"؟`)) return;
    try {
      const response = await fetch(`/api/gantt?task_id=${task.id}`, { method: 'DELETE' });
      const json = await response.json();
      // The server refuses to delete a task that has already started; that is a
      // business rule, so surface its message rather than a generic failure.
      if (!json.success) { toast.error(json.message || 'تعذر حذف المهمة'); return; }
      toast.success('تم حذف المهمة');
      if (selectedTaskId === task.id) setSelectedTaskId(null);
      await fetchGantt(projectId);
    } catch { toast.error('تعذر حذف المهمة'); }
  };

  const saveDependency = async () => {
    if (!depForm.successor_task_id || !depForm.predecessor_task_id) {
      toast.error('اختر المهمة السابقة واللاحقة'); return;
    }
    if (depForm.successor_task_id === depForm.predecessor_task_id) {
      toast.error('لا يمكن ربط المهمة بنفسها'); return;
    }
    try {
      setSaving(true);
      const response = await fetch('/api/gantt/dependencies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          successor_task_id: depForm.successor_task_id,
          predecessor_task_id: depForm.predecessor_task_id,
          lag_days: Number(depForm.lag_days) || 0,
        }),
      });
      const json = await response.json();
      // A cycle or duplicate edge comes back as a 409 with an Arabic message
      // from the database guard — show it verbatim.
      if (!json.success) { toast.error(json.message || 'تعذر إضافة الاعتمادية'); return; }
      toast.success('تمت إضافة الاعتمادية');
      setDepModal(false);
      setDepForm({ successor_task_id: '', predecessor_task_id: '', lag_days: 0 });
      await fetchGantt(projectId);
    } catch { toast.error('تعذر إضافة الاعتمادية'); }
    finally { setSaving(false); }
  };

  const deleteDependency = async (dependency: GanttDependency) => {
    try {
      const response = await fetch(`/api/gantt/dependencies?dependency_id=${dependency.id}`, { method: 'DELETE' });
      const json = await response.json();
      if (!json.success) { toast.error(json.message || 'تعذر حذف الاعتمادية'); return; }
      toast.success('تم حذف الاعتمادية');
      await fetchGantt(projectId);
    } catch { toast.error('تعذر حذف الاعتمادية'); }
  };

  const taskName = (id: string) => tasks.find((task) => task.id === id)?.name || '—';

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="المخطط الزمني"
        description="جدولة المهام والمسار الحرج والاعتماديات"
        icon={GanttChartSquare}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Link2 className="w-4 h-4" />}
              onClick={() => setDepModal(true)} disabled={!projectId || tasks.length < 2}>
              اعتمادية
            </Button>
            <Button leftIcon={<Plus className="w-4 h-4" />} onClick={openNewTask} disabled={!projectId}>
              مهمة جديدة
            </Button>
          </>
        }
      />

      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Select
              label="المشروع"
              searchable
              value={projectId}
              onChange={(value) => { setProjectId(value); setSelectedTaskId(null); }}
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              placeholder="اختر المشروع"
            />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(z - 1, 0))}
              disabled={zoom === 0} aria-label="تصغير">
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(z + 1, zoomLevels.length - 1))}
              disabled={zoom === zoomLevels.length - 1} aria-label="تكبير">
              <ZoomIn className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="p-3 rounded-lg bg-danger-light text-danger text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Card padding="sm"><div className="text-xs text-text-muted mb-1">إجمالي المهام</div>
            <div className="text-xl font-semibold">{summary.totalTasks}</div></Card>
          <Card padding="sm"><div className="text-xs text-text-muted mb-1">مكتملة</div>
            <div className="text-xl font-semibold text-success">{summary.completed}</div></Card>
          <Card padding="sm"><div className="text-xs text-text-muted mb-1">قيد التنفيذ</div>
            <div className="text-xl font-semibold text-info">{summary.inProgress}</div></Card>
          <Card padding="sm"><div className="text-xs text-text-muted mb-1">متأخرة</div>
            <div className="text-xl font-semibold text-danger">{summary.overdue}</div></Card>
          <Card padding="sm"><div className="text-xs text-text-muted mb-1">مهام حرجة</div>
            <div className="text-xl font-semibold text-danger">{summary.criticalTasks}</div></Card>
          <Card padding="sm">
            <div className="text-xs text-text-muted mb-1">مدة المسار الحرج</div>
            <div className="text-xl font-semibold">{summary.criticalPathDays} يوم</div>
            {/* The network can imply a longer schedule than the typed dates. */}
            {summary.criticalPathDays > summary.totalDays && (
              <div className="text-[11px] text-warning mt-1">تتجاوز المدة المخططة ({summary.totalDays} يوم)</div>
            )}
          </Card>
        </div>
      )}

      {chartLoading ? (
        <LoadingSkeleton />
      ) : !projectId ? (
        <EmptyState title="لا يوجد مشروع" description="أضف مشروعاً أولاً لعرض مخططه الزمني" />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="لا توجد مهام"
          description="ابدأ بإضافة مهام المشروع لبناء المخطط الزمني والمسار الحرج"
          actionLabel="مهمة جديدة"
          onAction={openNewTask}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)' }} />
              مهمة حرجة (بدون فائض)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-info-light)', border: '1px solid var(--color-info)' }} />
              مهمة عادية
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-2 rounded-sm border border-dashed border-text-muted/60" />
              الفائض الزمني
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-px bg-danger" style={{ borderTop: '1px dashed var(--color-danger)' }} />
              اعتمادية مخالفة للتواريخ
            </span>
          </div>

          <GanttChart
            tasks={orderedTasks}
            dependencies={dependencies}
            projectStart={summary!.projectStart}
            totalDays={summary!.totalDays}
            dayWidth={zoomLevels[zoom]}
            onSelectTask={(task) => setSelectedTaskId(task.id === selectedTaskId ? null : task.id)}
            selectedTaskId={selectedTaskId}
          />

          {selectedTask && (
            <Card>
              <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    {selectedTask.name}
                    {selectedTask.isCritical && <Badge variant="danger">على المسار الحرج</Badge>}
                  </h3>
                  {selectedTask.description && (
                    <p className="text-sm text-text-muted mt-1">{selectedTask.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openEditTask(selectedTask)}>تعديل</Button>
                  <Button variant="danger" size="sm" onClick={() => deleteTask(selectedTask)}>حذف</Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <Field label="الحالة">
                  <Badge variant={statusMeta[selectedTask.status]?.variant || 'default'}>
                    {statusMeta[selectedTask.status]?.label || selectedTask.status}
                  </Badge>
                </Field>
                <Field label="الأولوية">
                  <Badge variant={priorityMeta[selectedTask.priority]?.variant || 'default'}>
                    {priorityMeta[selectedTask.priority]?.label || selectedTask.priority}
                  </Badge>
                </Field>
                <Field label="الإنجاز">{selectedTask.progress_percent}%</Field>
                <Field label="المدة">{selectedTask.duration_days} يوم</Field>
              </div>

              {/* CPM outputs: computed in the database, previously not shown anywhere. */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-xs font-medium text-text-muted mb-3">
                  تحليل المسار الحرج (بالأيام من بداية المشروع)
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <Field label="أبكر بداية">{fmt(selectedTask.earliest_start)}</Field>
                  <Field label="أبكر نهاية">{fmt(selectedTask.earliest_finish)}</Field>
                  <Field label="أقصى بداية">{fmt(selectedTask.latest_start)}</Field>
                  <Field label="أقصى نهاية">{fmt(selectedTask.latest_finish)}</Field>
                  <Field label="الفائض الزمني">
                    <span className={Number(selectedTask.total_float) === 0 ? 'text-danger font-semibold' : ''}>
                      {fmt(selectedTask.total_float)} يوم
                    </span>
                  </Field>
                </div>
                <p className="text-xs text-text-muted mt-3">
                  {Number(selectedTask.total_float) === 0
                    ? 'أي تأخير في هذه المهمة يؤخر المشروع بالكامل.'
                    : `يمكن تأخير هذه المهمة حتى ${selectedTask.total_float} يوم دون التأثير على موعد انتهاء المشروع.`}
                </p>
              </div>
            </Card>
          )}

          <Card title="الاعتماديات">
            {dependencies.length === 0 ? (
              <p className="text-sm text-text-muted">لا توجد اعتماديات. اربط المهام لحساب مسار حرج دقيق.</p>
            ) : (
              <div className="space-y-2">
                {dependencies.map((dependency) => (
                  <div key={dependency.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-bg-elevated text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="truncate">{taskName(dependency.predecessor_task_id)}</span>
                      <span className="text-text-muted shrink-0">←</span>
                      <span className="truncate">{taskName(dependency.successor_task_id)}</span>
                      {dependency.lag_days !== 0 && (
                        <Badge variant={dependency.lag_days > 0 ? 'warning' : 'info'}>
                          {dependency.lag_days > 0
                            ? `فارق ${dependency.lag_days} يوم`
                            : `تداخل ${Math.abs(dependency.lag_days)} يوم`}
                        </Badge>
                      )}
                    </div>
                    <button
                      onClick={() => deleteDependency(dependency)}
                      className="text-text-muted hover:text-danger transition-colors shrink-0"
                      aria-label="حذف الاعتمادية"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <Modal isOpen={taskModal} onClose={() => setTaskModal(false)}
        title={editingId ? 'تعديل مهمة' : 'مهمة جديدة'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTaskModal(false)}>إلغاء</Button>
            <Button onClick={saveTask} loading={saving}>حفظ</Button>
          </>
        }>
        <div className="space-y-4">
          <Input label="اسم المهمة" value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Textarea label="الوصف" rows={2} value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="تاريخ البداية" type="date" value={form.start_date}
              onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
            <Input label="تاريخ النهاية" type="date" value={form.end_date}
              onChange={(event) => setForm({ ...form, end_date: event.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="الحالة" value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              options={Object.entries(statusMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
            <Select label="الأولوية" value={form.priority}
              onChange={(value) => setForm({ ...form, priority: value })}
              options={Object.entries(priorityMeta).map(([value, meta]) => ({ value, label: meta.label }))} />
          </div>
          <Input label="نسبة الإنجاز %" type="number" min={0} max={100} value={form.progress}
            onChange={(event) => setForm({ ...form, progress: Number(event.target.value) || 0 })} />
        </div>
      </Modal>

      <Modal isOpen={depModal} onClose={() => setDepModal(false)} title="اعتمادية جديدة"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDepModal(false)}>إلغاء</Button>
            <Button onClick={saveDependency} loading={saving}>حفظ</Button>
          </>
        }>
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            علاقة «إنهاء ← بدء»: لا تبدأ المهمة اللاحقة إلا بعد انتهاء المهمة السابقة.
          </p>
          <Select label="المهمة السابقة" searchable value={depForm.predecessor_task_id}
            onChange={(value) => setDepForm({ ...depForm, predecessor_task_id: value })}
            options={taskOptions} placeholder="اختر المهمة" />
          <Select label="المهمة اللاحقة" searchable value={depForm.successor_task_id}
            onChange={(value) => setDepForm({ ...depForm, successor_task_id: value })}
            options={taskOptions.filter((option) => option.value !== depForm.predecessor_task_id)}
            placeholder="اختر المهمة" />
          <Input label="فارق الأيام" type="number" value={depForm.lag_days}
            helperText="قيمة موجبة = فترة انتظار، سالبة = تداخل بين المهمتين"
            onChange={(event) => setDepForm({ ...depForm, lag_days: Number(event.target.value) })} />
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function fmt(value: number | null): string {
  return value === null || value === undefined ? '—' : String(value);
}
