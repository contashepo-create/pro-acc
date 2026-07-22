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
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ProgressBillingPage() {
  const [claims, setClaims] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClaim, setEditingClaim] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    project_id: '', date: new Date().toISOString().split('T')[0],
    gross_amount: 0, retention_percentage: 10, notes: '', is_final: false, tax_enabled: false, tax_rate: 0.15,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [claimRes, projRes] = await Promise.all([
        fetch('/api/progress-billing'),
        fetch('/api/projects'),
      ]);
      const [claimJson, projJson] = await Promise.all([
        claimRes.json(),
        projRes.json(),
      ]);
      if (claimJson.success) setClaims(claimJson.data?.claims || []);
      else setError(claimJson.message || 'فشل');
      if (projJson.success) setProjects(projJson.data?.projects || []);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.project_id) { setSaveError('يجب اختيار مشروع'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingClaim ? `/api/progress-billing/${editingClaim.id}` : '/api/progress-billing';
      const method = editingClaim ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingClaim(null);
        setForm({
          project_id: '', date: new Date().toISOString().split('T')[0],
          gross_amount: 0, retention_percentage: 10, notes: '', is_final: false, tax_enabled: false, tax_rate: 0.15,
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (claim: any) => {
    try {
      const res = await fetch(`/api/progress-billing/${claim.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingClaim(claim);
        setForm({
          project_id: json.data.project_id,
          date: json.data.date,
          gross_amount: json.data.gross_amount,
          retention_percentage: json.data.retention_percentage,
          notes: json.data.notes || '',
          is_final: json.data.is_final || false,
        });
        setShowModal(true);
      }
    } catch (e) {
      console.error('Failed to load claim:', e);
    }
  };

  const handleDelete = async (claim: any) => {
    try {
      const res = await fetch(`/api/progress-billing/${claim.id}`, { method: 'DELETE' });
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
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      submitted: { variant: 'info', label: 'مُسلّم' },
      approved: { variant: 'success', label: 'مُعتمد' },
      paid: { variant: 'success', label: 'مدفوع' },
      rejected: { variant: 'danger', label: 'مرفوض' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'claim_number', label: 'الرقم', sortable: true },
    { key: 'project_name', label: 'المشروع', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'gross_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.gross_amount) },
    { key: 'retention_amount', label: 'الاحتجاز', render: (row: any) => formatCurrency(row.retention_amount) },
    { key: 'net_amount', label: 'الصافي', render: (row: any) => formatCurrency(row.net_amount) },
    { key: 'status', label: 'الحالة', render: (row: any) => (
      <div className="flex items-center gap-2">
        {statusBadge(row.status)}
        {row.is_final && <Badge variant="success">نهائية</Badge>}
      </div>
    ) },
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
      <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية" actions={<Button onClick={() => { setEditingClaim(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة فاتورة</Button>} />
      {claims.length === 0 ? <EmptyState title="لا توجد فواتير مرحلية" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={claims} searchable searchKeys={['project_name', 'claim_number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingClaim(null); }} title={editingClaim ? 'تعديل فاتورة مرحلية' : 'إضافة فاتورة مرحلية'} size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingClaim(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select label="المشروع" value={form.project_id} onChange={(v) => setForm({...form, project_id: v})} options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))]} className="col-span-2" />
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Input label="المبلغ الإجمالي" type="number" value={form.gross_amount} onChange={(e) => setForm({...form, gross_amount: parseFloat(e.target.value) || 0})} />
            <Input label="نسبة الاحتجاز (%)" type="number" value={form.retention_percentage} onChange={(e) => setForm({...form, retention_percentage: parseFloat(e.target.value) || 10})} />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات الفاتورة المرحلية" />
          <Checkbox label="تطبيق ضريبة القيمة المضافة (15%)" checked={form.tax_enabled} onChange={(checked: boolean) => setForm({...form, tax_enabled: checked, tax_rate: checked ? 0.15 : 0})} />
          <Checkbox label="دفعة نهائية" checked={form.is_final} onChange={(checked: boolean) => setForm({...form, is_final: checked})} />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
