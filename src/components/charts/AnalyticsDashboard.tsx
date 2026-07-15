'use client';

import { useState, useEffect } from 'react';

interface AnalyticsData {
  revenueChart: Array<{ month: string; revenue: number; expenses: number }>;
  agingReport: Array<{ range: string; count: number; amount: number }>;
  topClients: Array<{ name: string; revenue: number; invoiceCount: number }>;
  projectProfitability: Array<{ name: string; budget: number; actual: number; margin: number }>;
  kpis: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    profitMargin: number;
    outstandingInvoices: number;
    avgPaymentDays: number;
  };
}

// Simple SVG-based chart components (no external dependency)
function BarChart({ data, height = 200 }: { data: Array<{ label: string; value: number; color?: string }>; height?: number }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barWidth = Math.floor(100 / data.length);

  return (
    <div className="w-full" style={{ height }}>
      <svg viewBox={`0 0 ${data.length * 60} ${height + 40}`} className="w-full h-full" preserveAspectRatio="none">
        {data.map((d, i) => {
          const barH = (d.value / max) * height;
          return (
            <g key={i}>
              <rect
                x={i * 60 + 10}
                y={height - barH}
                width={40}
                height={barH}
                fill={d.color || '#2563eb'}
                rx={4}
              />
              <text x={i * 60 + 30} y={height + 16} textAnchor="middle" fontSize="10" fill="#6b7280">
                {d.label}
              </text>
              <text x={i * 60 + 30} y={height - barH - 4} textAnchor="middle" fontSize="9" fill="#374151" fontWeight="bold">
                {d.value >= 1000 ? `${(d.value / 1000).toFixed(0)}k` : d.value.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function DonutChart({ segments, size = 120 }: { segments: Array<{ value: number; color: string; label: string }>; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  let cumulativePercent = 0;

  function getCoordinatesForPercent(percent: number) {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  }

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="-1 -1 2 2" style={{ transform: 'rotate(-90deg)' }}>
        {segments.map((seg, i) => {
          const percent = seg.value / total;
          const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
          cumulativePercent += percent;
          const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
          const largeArcFlag = percent > 0.5 ? 1 : 0;
          const pathData = `M ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} L 0 0`;
          return <path key={i} d={pathData} fill={seg.color} />;
        })}
        <circle r={0.6} fill="white" />
      </svg>
      <div className="space-y-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="text-gray-600">{seg.label}</span>
            <span className="font-medium">{seg.value.toFixed(0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SparkLine({ data, color = '#2563eb', height = 40 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 200;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="w-full" style={{ height }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const token = document.cookie.replace(/(?:(?:^|.*;\s*)token\s*=\s*([^;]*).*$)|^.*$/, '$1');
      const res = await fetch('/api/reports/analytics', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (result.success) setData(result.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!data) return <div className="p-6 text-center text-gray-500">لا توجد بيانات تحليلية</div>;

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">التحليلات المتقدمة</h1>
          <p className="text-gray-500 text-sm">نظرة شاملة على أداء الشركة المالي</p>
        </div>
        <button onClick={fetchAnalytics} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-sm font-medium">
          تحديث
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'الإيرادات', value: data.kpis.totalRevenue, format: 'currency', color: 'text-blue-600' },
          { label: 'المصروفات', value: data.kpis.totalExpenses, format: 'currency', color: 'text-red-600' },
          { label: 'صافي الربح', value: data.kpis.netProfit, format: 'currency', color: data.kpis.netProfit >= 0 ? 'text-green-600' : 'text-red-600' },
          { label: 'هامش الربح', value: data.kpis.profitMargin, format: 'percent', color: 'text-purple-600' },
          { label: 'فواتير مستحقة', value: data.kpis.outstandingInvoices, format: 'currency', color: 'text-orange-600' },
          { label: 'متوسط أيام السداد', value: data.kpis.avgPaymentDays, format: 'days', color: 'text-slate-600' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
            <p className={`text-xl font-bold ${kpi.color}`}>
              {kpi.format === 'currency' && `${kpi.value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ر.س`}
              {kpi.format === 'percent' && `${kpi.value.toFixed(1)}%`}
              {kpi.format === 'days' && `${kpi.value} يوم`}
            </p>
          </div>
        ))}
      </div>

      {/* Revenue vs Expenses Chart */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-4">الإيرادات مقابل المصروفات (شهرياً)</h3>
        {data.revenueChart.length > 0 ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 mb-2">الإيرادات</p>
              <BarChart data={data.revenueChart.map(d => ({ label: d.month, value: d.revenue, color: '#2563eb' }))} />
            </div>
            <div>
              <p className="text-sm text-gray-500 mb-2">المصروفات</p>
              <BarChart data={data.revenueChart.map(d => ({ label: d.month, value: d.expenses, color: '#ef4444' }))} />
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">لا توجد بيانات كافية</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Aging Report */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4">تقرير أعمار الذمم</h3>
          {data.agingReport.length > 0 ? (
            <DonutChart
              segments={data.agingReport.map((a, i) => ({
                value: a.amount,
                color: ['#22c55e', '#f59e0b', '#ef4444', '#7c3aed'][i] || '#6b7280',
                label: a.range,
              }))}
            />
          ) : (
            <p className="text-gray-400 text-center py-8">لا توجد ذمم مستحقة</p>
          )}
        </div>

        {/* Top Clients */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4">أكبر 5 عملاء بالإيرادات</h3>
          {data.topClients.length > 0 ? (
            <div className="space-y-3">
              {data.topClients.map((client, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <span className="text-sm font-medium">{client.name}</span>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold">{client.revenue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ر.س</p>
                    <p className="text-xs text-gray-400">{client.invoiceCount} فاتورة</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">لا توجد بيانات عملاء</p>
          )}
        </div>
      </div>

      {/* Project Profitability */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-gray-900 mb-4">ربحية المشاريع</h3>
        {data.projectProfitability.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-right p-3 text-sm font-medium text-gray-600">المشروع</th>
                  <th className="text-center p-3 text-sm font-medium text-gray-600">الميزانية</th>
                  <th className="text-center p-3 text-sm font-medium text-gray-600">الفعلي</th>
                  <th className="text-center p-3 text-sm font-medium text-gray-600">الهامش</th>
                  <th className="text-left p-3 text-sm font-medium text-gray-600">الأداء</th>
                </tr>
              </thead>
              <tbody>
                {data.projectProfitability.map((p, i) => (
                  <tr key={i} className="border-b">
                    <td className="p-3 font-medium text-sm">{p.name}</td>
                    <td className="p-3 text-center text-sm">{p.budget.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                    <td className="p-3 text-center text-sm">{p.actual.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</td>
                    <td className="p-3 text-center">
                      <span className={`text-sm font-bold ${p.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {p.margin.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${p.margin >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.min(100, Math.abs(p.margin))}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">لا توجد مشاريع</p>
        )}
      </div>
    </div>
  );
}
