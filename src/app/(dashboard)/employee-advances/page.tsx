'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function EmployeeAdvancesPage() {
  const [advances, setAdvances] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [advRes, empRes] = await Promise.all([
        fetch('/api/employee-advances'),
        fetch('/api/employees'),
      ]);
      const [advJson, empJson] = await Promise.all([
        advRes.json(),
        empRes.json(),
      ]);
      if (advJson.success) setAdvances(advJson.data?.advances || []);
      else setError(advJson.message || 'فشل');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
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
      const url = editingAdvance ? `/api/employee-advances/${editingAdvance.id}` : '/api/employee-advances';
      const method = editingAdvance ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingAdvance(null);
        setForm({ employee_id: '', amount: 0, date: new Date().toISOString().split('T')[0], reason: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (advance: any) => {
    try {
      const res = await fetch(`/api/employee-advances/${advance.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingAdvance(advance);
        setForm({
          employee_id: json.data.employee_id,
          amount: json.data.amount,
          date: json.data.date,
          reason: json.data.reason || '',
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load advance:', e);
    }
  };

  const handleDelete = async (advance: any) => {
    try {
      const res = await fetch(`/api/employee-advances/${advance.id}`, { method: 'DELETE' });
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

  const columns = [
    { key: 'employee_name', label: 'الموظف', sortable: true },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount) },
    { key: 'remaining_amount', label: 'المتبقي', render: (row: any) => formatCurrency(row.remaining_amount) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'reason', label: 'السبب' },
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
      <PageHeader title="سلف الموظفين" description="إدارة السلف المقدمة للموظفين" actions={<Button onClick={() => { setEditingAdvance(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة سلفة</Button>} />
      {advances.length === 0 ? <EmptyState title="لا توجد سلف" actionLabel="إضافة سلفة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={advances} searchable searchKeys={['employee_name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingAdvance(null); }} title={editingAdvance ? 'تعديل سلفة' : 'إضافة سلفة موظف'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingAdvance(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="الموظف" value={form.employee_id} onChange={(v) => setForm({...form, employee_id: v})} options={[{ value: '', label: 'اختر موظفاً' }, ...employees.map((e: any) => ({ value: e.id, label: e.name }))]} className="col-span-2" />
            <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})} />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
          </div>
          <Textarea label="السبب" value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} placeholder="سبب السلفة" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
