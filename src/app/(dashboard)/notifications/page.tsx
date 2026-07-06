'use client';

import { useState } from 'react';
import { Bell, Search, CheckCheck, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';

const mockNotifications = [
  { id: '1', type: 'info', title: 'فاتورة جديدة', message: 'تم إضافة فاتورة جديدة للمشروع', is_read: false, created_at: '2026-06-23T08:00:00Z' },
  { id: '2', type: 'warning', title: 'رصيد منخفض', message: 'رصيد الخزينة الرئيسية أقل من 10,000 ريال', is_read: false, created_at: '2026-06-22T10:00:00Z' },
  { id: '3', type: 'success', title: 'تمت التسوية', message: 'تمت تسوية كشف الحساب البنكي لشهر مايو', is_read: true, created_at: '2026-06-20T14:00:00Z' },
];

const typeIcons: Record<string, string> = { info: '🔵', warning: '🟡', success: '🟢', error: '🔴' };
const typeVariants: Record<string, string> = { info: 'info', warning: 'warning', success: 'success', error: 'danger' };

export default function NotificationsPage() {
  const [loading] = useState(false);

  if (loading) return <LoadingSkeleton variant="table" count={6} />;

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
      {mockNotifications.length === 0 ? (
        <EmptyState title="لا توجد إشعارات" description="سيتم عرض الإشعارات هنا عند حدوثها" />
      ) : (
        <div className="space-y-2">
          {mockNotifications.map((n) => (
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
