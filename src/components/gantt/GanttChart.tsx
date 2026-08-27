'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { GanttDependency, GanttTask } from '@/lib/gantt-types';
import { dayIndex, statusMeta } from '@/lib/gantt-types';

const ROW_HEIGHT = 40;
const LABEL_WIDTH = 260;

interface GanttChartProps {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  projectStart: string;
  totalDays: number;
  dayWidth: number;
  onSelectTask?: (task: GanttTask) => void;
  selectedTaskId?: string | null;
}

/**
 * Time runs left-to-right even though the application is RTL.
 *
 * Arabic project-planning tools keep the chronological axis western-ordered
 * because the whole visual grammar of a Gantt (dependency arrows pointing at
 * the successor, progress filling from the start) is read that way. Mirroring
 * the axis would invert every arrow and confuse the critical path, so only the
 * label column is RTL and the plotting area is explicitly LTR.
 */
export function GanttChart({
  tasks, dependencies, projectStart, totalDays, dayWidth, onSelectTask, selectedTaskId,
}: GanttChartProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [hoveredDependency, setHoveredDependency] = useState<string | null>(null);

  // One horizontal scrollbar drives both the ruler and the plotting area.
  useEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!body || !header) return;
    const sync = () => { header.scrollLeft = body.scrollLeft; };
    body.addEventListener('scroll', sync);
    return () => body.removeEventListener('scroll', sync);
  }, []);

  const chartWidth = Math.max(totalDays, 1) * dayWidth;
  const rowIndex = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index])),
    [tasks],
  );

  const days = useMemo(() => {
    const start = Date.parse(projectStart);
    return Array.from({ length: totalDays }, (_, offset) => {
      const date = new Date(start + offset * 86400000);
      return {
        offset,
        date,
        day: date.getUTCDate(),
        month: date.getUTCMonth(),
        year: date.getUTCFullYear(),
        // Friday/Saturday is the working week in most of the region.
        isWeekend: date.getUTCDay() === 5 || date.getUTCDay() === 6,
      };
    });
  }, [projectStart, totalDays]);

  const months = useMemo(() => {
    const groups: Array<{ key: string; label: string; span: number }> = [];
    for (const day of days) {
      const key = `${day.year}-${day.month}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.span += 1;
      else groups.push({
        key,
        label: new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(day.date),
        span: 1,
      });
    }
    return groups;
  }, [days]);

  const todayOffset = useMemo(() => {
    const today = new Date();
    const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const offset = Math.round((utcToday - Date.parse(projectStart)) / 86400000);
    return offset >= 0 && offset < totalDays ? offset : null;
  }, [projectStart, totalDays]);

  /**
   * Finish-to-start arrows, routed as elbows so they never run through a bar.
   * A dependency whose successor starts before its predecessor finishes (plus
   * lag) is a schedule violation, so it is drawn in the danger colour.
   */
  const arrows = useMemo(() => {
    return dependencies.flatMap((dependency) => {
      const from = tasks.find((task) => task.id === dependency.predecessor_task_id);
      const to = tasks.find((task) => task.id === dependency.successor_task_id);
      if (!from || !to) return [];
      const fromRow = rowIndex.get(from.id);
      const toRow = rowIndex.get(to.id);
      if (fromRow === undefined || toRow === undefined) return [];

      const x1 = (dayIndex(from.end_date, projectStart) + 1) * dayWidth;
      const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = dayIndex(to.start_date, projectStart) * dayWidth;
      const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      const required = dayIndex(from.end_date, projectStart) + 1 + (dependency.lag_days || 0);
      const violated = dayIndex(to.start_date, projectStart) < required;

      // Step out, run vertically in the gutter, then approach the successor.
      const gutter = x2 > x1 + 12 ? (x1 + x2) / 2 : x1 + 12;
      const points = x2 > x1 + 12
        ? `${x1},${y1} ${gutter},${y1} ${gutter},${y2} ${x2},${y2}`
        : `${x1},${y1} ${x1 + 10},${y1} ${x1 + 10},${(y1 + y2) / 2} ${x2 - 14},${(y1 + y2) / 2} ${x2 - 14},${y2} ${x2},${y2}`;

      return [{
        id: dependency.id,
        points,
        violated,
        critical: Boolean(from.isCritical && to.isCritical),
        lag: dependency.lag_days || 0,
        labelX: gutter,
        labelY: (y1 + y2) / 2,
      }];
    });
  }, [dependencies, tasks, rowIndex, projectStart, dayWidth]);

  if (tasks.length === 0) return null;

  return (
    <div className="flex border border-border rounded-lg overflow-hidden bg-bg-surface" dir="ltr">
      {/* Task names stay RTL: they are Arabic content, not part of the time axis. */}
      <div className="shrink-0 border-l border-border bg-bg-surface" style={{ width: LABEL_WIDTH }} dir="rtl">
        <div className="h-[52px] border-b border-border flex items-end px-3 pb-1.5 text-xs font-medium text-text-muted">
          المهمة
        </div>
        {tasks.map((task) => (
          <button
            key={task.id}
            onClick={() => onSelectTask?.(task)}
            className={`w-full flex items-center gap-2 px-3 text-right border-b border-border/60 transition-colors hover:bg-bg-hover ${
              selectedTaskId === task.id ? 'bg-accent/10' : ''
            }`}
            style={{ height: ROW_HEIGHT }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: task.isCritical ? 'var(--color-danger)' : statusMeta[task.status]?.color || 'var(--color-info)' }}
            />
            <span className="truncate text-sm">{task.name}</span>
            {task.isCritical && (
              <span className="mr-auto text-[10px] px-1.5 py-0.5 rounded bg-danger-light text-danger shrink-0">حرجة</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        {/* Ruler */}
        <div ref={headerRef} className="overflow-x-hidden border-b border-border">
          <div style={{ width: chartWidth }}>
            <div className="flex h-[28px]">
              {months.map((month) => (
                <div
                  key={month.key}
                  className="border-l border-border text-xs text-text-secondary flex items-center justify-center overflow-hidden whitespace-nowrap px-1"
                  style={{ width: month.span * dayWidth }}
                >
                  {month.span * dayWidth > 60 ? month.label : ''}
                </div>
              ))}
            </div>
            <div className="flex h-[24px]">
              {days.map((day) => (
                <div
                  key={day.offset}
                  className={`border-l border-border/50 text-[10px] flex items-center justify-center ${
                    day.isWeekend ? 'bg-bg-elevated text-text-muted' : 'text-text-secondary'
                  }`}
                  style={{ width: dayWidth }}
                >
                  {dayWidth >= 18 ? day.day : ''}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Plotting area */}
        <div ref={bodyRef} className="overflow-x-auto">
          <div className="relative" style={{ width: chartWidth, height: tasks.length * ROW_HEIGHT }}>
            {/* Weekend bands and day grid */}
            <div className="absolute inset-0 flex">
              {days.map((day) => (
                <div
                  key={day.offset}
                  className={`border-l border-border/40 h-full ${day.isWeekend ? 'bg-bg-elevated/60' : ''}`}
                  style={{ width: dayWidth }}
                />
              ))}
            </div>

            {todayOffset !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-accent z-20 pointer-events-none"
                style={{ left: todayOffset * dayWidth }}
                title="اليوم"
              />
            )}

            {/* Dependency arrows sit above the grid but below the bars' tooltips. */}
            <svg
              className="absolute inset-0 z-10 pointer-events-none overflow-visible"
              width={chartWidth}
              height={tasks.length * ROW_HEIGHT}
            >
              <defs>
                <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-text-muted)" />
                </marker>
                <marker id="gantt-arrow-critical" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-danger)" />
                </marker>
              </defs>
              {arrows.map((arrow) => (
                <g key={arrow.id}>
                  <polyline
                    points={arrow.points}
                    fill="none"
                    strokeWidth={arrow.critical || arrow.violated ? 1.75 : 1.25}
                    strokeDasharray={arrow.violated ? '4 3' : undefined}
                    stroke={arrow.critical || arrow.violated ? 'var(--color-danger)' : 'var(--color-text-muted)'}
                    markerEnd={`url(#gantt-arrow${arrow.critical || arrow.violated ? '-critical' : ''})`}
                    opacity={hoveredDependency && hoveredDependency !== arrow.id ? 0.25 : 0.9}
                  />
                  {arrow.lag !== 0 && (
                    <text
                      x={arrow.labelX} y={arrow.labelY - 3} textAnchor="middle"
                      className="fill-text-muted" style={{ fontSize: 9 }}
                    >
                      {arrow.lag > 0 ? `+${arrow.lag}` : arrow.lag}
                    </text>
                  )}
                </g>
              ))}
            </svg>

            {/* Bars */}
            {tasks.map((task, index) => {
              const start = dayIndex(task.start_date, projectStart);
              const span = Math.max(dayIndex(task.end_date, projectStart) - start + 1, 1);
              const float = Number(task.total_float) || 0;
              const progress = Math.min(Math.max(Number(task.progress_percent) || 0, 0), 100);
              return (
                <div
                  key={task.id}
                  className="absolute"
                  style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT, left: 0, right: 0 }}
                >
                  {/* Slack: how far the task may slip before the project does. */}
                  {float > 0 && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-2 rounded-sm border border-dashed border-text-muted/50 z-10"
                      style={{ left: (start + span) * dayWidth, width: float * dayWidth }}
                      title={`فائض زمني: ${float} يوم`}
                    />
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectTask?.(task)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectTask?.(task); }}
                    onMouseEnter={() => setHoveredDependency(null)}
                    className={`absolute top-1/2 -translate-y-1/2 h-6 rounded z-10 cursor-pointer overflow-hidden transition-shadow ${
                      selectedTaskId === task.id ? 'ring-2 ring-accent' : ''
                    }`}
                    style={{
                      left: start * dayWidth,
                      width: Math.max(span * dayWidth - 2, 6),
                      background: task.isCritical ? 'var(--color-danger-light)' : 'var(--color-info-light)',
                      border: `1px solid ${task.isCritical ? 'var(--color-danger)' : 'var(--color-info)'}`,
                    }}
                    title={`${task.name}\n${task.start_date} ← ${task.end_date}\nالإنجاز: ${progress}%\nالفائض: ${float} يوم`}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${progress}%`,
                        background: task.isCritical ? 'var(--color-danger)' : 'var(--color-info)',
                        opacity: 0.55,
                      }}
                    />
                    {span * dayWidth > 46 && (
                      <span className="absolute inset-0 flex items-center px-1.5 text-[10px] text-text-primary truncate">
                        {progress}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GanttChart;
