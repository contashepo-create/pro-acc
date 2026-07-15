'use client';

import { useState, useEffect } from 'react';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { formatDate, formatCurrency } from '@/lib/utils';

interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
}

export default function JournalPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState<any>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    type: 'general',
    description: '',
    lines: [
      { accountCode: '', debit: 0, credit: 0, description: '' },
      { accountCode: '', debit: 0, credit: 0, description: '' },
    ] as JournalLine[],
  });

  const handleSave = async () => {
    if (!form.date) {
      setSaveError('يجب إدخال التاريخ');
      return;
    }
    if (!form.description) {
      setSaveError('يجب إدخال البيان');
      return;
    }
    if (form.lines.length < 2) {
      setSaveError('يجب إضافة سطرين على الأقل');
      return;
    }
    if (form.lines.some(l => !l.accountCode)) {
      setSaveError('يجب اختيار حساب لجميع السطور');
      return;
    }

    const totalDebit = form.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = form.lines.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      setSaveError(`القيد غير متوازن: مدين ${totalDebit} != دائن ${totalCredit}`);
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          type: form.type,
          description: form.description,
          lines: form.lines.map(l => ({
            accountCode: l.accountCode,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          date: new Date().toISOString().split('T')[0],
          type: 'general',
          description: '',
          lines: [
            { accountCode: '', debit: 0, credit: 0, description: '' },
            { accountCode: '', debit: 0, credit: 0, description: '' },
          ],
        });
        window.location.reload();
      } else {
        setSaveError(json.message || 'فشل الحفظ');
      }
    } catch (e) {
      setSaveError('خطأ في الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { accountCode: '', debit: 0, credit: 0, description: '' }],
    });
  };

  const removeLine = (index: number) => {
    if (form.lines.length <= 2) return;
    setForm({
      ...form,
      lines: form.lines.filter((_: any, i: number) => i !== index),
    });
  };

  const updateLine = (index: number, field: keyof JournalLine, value: any) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const totalDebit = form.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = form.lines.reduce((sum, l) => sum + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) <= 0.01;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [entRes, accRes] = await Promise.all([
          fetch('/api/journal'),
          fetch('/api/accounts'),
        ]);
        const [entJson, accJson] = await Promise.all([
          entRes.json(),
          accRes.json(),
        ]);
        if (entJson.success) {
          setEntries(entJson.data?.entries || []);
        } else {
          setError(entJson.message || 'فشل تحميل البيانات');
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

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true },
    { key: 'date', label: 'التاريخ', sortable: true, render: (row: any) => formatDate(row.date) },
    { key: 'description', label: 'البيان', sortable: true },
    { key: 'type', label: 'النوع', sortable: true, render: (row: any) => <Badge variant={row.type === 'closing' ? 'warning' : 'info'}>{row.type}</Badge> },
    { key: 'total_debit', label: 'المدين', render: (row: any) => formatCurrency(row.total_debit || 0) },
    { key: 'total_credit', label: 'الدائن', render: (row: any) => formatCurrency(row.total_credit || 0) },
    {
      key: 'actions', label: '', render: (row: any) => (
        <Button variant="ghost" size="sm" onClick={() => setShowDetail(row)}><Eye size={16} /></Button>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="القيود المحاسبية" description="إدخال وعرض القيود اليومية"
          actions={<Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>إضافة قيد</Button>}
        />
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="القيود المحاسبية"
        description="إدخال وعرض القيود اليومية"
        actions={
          <Button onClick={() => setShowModal(true)} leftIcon={<Plus size={18} />}>
            إضافة قيد
          </Button>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="لا توجد قيود" description="أضف قيداً محاسبياً جديداً" actionLabel="إضافة قيد" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={entries} searchable searchKeys={['description', 'number']} />
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="إضافة قيد محاسبي" size="xl" footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button>
        </div>
      }>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Select
              label="النوع"
              value={form.type}
              onChange={(value) => setForm({...form, type: value})}
              options={[
                { value: 'general', label: 'عام' },
                { value: 'opening_balance', label: 'افتتاحي' },
                { value: 'accrual', label: 'استحقاق' },
              ]}
            />
          </div>

          <Textarea
            label="البيان"
            value={form.description}
            onChange={(e) => setForm({...form, description: e.target.value})}
            placeholder="شرح القيد المحاسبي"
          />

          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <th className="p-2 text-right">الحساب</th>
                  <th className="p-2 text-right w-28">مدين</th>
                  <th className="p-2 text-right w-28">دائن</th>
                  <th className="p-2 text-right">البيان</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {form.lines.map((line, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">
                      <Select
                        value={line.accountCode}
                        onChange={(value) => updateLine(i, 'accountCode', value)}
                        options={[
                          { value: '', label: 'اختر حساباً' },
                          ...accounts.filter(a => !a.parent_id || a.children?.length === 0).map(a => ({
                            value: a.code,
                            label: `${a.code} - ${a.name}`,
                          })),
                        ]}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={line.debit}
                        onChange={(e) => updateLine(i, 'debit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={line.credit}
                        onChange={(e) => updateLine(i, 'credit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        placeholder="شرح"
                        value={line.description}
                        onChange={(e) => updateLine(i, 'description', e.target.value)}
                      />
                    </td>
                    <td className="p-2">
                      {form.lines.length > 2 && (
                        <Button variant="ghost" size="sm" onClick={() => removeLine(i)}>
                          <Trash2 size={14} className="text-danger" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center">
            <Button variant="ghost" onClick={addLine} leftIcon={<Plus size={16} />}>
              إضافة سطر
            </Button>
            <div className="text-left space-y-1 text-sm">
              <div>المدين: <strong className={totalDebit > 0 ? 'text-success' : ''}>{formatCurrency(totalDebit)}</strong></div>
              <div>الدائن: <strong className={totalCredit > 0 ? 'text-success' : ''}>{formatCurrency(totalCredit)}</strong></div>
              <div className={`text-lg font-bold ${isBalanced ? 'text-success' : 'text-danger'}`}>
                {isBalanced ? '✅ متوازن' : `❌ الفرق: ${formatCurrency(Math.abs(totalDebit - totalCredit))}`}
              </div>
            </div>
          </div>

          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

      <Modal isOpen={!!showDetail} onClose={() => setShowDetail(null)} title={`قيد رقم #${showDetail?.number || ''}`} size="lg">
        {showDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><span className="text-text-muted">التاريخ:</span> {formatDate(showDetail.date)}</div>
              <div><span className="text-text-muted">النوع:</span> {showDetail.type}</div>
              <div className="col-span-2"><span className="text-text-muted">البيان:</span> {showDetail.description}</div>
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary">
                  <tr>
                    <th className="p-2 text-right">الحساب</th>
                    <th className="p-2 text-right">مدين</th>
                    <th className="p-2 text-right">دائن</th>
                    <th className="p-2 text-right">البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {(showDetail.lines || []).map((line: any, i: number) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2">{line.account_name || line.account_code}</td>
                      <td className="p-2">{formatCurrency(line.debit)}</td>
                      <td className="p-2">{formatCurrency(line.credit)}</td>
                      <td className="p-2">{line.description}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-bg-secondary font-bold">
                  <tr>
                    <td className="p-2">الإجمالي</td>
                    <td className="p-2">{formatCurrency(showDetail.total_debit || 0)}</td>
                    <td className="p-2">{formatCurrency(showDetail.total_credit || 0)}</td>
                    <td className="p-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
