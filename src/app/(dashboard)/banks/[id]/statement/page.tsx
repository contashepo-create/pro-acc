'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PrintTemplate, type PrintColumn } from '@/components/ui/PrintTemplate';

interface Row { seq: number; date: string; number: string; description: string; debit: number; credit: number; balance: number }
interface Totals { debit: number; credit: number; balance: number }

const fmt = (n: number) => n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankStatementPage() {
  const params = useParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [safeName, setSafeName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/banks/${params.id}/statement`);
        const json = await res.json();
        if (!json.success) { setError(json.message || 'فشل التحميل'); return; }
        setRows(json.data.rows || []);
        setTotals(json.data.totals || null);
        setSafeName(String((json.data.safe as Record<string, unknown>)?.name ?? ''));
      } catch { setError('خطأ في الاتصال'); }
    })();
  }, [params.id]);

  const columns: PrintColumn<Row>[] = [
    { key: 'seq', label: '#', align: 'center' },
    { key: 'date', label: 'التاريخ' },
    { key: 'number', label: 'رقم القيد', align: 'center' },
    { key: 'description', label: 'البيان' },
    { key: 'debit', label: 'مدين (قبض)', render: (r) => r.debit ? fmt(r.debit) : '—', align: 'end' },
    { key: 'credit', label: 'دائن (صرف)', render: (r) => r.credit ? fmt(r.credit) : '—', align: 'end' },
    { key: 'balance', label: 'الرصيد', render: (r) => fmt(r.balance), align: 'end' },
  ];

  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <PrintTemplate
      title="كشف حساب خزينة / بنك"
      subtitle={safeName}
      rows={rows}
      columns={columns}
      extraInfo={[
        { label: 'عدد الحركات', value: String(rows.length) },
        ...(totals ? [
          { label: 'إجمالي مدين', value: fmt(totals.debit) },
          { label: 'إجمالي دائن', value: fmt(totals.credit) },
          { label: 'الرصيد النهائي', value: fmt(totals.balance) },
        ] : []),
      ]}
      footerTotals={totals ? [{ label: 'الرصيد الختامي', value: fmt(totals.balance) }] : undefined}
    />
  );
}
