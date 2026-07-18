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

export default function CashPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    type: 'revenue',
    amount: 0,
    bank_safe_id: '',
    account_id: '',
    reason: '',
  });

  const handleSave = async () => {
    if (!form.date) {
      setSaveError('يجب إدخال التاريخ');
      return;
    }
    if (!form.amount || form.amount <= 0) {
      setSaveError('يجب إدخال مبلغ صحيح');
      return;
    }
    if (!form.account_id) {
      setSaveError('يجب اختيار الحساب');
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          date: new Date().toISOString().split('T')[0],
          type: 'revenue',
          amount: 0,
          bank_safe_id: '',
          account_id: '',
          reason: '',
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e: any) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const [typeTab, setTypeTab] = useState('all');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [txRes, bankRes, accRes] = await Promise.all([
          fetch('/api/cash'),
          fetch('/api/banks'),
          fetch('/api/accounts'),
        ]);
        const [txJson, bankJson, accJson] = await Promise.all([
          txRes.json(),
          bankRes.json(),
          accRes.json(),
        ]);
        if (txJson.success) {
          setTransactions(txJson.data?.rows || []);
        } else {
          setError(txJson.message || 'فشل تحميل البيانات');
        }
        if (bankJson.success) {
          setBanks(bankJson.data?.banks || []);
        }
        if (accJson.success) {
          setAccounts(accJson.data?.accounts || []);
        }
      } catch {
        setError('فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = typeTab === 'all' ? transactions : transactions.filter(t => t.type === typeTab);

  const columns = [
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'type', label: 'النوع', sortable: true,
      render: (row: any) => <Badge variant={row.type === 'revenue' ? 'success' : 'danger'}>{row.type === 'revenue' ? 'قبض' : 'صرف'}</Badge>,
    },
    { key: 'account_name', label: 'الحساب', sortable: true },
    { key: 'amount', label: 'المبلغ', sortable: true, render: (row: any) => formatCurrency(row.amount) },
    { key: 'reason', label: 'البيان', sortable: true },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="النقدية" description="إدارة المعاملات النقدية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة معاملة</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="النقدية"
        description="إدارة المعاملات النقدية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة معاملة
          </Button>
        }
      />

      <div className="flex gap-4">
        <Button variant={typeTab === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('all')}>الكل</Button>
        <Button variant={typeTab === 'revenue' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('revenue')}>قبض</Button>
        <Button variant={typeTab === 'expense' ? 'primary' : 'secondary'} size="sm" onClick={() => setTypeTab('expense')}>صرف</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="لا توجد معاملات" description="أضف معاملة نقدية جديدة" actionLabel="إضافة معاملة" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={filtered} searchable searchKeys={['reason']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة معاملة نقدية" size="lg" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="التاريخ"
              type="date"
              value={form.date}
              onChange={(e) => setForm({...form, date: e.target.value})}
            />
            <Select
              label="النوع"
              value={form.type}
              onChange={(value) => setForm({...form, type: value})}
              options={[
                { value: 'revenue', label: 'قبض' },
                { value: 'expense', label: 'صرف' },
              ]}
            />
            <Input
              label="المبلغ"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({...form, amount: parseFloat(e.target.value) || 0})}
            />
            <Select
              label="الخزينة/البنك"
              value={form.bank_safe_id}
              onChange={(value) => setForm({...form, bank_safe_id: value})}
              options={[
                { value: '', label: 'اختر الخزينة/البنك (اختياري)' },
                ...banks.map(b => ({ value: b.id, label: `${b.name} (${b.type === 'bank' ? 'بنك' : 'صندوق'})` })),
              ]}
            />
            <Select
              label="الحساب"
              value={form.account_id}
              onChange={(value) => setForm({...form, account_id: value})}
              options={[
                { value: '', label: 'اختر حساباً' },
                ...accounts.filter(a => !a.parent_id || a.children?.length === 0).map(a => ({
                  value: a.id,
                  label: `${a.code} - ${a.name}`,
                })),
              ]}
              className="col-span-2"
            />
            <Input
              label="البيان"
              value={form.reason}
              onChange={(e) => setForm({...form, reason: e.target.value})}
              placeholder="سبب المعاملة"
              className="col-span-2"
            />
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
