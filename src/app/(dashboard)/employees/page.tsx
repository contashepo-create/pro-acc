'use client';

import { useState } from 'react';
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

const mockEmployees = [
  { id: '1', name: 'أحمد محمد', phone: '0555000111', salary: 12000, department: 'المحاسبة', position: 'محاسب', hire_date: '2024-01-15', is_active: true },
  { id: '2', name: 'سارة خالد', phone: '0555000222', salary: 15000, department: 'المشاريع', position: 'مهندس', hire_date: '2024-03-01', is_active: true },
];

export default function EmployeesPage() {
  const [loading] = useState(false);
  const [showModal, setShowModal] = useState(false);

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

  return (
    <div className="space-y-6">
      <PageHeader title="الموظفين" description="إدارة بيانات الموظفين"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة موظف</Button>}
      />
      {mockEmployees.length === 0 ? (
        <EmptyState title="لا توجد موظفين" description="أضف موظفاً جديداً" actionLabel="إضافة موظف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={mockEmployees} searchable searchKeys={['name', 'phone', 'department']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة موظف جديد" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>
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
