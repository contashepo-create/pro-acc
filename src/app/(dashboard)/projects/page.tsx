'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    client_id: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    budget: 0,
  });

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('اسم المشروع مطلوب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          name: '',
          client_id: '',
          start_date: new Date().toISOString().split('T')[0],
          end_date: '',
          budget: 0,
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [projRes, clientRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/clients'),
        ]);
        const [projJson, clientJson] = await Promise.all([
          projRes.json(),
          clientRes.json(),
        ]);
        if (projJson.success) {
          setProjects(projJson.data?.projects || []);
        } else {
          setError(projJson.message || 'فشل تحميل البيانات');
        }
        if (clientJson.success) {
          setClients(clientJson.data?.clients || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      active: { variant: 'success', label: 'نشط' },
      completed: { variant: 'info', label: 'مكتمل' },
      cancelled: { variant: 'danger', label: 'ملغى' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'name', label: 'اسم المشروع', sortable: true },
    { key: 'client_name', label: 'العميل', sortable: true },
    { key: 'start_date', label: 'تاريخ البدء', render: (row: any) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ الانتهاء', render: (row: any) => row.end_date ? formatDate(row.end_date) : '-' },
    { key: 'budget', label: 'الميزانية', render: (row: any) => formatCurrency(row.budget) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="المشاريع" description="إدارة المشاريع"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة مشروع</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="المشاريع" description="إدارة المشاريع"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة مشروع</Button>}
      />
      {projects.length === 0 ? (
        <EmptyState title="لا توجد مشاريع" actionLabel="إضافة مشروع" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={projects} searchable searchKeys={['name', 'client_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة مشروع" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="اسم المشروع" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Select
              label="العميل"
              value={form.client_id}
              onChange={(value) => setForm({...form, client_id: value})}
              options={[
                { value: '', label: 'اختر عميلاً (اختياري)' },
                ...clients.map(c => ({ value: c.id, label: c.name })),
              ]}
              className="col-span-2"
            />
            <Input label="تاريخ البدء" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
            <Input label="تاريخ الانتهاء" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
            <Input label="الميزانية" type="number" value={form.budget} onChange={(e) => setForm({...form, budget: parseFloat(e.target.value) || 0})} className="col-span-2" />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
