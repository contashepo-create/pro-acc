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
import { formatCurrency } from '@/lib/utils';

export default function BanksPage() {
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({ name: '', type: 'bank', account_number: '', opening_balance: '' });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/banks');
      const json = await res.json();
      if (json.success) setBanks(json.data?.banks || []);
      else setError(json.message || 'فشل تحميل البيانات');
    } catch { setError('فشل تحميل البيانات - خطأ في الاتصال'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name || !form.type) { setSaveError('الاسم والنوع مطلوبان'); return; }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          account_number: form.account_number,
          opening_balance: Number(form.opening_balance) || 0,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ name: '', type: 'bank', account_number: '', opening_balance: '' });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e:any) { setSaveError('خطأ في الاتصال: ' + (e.message || '')); } finally { setSaving(false); }
  };

  const columns = [
    { key: 'name', label: 'الاسم', sortable: true },
    { key: 'type', label: 'النوع', render: (row: any) => <Badge variant={row.type === 'bank' ? 'info' : 'accent'}>{row.type === 'bank' ? 'بنك' : 'صندوق'}</Badge> },
    { key: 'account_number', label: 'رقم الحساب' },
    { key: 'opening_balance', label: 'الرصيد الافتتاحي', render: (row: any) => formatCurrency(row.opening_balance) },
    { key: 'is_active', label: 'الحالة', render: (row: any) => <Badge variant={row.is_active ? 'success' : 'danger'}>{row.is_active ? 'نشط' : 'غير نشط'}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="space-y-6"><PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية" actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>} /><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="البنوك والخزائن" description="إدارة الحسابات البنكية والخزائن النقدية" actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة بنك/خزينة</Button>} />
      {banks.length === 0 ? <EmptyState title="لا توجد بنوك أو خزائن" actionLabel="إضافة بنك/خزينة" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={banks} searchable searchKeys={['name', 'account_number']} />}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة بنك/خزينة" size="lg" footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="الاسم" className="col-span-2" value={form.name} onChange={(e:any)=>setForm({...form, name: e.target.value})} placeholder="مثلاً: البنك الأهلي - حساب رئيسي" />
          <Select label="النوع" value={form.type} onChange={(value)=>setForm({...form, type: value})} options={[{ value: 'bank', label: 'بنك' }, { value: 'safe', label: 'صندوق' }]} />
          <Input label="رقم الحساب" value={form.account_number} onChange={(e:any)=>setForm({...form, account_number: e.target.value})} placeholder="1234567890" />
          <Input label="الرصيد الافتتاحي" type="number" value={form.opening_balance} onChange={(e:any)=>setForm({...form, opening_balance: e.target.value})} placeholder="0" />
          {saveError && <div className="col-span-2 bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
