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

interface JournalLine { accountCode: string; debit: number; credit: number; description: string; }

function flatten(accounts: any[], depth = 0, out: any[] = []): any[] {
  for (const a of accounts || []) {
    const isParent = Boolean(a.children && a.children.length > 0);
    out.push({
      code: a.code,
      name: a.name,
      label: `${'  '.repeat(depth)}${a.code} — ${a.name}${isParent ? ' (حساب رئيسي — غير قابل للترحيل)' : ''}`,
      depth,
      isParent,
    });
    if (a.children && a.children.length) flatten(a.children, depth + 1, out);
  }
  return out;
}

export default function NewJournalPage() {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
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
    setEditId(p);
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((j) => { if (j.success) setAccounts(flatten(j.data?.accounts || [])); });

    if (p) {
      fetch(`/api/journal/${p}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.success) {
            const d = j.data;
            setForm({
              date: d.date,
              type: d.type,
              description: d.description,
              lines:
                d.lines?.map((l: any) => ({
                  accountCode: l.account_code,
                  debit: l.debit,
                  credit: l.credit,
                  description: l.description || '',
                })) || [{ accountCode: '', debit: 0, credit: 0, description: '' }],
            });
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateLine = (i: number, field: string, value: any) => {
    setForm((f: any) => {
      const lines = [...f.lines];
      const line: any = { ...lines[i], [field]: value };
      // مدين ودائن متعاكسان: إدخال أحدهما يصفّر الآخر
      if (field === 'debit' && Number(value) > 0) line.credit = 0;
      if (field === 'credit' && Number(value) > 0) line.debit = 0;
      lines[i] = line;
      return { ...f, lines };
    });
  };

  const addLine = () =>
    setForm((f: any) => ({
      ...f,
      lines: [...f.lines, { accountCode: '', debit: 0, credit: 0, description: '' }],
    }));

  const removeLine = (i: number) =>
    setForm((f: any) => ({ ...f, lines: f.lines.filter((_: any, idx: number) => idx !== i) }));

  const handleSave = async () => {
    if (!form.date) { setSaveError('يجب إدخال التاريخ'); return; }
    if (!form.description) { setSaveError('يجب إدخال البيان'); return; }
    if (form.lines.length < 2) { setSaveError('يجب إضافة سطرين على الأقل'); return; }
    if (form.lines.some((l: any) => !l.accountCode)) { setSaveError('يجب اختيار حساب لجميع السطور'); return; }
    if (form.lines.some((l: any) => Number(l.debit) > 0 && Number(l.credit) > 0)) {
      setSaveError('لا يمكن إدخال مدين ودائن معاً في نفس السطر'); return;
    }
    if (form.lines.some((l: any) => !(Number(l.debit) > 0 || Number(l.credit) > 0))) {
      setSaveError('كل سطر يجب أن يكون مديناً أو دائناً (قيمة أكبر من صفر)'); return;
    }
    const totalDebit = form.lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
    const totalCredit = form.lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      setSaveError(`القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}`); return;
    }

    setSaving(true); setSaveError('');
    try {
      const url = editId ? `/api/journal/${editId}` : '/api/journal';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          type: form.type,
          description: form.description,
          lines: form.lines.map((l: any) => ({
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

  return (
    <div className="max-w-5xl mx-auto p-6">
      <PageHeader
        title={editId ? 'تعديل قيد' : 'تسجيل قيد جديد'}
        description="تسجيل الأطراف المدينة والدائنة مقيدة بالحسابات الفرعية وفق المعايير المحاسبية العالمية"
        actions={<Button variant="ghost" onClick={() => router.push('/journal')} leftIcon={<ArrowRight size={16} />}>رجوع للقيود</Button>}
      />

      <div className="space-y-6 mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={[{ value: 'general', label: 'عام' }, { value: 'opening_balance', label: 'افتتاحي' }, { value: 'accrual', label: 'استحقاق' }]} />
        </div>

        <Textarea label="البيان العام للقيد" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div className="bg-bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h3 className="font-bold text-sm text-text-primary">بنود وشروط القيد (مدين / دائن)</h3>
            <span className="text-xs text-text-muted">ملاحظة: يُسمح بالترحيل المباشر على الحسابات الفرعية فقط</span>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary text-text-muted">
                <tr>
                  <th className="p-3 text-right min-w-[280px]">الحساب الفرعي (Posting Account)</th>
                  <th className="p-3 text-right">البيان الفرعي</th>
                  <th className="p-3 text-right w-36">مدين (Debit)</th>
                  <th className="p-3 text-right w-36">دائن (Credit)</th>
                  <th className="p-3 w-12 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {form.lines.map((line: any, i: number) => (
                  <tr key={i} className="hover:bg-bg-hover/50 align-middle">
                    <td className="p-2.5">
                      <Select
                        searchable
                        value={line.accountCode}
                        onChange={(v) => updateLine(i, 'accountCode', v)}
                        options={accountOptions}
                        placeholder="بحث بالرمز أو اسم الحساب الفرعي..."
                      />
                    </td>
                    <td className="p-2.5">
                      <Input
                        placeholder="بيان السطر (اختياري)"
                        value={line.description}
                        onChange={(e) => updateLine(i, 'description', e.target.value)}
                      />
                    </td>
                    <td className="p-2.5">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={line.debit || ''}
                        onChange={(e) => updateLine(i, 'debit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2.5">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        placeholder="0.00"
                        value={line.credit || ''}
                        onChange={(e) => updateLine(i, 'credit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(i)}
                        className="text-danger hover:text-danger/80 p-1.5 rounded-lg hover:bg-danger/10 transition-colors"
                        title="حذف السطر"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={addLine} leftIcon={<Plus size={16} />}>
              إضافة سطر جديد
            </Button>
            <div className="text-xs text-text-muted flex gap-4 font-mono">
              <span>إجمالي المدين: <strong className="text-text-primary">{form.lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0).toFixed(2)}</strong></span>
              <span>إجمالي الدائن: <strong className="text-text-primary">{form.lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0).toFixed(2)}</strong></span>
            </div>
          </div>
        </div>

        {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ القيد'}</Button>
          <Button variant="ghost" onClick={() => router.push('/journal')}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}
