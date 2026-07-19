'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate } from '@/lib/utils';

export default function MessagesPage() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/messages');
      const json = await res.json();
      if (json.success) setMessages(json.data?.messages || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleEdit = async (message: any) => {
    alert('تعديل الرسالة - سيتم فتح نافذة التعديل');
  };

  const handleDelete = async (message: any) => {
    try {
      const res = await fetch(`/api/messages/${message.id}`, { method: 'DELETE' });
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

  const directionBadge = (direction: string) => {
    const map: Record<string, { variant: 'success' | 'info'; label: string }> = {
      admin_to_company: { variant: 'info', label: 'من الإدارة' },
      company_to_admin: { variant: 'success', label: 'إلى الإدارة' },
    };
    const m = map[direction] || { variant: 'info', label: direction };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'subject', label: 'الموضوع', sortable: true },
    { key: 'direction', label: 'الاتجاه', render: (row: any) => directionBadge(row.direction) },
    { key: 'created_at', label: 'التاريخ', render: (row: any) => formatDate(row.created_at) },
    { key: 'is_read', label: 'الحالة', render: (row: any) => <Badge variant={row.is_read ? 'success' : 'warning'}>{row.is_read ? 'مقروء' : 'غير مقروء'}</Badge> },
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
      <PageHeader title="الرسائل" description="عرض وإدارة الرسائل" />
      {messages.length === 0 ? (
        <div className="text-center py-12 text-text-muted">لا توجد رسائل</div>
      ) : (
        <DataTable columns={columns} data={messages} searchable searchKeys={['subject']} />
      )}
    </div>
  );
}
