'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate } from '@/lib/utils';
import { fetchRecord, applyDates, recordOrRow, toDateInput } from '@/lib/form-utils';
import { toast } from '@/components/ui/Toast';

interface FiscalYearRow {
  id: string;
  name: string;
  start_date?: string;
  end_date?: string;
  status?: string;
}
interface FiscalYearForm { name: string; start_date: string; end_date: string; }

export default function FiscalPage() {
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingYear, setEditingYear] = useState<FiscalYearRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<FiscalYearForm>({ name: '', start_date: '', end_date: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/fiscal');
      const json = await res.json();
      if (json.success) setFiscalYears(json.data?.fiscalYears || []);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  // Initial load on mount (standard fetch pattern).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.start_date || !form.end_date) {
      setSaveError('جميع الحقول مطلوبة');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const url = editingYear ? `/api/fiscal/${editingYear.id}` : '/api/fiscal';
      const method = editingYear ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingYear(null);
        setForm({ name: '', start_date: '', end_date: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (year: FiscalYearRow) => {
    const { data, error } = await fetchRecord(`/api/fiscal/${year.id}`);
    const src = recordOrRow(data, year);
    if (!data && error) toast.error(error);
    setEditingYear(year);
    setForm(applyDates({
      name: String(src.name ?? ''),
      start_date: toDateInput(src.start_date) ?? '',
      end_date: toDateInput(src.end_date) ?? '',
    }, ['start_date', 'end_date']));
    setShowModal(true);
  };

  const handleDelete = async (year: FiscalYearRow) => {
    try {
      const res = await fetch(`/api/fiscal/${year.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'start_date', label: 'تاريخ البداية', render: (row: FiscalYearRow) => formatDate(row.start_date) },
    { key: 'end_date', label: 'تاريخ النهاية', render: (row: FiscalYearRow) => formatDate(row.end_date) },
    { key: 'status', label: 'الحالة', render: (row: FiscalYearRow) => <Badge variant={row.status === 'open' ? 'success' : 'warning'}>{row.status === 'open' ? 'مفتوحة' : 'مقفلة'}</Badge> },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: FiscalYearRow) => (
        <ActionButtons
          item={row}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ),
    },
  ];

  const openYear = fiscalYears.find((y: FiscalYearRow) => y.status === 'open');

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="السنوات المالية" description="إدارة الفترات المالية" actions={<Button onClick={() => { setEditingYear(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة سنة مالية</Button>} />

      <div className="rounded-2xl border p-4 text-sm space-y-1" style={{ background: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2 font-bold" style={{ color: 'var(--color-text-primary)' }}>
          <Badge variant={openYear ? 'success' : 'warning'}>{openYear ? 'السنة المالية الحالية' : 'لا توجد سنة مفتوحة'}</Badge>
          {openYear && <span>{openYear.name} ({formatDate(openYear.start_date)} — {formatDate(openYear.end_date)})</span>}
        </div>
        <p style={{ color: 'var(--color-text-muted)' }}>
          لا يمكن فتح أكثر من سنة مالية واحدة في الوقت نفسه، ولا يُسمح بالترحيل إلى تواريخ خارج السنة المفتوحة أو داخل سنة مقفلة. عند إنشاء شركة جديدة تُنشأ سنة مالية للعام الحالي تلقائياً.
        </p>
      </div>

      {fiscalYears.length === 0 ? <EmptyState title="لا توجد سنوات مالية" actionLabel="إضافة سنة مالية" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={fiscalYears} searchable searchKeys={['name']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingYear(null); }} title={editingYear ? 'تعديل سنة مالية' : 'إضافة سنة مالية'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingYear(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <Input label="الاسم" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="مثال: 2026" />
          <Input label="تاريخ البداية" type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} />
          <Input label="تاريخ النهاية" type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
