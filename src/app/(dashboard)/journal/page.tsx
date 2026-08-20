'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { formatDocumentNumber } from '@/lib/document-number';

export default function JournalPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<any>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/journal');
      const json = await res.json();
      if (json.success) setEntries(json.data?.entries || []);
      else { setError(json.message || 'فشل'); toast.error(json.message || 'فشل تحميل القيود'); }
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDelete = async (entry: any) => {
    if (!confirm('هل تريد حذف هذا القيد؟')) return;
    try {
      const res = await apiFetch(`/api/journal/${entry.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success || res.status === 404) {
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        toast.success(json.success ? 'تم حذف القيد' : 'تم حذف القيد مسبقاً');
        await fetchData();
      } else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => formatDocumentNumber('journal', row.number) },
    { key: 'date', label: 'التاريخ', render: (r: any) => formatDate(r.date) },
    { key: 'description', label: 'البيان' },
    { key: 'total_debit', label: 'المدين', render: (r: any) => formatCurrency(r.total_debit || 0) },
    { key: 'total_credit', label: 'الدائن', render: (r: any) => formatCurrency(r.total_credit || 0) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (r: any) => (
        <ActionButtons
          item={r}
          onView={async () => {
            try {
              const res = await apiFetch(`/api/journal/${r.id}`);
              const json = await res.json();
              if (json.success) setViewing(json.data);
              else toast.error(json.message || 'تعذر عرض القيد');
            } catch { toast.error('تعذر عرض القيد'); }
          }}
          onEdit={() => router.push(`/journal/new?edit=${r.id}`)}
          onDelete={() => handleDelete(r)}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="القيود المحاسبية"
        description="سجل القيود اليومية"
        actions={<Button onClick={() => router.push('/journal/new')} leftIcon={<Plus size={18} />}>تسجيل قيد</Button>}
      />
      {entries.length === 0 ? (
        <EmptyState title="لا توجد قيود" actionLabel="تسجيل قيد" onAction={() => router.push('/journal/new')} />
      ) : (
        <DataTable columns={columns} data={entries} searchable searchKeys={['number', 'description']} />
      )}

      <RecordViewModal
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `قيد رقم ${viewing.number}` : 'عرض القيد'}
        record={viewing}
        extra={viewing?.lines?.length ? (
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-text-muted">
                <tr>
                  <th className="p-2 text-right">الحساب</th>
                  <th className="p-2 text-right">مدين</th>
                  <th className="p-2 text-right">دائن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewing.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td className="p-2"><span dir="ltr" className="font-mono" style={{ unicodeBidi: 'isolate' }}>{l.account_code}</span> — {l.account_name || ''}</td>
                    <td className="p-2 font-mono">{formatCurrency(l.debit || 0)}</td>
                    <td className="p-2 font-mono">{formatCurrency(l.credit || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      />
    </div>
  );
}
