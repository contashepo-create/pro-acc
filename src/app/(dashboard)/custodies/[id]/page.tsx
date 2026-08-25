'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, Plus, Receipt, Lock, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { formatCurrency, formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

// حسابات مصروف شائعة من شجرة الحسابات الافتراضية:
// 5100–5140 تكلفة مشروع، 5200/5300/5400 مصروفات تشغيلية/عمومية للشركة.
const EXPENSE_ACCOUNT_OPTIONS = [
  { value: '5100', label: 'تكلفة مباشرة (مشروع)' },
  { value: '5110', label: 'مواد خام' },
  { value: '5120', label: 'أجور عمالة مباشرة' },
  { value: '5130', label: 'تكاليف مقاولي باطن' },
  { value: '5140', label: 'إيجار معدات' },
  { value: '5210', label: 'رواتب وأجور' },
  { value: '5220', label: 'إيجارات' },
  { value: '5230', label: 'كهرباء ومياه' },
  { value: '5240', label: 'اتصالات وانترنت' },
  { value: '5250', label: 'صيانة' },
  { value: '5270', label: 'محروقات' },
  { value: '5280', label: 'قرطاسية ومطبوعات' },
  { value: '5290', label: 'مصروفات بنكية' },
  { value: '5400', label: 'مصروفات إدارية وعمومية' },
];

interface CustodyTransaction {
  id: string;
  type: string;
  date?: string;
  created_at?: string;
  description?: string;
  amount?: number;
}
interface CustodyFile {
  id: string;
  file_number?: string;
  employee_name?: string;
  date?: string;
  status?: string;
  computed_status?: string;
  is_closed?: boolean;
  bank_safe_id?: string;
  project_id?: string;
  project_name?: string;
  reason?: string;
  description?: string;
  amount?: number;
  total_received?: number;
  total_expenses?: number;
  remaining_amount?: number;
  transactions?: CustodyTransaction[];
}
interface BankSafeOption { id: string; name: string; }
interface ContactOption { id: string; name: string; }
interface ProjectOption { id: string; name: string; }
interface CustodyForm {
  amount?: number;
  date: string;
  bank_safe_id?: string;
  description?: string;
  allow_excess?: boolean;
  returned_cash?: number;
  supplier_id?: string;
  project_mode?: string;
  project_id?: string;
}
interface ExpenseForm {
  amount: number;
  date: string;
  description?: string;
  expense_account_code: string;
  project_mode?: string;
  project_id?: string;
  allow_excess: boolean;
}

