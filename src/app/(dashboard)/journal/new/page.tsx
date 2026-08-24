'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { toDateInput } from '@/lib/form-utils';

interface JournalLine { accountCode: string; debit: number; credit: number; description: string; }

interface AccountNode { code: string; name: string; is_header?: boolean; children?: AccountNode[]; }
interface FlatAccount { code: string; name: string; label: string; depth: number; isParent: boolean; }
interface RawLine { account_code?: string; accountCode?: string; debit?: number; credit?: number; description?: string; }
interface JournalForm { date: string; type: string; description: string; lines: JournalLine[]; }

function flatten(accounts: AccountNode[], depth = 0, out: FlatAccount[] = []): FlatAccount[] {
  for (const a of accounts || []) {
    const isParent = Boolean(a.is_header) || Boolean(a.children && a.children.length > 0);
    out.push({
      code: a.code,
      name: a.name,
      label: `${'  '.repeat(depth)}\u202A${a.code}\u202C — ${a.name}${isParent ? ' (حساب رئيسي — غير قابل للترحيل)' : ''}`,
      depth,
      isParent,
    });
    if (a.children && a.children.length) flatten(a.children, depth + 1, out);
  }
  return out;
}

function moneyInput(value: number) {
  return value ? String(value) : '';
}

export default function NewJournalPage() {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<FlatAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<JournalForm>({
    date: new Date().toISOString().split('T')[0],
    type: 'general',
    description: '',
    lines: [
      { accountCode: '', debit: 0, credit: 0, description: '' },
      { accountCode: '', debit: 0, credit: 0, description: '' },
    ],
  });

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('edit');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditId(p);
    fetch(`/api/accounts?_ts=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => { if (j.success) setAccounts(flatten(j.data?.accounts || [])); });

    if (p) {
      fetch(`/api/journal/${p}`, { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((j) => {
          if (j.success && j.data) {
            const d = j.data;
            setForm({
              date: toDateInput(d.date),
              type: d.type || 'general',
              description: d.description || '',
              lines:
                (d.lines || []).map((l: RawLine) => ({
                  accountCode: l.account_code || l.accountCode || '',
                  debit: Number(l.debit) || 0,
                  credit: Number(l.credit) || 0,
                  description: l.description || '',
                })),
            });
          } else {
            toast.error(j.message || 'تعذر تحميل القيد للتعديل');
          }
        })
        .catch(() => toast.error('تعذر تحميل القيد للتعديل'));
    }
  }, []);

  const updateLine = (i: number, field: string, value: string | number) => {
    setForm((f) => {
      const lines = [...f.lines];
      const line: JournalLine = { ...lines[i], [field]: value };
      if (field === 'debit' && Number(value) > 0) line.credit = 0;
      if (field === 'credit' && Number(value) > 0) line.debit = 0;
      lines[i] = line;
      return { ...f, lines };
    });
  };

  const addLine = () =>
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { accountCode: '', debit: 0, credit: 0, description: '' }],
    }));

  const removeLine = (i: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_o: JournalLine, idx: number) => idx !== i) }));

  const totalDebit = form.lines.reduce((s: number, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = form.lines.reduce((s: number, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const handleSave = async () => {
    if (!form.date) { setSaveError('يجب إدخال التاريخ'); return; }
    if (!form.description) { setSaveError('يجب إدخال البيان'); return; }
    if (form.lines.length < 2) { setSaveError('يجب إضافة سطرين على الأقل'); return; }
    if (form.lines.some((l) => !l.accountCode)) { setSaveError('يجب اختيار حساب لجميع السطور'); return; }
    if (form.lines.some((l) => Number(l.debit) > 0 && Number(l.credit) > 0)) {
      setSaveError('لا يمكن إدخال مدين ودائن معاً في نفس السطر'); return;
    }
    if (form.lines.some((l) => !(Number(l.debit) > 0 || Number(l.credit) > 0))) {
      setSaveError('كل سطر يجب أن يكون مديناً أو دائناً (قيمة أكبر من صفر)'); return;
    }
    if (!balanced) {
      setSaveError(`القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}`); return;
    }

    setSaving(true); setSaveError('');
    try {
      const url = editId ? `/api/journal/${editId}` : '/api/journal';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          type: form.type,
          description: form.description,
          lines: form.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(editId ? 'تم تحديث القيد' : 'تم حفظ القيد');
        router.push('/journal');
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch {
      setSaveError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  const accountOptions = [
    { value: '', label: 'اختر حساباً فرعياً للترحيل...' },
    ...accounts.map((a) => ({
      value: a.code,
      label: a.label,
      disabled: a.isParent,
    })),
  ];

  const amountField = (i: number, field: 'debit' | 'credit', label: string) => (
    <Input
      label={label}
      inputMode="decimal"
      type="text"
      autoComplete="off"
      placeholder="0.00"
      dir="ltr"
      className="font-mono text-base"
      value={moneyInput(form.lines[i][field])}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.]/g, '');
        updateLine(i, field, raw === '' ? 0 : parseFloat(raw) || 0);
      }}
    />
  );

  return (
    <div className="w-full max-w-5xl mx-auto pb-28 sm:pb-8">
      <PageHeader
        title={editId ? 'تعديل قيد' : 'تسجيل قيد جديد'}
        description="تسجيل الأطراف المدينة والدائنة على الحسابات الفرعية"
        actions={<Button variant="ghost" onClick={() => router.push('/journal')} leftIcon={<ArrowRight size={16} />}>رجوع للقيود</Button>}
      />

      <div className="space-y-5 mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={[{ value: 'general', label: 'عام' }, { value: 'opening_balance', label: 'افتتاحي' }, { value: 'accrual', label: 'استحقاق' }]} />
        </div>

        <Textarea label="البيان العام للقيد" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm text-text-primary">بنود القيد</h3>
            <span className="text-xs text-text-muted hidden sm:inline">حساب فرعي فقط — سطر مدين أو دائن</span>
          </div>

          <div className="space-y-3">
            {form.lines.map((line: JournalLine, i: number) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-bg-card p-3 sm:p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-text-muted">سطر {i + 1}</span>
                  {form.lines.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-danger hover:bg-danger/10 p-2 rounded-lg min-h-11 min-w-11 inline-flex items-center justify-center"
                      title="حذف السطر"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <Select
                  label="الحساب"
                  searchable
                  value={line.accountCode}
                  onChange={(v) => updateLine(i, 'accountCode', v)}
                  options={accountOptions}
                  placeholder="بحث بالرمز أو الاسم..."
                />
                <Input
                  label="البيان (اختياري)"
                  placeholder="بيان السطر"
                  value={line.description}
                  onChange={(e) => updateLine(i, 'description', e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  {amountField(i, 'debit', 'مدين')}
                  {amountField(i, 'credit', 'دائن')}
                </div>
              </div>
            ))}
          </div>

          <Button variant="ghost" onClick={addLine} leftIcon={<Plus size={16} />} className="w-full sm:w-auto">
            إضافة سطر
          </Button>
        </div>

        {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}

        <div className="hidden sm:flex gap-2">
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ القيد'}</Button>
          <Button variant="ghost" onClick={() => router.push('/journal')}>إلغاء</Button>
        </div>
      </div>

      {/* شريط إجمالي ثابت أسفل الشاشة — لا يغطي الحقول لأن الصفحة لها padding-bottom */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-bg-card/95 backdrop-blur-md px-4 py-3 sm:static sm:mt-4 sm:rounded-xl sm:border sm:bg-bg-card sm:backdrop-blur-none">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex justify-between sm:justify-start gap-4 font-mono text-sm">
            <span>مدين <strong className="text-text-primary">{totalDebit.toFixed(2)}</strong></span>
            <span>دائن <strong className="text-text-primary">{totalCredit.toFixed(2)}</strong></span>
            <span className={balanced ? 'text-success' : 'text-danger'}>
              {balanced ? 'متوازن' : `فرق ${(totalDebit - totalCredit).toFixed(2)}`}
            </span>
          </div>
          <div className="flex gap-2 sm:hidden">
            <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'جاري الحفظ...' : 'حفظ القيد'}</Button>
            <Button variant="ghost" onClick={() => router.push('/journal')}>إلغاء</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
