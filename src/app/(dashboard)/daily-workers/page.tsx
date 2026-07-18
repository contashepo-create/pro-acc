'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';

export default function DailyWorkersPage() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    phone: '',
    daily_wage: 0,
    project_id: '',
    date: new Date().toISOString().split('T')[0],
    days: 1,
  });

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('اسم العامل مطلوب');
      return;
    }
    if (!form.daily_wage || form.daily_wage <= 0) {
      setSaveError('يجب إدخال الأجر اليومي');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/daily-workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          name: '',
          phone: '',
          daily_wage: 0,
          project_id: '',
          date: new Date().toISOString().split('T')[0],
          days: 1,
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
        const [workRes, projRes] = await Promise.all([
          fetch('/api/daily-workers'),
          fetch('/api/projects'),
        ]);
        const [workJson, projJson] = await Promise.all([
          workRes.json(),
          projRes.json(),
        ]);
        if (workJson.success) {
          setWorkers(workJson.data?.workers || []);
        } else {
          setError(workJson.message || 'فشل تحميل البيانات');
        }
        if (projJson.success) {
          setProjects(projJson.data?.projects || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال' },
    { key: 'daily_wage', label: 'الأجر اليومي' },
    { key: 'days', label: 'الأيام' },
    { key: 'total', label: 'الإجمالي' },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="العمالة اليومية" description="إدارة العمالة اليومية والأجور"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عامل</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="العمالة اليومية" description="إدارة العمالة اليومية والأجور"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عامل</Button>}
      />
      {workers.length === 0 ? (
        <EmptyState title="لا يوجد عمال" actionLabel="إضافة عامل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={workers} searchable searchKeys={['name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عامل يومي" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="الأجر اليومي" type="number" value={form.daily_wage} onChange={(e) => setForm({...form, daily_wage: parseFloat(e.target.value) || 0})} />
            <Input label="عدد الأيام" type="number" value={form.days} onChange={(e) => setForm({...form, days: parseInt(e.target.value) || 1})} />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select
              label="المشروع (اختياري)"
              value={form.project_id}
              onChange={(value) => setForm({...form, project_id: value})}
              options={[
                { value: '', label: 'بدون مشروع' },
                ...projects.map(p => ({ value: p.id, label: p.name })),
              ]}
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
