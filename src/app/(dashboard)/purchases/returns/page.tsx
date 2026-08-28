'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { useAuthStore } from '@/store/auth-store';
import { companyDisplayMoney } from '@/lib/company-money';
import { formatDocumentNumber } from '@/lib/document-number';

interface PurchaseReturnRow {
  id: string;
  number?: number;
  date?: string;
  invoice_number?: number | string;
  supplier_name?: string;
  reason?: string;
  total: number;
  refund_amount?: number;
  status?: string;
}

export default function PurchaseReturnsPage() {
  const { company } = useAuthStore();
  const money = (n: number) => companyDisplayMoney(Number(n) || 0, company);
  const [rows, setRows] = useState<PurchaseReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/purchases/returns');
      const json = await res.json();
      if (json.success) setRows(json.data?.returns || []);
      else setError(json.message || 'فشل تحميل المرتجعات');
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCancel = async (row: PurchaseReturnRow) => {
    if (!confirm('سيتم إلغاء المرتجع مع عكس قيده. متابعة؟')) return;
    try {
      const res = await fetch(`/api/purchases/returns/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم إلغاء المرتجع');
        fetchData();
      } else toast.error(json.message || 'فشل الإلغاء');
    } catch {
      toast.error('خطأ في الاتصال');
    }
  };

  const columns = [
    { key: 'number', label: 'الرقم', render: (row: PurchaseReturnRow) => formatDocumentNumber('purchase_return', row.number) },
    { key: 'date', label: 'التاريخ', render: (row: PurchaseReturnRow) => formatDate(row.date) },
    { key: 'invoice_number', label: 'فاتورة الشراء', render: (row: PurchaseReturnRow) => row.invoice_number ? formatDocumentNumber('purchase_invoice', row.invoice_number) : '—' },
    { key: 'supplier_name', label: 'المورد' },
    { key: 'reason', label: 'السبب' },
    { key: 'total', label: 'القيمة', render: (row: PurchaseReturnRow) => money(row.total) },
    { key: 'refund_amount', label: 'الرد النقدي', render: (row: PurchaseReturnRow) => money(row.refund_amount || 0) },
    { key: 'status', label: 'الحالة', render: (row: PurchaseReturnRow) => (
      <Badge variant={row.status === 'cancelled' ? 'danger' : 'success'}>
        {row.status === 'cancelled' ? 'ملغى' : 'معتمد'}
      </Badge>
    ) },
    { key: 'actions', label: 'إجراءات', render: (row: PurchaseReturnRow) => (
      <ActionButtons item={row} showView={false} showPrint={false} onDelete={row.status === 'cancelled' ? undefined : handleCancel} />
    ) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="مرتجعات المشتريات"
        description="تخفيض ذمة المورد مع رد نقدي اختياري. الإنشاء من فاتورة المشتريات."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="لا توجد مرتجعات"
          description="افتح فاتورة المشتريات واختر مرتجع المشتريات لتسجيل الإرجاع"
        />
      ) : (
        <DataTable columns={columns} data={rows} searchable searchKeys={['number', 'supplier_name', 'reason']} />
      )}
    </div>
  );
}
