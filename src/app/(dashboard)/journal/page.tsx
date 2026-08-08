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
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function JournalPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/journal');
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
      const res = await fetch(`/api/journal/${entry.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم حذف القيد'); fetchData(); }
      else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
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
    </div>
  );
}
