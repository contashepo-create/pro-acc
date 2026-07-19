'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate } from '@/lib/utils';

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/complaints');
      const json = await res.json();
      if (json.success) setComplaints(json.data?.complaints || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEdit = async (complaint: any) => {
    alert('تعديل الشكوى - سيتم فتح نافذة التعديل');
  };

  const handleDelete = async (complaint: any) => {
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      pending: { variant: 'warning', label: 'قيد الانتظار' },
      read: { variant: 'info', label: 'مقروءة' },
      replied: { variant: 'success', label: 'تم الرد' },
      closed: { variant: 'danger', label: 'مغلقة' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'info' | 'accent'; label: string }> = {
      complaint: { variant: 'accent', label: 'شكوى' },
      suggestion: { variant: 'info', label: 'اقتراح' },
    };
    const m = map[type] || { variant: 'info', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'subject', label: 'الموضوع', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => typeBadge(row.type) },
    { key: 'user_name', label: 'المستخدم', sortable: true },
    { key: 'created_at', label: 'التاريخ', render: (row: any) => formatDate(row.created_at) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="الشكاوى والاقتراحات" description="عرض وإدارة الشكاوى والاقتراحات" />
      {complaints.length === 0 ? (
        <div className="text-center py-12 text-text-muted">لا توجد شكاوى أو اقتراحات</div>
      ) : (
        <DataTable columns={columns} data={complaints} searchable searchKeys={['subject', 'user_name']} />
      )}
    </div>
  );
}
