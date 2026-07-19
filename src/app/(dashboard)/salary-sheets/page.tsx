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

export default function SalarySheetsPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSheet, setEditingSheet] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', month: 1, year: new Date().getFullYear(), date: new Date().toISOString().split('T')[0] });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [sheetRes, empRes] = await Promise.all([
        fetch('/api/salary-sheets'),
        fetch('/api/employees'),
      ]);
      const [sheetJson, empJson] = await Promise.all([
        sheetRes.json(),
        empRes.json(),
      ]);
      if (sheetJson.success) setSheets(sheetJson.data?.sheets || []);
      else setError(sheetJson.message || 'فشل');
      if (empJson.success) setEmployees(empJson.data?.employees || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.date) { setSaveError('الاسم والتاريخ مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingSheet ? `/api/salary-sheets/${editingSheet.id}` : '/api/salary-sheets';
      const method = editingSheet ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingSheet(null);
        setForm({ name: '', month: 1, year: new Date().getFullYear(), date: new Date().toISOString().split('T')[0] });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (sheet: any) => {
    try {
      const res = await fetch(`/api/salary-sheets/${sheet.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingSheet(sheet);
        setForm({
          name: json.data.name,
          month: json.data.month,
          year: json.data.year,
          date: json.data.date,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load sheet:', e);
    }
  };

  const handleDelete = async (sheet: any) => {
    try {
      const res = await fetch(`/api/salary-sheets/${sheet.id}`, { method: 'DELETE' });
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
    const map: Record<string, { variant: 'success' | 'warning' | 'info'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      approved: { variant: 'success', label: 'معتمدة' },
      paid: { variant: 'info', label: 'مدفوعة' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'month', label: 'الشهر' },
    { key: 'year', label: 'السنة' },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'total_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total_amount || 0) },
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
      <PageHeader title="كشوف الرواتب" description="إدارة كشوف رواتب الموظفين" actions={<Button onClick={() => { setEditingSheet(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة كشف</Button>} />
      {sheets.length === 0 ? <EmptyState title="لا توجد كشوف رواتب" actionLabel="إضافة كشف" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={sheets} searchable searchKeys={['name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingSheet(null); }} title={editingSheet ? 'تعديل كشف رواتب' : 'إضافة كشف رواتب'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingSheet(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="مثال: رواتب يناير 2026" />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
          <Input label="الشهر" type="number" value={form.month} onChange={(e) => setForm({...form, month: parseInt(e.target.value) || 1})} />
          <Input label="السنة" type="number" value={form.year} onChange={(e) => setForm({...form, year: parseInt(e.target.value) || new Date().getFullYear()})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
