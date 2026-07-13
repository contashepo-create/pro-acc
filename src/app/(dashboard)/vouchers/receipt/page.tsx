'use client';

import { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
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

export default function ReceiptPage() {
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({"amount": "", "bank_safe_id": "", "reason": "", "receipt_type": ""});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/vouchers/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({});
        // Refresh data
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ: ' + JSON.stringify(json));
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم: ' + (e.message || ''));
    } finally {
      setSaving(false);
    }
  };





  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/vouchers/receipt');
        const json = await res.json();
        if (json.success) {
          setReceipts(json.data?.receipts || []);
        } else {
          setError(json.message || 'فشل تحميل البيانات');
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const typeBadge = (type: string) => {
    const map: Record<string, { variant: 'success' | 'info' | 'accent'; label: string }> = {
      client: { variant: 'success', label: 'عميل' },
      supplier_refund: { variant: 'info', label: 'مورد' },
      general: { variant: 'accent', label: 'عام' },
    };
    const m = map[type] || { variant: 'default' as const, label: type };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'receipt_type', label: 'النوع', sortable: true, render: (row: any) => typeBadge(row.receipt_type) },
    { key: 'contact_name', label: 'الطرف', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'bank_name', label: 'الخزينة/البنك', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="سندات القبض" description="تسجيل المقبوضات النقدية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة سند قبض</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="سندات القبض"
        description="تسجيل المقبوضات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة سند قبض
          </Button>
        }
      />

      {receipts.length === 0 ? (
        <EmptyState title="لا توجد سندات قبض" description="أضف سند قبض جديد" actionLabel="إضافة سند قبض" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={receipts} searchable searchKeys={['number', 'contact_name']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة سند قبض" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="نوع السند" options={[
              { value: 'client', label: 'تحصيل من عميل' },
              { value: 'supplier_refund', label: 'استرداد من مورد' },
              { value: 'general', label: 'قبض عام' },
            ]} />
            <Select label="الخزينة/البنك" options={[{ value: '', label: 'اختر' }]} />
            <Input label="المبلغ" type="number" />
            <Input label="البيان" className="col-span-2" placeholder="سبب القبض" />
          </div>
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
