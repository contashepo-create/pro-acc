'use client';

import { useState, useEffect } from 'react';
import { Play, Eye } from 'lucide-react';
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

export default function PayrollPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showProcess, setShowProcess] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/payroll');
        const json = await res.json();
        if (json.success) {
          setRecords(json.data?.records || []);
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
    { key: 'date', label: 'الشهر', sortable: true, render: (row: any) => row.date?.substring(0, 7) },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'basic_salary', label: 'الراتب الأساسي', sortable: true, render: (row: any) => formatCurrency(row.basic_salary) },
    { key: 'advance_deduction', label: 'خصم السلف', sortable: true, render: (row: any) => formatCurrency(row.advance_deduction) },
    { key: 'net_pay', label: 'صافي الراتب', sortable: true, render: (row: any) => formatCurrency(row.net_pay) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
          actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
        actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
      />
      {records.length === 0 ? (
        <EmptyState title="لا توجد معالجات سابقة" description="قم بمعالجة الرواتب لشهر جديد" actionLabel="معالجة الرواتب" onAction={() => setShowProcess(true)} />
      ) : (
        <DataTable columns={columns} data={records} searchable searchKeys={['employee_name']} />
      )}
      <Modal isOpen={showProcess} onClose={() => setShowProcess(false)} title="معالجة الرواتب" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowProcess(false)}>إلغاء</Button><Button>معالجة</Button></div>}>
        <div className="space-y-4">
          <Input label="الشهر" type="month" />
          <Select label="الموظفين" options={[{ value: 'all', label: 'جميع الموظفين' }]} />
          <p className="text-sm text-text-muted">سيتم إنشاء قيد محاسبي (Dr مصروفات رواتب / Cr رواتب مستحقة + Cr سلف موظفين)</p>
        </div>
      </Modal>
    </div>
  );
}
