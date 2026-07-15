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
import { formatDate, formatCurrency } from '@/lib/utils';

export default function ProgressBillingPage() {
  const [claims, setClaims] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    project_id: '',
    date: new Date().toISOString().split('T')[0],
    gross_amount: 0,
    retention_percentage: 10,
    notes: '',
  });

  const handleSave = async () => {
    if (!form.project_id) {
      setSaveError('يجب اختيار مشروع');
      return;
    }
    if (!form.gross_amount || form.gross_amount <= 0) {
      setSaveError('يجب إدخال المبلغ الإجمالي');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const retentionAmount = form.gross_amount * (form.retention_percentage / 100);
      const netAmount = form.gross_amount - retentionAmount;

      const res = await fetch('/api/progress-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: form.project_id,
          date: form.date,
          grossAmount: form.gross_amount,
          retentionPercentage: form.retention_percentage,
          retentionAmount,
          netAmount,
          notes: form.notes,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          project_id: '',
          date: new Date().toISOString().split('T')[0],
          gross_amount: 0,
          retention_percentage: 10,
          notes: '',
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const grossAmount = form.gross_amount || 0;
  const retentionAmount = grossAmount * (form.retention_percentage / 100);
  const netAmount = grossAmount - retentionAmount;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [claimRes, projRes] = await Promise.all([
          fetch('/api/progress-billing'),
          fetch('/api/projects'),
        ]);
        const [claimJson, projJson] = await Promise.all([
          claimRes.json(),
          projRes.json(),
        ]);
        if (claimJson.success) {
          setClaims(claimJson.data?.claims || []);
        } else {
          setError(claimJson.message || 'فشل تحميل البيانات');
        }
        if (projJson.success) {
          setProjects(projJson.data?.projects || []);
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
    { key: 'claim_number', label: 'رقم الفاتورة', sortable: true },
    { key: 'project_name', label: 'المشروع', sortable: true },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'gross_amount', label: 'الإجمالي', render: (row: any) => formatCurrency(row.gross_amount) },
    { key: 'retention_amount', label: 'الاحتجاز', render: (row: any) => formatCurrency(row.retention_amount) },
    { key: 'net_amount', label: 'الصافي', render: (row: any) => formatCurrency(row.net_amount) },
    { key: 'status', label: 'الحالة', render: (row: any) => <Badge variant="success">{row.status || 'معتمدة'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة مرحلية</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="الفواتير المرحلية" description="إدارة فواتير المبيعات المرحلية"
        actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة مرحلية</Button>}
      />
      {claims.length === 0 ? (
        <EmptyState title="لا توجد فواتير مرحلية" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={claims} searchable searchKeys={['claim_number', 'project_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة فاتورة مرحلية" size="lg" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="المشروع"
              value={form.project_id}
              onChange={(value) => setForm({...form, project_id: value})}
              options={[
                { value: '', label: 'اختر مشروعاً' },
                ...projects.map(p => ({ value: p.id, label: p.name })),
              ]}
              className="col-span-2"
            />
            <Input
              label="التاريخ"
              type="date"
              value={form.date}
              onChange={(e) => setForm({...form, date: e.target.value})}
            />
            <Input
              label="المبلغ الإجمالي"
              type="number"
              value={form.gross_amount}
              onChange={(e) => setForm({...form, gross_amount: parseFloat(e.target.value) || 0})}
            />
            <Input
              label="نسبة الاحتجاز (%)"
              type="number"
              value={form.retention_percentage}
              onChange={(e) => setForm({...form, retention_percentage: parseFloat(e.target.value) || 0})}
            />
          </div>

          <div className="bg-bg-secondary rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">المبلغ الإجمالي:</span>
              <strong>{formatCurrency(grossAmount)}</strong>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">الاحتجاز ({form.retention_percentage}%):</span>
              <strong className="text-warning">{formatCurrency(retentionAmount)}</strong>
            </div>
            <div className="flex justify-between text-base border-t border-border pt-2">
              <span className="font-bold">الصافي للدفع:</span>
              <strong className="text-accent">{formatCurrency(netAmount)}</strong>
            </div>
          </div>

          <Input
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({...form, notes: e.target.value})}
            placeholder="ملاحظات الفاتورة المرحلية"
          />

          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
