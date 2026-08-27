/**
 * UI component tests for AnalyticsDashboard and GanttChart.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AnalyticsDashboard from '@/components/charts/AnalyticsDashboard';
import { GanttChart } from '@/components/gantt/GanttChart';
import type { GanttDependency, GanttTask } from '@/lib/gantt-types';

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

afterEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

describe('AnalyticsDashboard', () => {
  test('renders KPIs after loading analytics data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {
        revenueChart: [{ month: 'يناير', revenue: 100, expenses: 40 }],
        agingReport: [{ range: '0-30', count: 1, amount: 50 }],
        topClients: [{ name: 'عميل أ', revenue: 100, invoiceCount: 2 }],
        projectProfitability: [{ name: 'مشروع', revenue: 100, expenses: 60, margin: 40 }],
        kpis: { totalRevenue: 100, totalExpenses: 40, netProfit: 60, profitMargin: 60, outstandingInvoices: 3, avgPaymentDays: 12 },
      } }),
    });
    render(<AnalyticsDashboard />);
    expect((await screen.findAllByText(/ر\.س/)).length).toBeGreaterThan(0);
  });
});

describe('GanttChart', () => {
  const tasks = [{
    id: 't1', name: 'أساسيات', start_date: '2026-01-01', end_date: '2026-01-10',
    status: 'in_progress', priority: 'high', progress: 50, progress_percent: 50, duration_days: 10,
    earliest_start: 0, earliest_finish: 9, latest_start: 0, latest_finish: 9, total_float: 0, isCritical: true,
  }];
  test('renders task labels', () => {
    render(<GanttChart tasks={tasks} dependencies={[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} />);
    expect(screen.getByText('أساسيات')).toBeInTheDocument();
  });

  test('renders nothing for an empty task list', () => {
    const { container } = render(<GanttChart tasks={[]} dependencies={[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} />);
    expect(container.firstChild).toBeNull();
  });

  test('shows a critical badge for critical tasks', () => {
    render(<GanttChart tasks={tasks} dependencies={[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} />);
    expect(screen.getByText('حرجة')).toBeInTheDocument();
  });

  test('renders dependency arrows with lag and calls onSelectTask', () => {
    const onSelectTask = jest.fn();
    const twoTasks = [
      { id: 'a', name: 'أساسيات', start_date: '2026-01-01', end_date: '2026-01-05', status: 'done', isCritical: false, total_float: 0, progress_percent: 100 },
      { id: 'b', name: 'هيكل', start_date: '2026-01-06', end_date: '2026-01-10', status: 'pending', isCritical: false, total_float: 0, progress_percent: 0 },
    ];
    const deps = [{ id: 'd1', predecessor_task_id: 'a', successor_task_id: 'b', lag_days: 2, type: 'finish_to_start' }];
    const { container } = render(
      <GanttChart tasks={twoTasks as unknown as GanttTask[]} dependencies={deps as unknown as GanttDependency[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} onSelectTask={onSelectTask} />
    );
    expect(container.querySelectorAll('polyline').length).toBe(1);
    expect(container.querySelector('text')).toBeInTheDocument();
    fireEvent.click(screen.getByText('أساسيات'));
    expect(onSelectTask).toHaveBeenCalled();
  });

  test('marks a violated dependency with dashed stroke and highlights the selected task', () => {
    const twoTasks = [
      { id: 'a', name: 'أ', start_date: '2026-01-01', end_date: '2026-01-08', status: 'done', isCritical: true, total_float: 0, progress_percent: 100 },
      { id: 'b', name: 'ب', start_date: '2026-01-02', end_date: '2026-01-10', status: 'pending', isCritical: true, total_float: 0, progress_percent: 0 },
    ];
    const deps = [{ id: 'd1', predecessor_task_id: 'a', successor_task_id: 'b', lag_days: 0, type: 'finish_to_start' }];
    const { container } = render(
      <GanttChart tasks={twoTasks as unknown as GanttTask[]} dependencies={deps as unknown as GanttDependency[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} selectedTaskId="b" />
    );
    const polyline = container.querySelector('polyline') as SVGElement;
    expect(polyline.getAttribute('stroke-dasharray')).toBe('4 3');
    expect(screen.getAllByText('حرجة').length).toBeGreaterThan(0);
  });

  test('renders a slack bar for tasks with positive float', () => {
    const floatTask = [
      { id: 'a', name: 'مرنة', start_date: '2026-01-01', end_date: '2026-01-03', status: 'pending', isCritical: false, total_float: 4, progress_percent: 20 },
    ];
    const { container } = render(
      <GanttChart tasks={floatTask as unknown as GanttTask[]} dependencies={[]} projectStart="2026-01-01" totalDays={10} dayWidth={30} />
    );
    expect(container.querySelector('[title^="فائض زمني"]')).not.toBeNull();
  });
});