export default function CustodyFilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [file, setFile] = useState<CustodyFile | null>(null);
  const [banks, setBanks] = useState<BankSafeOption[]>([]);
  const [suppliers, setSuppliers] = useState<ContactOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'add' | 'expense' | 'general' | 'close' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CustodyForm>({ amount: 0, date: new Date().toISOString().split('T')[0], bank_safe_id: '', description: '', allow_excess: false, returned_cash: 0 });
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({ amount: 0, date: new Date().toISOString().split('T')[0], description: '', expense_account_code: '5100', project_mode: 'none', project_id: '', allow_excess: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, bRes, sRes, pRes] = await Promise.all([
        fetch(`/api/custodies/${id}`), fetch('/api/banks'), fetch('/api/contacts?type=supplier'), fetch('/api/projects'),
      ]);
      const [fJson, bJson, sJson, pJson] = await Promise.all([fRes.json(), bRes.json(), sRes.json(), pRes.json()]);
      if (!fJson.success) setError(fJson.message || 'تعذر التحميل');
      else setFile(fJson.data);
      if (bJson.success) setBanks(bJson.data?.banks || []);
      if (sJson.success) setSuppliers(sJson.data?.suppliers || sJson.data?.contacts || []);
      if (pJson.success) setProjects(pJson.data?.projects || pJson.data?.rows || []);
    } catch { setError('خطأ في الاتصال'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const closed = file?.is_closed || file?.status === 'settled';

  const post = async (url: string, body: Record<string, unknown>) => {
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
  const st = statusMap[file.computed_status || file.status || ''] || statusMap.open;

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
          <Button size="sm" variant="secondary" leftIcon={<Receipt size={14} />} onClick={() => { setForm({ amount: 0, date: new Date().toISOString().split('T')[0], description: '', supplier_id: '', project_mode: file.project_id ? 'custody' : 'none', project_id: file.project_id || '', allow_excess: false }); setModal('expense'); }}>فاتورة مدفوعة من العهدة</Button>
          <Button size="sm" variant="secondary" leftIcon={<Wallet size={14} />} onClick={() => { setExpenseForm({ amount: 0, date: new Date().toISOString().split('T')[0], description: '', expense_account_code: '5100', project_mode: file.project_id ? 'custody' : 'none', project_id: file.project_id || '', allow_excess: false }); setModal('general'); }}>مصروف / مصروف تشغيلي</Button>
          <Button size="sm" variant="outline" leftIcon={<Lock size={14} />} onClick={() => { setForm({ returned_cash: file.remaining_amount, date: new Date().toISOString().split('T')[0], bank_safe_id: file.bank_safe_id || '', description: '' }); setModal('close'); }}>إغلاق الملف</Button>
        </div>
      )}

      <Card title="حركة الملف">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="text-text-muted border-b border-border">
                <th className="py-2">التاريخ</th>
                <th className="py-2">النوع</th>
                <th className="py-2">البيان</th>
                <th className="py-2">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {(file.transactions || []).length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-text-muted">لا حركات بعد الافتتاح</td></tr>
              )}
              {(file.transactions || []).map((t: CustodyTransaction) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2 whitespace-nowrap">{t.created_at ? new Date(t.created_at).toISOString().slice(0, 10) : '—'}</td>
                  <td className="py-2">{t.type === 'addition' ? (Number(t.amount) === Number(file.total_received) && String(t.description || '').startsWith('افتتاح') ? 'افتتاح' : 'تعزيز') : t.type === 'expense' ? 'مصروف' : t.type === 'shortage' ? 'عجز' : t.type === 'surplus' ? 'زيادة' : t.type === 'return' ? 'مرتجع' : t.type}</td>
                  <td className="py-2">{t.description}</td>
                  <td className="py-2 font-mono">{formatCurrency(Number(t.amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">التاريخ: {formatDate(file.date)} — المصروف يُخصم من 1150 فلا يُصرف نقداً مرة أخرى. الإغلاق لا يتم إلا بتأكيد.</p>
      </Card>

      <Modal isOpen={modal === 'add'} onClose={() => setModal(null)} title="تعزيز الملف" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button><Button disabled={saving} onClick={() => post(`/api/custodies/${id}/add`, {
        amount: form.amount, date: form.date, bank_safe_id: form.bank_safe_id, description: form.description,
      })}>ترحيل التعزيز</Button></div>}>
        <div className="space-y-3">
          <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="الملاحظات" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="سبب التعزيز (اختياري)" />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="المصدر" value={form.bank_safe_id} onChange={(v) => setForm({ ...form, bank_safe_id: v })}
            options={[{ value: '', label: 'اختر' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]} />
          <Input label="البيان" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </Modal>

      <Modal isOpen={modal === 'expense'} onClose={() => setModal(null)} title="فاتورة مشتريات مدفوعة من العهدة" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button><Button disabled={saving} onClick={() => {
        if (!form.supplier_id || !form.amount) { toast.error('المورد والمبلغ مطلوبان'); return; }
        const link_to_project = form.project_mode !== 'none';
        const project_id = form.project_mode === 'other' ? form.project_id : (form.project_mode === 'custody' ? file.project_id : null);
        post('/api/purchases/invoices', {
          date: form.date,
          supplier_id: form.supplier_id,
          items: [{ description: form.description || 'مشتريات من عهدة', quantity: 1, unit_price: form.amount }],
          tax_rate: 0,
          notes: `مدفوعة من ملف ${file.file_number || ''}`,
          custody_id: id,
          project_id: project_id || null,
          link_to_project,
        });
      }}>إنشاء وخصم من الملف</Button></div>}>
        <div className="space-y-3">
          <p className="text-xs text-text-muted">فاتورة رسمية مدفوعة: مدين مصروف / دائن 1150. المشروع افتراضي من الملف ويمكن فكه أو تغييره.</p>
          <Select label="المورد" value={form.supplier_id || ''} onChange={(v) => setForm({ ...form, supplier_id: v })}
            options={[{ value: '', label: 'اختر المورد' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
          <Input label="المبلغ" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="بيان الفاتورة" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Select
            label="ربط المشروع"
            value={form.project_mode || (file.project_id ? 'custody' : 'none')}
            onChange={(v) => setForm({ ...form, project_mode: v })}
            options={[
              { value: 'custody', label: file.project_name ? `مشروع الملف (${file.project_name})` : 'مشروع الملف (غير محدد)' },
              { value: 'none', label: 'بدون مشروع' },
              { value: 'other', label: 'مشروع آخر…' },
            ]}
          />
          {form.project_mode === 'other' && (
            <Select label="المشروع" value={form.project_id || ''} onChange={(v) => setForm({ ...form, project_id: v })}
              options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          )}
        </div>
      </Modal>

      <Modal isOpen={modal === 'general'} onClose={() => setModal(null)} title="مصروف من العهدة (عام / تشغيلي)" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button><Button disabled={saving} onClick={() => {
        if (!expenseForm.amount || !expenseForm.description?.trim()) { toast.error('المبلغ والبيان مطلوبان'); return; }
        post(`/api/custodies/${id}/expense`, {
          amount: expenseForm.amount,
          date: expenseForm.date,
          description: expenseForm.description,
          expense_account_code: expenseForm.expense_account_code,
          link_to_project: expenseForm.project_mode !== 'none',
          project_id: expenseForm.project_mode === 'other' ? expenseForm.project_id : undefined,
          allow_excess: expenseForm.allow_excess,
        });
      }}>ترحيل وخصم من الملف</Button></div>}>
        <div className="space-y-3">
          <p className="text-xs text-text-muted">مصروف بلا فاتورة مورد: مدين حساب المصروف / دائن 1150. حسابات 5100–5140 تكلفة مشروع، و5200/5300/5400 مصروفات تشغيلية/عمومية للشركة.</p>
          <Select label="حساب المصروف" value={expenseForm.expense_account_code} onChange={(v) => setExpenseForm({ ...expenseForm, expense_account_code: v })}
            options={EXPENSE_ACCOUNT_OPTIONS} />
          <Input label="المبلغ" type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: parseFloat(e.target.value) || 0 })} />
          <Input label="التاريخ" type="date" value={expenseForm.date} onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} />
          <Input label="البيان" value={expenseForm.description || ''} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
          <Select
            label="ربط المشروع"
            value={expenseForm.project_mode || (file.project_id ? 'custody' : 'none')}
            onChange={(v) => setExpenseForm({ ...expenseForm, project_mode: v })}
            options={[
              { value: 'custody', label: file.project_name ? `مشروع الملف (${file.project_name})` : 'مشروع الملف (غير محدد)' },
              { value: 'none', label: 'بدون مشروع (مصروف عام للشركة)' },
              { value: 'other', label: 'مشروع آخر…' },
            ]}
          />
          {expenseForm.project_mode === 'other' && (
            <Select label="المشروع" value={expenseForm.project_id || ''} onChange={(v) => setExpenseForm({ ...expenseForm, project_id: v })}
              options={[{ value: '', label: 'اختر مشروعاً' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          )}
          <Checkbox checked={expenseForm.allow_excess} onChange={(v) => setExpenseForm({ ...expenseForm, allow_excess: v })}
            label="السماح بالزيادة (أنفق الموظف من ماله الخاص)" />
        </div>
      </Modal>

      <Modal isOpen={modal === 'close'} onClose={() => setModal(null)} title="تأكيد إغلاق الملف" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => setModal(null)}>تراجع</Button><Button disabled={saving} onClick={() => post(`/api/custodies/${id}/settle`, { confirm: true, returned_cash: form.returned_cash, bank_safe_id: form.bank_safe_id, date: form.date, description: form.description })}>أؤكد الإغلاق</Button></div>}>
        <div className="space-y-3">
          <p className="text-sm">المتبقي الحالي: <b>{formatCurrency(file.remaining_amount ?? 0)}</b></p>
          <p className="text-xs text-text-muted">المرتجع يدخل الخزينة. ما يزيد عن المرتجع يُسجَّل سلفة (1160) على راتب الموظف. لا يُغلق الملف مرتين.</p>
          <Input label="مرتجع نقدي" type="number" value={form.returned_cash} onChange={(e) => setForm({ ...form, returned_cash: parseFloat(e.target.value) || 0 })} />
          <Select label="خزينة المرتجع" value={form.bank_safe_id} onChange={(v) => setForm({ ...form, bank_safe_id: v })}
            options={[{ value: '', label: 'اختر' }, ...banks.map((b) => ({ value: b.id, label: b.name }))]} />
        </div>
      </Modal>
    </div>
  );
}
