'use client';

import { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function PayrollPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showProcess, setShowProcess] = useState(false);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [processing, setProcessing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [payRes, empRes] = await Promise.all([
        fetch('/api/payroll', { credentials: 'same-origin' }),
        fetch('/api/employees', { credentials: 'same-origin' }),
      ]);
      const [payJson, empJson] = await Promise.all([payRes.json(), empRes.json()]);
      if (payJson.success) setRecords(payJson.data?.records || []);
      else setError(payJson.message || 'فشل تحميل البيانات');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleProcess = async () => {
    if (!month) { toast.error('اختر الشهر'); return; }
    if (employees.length === 0) { toast.error('لا يوجد موظفون للمعالجة'); return; }
    setProcessing(true);
    try {
      const date = `${month}-01`;
      const res = await fetch('/api/payroll', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, employee_ids: employees.map((e) => e.id) }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`تم معالجة ${json.data?.length || 0} راتب`);
        setShowProcess(false);
        fetchData();
      } else {
        toast.error(json.message || 'فشل معالجة الرواتب');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { key: 'date', label: 'الشهر', sortable: true, render: (row: any) => row.date?.substring(0, 7) },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'basic_salary', label: 'الراتب الأساسي', sortable: true, render: (row: any) => formatCurrency(row.basic_salary) },
    { key: 'advance_deduction', label: 'خصم السلف', sortable: true, render: (row: any) => formatCurrency(row.advance_deduction) },
    { key: 'net_pay', label: 'صافي الراتب', sortable: true, render: (row: any) => formatCurrency(row.net_pay) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => <ActionButtons item={{ ...row, date: formatDate(row.date) }} />,
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
        actions={<Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>}
      />
      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {records.length === 0 ? (
        <EmptyState title="لا توجد معالجات سابقة" description="قم بمعالجة الرواتب لشهر جديد" actionLabel="معالجة الرواتب" onAction={() => setShowProcess(true)} />
      ) : (
        <DataTable columns={columns} data={records} searchable searchKeys={['employee_name']} />
      )}
      <Modal
        isOpen={showProcess}
        onClose={() => setShowProcess(false)}
        title="معالجة الرواتب"
        size="lg"
        footer={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowProcess(false)}>إلغاء</Button>
            <Button onClick={handleProcess} disabled={processing}>{processing ? 'جاري المعالجة...' : 'معالجة'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="الشهر" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <p className="text-sm text-text-muted">سيتم معالجة رواتب {employees.length} موظف وإنشاء قيد محاسبي متزن (مدين مصروف رواتب / دائن رواتب مستحقة + سلف).</p>
        </div>
      </Modal>
    </div>
  );
}
