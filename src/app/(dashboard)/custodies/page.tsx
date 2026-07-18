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
import { formatDate, formatCurrency } from '@/lib/utils';

export default function CustodiesPage() {
  const [custodies, setCustodies] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    employee_id: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    bank_safe_id: '',
    description: '',
  });

  const handleSave = async () => {
    if (!form.employee_id) {
      setSaveError('يجب اختيار موظف');
      return;
    }
    if (!form.amount || form.amount <= 0) {
      setSaveError('يجب إدخال مبلغ صحيح');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/custodies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          employee_id: '',
          amount: 0,
          date: new Date().toISOString().split('T')[0],
          bank_safe_id: '',
          description: '',
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
        const [custRes, empRes, bankRes] = await Promise.all([
          fetch('/api/custodies'),
          fetch('/api/employees'),
          fetch('/api/banks'),
        ]);
        const [custJson, empJson, bankJson] = await Promise.all([
          custRes.json(),
          empRes.json(),
          bankRes.json(),
        ]);
        if (custJson.success) {
          setCustodies(custJson.data?.custodies || []);
        } else {
          setError(custJson.message || 'فشل تحميل البيانات');
        }
        if (empJson.success) {
          setEmployees(empJson.data?.employees || []);
        }
        if (bankJson.success) {
          setBanks(bankJson.data?.banks || []);
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
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'status', label: 'الحالة' },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="عهد الموظفين" description="إدارة العهد النقدية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عهدة</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="عهد الموظفين" description="إدارة العهد النقدية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة عهدة</Button>}
      />
      {custodies.length === 0 ? (
        <EmptyState title="لا توجد عهد" actionLabel="إضافة عهدة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={custodies} searchable searchKeys={['employee_name']} />
      )}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة عهدة" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="الموظف"
              value={form.employee_id}
              onChange={(value) => setForm({...form, employee_id: value})}
              options={[
                { value: '', label: 'اختر موظفاً' },
                ...employees.map(e => ({ value: e.id, label: e.name })),
              ]}
              className="col-span-2"
            />
            <Input
              label="المبلغ"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})}
            />
            <Input
              label="التاريخ"
              type="date"
              value={form.date}
              onChange={(e) => setForm({...form, date: e.target.value})}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(value) => setForm({...form, bank_safe_id: value})}
              options={[
                { value: '', label: 'اختر (اختياري)' },
                ...banks.map(b => ({ value: b.id, label: b.name })),
              ]}
              className="col-span-2"
            />
            <Input
              label="الوصف"
              value={form.description}
              onChange={(e) => setForm({...form, description: e.target.value})}
              placeholder="وصف العهدة"
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
