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
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

const EXPENSE_TYPES: Record<string, { label: string; variant: 'info' | 'success' | 'warning' | 'danger' }> = {
  materials: { label: 'مواد', variant: 'info' },
  labor: { label: 'عمالة', variant: 'success' },
  subcontractor: { label: 'مقاول باطن', variant: 'warning' },
  equipment: { label: 'معدات', variant: 'danger' },
  other: { label: 'أخرى', variant: 'info' },
};

export default function ProjectExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [form, setForm] = useState<any>({
    project_id: '',
    expense_type: 'materials',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
    contact_id: '',
    notes: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [expRes, projRes, conRes] = await Promise.all([
        fetch(`/api/project-expenses${filterProject ? `?projectId=${filterProject}` : ''}`),
        fetch('/api/projects'),
        fetch('/api/contacts'),
      ]);
      const [expJson, projJson, conJson] = await Promise.all([
        expRes.json(),
        projRes.json(),
        conRes.json(),
      ]);
      if (expJson.success) setExpenses(expJson.data?.expenses || []);
      else setError(expJson.message || 'فشل');
      if (projJson.success) setProjects(projJson.data?.projects || projJson.data?.rows || []);
      if (conJson.success) setContacts(conJson.data?.contacts || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [filterProject]);

  const handleSave = async () => {
    if (!form.project_id || !form.description || !form.amount || !form.date) {
      setSaveError('المشروع، الوصف، المبلغ، والتاريخ مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingItem ? `/api/project-expenses/${editingItem.id}` : '/api/project-expenses';
      const method = editingItem ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingItem(null);
        setForm({
          project_id: '', expense_type: 'materials', description: '',
          amount: 0, date: new Date().toISOString().split('T')[0],
          contact_id: '', notes: '',
        });
        fetchData();
        toast.success(editingItem ? 'تم تحديث المصروف' : 'تم تسجيل المصروف');
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = (item: any) => {
    setEditingItem(item);
    setForm({
      project_id: item.project_id,
      expense_type: item.expense_type,
      description: item.description,
      amount: item.amount,
      date: item.date,
      contact_id: item.contact_id || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (item: any) => {
    try {
      const res = await fetch(`/api/project-expenses/${item.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
        toast.success('تم حذف المصروف');
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const expenseBadge = (type: string) => {
    const m = EXPENSE_TYPES[type] || { label: type, variant: 'info' as const };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date), sortable: true },
    { key: 'project_name', label: 'المشروع', sortable: true },
    { key: 'expense_type', label: 'النوع', render: (row: any) => expenseBadge(row.expense_type) },
    { key: 'description', label: 'الوصف', sortable: true },
    { key: 'amount', label: 'المبلغ', render: (row: any) => formatCurrency(row.amount), sortable: true },
    { key: 'contact_name', label: 'الطرف' },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  const totalAmount = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مصروفات المشاريع"
        description="تسجيل المصروفات المباشرة على المشاريع (مواد، عمالة، مقاولين، معدات)"
        actions={
          <Button onClick={() => { setEditingItem(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>
            إضافة مصروف
          </Button>
        }
      />

      <div className="flex items-center gap-4">
        <Select
          label=""
          value={filterProject}
          onChange={(v) => setFilterProject(v)}
          options={[{ value: '', label: 'كل المشاريع' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]}
          className="w-64"
        />
        <div className="text-sm text-text-secondary">
          إجمالي المصروفات: <span className="font-bold text-text-primary">{formatCurrency(totalAmount)}</span>
        </div>
      </div>

      {expenses.length === 0 ? (
        <EmptyState title="لا توجد مصروفات" actionLabel="إضافة مصروف" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={expenses} searchable searchKeys={['description', 'project_name']} />
      )}

      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingItem(null); }}
        title={editingItem ? 'تعديل مصروف' : 'إضافة مصروف مشروع'}
        size="lg"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingItem(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="المشروع"
              value={form.project_id}
              onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]}
              className="col-span-2"
            />
            <Select
              label="نوع المصروف"
              value={form.expense_type}
              onChange={(v) => setForm({ ...form, expense_type: v })}
              options={Object.entries(EXPENSE_TYPES).map(([key, val]) => ({ value: key, label: val.label }))}
            />
            <Input
              label="التاريخ"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
            <Input
              label="الوصف"
              className="col-span-2"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف المصروف"
            />
            <Input
              label="المبلغ"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
            />
            <Select
              label="الطرف (اختياري)"
              value={form.contact_id}
              onChange={(v) => setForm({ ...form, contact_id: v })}
              options={[{ value: '', label: 'بدون' }, ...contacts.map((c: any) => ({ value: c.id, label: c.name }))]}
            />
          </div>
          <Textarea
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="ملاحظات إضافية"
          />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
