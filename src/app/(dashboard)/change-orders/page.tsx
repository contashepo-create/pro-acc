'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Badge } from '@/components/ui/Badge';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { fetchRecord, recordOrRow } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';
import { PrintButton } from '@/components/ui/PrintButton';
import { formatCurrency } from '@/lib/utils';
import { formatDocumentNumber } from '@/lib/document-number';

const statusMeta: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'; label: string }> = {
  draft: { variant: 'default', label: 'مسودة' },
  submitted: { variant: 'info', label: 'مقدّم' },
  approved: { variant: 'success', label: 'معتمد' },
  rejected: { variant: 'danger', label: 'مرفوض' },
  invoiced: { variant: 'accent', label: 'تمت فوترته' },
};

interface ChangeOrderRow {
  id: string;
  number?: string;
  title?: string;
  description?: string;
  project_id?: string;
  projects?: { name?: string };
  base_contract_amount?: number;
  change_amount: number;
  new_contract_amount: number;
  status: string;
}
interface ProjectOption { id: string; name: string; }
interface ChangeOrderForm { project_id: string; title: string; description: string; change_amount: number; status: string; }

export default function ChangeOrdersPage() {
  const [rows, setRows] = useState<ChangeOrderRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ChangeOrderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ChangeOrderForm>({ project_id: '', title: '', description: '', change_amount: 0, status: 'draft' });

  const fetchData = async () => {
    try {
      setLoading(true); setError('');
      const [coRes, projRes] = await Promise.all([fetch('/api/change-orders'), fetch('/api/projects')]);
      const [coJson, projJson] = await Promise.all([coRes.json(), projRes.json()]);
      if (coJson.success) setRows(coJson.data.rows || []);
      else setError(coJson.message || 'فشل التحميل');
      if (projJson.success) setProjects(projJson.data.rows || []);
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setEditingId(null);
    setForm({ project_id: '', title: '', description: '', change_amount: 0, status: 'draft' });
    setShowModal(true);
  };

  const handleEdit = async (row: ChangeOrderRow) => {
    const { data, error } = await fetchRecord(`/api/change-orders/${row.id}`);
    const src = recordOrRow(data, row);
    if (!data && error) toast.error(error);
    setEditingId(row.id);
    setForm({
      project_id: String(src.project_id ?? ''),
      title: String(src.title ?? ''),
      description: String(src.description ?? ''),
      change_amount: Number(src.change_amount) || 0,
      status: String(src.status ?? 'draft'),
    });
    setShowModal(true);
  };

  const handleDelete = async (row: ChangeOrderRow) => {
    if (!confirm(`حذف أمر التغيير ${row.number}؟`)) return;
    try {
      const res = await fetch(`/api/change-orders/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم الحذف'); fetchData(); }
      else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const handleSave = async () => {
    if (!form.project_id) { toast.error('اختر المشروع'); return; }
    if (!form.title.trim()) { toast.error('العنوان مطلوب'); return; }
    setSaving(true);
    try {
      const url = editingId ? `/api/change-orders/${editingId}` : '/api/change-orders';
      const method = editingId ? 'PATCH' : 'POST';
      const payload = editingId ? {
        title: form.title,
        description: form.description,
        change_amount: form.change_amount,
        status: form.status,
      } : form;
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) { toast.success(editingId ? 'تم تحديث أمر التغيير' : 'تم إنشاء أمر التغيير'); setShowModal(false); setEditingId(null); fetchData(); }
      else toast.error(data.message || 'فشل الحفظ');
    } catch { toast.error('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'number', label: 'الرقم', render: (row: ChangeOrderRow) => formatDocumentNumber('change_order', row.number) },
    { key: 'title', label: 'العنوان' },
    { key: 'projects', label: 'المشروع', render: (r: ChangeOrderRow) => r.projects?.name || r.project_id },
    { key: 'base_contract_amount', label: 'العقد الأساسي', render: (r: ChangeOrderRow) => formatCurrency(r.base_contract_amount ?? 0) },
    { key: 'change_amount', label: 'قيمة التغيير', render: (r: ChangeOrderRow) => <span className={r.change_amount >= 0 ? 'text-success font-bold' : 'text-danger font-bold'}>{formatCurrency(r.change_amount)}</span> },
    { key: 'new_contract_amount', label: 'العقد بعد التعديل', render: (r: ChangeOrderRow) => <span className="font-bold">{formatCurrency(r.new_contract_amount)}</span> },
    { key: 'status', label: 'الحالة', render: (r: ChangeOrderRow) => { const m = statusMeta[r.status] || statusMeta.draft; return <Badge variant={m.variant}>{m.label}</Badge>; } },
    {
      key: 'actions', label: 'إجراءات',
      render: (r: ChangeOrderRow) => (
        <ActionButtons
          item={r}
          onView={async () => {
            const { data, error } = await fetchRecord(`/api/change-orders/${r.id}`);
            if (!data && error) { toast.error(error); return; }
            setViewing(data as ChangeOrderRow | null);
          }}
          onEdit={() => handleEdit(r)}
          onDelete={() => handleDelete(r)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="أوامر التغيير"
        description="تعديلات العقود وتأثيرها على الميزانية (Change Orders)"
        actions={<Button onClick={openNew} leftIcon={<Plus size={18} />}>أمر تغيير جديد</Button>}
      />
      {loading ? <LoadingSkeleton variant="table" count={8} /> : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      ) : (
        <DataTable columns={columns} data={rows} searchable searchKeys={['number', 'title']} pageSize={20} />
      )}

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingId(null); }} title={editingId ? 'تعديل أمر التغيير' : 'أمر تغيير جديد'} size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </>}>
        <div className="space-y-4">
          <Select label="المشروع *" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
            options={[{ value: '', label: '— اختر المشروع —' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          <Input label="العنوان *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="قيمة التغيير (شامل الضريبة) *" type="number" value={form.change_amount} onChange={(e) => setForm({ ...form, change_amount: parseFloat(e.target.value) || 0 })} />
          <Select label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })}
            options={Object.entries(statusMeta).map(([v, m]) => ({ value: v, label: m.label }))} />
          <Textarea label="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>

      <RecordViewModal
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `أمر تغيير ${viewing.number}` : 'عرض أمر التغيير'}
        record={viewing}
      />
    <PrintButton /></div>
  );
}
