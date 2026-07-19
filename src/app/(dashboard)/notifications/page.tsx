'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate } from '@/lib/utils';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/notifications');
      const json = await res.json();
      if (json.success) setNotifications(json.data?.notifications || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleMarkAsRead = async (notification: any) => {
    try {
      const res = await fetch(`/api/notifications/${notification.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true }),
      });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل التحديث');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const handleDelete = async (notification: any) => {
    try {
      const res = await fetch(`/api/notifications/${notification.id}`, { method: 'DELETE' });
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

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger' | 'accent'; label: string }> = {
      info: { variant: 'info', label: 'معلومة' },
      warning: { variant: 'warning', label: 'تحذير' },
      success: { variant: 'success', label: 'نجاح' },
      error: { variant: 'danger', label: 'خطأ' },
      approval: { variant: 'accent', label: 'موافقة' },
    };
    const m = map[type] || { variant: 'info', label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'title', label: 'العنوان', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => typeBadge(row.type) },
    { key: 'message', label: 'الرسالة' },
    { key: 'created_at', label: 'التاريخ', render: (row: any) => formatDate(row.created_at) },
    { key: 'is_read', label: 'الحالة', render: (row: any) => <Badge variant={row.is_read ? 'success' : 'warning'}>{row.is_read ? 'مقروء' : 'جديد'}</Badge> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <div className="flex gap-2">
          {!row.is_read && (
            <Button variant="ghost" size="sm" onClick={() => handleMarkAsRead(row)}>
              تحديد كمقروء
            </Button>
          )}
          <ActionButtons
            item={row}
            onDelete={handleDelete}
          />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6">
      <PageHeader 
        title="الإشعارات" 
        description={`لديك ${unreadCount} إشعار غير مقروء`}
        actions={
          unreadCount > 0 && (
            <Button onClick={() => notifications.forEach(n => !n.is_read && handleMarkAsRead(n))}>
              تحديد الكل كمقروء
            </Button>
          )
        }
      />
      {notifications.length === 0 ? (
        <div className="text-center py-12 text-text-muted">لا توجد إشعارات</div>
      ) : (
        <DataTable columns={columns} data={notifications} searchable searchKeys={['title', 'message']} />
      )}
    </div>
  );
}
