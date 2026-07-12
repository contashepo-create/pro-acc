'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { formatDate, formatCurrency } from '@/lib/utils';

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const handleSave = async () => {
    // TODO: Implement save logic for this page
    // This is a temporary fix to prevent empty button
    alert('جاري تطوير حفظ البيانات لهذا القسم - سيتم تفعيله قريباً');
    setShowModal(false);
  };



  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/purchases/orders');
        const json = await res.json();
        if (json.success) {
          setOrders(json.data?.orders || []);
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

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'warning' | 'success' | 'info' | 'danger'; label: string }> = {
      pending: { variant: 'warning', label: 'قيد الانتظار' },
      partial: { variant: 'info', label: 'مستلم جزئياً' },
      received: { variant: 'success', label: 'مستلم كلياً' },
      cancelled: { variant: 'danger', label: 'ملغي' },
    };
    const m = map[status] || { variant: 'default' as const, label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'po_number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'supplier_name', label: 'المورد', sortable: true },
    { key: 'total', label: 'الإجمالي', sortable: true, render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', sortable: true, render: (row: any) => statusBadge(row.status) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="أوامر الشراء" description="إدارة أوامر الشراء"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة أمر شراء</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="أوامر الشراء"
        description="إدارة أوامر الشراء"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة أمر شراء
          </Button>
        }
      />

      {orders.length === 0 ? (
        <EmptyState title="لا توجد أوامر شراء" description="أضف أمر شراء جديد" actionLabel="إضافة أمر شراء" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={orders} searchable searchKeys={['supplier_name', 'po_number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة أمر شراء" size="xl" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave}>حفظ</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" />
            <Select label="المورد" options={[{ value: '', label: 'اختر مورداً' }]} />
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
        </div>
      </Modal>
    </div>
  );
}
