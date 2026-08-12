'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatCurrency } from '@/lib/utils';

export default function WipReportPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/reports/wip').then((r) => r.json()).then((d) => {
      if (d.success) { setRows(d.data.rows || []); setTotals(d.data.totals); }
      else setError(d.message || 'فشل');
    }).catch(() => setError('خطأ في الاتصال')).finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'project_name', label: 'المشروع' },
    { key: 'client_name', label: 'العميل' },
    { key: 'contract_amount', label: 'قيمة العقد', render: (r: any) => formatCurrency(r.contract_amount) },
    { key: 'costs_incurred', label: 'التكاليف', render: (r: any) => formatCurrency(r.costs_incurred) },
    { key: 'billed_to_date', label: 'المفوتر', render: (r: any) => formatCurrency(r.billed_to_date) },
    { key: 'percentComplete', label: 'الإنجاز %', render: (r: any) => `${(r.percentComplete * 100).toFixed(1)}%` },
    { key: 'earnedRevenue', label: 'الإيراد المستحق', render: (r: any) => formatCurrency(r.earnedRevenue) },
    { key: 'overUnderBilled', label: 'زيادة/نقص الفوترة', render: (r: any) => {
      const v = r.overUnderBilled;
      return <span className={v >= 0 ? 'text-success font-bold' : 'text-danger font-bold'}>{formatCurrency(v)}</span>;
    } },
    { key: 'status', label: 'الحالة', render: (r: any) => {
      const map: Record<string, any> = {
        'under-billed': { v: 'info', l: 'نقص فوترة' },
        'over-billed': { v: 'danger', l: 'زيادة فوترة' },
        'on-track': { v: 'success', l: 'متوازن' },
      };
      const m = map[r.status] || { v: 'default', l: r.status };
      return <Badge variant={m.v}>{m.l}</Badge>;
    } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="العمل تحت التنفيذ (WIP)" description="نسبة الإنجاز، الإيراد المستحق، وزيادة/نقص الفوترة لكل مشروع" />
      {loading ? <LoadingSkeleton variant="table" count={8} /> : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      ) : (
        <>
          {totals && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="card p-4"><p className="text-sm text-text-muted">إجمالي العقود</p><p className="text-xl font-bold">{formatCurrency(totals.contract)}</p></div>
              <div className="card p-4"><p className="text-sm text-text-muted">إجمالي التكاليف</p><p className="text-xl font-bold">{formatCurrency(totals.costs)}</p></div>
              <div className="card p-4"><p className="text-sm text-text-muted">إجمالي المفوتر</p><p className="text-xl font-bold">{formatCurrency(totals.billed)}</p></div>
              <div className="card p-4"><p className="text-sm text-text-muted">صافي الزيادة/النقص</p><p className="text-xl font-bold text-accent">{formatCurrency(totals.overUnderBilled)}</p></div>
            </div>
          )}
          <DataTable columns={columns} data={rows} pageSize={20} />
        </>
      )}
    </div>
  );
}
