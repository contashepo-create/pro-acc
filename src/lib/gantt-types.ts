/**
 * Shapes returned by `GET /api/gantt` and `GET /api/gantt/dependencies`.
 *
 * The CPM fields (`earliest_*`, `latest_*`, `total_float`, `isCritical`) come
 * from the forward/backward pass in `get_project_critical_path` (migration
 * 062) and are expressed in whole days relative to the project start, not as
 * dates.
 */
export interface GanttTask {
  id: string;
  name: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  status: string;
  priority: string;
  progress?: number | null;
  progress_percent: number;
  duration_days: number;
  assigned_to?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  earliest_start: number | null;
  earliest_finish: number | null;
  latest_start: number | null;
  latest_finish: number | null;
  total_float: number | null;
  isCritical: boolean;
}

export interface GanttDependency {
  id: string;
  project_id?: string;
  successor_task_id: string;
  predecessor_task_id: string;
  lag_days: number;
  created_at?: string;
}

export interface GanttSummary {
  totalTasks: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  projectStart: string;
  projectEnd: string;
  totalDays: number;
  criticalPathDays: number;
  criticalTasks: number;
}

export interface GanttResponse {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  criticalPath: string[];
  summary: GanttSummary;
  project: { id: string; start: string; end: string; duration: number };
}

export const statusMeta: Record<string, { label: string; color: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default' }> = {
  not_started: { label: 'لم تبدأ', color: 'var(--color-text-muted)', variant: 'default' },
  in_progress: { label: 'قيد التنفيذ', color: 'var(--color-info)', variant: 'info' },
  completed: { label: 'مكتملة', color: 'var(--color-success)', variant: 'success' },
  blocked: { label: 'متوقفة', color: 'var(--color-danger)', variant: 'danger' },
  on_hold: { label: 'معلقة', color: 'var(--color-warning)', variant: 'warning' },
};

export const priorityMeta: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default' }> = {
  low: { label: 'منخفضة', variant: 'default' },
  medium: { label: 'متوسطة', variant: 'info' },
  high: { label: 'عالية', variant: 'warning' },
  critical: { label: 'حرجة', variant: 'danger' },
};

/** Whole-day offset of `date` from the project start, in UTC. */
export function dayIndex(date: string, projectStart: string): number {
  return Math.round((Date.parse(date) - Date.parse(projectStart)) / 86400000);
}
