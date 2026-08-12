'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Plus, Receipt, Lock } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

export default function CustodyFilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [file, setFile] = useState<any>(null);
  const [banks, setBanks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'add' | 'expense' | 'close' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ amount: 0, date: new Date().toISOString().split('T')[0], bank_safe_id: '', description: '', allow_excess: false, returned_cash: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const [fRes, bRes] = await Promise.all([fetch(`/api/custodies/${id}`), fetch('/api/banks')]);
      const [fJson, bJson] = await Promise.all([fRes.json(), bRes.json()]);
      if (!fJson.success) setError(fJson.message || 'تعذر التحميل');
      else setFile(fJson.data);
      if (bJson.success) setBanks(bJson.data?.banks || []);
    } catch { setError('خطأ في الاتصال'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  const closed = file?.is_closed || file?.status === 'settled';

  const post = async (url: string, body: any) => {
    setSaving(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.success) { toast.error(json.message || 'فشل'); return; }
      toast.success(json.data?.message || 'تم');
      setModal(null);
      await load();
    } catch { toast.error('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-text-muted">جاري تحميل ملف العهدة...</div>;
  if (error || !file) return <div className="p-6 text-danger">{error || 'غير موجود'}</div>;

  const statusMap: Record<string, { label: string; variant: 'warning' | 'info' | 'success' }> = {
    open: { label: 'مفتوحة', variant: 'warning' },
    partially_settled: { label: 'مسوّاة جزئياً', variant: 'info' },
    settled: { label: 'مغلقة', variant: 'success' },
  };
  const st = statusMap[file.computed_status || file.status] || statusMap.open;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/custodies')}><ArrowRight size={18} /></Button>
          <PageHeader title={`ملف ${file.file_number || ''}`} description={`${file.employee_name} — ${file.reason || file.description || ''}`} />
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['إجمالي المستلم', file.total_received],
          ['المصروف المثبت', file.total_expenses],
          ['المتبقي في الملف', file.remaining_amount],
          ['المشروع', null],
        ].map(([label, val]) => (
          <Card key={String(label)} className="p-4">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-lg font-bold mt-1">{val === null ? (file.project_name || 'عام') : formatCurrency(Number(val) || 0)}</p>
          </Card>
        ))}
      </div>

      {!closed && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => { setForm({ amount: 0, date: new Date().toISOString().split('T')[0], bank_safe_id: file.bank_safe_id || '', description: 'تعزيز' }); setModal('add'); }}>تعزيز</Button>
          <Button size="sm" variant="secondary" leftIcon={<Receipt size={14} />} onClick={() => { setForm({ amount: 0, date: new Date().toISOString().split('T')[0], description: '', allow_excess: false }); setModal('expense'); }}>إثبات مصروف / فاتورة</Button>
          <Button size="sm" variant="outline" leftIcon={<Lock size={14} />} onClick={() => { setForm({ returned_cash: file.remaining_amount, date: new Date().toISOString().split('T')[0], bank_safe_id: file.bank_safe_id || '', description: '' }); setModal('close'); }}>إغلاق الملف</Button>
        </div>
      )}

      <Card title="حركة الملف">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-text-muted border-b border-border">
                <th className="py-2">النوع</th>
                <th className="py-2">البيان</th>
                <th className="py-2">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {(file.transactions || []).length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-text-muted">لا حركات بعد الافتتاح</td></tr>
              )}
              {(file.transactions || []).map((t: any) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2">{t.type === 'addition' ? 'تعزيز' : t.type === 'expense' ? 'مصروف' : t.type === 'shortage' ? 'عجز' : t.type === 'surplus' ? 'زيادة' : t.type === 'return' ? 'مرتجع' : t.type}</td>
                  <td className="py-2">{t.description}</td>
                  <td className="py-2 font-mono">{formatCurrency(parseFloat(t.amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">التاريخ: {formatDate(file.date)} — المصروف يُخصم من 1150 فلا يُصرف نقداً مرة أخرى. الإغلاق لا يتم إلا بتأكيد.</p>
      </Card>

      <Modal isOpen={modal === 'add'} onClose={() => setModal(null)} title="تعزيز الملف" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button><Button disabled={saving} onClick={() => post(`/api/custodies/${id}/add`, form)}>ترحيل التعزيز</Button></div>}>
        <div className="space-y-3">
          <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="المصدر" value={form.bank_safe_id} onChange={(v) => setForm({ ...form, bank_safe_id: v })}
            options={[{ value: '', label: 'اختر' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]} />
          <Input label="البيان" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>

      <Modal isOpen={modal === 'expense'} onClose={() => setModal(null)} title="إثبات مصروف من العهدة" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button><Button disabled={saving} onClick={() => post(`/api/custodies/${id}/expense`, form)}>خصم من الملف</Button></div>}>
        <div className="space-y-3">
          <p className="text-xs text-text-muted">مدين المصروف / دائن عهدة الموظف. لا يُنشأ سند صرف نقدي إضافي.</p>
          <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="البيان (الفاتورة / جهة الشراء)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.allow_excess} onChange={(e) => setForm({ ...form, allow_excess: e.target.checked })} />
            السماح بزيادة عن المتبقي (مستحق للموظف على الراتب)
          </label>
        </div>
      </Modal>

      <Modal isOpen={modal === 'close'} onClose={() => setModal(null)} title="تأكيد إغلاق الملف" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>تراجع</Button><Button disabled={saving} onClick={() => post(`/api/custodies/${id}/settle`, { confirm: true, returned_cash: form.returned_cash, bank_safe_id: form.bank_safe_id, date: form.date, description: form.description })}>أؤكد الإغلاق</Button></div>}>
        <div className="space-y-3">
          <p className="text-sm">المتبقي الحالي: <b>{formatCurrency(file.remaining_amount)}</b></p>
          <p className="text-xs text-text-muted">المرتجع يدخل الخزينة. ما يزيد عن المرتجع يُسجَّل سلفة (1160) على راتب الموظف. لا يُغلق الملف مرتين.</p>
          <Input label="مرتجع نقدي" type="number" value={form.returned_cash} onChange={(e) => setForm({ ...form, returned_cash: parseFloat(e.target.value) || 0 })} />
          <Select label="خزينة المرتجع" value={form.bank_safe_id} onChange={(v) => setForm({ ...form, bank_safe_id: v })}
            options={[{ value: '', label: 'اختر' }, ...banks.map((b: any) => ({ value: b.id, label: b.name }))]} />
        </div>
      </Modal>
    </div>
  );
}
