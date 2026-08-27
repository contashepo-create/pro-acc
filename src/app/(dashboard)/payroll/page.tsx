'use client';

import { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

interface PayrollRecord {
  date?: string;
  employee_name?: string;
  basic_salary: number;
  advance_deduction: number;
  gosi_employer?: number;
  gosi_employee?: number;
  net_pay: number;
}
interface EmployeeOption { id: string; }

export default function PayrollPage() {
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
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
        fetch('/api/employees?active=true', { credentials: 'same-origin' }),
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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch pattern
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

  const handleEosb = async () => {
    if (!month) { toast.error('اختر الشهر'); return; }
    if (!confirm(`سيتم ترحيل استحقاق نهاية الخدمة لشهر ${month} لجميع الموظفين النشطين. متابعة؟`)) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/payroll/eosb', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: `${month}-01` }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data?.status === 'nothing_to_accrue') toast.info('لا توجد استحقاقات جديدة لهذا الشهر');
        else toast.success(`تم ترحيل استحقاق نهاية الخدمة لـ ${json.data?.count ?? 0} موظف بإجمالي ${json.data?.total ?? 0}`);
        fetchData();
      } else {
        toast.error(json.message || 'فشل ترحيل الاستحقاق');
      }
    } catch {
      toast.error('خطأ في الاتصال');
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { key: 'date', label: 'الشهر', sortable: true, render: (row: PayrollRecord) => row.date?.substring(0, 7) },
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'basic_salary', label: 'الراتب الأساسي', sortable: true, render: (row: PayrollRecord) => formatCurrency(row.basic_salary) },
    { key: 'advance_deduction', label: 'خصم السلف', sortable: true, render: (row: PayrollRecord) => formatCurrency(row.advance_deduction) },
    { key: 'gosi_employer', label: 'التأمينات (صاحب عمل)', render: (row: PayrollRecord) => formatCurrency(row.gosi_employer ?? 0) },
    { key: 'gosi_employee', label: 'التأمينات (الموظف)', render: (row: PayrollRecord) => formatCurrency(row.gosi_employee ?? 0) },
    { key: 'net_pay', label: 'صافي الراتب', sortable: true, render: (row: PayrollRecord) => formatCurrency(row.net_pay) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: PayrollRecord) => <ActionButtons item={{ ...row, date: formatDate(row.date) }} />,
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="الرواتب" description="إدارة ومعالجة الرواتب"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleEosb} disabled={processing}>استحقاق نهاية الخدمة</Button>
            <Button onClick={() => setShowProcess(true)} leftIcon={<Play size={18} />}>معالجة الرواتب</Button>
          </div>
        }
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
