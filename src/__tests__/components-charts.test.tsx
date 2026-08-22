/**
 * UI component tests for AnalyticsDashboard and GanttChart.
 * Run via jest -c jest.ui.config.js (jsdom + RTL).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalyticsDashboard from '@/components/charts/AnalyticsDashboard';
import { GanttChart } from '@/components/gantt/GanttChart';

const fetchMock = jest.fn();
global.fetch = fetchMock as any;

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
});
