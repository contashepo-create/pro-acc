'use client';

import { useState, useEffect } from 'react';
import { Plus, ShoppingCart, DollarSign } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/utils';

export default function POSPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [terminals, setTerminals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ terminal_id: '', total: '', payment_method: 'cash' });
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [salesRes, terminalsRes] = await Promise.all([
        fetch('/api/pos/sales').then(r => r.json()).catch(() => ({ success: false })),
        fetch('/api/pos/terminals').then(r => r.json()).catch(() => ({ success: false }))
      ]);
      if (salesRes.success) setSales(salesRes.data?.sales || []);
      if (terminalsRes.success) setTerminals(terminalsRes.data?.terminals || []);
    } catch {
      setError('فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.total) { setError('المبلغ مطلوب'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/pos/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminal_id: form.terminal_id || null,
          total: Number(form.total),
          payment_method: form.payment_method,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({ terminal_id: '', total: '', payment_method: 'cash' });
        fetchData();
      } else setError(json.message || 'فشل الحفظ');
    } catch (e:any) { setError('خطأ: ' + e.message); } finally { setSaving(false); }
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (r:any) => formatCurrency(r.total) },
    { key: 'payment_method', label: 'طريقة الدفع', render: (r:any) => <Badge>{r.payment_method}</Badge> },
    { key: 'status', label: 'الحالة', render: (r:any) => <Badge variant={r.status === 'completed' ? 'success' : 'danger'}>{r.status}</Badge> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  return (
    <div className="space-y-6">
      <PageHeader title="نقاط البيع POS" description="مبيعات سريعة للمطاعم والمحلات" actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>بيع جديد</Button>} />
      {error && <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>}
      {sales.length === 0 ? <EmptyState title="لا توجد مبيعات" description="ابدأ بعملية بيع جديدة" actionLabel="بيع جديد" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={sales} searchable searchKeys={['number']} />}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="بيع جديد - نقطة بيع" size="lg" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ البيع'}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="نقطة البيع" value={form.terminal_id} onChange={(v)=>setForm({...form, terminal_id: v})} options={[{ value: '', label: 'بدون' }, ...terminals.map((t:any)=>({ value: t.id, label: t.name }))]} />
          <Input label="الإجمالي *" type="number" value={form.total} onChange={(e:any)=>setForm({...form, total: e.target.value})} placeholder="0" />
          <Select label="طريقة الدفع" value={form.payment_method} onChange={(v)=>setForm({...form, payment_method: v})} options={[{value:'cash',label:'نقدي'},{value:'card',label:'بطاقة'},{value:'transfer',label:'تحويل'}]} />
        </div>
      </Modal>
    </div>
  );
}
