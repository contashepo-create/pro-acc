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

  const handleSave = async () => {
    // TODO: Implement save logic for this page
    // This is a temporary fix to prevent empty button
    alert('جاري تطوير حفظ البيانات لهذا القسم - سيتم تفعيله قريباً');
    setShowModal(false);
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
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة موظف جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" placeholder="اسم الموظف" className="col-span-2" />
          <Input label="الجوال" placeholder="05xxxxxxxx" />
          <Input label="البريد الإلكتروني" type="email" />
          <Input label="الراتب" type="number" />
          <Input label="تاريخ التعيين" type="date" />
          <Input label="القسم" />
          <Input label="المسمى الوظيفي" />
        </div>
      </Modal>
    </div>
  );
}
