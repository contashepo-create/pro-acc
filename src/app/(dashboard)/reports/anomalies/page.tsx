'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/utils';

const sevMeta: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'; label: string }> = {
  low: { variant: 'info', label: 'منخفضة' },
  medium: { variant: 'warning', label: 'متوسطة' },
  high: { variant: 'danger', label: 'عالية' },
  critical: { variant: 'danger', label: 'حرجة' },
};

export default function AnomaliesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/reports/anomalies').then((r) => r.json()).then((d) => {
      if (d.success) setData(d.data);
      else setError(d.message || 'فشل');
    }).catch(() => setError('خطأ في الاتصال')).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSkeleton variant="card" count={3} />;
  if (error) return <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>;

  const findings = data?.findings || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="كشف الشذوذ"
        description="تنبيهات تلقائية على الأنماط المشبوهة في البيانات المالية"
        icon={ShieldAlert}
        actions={findings.length > 0 ? (
          <div className="flex gap-2">
            <Badge variant="danger">{data.high + data.critical} عالية</Badge>
            <Badge variant="warning">{findings.length} إجمالي</Badge>
          </div>
        ) : <Badge variant="success">لا توجد شذوذات</Badge>}
      />

      {findings.length === 0 ? (
        <div className="card p-10 text-center text-text-muted">
          <ShieldAlert size={48} className="mx-auto mb-4 text-success" />
          <p>لا توجد أنماط مشبوهة في البيانات الحالية.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...findings].sort((a, b) => (b.score || 0) - (a.score || 0)).map((f: any, i: number) => {
            const m = sevMeta[f.severity] || sevMeta.low;
            return (
              <div key={i} className="card p-4 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${f.severity === 'high' || f.severity === 'critical' ? 'bg-danger-light' : 'bg-warning-light'}`}>
                  <AlertTriangle size={18} className={f.severity === 'high' || f.severity === 'critical' ? 'text-danger' : 'text-warning'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-text-muted">{f.code}</span>
                    <Badge variant={m.variant}>{m.label}</Badge>
                    {f.refId && <span className="text-xs text-text-muted font-mono">{f.refId}</span>}
                  </div>
                  <p className="text-sm mt-1">{f.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-xs text-text-muted">المبلغ المعروض كمرجع: {formatCurrency(findings.reduce((s: number, f: any) => s + (f.score || 0), 0))}</div>
    </div>
  );
}
