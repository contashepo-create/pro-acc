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
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function CustodiesPage() {
  const [custodies, setCustodies] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingCustody, setEditingCustody] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], bank_safe_id: '', description: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
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
      if (custJson.success) setCustodies(custJson.data?.custodies || []);
      else setError(custJson.message || 'فشل');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
      if (bankJson.success) setBanks(bankJson.data?.banks || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.employee_id || !form.amount || form.amount <= 0) {
      setSaveError('الموظف والمبلغ مطلوبان');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingCustody ? `/api/custodies/${editingCustody.id}` : '/api/custodies';
      const method = editingCustody ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingCustody(null);
        setForm({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], bank_safe_id: '', description: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (custody: any) => {
    try {
      const res = await fetch(`/api/custodies/${custody.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingCustody(custody);
        setForm({
          employee_id: json.data.employee_id,
          amount: json.data.amount,
          date: json.data.date,
          bank_safe_id: json.data.bank_safe_id || '',
          description: json.data.description || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load custody:', e);
    }
  };

  const handleDelete = async (custody: any) => {
    try {
      const res = await fetch(`/api/custodies/${custody.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
      open: { variant: 'warning', label: 'مفتوحة' },
      settled: { variant: 'success', label: 'مسوّاة' },
      shortage: { variant: 'danger', label: 'عجز' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'remaining_amount', label: 'المتبقي', render: (row: any) => formatCurrency(row.remaining_amount) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
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
      <PageHeader title="عهد الموظفين" description="إدارة العهد النقدية" actions={<Button onClick={() => { setEditingCustody(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عهدة</Button>} />
      {custodies.length === 0 ? <EmptyState title="لا توجد عهد" actionLabel="إضافة عهدة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={custodies} searchable searchKeys={['employee_name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingCustody(null); }} title={editingCustody ? 'تعديل عهدة' : 'إضافة عهدة'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingCustody(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="الموظف" value={form.employee_id} onChange={(v) => setForm({...form, employee_id: v})} options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e: any) => ({ value: e.id, label: e.name }))]} className="col-span-2" />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select label="الخزينة/البنك (اختياري)" value={form.bank_safe_id} onChange={(v) => setForm({...form, bank_safe_id: v})} options={[{ value: '', label: 'بدون' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]} />
            <Input label="الوصف" className="col-span-2" value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
