'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Printer } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { PrintButton } from '@/components/ui/PrintButton';
import { formatDate, formatCurrency } from '@/lib/utils';
import { printCurrentPage } from '@/lib/print';

const typeLabel: Record<string, string> = {
  voucher_disbursement: 'سند صرف',
  voucher_disbursement_reversal: 'عكس سند صرف',
  voucher_receipt: 'سند قبض',
  purchase_invoice: 'فاتورة شراء',
  purchase_invoice_reversal: 'عكس فاتورة شراء',
  journal: 'قيد',
  opening_balance: 'رصيد افتتاحي',
};

export default function SupplierStatementPage() {
interface SupplierStatementEntry {
  id: string;
  date: string;
  type?: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
}
interface PurchaseInvoiceChip { id: string; number: string; total: number; }
interface DisbursementChip { id: string; number: string; amount: number; }
interface SupplierStatementData {
  id: string;
  supplier?: { name?: string };
  opening_balance: number;
  total_debit: number;
  total_credit: number;
  balance: number;
  entries?: SupplierStatementEntry[];
  purchase_invoices: PurchaseInvoiceChip[];
  disbursements: DisbursementChip[];
}

  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<SupplierStatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/suppliers/${params.id}/statement?page=1&pageSize=100`);
        const json = await res.json();
        if (json.success) setData(json.data);
        else setError(json.message || 'فشل تحميل البيانات');
      } catch { setError('خطأ في الاتصال بالخادم'); }
      finally { setLoading(false); }
    };
    fetchData();
  }, [params.id]);

  const handlePrint = () => void printCurrentPage();

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  if (!data) return null;
  const s = data;
  return (
    <div className="space-y-6">
      <PageHeader
        title={`كشف حساب المورد: ${s.supplier?.name || ''}`}
        description="حركات المورد وأرصدته من القيود المثبتة فقط — رصيد دائن يعني أن له عليك."
        icon={ArrowRight}
        actions={<Button onClick={handlePrint} variant="secondary" leftIcon={<Printer size={16} />}>طباعة</Button>}
        onBack={() => router.push('/suppliers')}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-xs text-text-muted">الرصيد الافتتاحي</div>
          <div className="text-lg font-bold mt-1">{formatCurrency(s.opening_balance)}</div>
        </div>
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-xs text-text-muted">الحركات المدينة</div>
          <div className="text-lg font-bold mt-1">{formatCurrency(s.total_debit)}</div>
        </div>
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-xs text-text-muted">الحركات الدائنة</div>
          <div className="text-lg font-bold mt-1">{formatCurrency(s.total_credit)}</div>
        </div>
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <div className="text-xs text-text-muted">الرصيد الحالي</div>
          <div className="text-lg font-bold mt-1">{formatCurrency(s.balance)}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-bg-secondary">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-text-muted border-b border-border">
              <th className="p-3 font-semibold">التاريخ</th>
              <th className="p-3 font-semibold">النوع</th>
              <th className="p-3 font-semibold">البيان</th>
              <th className="p-3 font-semibold">مدين</th>
              <th className="p-3 font-semibold">دائن</th>
              <th className="p-3 font-semibold">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {s.entries?.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-text-muted">لا توجد حركات في هذه الفترة</td></tr>
            ) : (s.entries || []).map((e) => (
              <tr key={e.id} className="border-b border-border/60 hover:bg-surface-hover/40">
                <td className="p-3 whitespace-nowrap">{formatDate(e.date)}</td>
                <td className="p-3"><span className="text-xs bg-surface rounded-md px-2 py-1">{typeLabel[e.type ?? ''] || e.type}</span></td>
                <td className="p-3 text-text-muted">{e.description || '—'}</td>
                <td className="p-3">{e.debit > 0 ? formatCurrency(e.debit) : '—'}</td>
                <td className="p-3">{e.credit > 0 ? formatCurrency(e.credit) : '—'}</td>
                <td className="p-3 font-bold">{formatCurrency(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {s.purchase_invoices?.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="font-bold mb-3">فواتير الشراء ({s.purchase_invoices.length})</h3>
          <div className="flex flex-wrap gap-2">
            {s.purchase_invoices.map((inv) => (
              <span key={inv.id} className="text-xs bg-surface rounded-md px-2 py-1">
                {inv.number} — {formatCurrency(inv.total)}
              </span>
            ))}
          </div>
        </div>
      )}
      {s.disbursements?.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-secondary p-4">
          <h3 className="font-bold mb-3">سندات الصرف ({s.disbursements.length})</h3>
          <div className="flex flex-wrap gap-2">
            {s.disbursements.map((d) => (
              <span key={d.id} className="text-xs bg-surface rounded-md px-2 py-1">
                {d.number} — {formatCurrency(d.amount)}
              </span>
            ))}
          </div>
        </div>
      )}
    <PrintButton /></div>
  );
}
