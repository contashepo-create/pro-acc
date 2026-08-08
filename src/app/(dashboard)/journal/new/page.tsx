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
    out.push({ code: a.code, name: a.name, label: `${'  '.repeat(depth)}${a.code} — ${a.name}`, depth });
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
    { value: '', label: 'اختر حساباً' },
    ...accounts.map((a) => ({ value: a.code, label: a.label })),
  ];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <PageHeader
        title={editId ? 'تعديل قيد' : 'تسجيل قيد جديد'}
        description="كل سطر يمثل حساباً واحداً: مدين أو دائن (لا كلاهما)"
        actions={<Button variant="ghost" onClick={() => router.push('/journal')} leftIcon={<ArrowRight size={16} />}>رجوع للقيود</Button>}
      />

      <div className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={[{ value: 'general', label: 'عام' }, { value: 'opening_balance', label: 'افتتاحي' }, { value: 'accrual', label: 'استحقاق' }]} />
        </div>

        <Textarea label="البيان" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />

        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary text-text-muted">
              <tr>
                <th className="p-2 text-right min-w-[260px]">الحساب</th>
                <th className="p-2 text-right">البيان</th>
                <th className="p-2 text-right w-32">مدين</th>
                <th className="p-2 text-right w-32">دائن</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line: any, i: number) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2"><Select value={line.accountCode} onChange={(v) => updateLine(i, 'accountCode', v)} options={accountOptions} /></td>
                  <td className="p-2"><Input value={line.description} onChange={(e) => updateLine(i, 'description', e.target.value)} /></td>
                  <td className="p-2"><Input type="number" value={line.debit} onChange={(e) => updateLine(i, 'debit', parseFloat(e.target.value) || 0)} /></td>
                  <td className="p-2"><Input type="number" value={line.credit} onChange={(e) => updateLine(i, 'credit', parseFloat(e.target.value) || 0)} /></td>
                  <td className="p-2"><button onClick={() => removeLine(i)} className="text-danger"><Trash2 size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button variant="ghost" onClick={addLine} leftIcon={<Plus size={16} />}>إضافة سطر</Button>

        {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ القيد'}</Button>
          <Button variant="ghost" onClick={() => router.push('/journal')}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}
