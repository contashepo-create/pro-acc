'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate } from '@/lib/utils';

const actionMeta: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'; label: string }> = {
  create: { variant: 'success', label: 'إنشاء' },
  update: { variant: 'warning', label: 'تعديل' },
  delete: { variant: 'danger', label: 'حذف' },
  approve: { variant: 'info', label: 'اعتماد' },
  reject: { variant: 'danger', label: 'رفض' },
};

interface AuditRow {
  created_at: string;
  user_id?: string;
  users?: { name?: string };
  entity_type?: string;
  entity_id?: string;
  action?: string;
  summary?: string;
}

export default function FinancialAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/financial-audit').then((r) => r.json()).then((d) => {
      if (d.success) setRows(d.data.rows || []);
      else setError(d.message || 'فشل');
    }).catch(() => setError('خطأ في الاتصال')).finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'created_at', label: 'الوقت', render: (r: AuditRow) => formatDate(r.created_at) },
    { key: 'users', label: 'المستخدم', render: (r: AuditRow) => r.users?.name || r.user_id || '—' },
    { key: 'entity_type', label: 'الكيان', render: (r: AuditRow) => <span className="font-mono text-xs">{r.entity_type}</span> },
    { key: 'entity_id', label: 'المعرّف', render: (r: AuditRow) => <span className="font-mono text-xs">{r.entity_id}</span> },
    { key: 'action', label: 'الإجراء', render: (r: AuditRow) => { const m = actionMeta[r.action ?? ''] || { variant: 'default', label: r.action ?? '' }; return <Badge variant={m.variant}>{m.label}</Badge>; } },
    { key: 'summary', label: 'الملخص', render: (r: AuditRow) => <span className="text-xs">{r.summary || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="سجل تدقيق المعاملات المالية" description="من غيّر ماذا ومتى — لكل عملية مالية (Audit Trail)" icon={ShieldCheck} />
      {loading ? <LoadingSkeleton variant="table" count={8} /> : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      ) : (
        <DataTable columns={columns} data={rows} searchable searchKeys={['entity_type', 'entity_id', 'summary']} pageSize={20} />
      )}
    </div>
  );
}
