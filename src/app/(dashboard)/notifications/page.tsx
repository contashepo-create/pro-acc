'use client';

import { useState, useEffect } from 'react';
import { Bell, Search, CheckCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

const typeIcons: Record<string, string> = { info: '🔵', warning: '🟡', success: '🟢', error: '🔴' };
const typeVariants: Record<string, string> = { info: 'info', warning: 'warning', success: 'success', error: 'danger' };

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/notifications');
        const json = await res.json();
        if (json.success) {
          setNotifications(json.data || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الإشعارات" description="جميع الإشعارات والتنبيهات"
          actions={<div className="flex gap-2"><Button variant="ghost" leftIcon={<CheckCheck size={18} />}>تحديد الكل مقروء</Button></div>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="الإشعارات"
        description="جميع الإشعارات والتنبيهات"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" leftIcon={<CheckCheck size={18} />}>تحديد الكل مقروء</Button>
          </div>
        }
      />
      {notifications.length === 0 ? (
        <EmptyState title="لا توجد إشعارات" description="سيتم عرض الإشعارات هنا عند حدوثها" />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${n.is_read ? 'bg-bg-card border-border' : 'bg-bg-card border-accent/30'}`}>
              <span className="text-xl mt-0.5">{typeIcons[n.type] || '🔵'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-text-primary">{n.title}</h3>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
                  <Badge variant={(typeVariants[n.type] || 'info') as any}>{n.type}</Badge>
                </div>
                <p className="text-sm text-text-muted mt-1">{n.message}</p>
                <p className="text-xs text-text-muted mt-2">{new Date(n.created_at).toLocaleDateString('ar-SA')}</p>
              </div>
              <button className="btn-icon text-text-muted hover:text-red-500 transition-colors shrink-0">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
