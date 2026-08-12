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
import { toast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/utils';

const statusMeta: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'; label: string }> = {
  draft: { variant: 'default', label: 'مسودة' },
  submitted: { variant: 'info', label: 'مقدّم' },
  approved: { variant: 'success', label: 'معتمد' },
  rejected: { variant: 'danger', label: 'مرفوض' },
  invoiced: { variant: 'accent', label: 'تمت فوترته' },
};

export default function ChangeOrdersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ project_id: '', title: '', description: '', change_amount: 0, status: 'draft' });

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

  useEffect(() => { fetchData(); }, []);

  const openNew = () => {
    setForm({ project_id: '', title: '', description: '', change_amount: 0, status: 'draft' });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/change-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) { toast.success('تم إنشاء أمر التغيير'); setShowModal(false); fetchData(); }
      else toast.error(data.message || 'فشل الحفظ');
    } catch { toast.error('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'number', label: 'الرقم' },
    { key: 'title', label: 'العنوان' },
    { key: 'projects', label: 'المشروع', render: (r: any) => r.projects?.name || r.project_id },
    { key: 'base_contract_amount', label: 'العقد الأساسي', render: (r: any) => formatCurrency(r.base_contract_amount) },
    { key: 'change_amount', label: 'قيمة التغيير', render: (r: any) => <span className={r.change_amount >= 0 ? 'text-success font-bold' : 'text-danger font-bold'}>{formatCurrency(r.change_amount)}</span> },
    { key: 'new_contract_amount', label: 'العقد بعد التعديل', render: (r: any) => <span className="font-bold">{formatCurrency(r.new_contract_amount)}</span> },
    { key: 'status', label: 'الحالة', render: (r: any) => { const m = statusMeta[r.status] || statusMeta.draft; return <Badge variant={m.variant}>{m.label}</Badge>; } },
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="أمر تغيير جديد" size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </>}>
        <div className="space-y-4">
          <Select label="المشروع *" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
            options={[{ value: '', label: '— اختر المشروع —' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} />
          <Input label="العنوان *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="قيمة التغيير (شامل الضريبة) *" type="number" value={form.change_amount} onChange={(e) => setForm({ ...form, change_amount: parseFloat(e.target.value) || 0 })} />
          <Select label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })}
            options={Object.entries(statusMeta).map(([v, m]) => ({ value: v, label: m.label }))} />
          <Textarea label="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
