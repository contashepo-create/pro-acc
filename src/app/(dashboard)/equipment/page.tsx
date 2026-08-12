'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { toast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/utils';

const costTypes = [
  { value: 'rental', label: 'إيجار' },
  { value: 'fuel', label: 'وقود' },
  { value: 'maintenance', label: 'صيانة' },
  { value: 'labour', label: 'عمالة' },
  { value: 'depreciation', label: 'إهلاك' },
  { value: 'other', label: 'أخرى' },
];

export default function EquipmentCostsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ equipment_id: '', project_id: '', cost_type: 'other', amount: 0, usage_hours: 0, date: new Date().toISOString().split('T')[0], notes: '' });

  const fetchData = async () => {
    try {
      setLoading(true); setError('');
      const [eqRes, projRes, asRes] = await Promise.all([fetch('/api/equipment-costs'), fetch('/api/projects'), fetch('/api/fixed-assets')]);
      const [eqJson, projJson, asJson] = await Promise.all([eqRes.json(), projRes.json(), asRes.json()]);
      if (eqJson.success) setRows(eqJson.data.rows || []);
      else setError(eqJson.message || 'فشل التحميل');
      if (projJson.success) setProjects(projJson.data.rows || []);
      if (asJson.success) setAssets((asJson.data.rows || asJson.data || []));
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/equipment-costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, equipment_id: form.equipment_id || null, project_id: form.project_id || null }),
      });
      const data = await res.json();
      if (data.success) { toast.success('تم تسجيل التكلفة'); setShowModal(false); fetchData(); }
      else toast.error(data.message || 'فشل الحفظ');
    } catch { toast.error('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const columns = [
    { key: 'date', label: 'التاريخ' },
    { key: 'fixed_assets', label: 'المعدة', render: (r: any) => r.fixed_assets?.name || '—' },
    { key: 'projects', label: 'المشروع', render: (r: any) => r.projects?.name || '—' },
    { key: 'cost_type', label: 'النوع', render: (r: any) => costTypes.find((c) => c.value === r.cost_type)?.label || r.cost_type },
    { key: 'usage_hours', label: 'ساعات الاستخدام' },
    { key: 'amount', label: 'المبلغ', render: (r: any) => <span className="font-bold">{formatCurrency(r.amount)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="تكاليف المعدات"
        description="تسجيل تكاليف المعدات وتحميلها على المشاريع (Equipment Costing)"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>تكلفة جديدة</Button>}
      />
      {loading ? <LoadingSkeleton variant="table" count={8} /> : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      ) : (
        <DataTable columns={columns} data={rows} searchable searchKeys={['notes', 'cost_type']} pageSize={20} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="تسجيل تكلفة معدات" size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </>}>
        <div className="space-y-4">
          <Select label="المعدة" value={form.equipment_id} onChange={(v) => setForm({ ...form, equipment_id: v })}
            options={[{ value: '', label: '— بدون —' }, ...assets.map((a: any) => ({ value: a.id, label: a.name }))]} />
          <Select label="المشروع" value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })}
            options={[{ value: '', label: '— بدون —' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} />
          <Select label="نوع التكلفة" value={form.cost_type} onChange={(v) => setForm({ ...form, cost_type: v })} options={costTypes} />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="المبلغ *" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="ساعات الاستخدام" type="number" value={form.usage_hours} onChange={(e) => setForm({ ...form, usage_hours: parseFloat(e.target.value) || 0 })} />
        </div>
      </Modal>
    </div>
  );
}
