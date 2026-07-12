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
import { formatDate, formatCurrency } from '@/lib/utils';

export default function PurchaseInvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({});

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/purchases/invoices', {
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
        const res = await fetch('/api/purchases/invoices');
        const json = await res.json();
        if (json.success) {
          setInvoices(json.data?.invoices || []);
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

  const columns = [
    { key: 'invoice_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'paid_amount', label: 'المدفوع', sortable: true, render: (row: any) => formatCurrency(row.paid_amount) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="فواتير المشتريات" description="إدارة فواتير الشراء"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة فاتورة</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="فواتير المشتريات"
        description="إدارة فواتير الشراء"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة فاتورة
          </Button>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState title="لا توجد فواتير مشتريات" description="أضف فاتورة مشتريات جديدة" actionLabel="إضافة فاتورة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={invoices} searchable searchKeys={['supplier_name', 'invoice_number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة فاتورة مشتريات" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="المورد" options={[{ value: '', label: 'اختر مورداً' }]} />
            <Select label="أمر الشراء" options={[{ value: '', label: 'اختياري' }]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" />
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr><th className="p-2 text-right">البيان</th><th className="p-2 text-right">الكمية</th><th className="p-2 text-right">سعر الوحدة</th><th className="p-2 text-right">الإجمالي</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="p-2"><Input placeholder="وصف الصنف" /></td>
                  <td className="p-2 w-24"><Input type="number" /></td>
                  <td className="p-2 w-24"><Input type="number" /></td>
                  <td className="p-2 w-24"><Input type="number" disabled /></td>
                </tr>
              </tbody>
            </table>
          </div>
                  {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
