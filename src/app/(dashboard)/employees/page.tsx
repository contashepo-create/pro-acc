'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '',
    phone: '',
    email: '',
    salary: 0,
    department: '',
    position: '',
    hire_date: new Date().toISOString().split('T')[0],
  });

  const handleSave = async () => {
    if (!form.name) {
      setSaveError('اسم الموظف مطلوب');
      return;
    }
    if (!form.salary || form.salary <= 0) {
      setSaveError('يجب إدخال الراتب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const url = editingEmployee ? `/api/employees/${editingEmployee.id}` : '/api/employees';
      const method = editingEmployee ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingEmployee(null);
        setForm({
          name: '',
          phone: '',
          email: '',
          salary: 0,
          department: '',
          position: '',
          hire_date: new Date().toISOString().split('T')[0],
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

  const handleEdit = async (employee: any) => {
    try {
      const res = await fetch(`/api/employees/${employee.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingEmployee(employee);
        setForm({
          name: json.data.name,
          phone: json.data.phone || '',
          email: json.data.email || '',
          salary: json.data.salary,
          department: json.data.department || '',
          position: json.data.position || '',
          hire_date: json.data.hire_date,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load employee:', e);
    }
  };

  const handleDelete = async (employee: any) => {
    try {
      const res = await fetch(`/api/employees/${employee.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        window.location.reload();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
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
          setError(json.message || 'فشل');
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
    { key: 'department', label: 'القسم' },
    { key: 'position', label: 'الوظيفة' },
    { key: 'salary', label: 'الراتب', sortable: true, render: (row: any) => formatCurrency(row.salary) },
    { key: 'hire_date', label: 'تاريخ التعيين', render: (row: any) => formatDate(row.hire_date) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الموظفين"
        description="إدارة بيانات الموظفين"
        actions={
          <Button onClick={() => { setEditingEmployee(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة موظف
          </Button>
        }
      />

      {employees.length === 0 ? (
        <EmptyState title="لا يوجد موظفين" actionLabel="إضافة موظف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={employees} searchable searchKeys={['name', 'department', 'position']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingEmployee(null); }}
        title={editingEmployee ? `تعديل موظف: ${editingEmployee.name}` : 'إضافة موظف'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingEmployee(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="col-span-2" />
            <Input label="الجوال" value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
            <Input label="القسم" value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} />
            <Input label="الوظيفة" value={form.position} onChange={(e) => setForm({...form, position: e.target.value})} />
            <Input label="الراتب" type="number" value={form.salary} onChange={(e) => setForm({...form, salary: parseFloat(e.target.value) || 0})} />
            <Input label="تاريخ التعيين" type="date" value={form.hire_date} onChange={(e) => setForm({...form, hire_date: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
