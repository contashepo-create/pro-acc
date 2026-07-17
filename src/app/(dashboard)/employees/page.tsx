'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
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

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"name": "", "phone": "", "email": "", "salary": "", "department": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم: ' + ('خطأ'));
    } finally {
      setSaving(false);
    }
  };





  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/employees');
        const json = await res.json();
        if (json.success) {
          setEmployees(json.data?.employees || []);
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

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'phone', label: 'الجوال', sortable: true },
    { key: 'salary', label: 'الراتب', sortable: true, render: (row: any) => formatCurrency(row.salary) },
    { key: 'department', label: 'القسم', sortable: true },
    { key: 'position', label: 'المسمى', sortable: true },
    { key: 'hire_date', label: 'تاريخ التعيين', render: (row: any) => formatDate(row.hire_date) },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الموظفين" description="إدارة بيانات الموظفين"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة موظف</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الموظفين" description="إدارة بيانات الموظفين"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة موظف</Button>}
      />
      {employees.length === 0 ? (
        <EmptyState title="لا توجد موظفين" description="أضف موظفاً جديداً" actionLabel="إضافة موظف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={employees} searchable searchKeys={['name', 'phone', 'department']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة موظف جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" placeholder="اسم الموظف" className="col-span-2" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
          <Input label="الجوال" type="tel" type="tel" placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
          <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
          <Input label="الراتب" type="number" value={form.salary} onChange={(e) => setForm({...form, salary: e.target.value})} />
          <Input label="تاريخ التعيين" type="date" value={form.hire_date} onChange={(e) => setForm({...form, تاريخ_التعيين: e.target.value})} />
          <Input label="القسم" value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} />
          <Input label="المسمى الوظيفي" value={form.position} onChange={(e) => setForm({...form, المسمى_الوظيفي: e.target.value})} />
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
