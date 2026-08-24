'use client';

import { useState, useEffect } from 'react';
import { Eye, XCircle, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

interface ComplaintRow {
  id: string;
  subject?: string;
  body?: string;
  type?: string;
  user_name?: string;
  created_at?: string;
  status?: string;
  admin_reply?: string;
}
interface ComplaintForm { subject: string; body: string; close: boolean; }

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ComplaintRow | null>(null);
  const [previewing, setPreviewing] = useState<ComplaintRow | null>(null);
  const [form, setForm] = useState<ComplaintForm>({ subject: '', body: '', close: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleEdit = (complaint: ComplaintRow) => {
    setEditing(complaint);
    setForm({ subject: complaint.subject || '', body: complaint.body || '', close: false });
    setSaveError('');
  };

  const handleSave = async () => {
    if (!editing) return;
    const isPending = editing.status === 'pending';
    const patch: Record<string, unknown> = {};
    if (isPending) {
      patch.subject = form.subject;
      patch.body = form.body;
    }
    if (form.close) patch.status = 'closed';

    if (Object.keys(patch).length === 0) {
      setSaveError('لا توجد تغييرات — التعديل مسموح فقط للشكاوى قيد الانتظار، أو اختر إغلاق الشكوى');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/complaints/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (json.success) {
        setEditing(null);
        toast.success(form.close ? 'تم إغلاق الشكوى' : 'تم حفظ التعديلات');
        fetchData();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (complaint: ComplaintRow) => {
    try {
      const res = await fetch(`/api/complaints/${complaint.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم حذف الشكوى');
        fetchData();
      } else {
        toast.error(json.message || 'فشل الحذف');
      }
    } catch {
      toast.error('خطأ في الاتصال بالخادم');
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
    { key: 'type', label: 'النوع', render: (row: ComplaintRow) => typeBadge(row.type || '') },
    { key: 'user_name', label: 'المستخدم', sortable: true },
    { key: 'created_at', label: 'التاريخ', render: (row: ComplaintRow) => formatDate(row.created_at) },
    { key: 'status', label: 'الحالة', render: (row: ComplaintRow) => statusBadge(row.status || '') },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: ComplaintRow) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPreviewing(row)} title="معاينة الشكوى">
            <Eye size={16} className="text-blue-600" />
          </Button>
          <ActionButtons
            item={row}
            showView={false}
            showPrint={false}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
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

      {/* معاينة الشكوى */}
      <Modal
        isOpen={!!previewing}
        onClose={() => setPreviewing(null)}
        title={previewing ? 'معاينة الشكوى' : ''}
        size="lg"
        footer={<div className="flex gap-2 justify-between items-center">
          <div className="flex items-center gap-2 text-sm text-text-muted">{previewing && statusBadge(previewing.status || '')}</div>
          <Button variant="ghost" onClick={() => setPreviewing(null)}>إغلاق</Button>
        </div>}
      >
        {previewing && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {typeBadge(previewing.type || '')}
              <span className="text-xs text-text-muted">بتاريخ {formatDate(previewing.created_at)}</span>
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary mb-1">الموضوع</p>
              <p className="text-text-primary">{previewing.subject}</p>
            </div>
            <div>
              <p className="text-sm font-bold text-text-primary mb-1">نص الشكوى / الاقتراح</p>
              <div className="rounded-xl bg-bg-secondary/50 border border-border p-3 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                {previewing.body}
              </div>
            </div>
            {previewing.admin_reply && (
              <div>
                <p className="text-sm font-bold text-text-primary mb-1 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-accent" /> رد الإدارة
                </p>
                <div className="rounded-xl bg-accent/5 border border-accent/20 p-3 text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                  {previewing.admin_reply}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* تعديل الشكوى */}
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `تعديل: ${editing.subject}` : ''}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-muted">الحالة الحالية:</span>
              {statusBadge(editing.status || '')}
              {editing.status !== 'pending' && (
                <span className="text-xs text-text-muted">(لا يمكن تعديل النص بعد أن عالجتها الإدارة)</span>
              )}
            </div>
            <Input
              label="الموضوع"
              value={form.subject}
              disabled={editing.status !== 'pending'}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
            <Textarea
              label="النص"
              value={form.body}
              disabled={editing.status !== 'pending'}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            {editing.admin_reply && (
              <div className="rounded-lg bg-bg-secondary/50 border border-border p-3 text-xs">
                <p className="font-bold text-text-primary mb-1">رد الإدارة:</p>
                <p className="text-text-secondary whitespace-pre-wrap">{editing.admin_reply}</p>
              </div>
            )}
            {editing.status !== 'closed' && (
              <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={form.close}
                  onChange={(e) => setForm({ ...form, close: e.target.checked })}
                  className="w-4 h-4 accent-danger"
                />
                <XCircle size={16} className="text-danger" />
                إغلاق الشكوى (لن تظهر ضمن القائمة النشطة)
              </label>
            )}
            {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
