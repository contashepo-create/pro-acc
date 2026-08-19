'use client';

import { useState, useEffect } from 'react';
import { Plus, Printer } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { RecordViewModal } from '@/components/ui/RecordViewModal';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency, escapeHtml } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';
import { openPrintWindow } from '@/lib/print';
import { formatDocumentNumber } from '@/lib/document-number';

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingQuotation, setEditingQuotation] = useState<any>(null);
  const [viewingQuotation, setViewingQuotation] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [company, setCompany] = useState<any>(null);
  const [form, setForm] = useState<any>({
    date: new Date().toISOString().split('T')[0],
    contact_id: '',
    valid_until: '',
    notes: '',
    tax_rate: 0.15,
    tax_enabled: true,
    items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [quotRes, cliRes, setRes] = await Promise.all([
        fetch('/api/quotations'),
        fetch('/api/clients'),
        fetch('/api/settings'),
      ]);
      const [quotJson, cliJson, setJson] = await Promise.all([
        quotRes.json(),
        cliRes.json(),
        setRes.json(),
      ]);
      if (quotJson.success) setQuotations(quotJson.data?.quotations || []);
      else setError(quotJson.message || 'فشل');
      if (cliJson.success) setClients(cliJson.data?.clients || []);
      if (setJson.success && setJson.data?.company) setCompany(setJson.data.company);
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.contact_id) { setSaveError('يجب اختيار عميل'); return; }
    const validItems = (form.items || []).filter((it: any) => String(it.description || '').trim() !== '');
    if (validItems.length === 0) { setSaveError('يجب إضافة بند واحد على الأقل بعرض السعر'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingQuotation ? `/api/quotations/${editingQuotation.id}` : '/api/quotations';
      const method = editingQuotation ? 'PUT' : 'POST';
      const payload = { ...form, items: validItems, tax_rate: form.tax_enabled ? Number(form.tax_rate || 0.15) : 0 };
      delete (payload as any).tax_enabled;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setEditingQuotation(null);
        setForm({
          date: new Date().toISOString().split('T')[0],
          contact_id: '',
          valid_until: '',
          notes: '',
          tax_rate: 0.15,
          tax_enabled: true,
          items: [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch (e: any) { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const handleEdit = async (quotation: any) => {
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingQuotation(quotation);
        const d = json.data;
        setForm({
          date: toDateInput(d.date),
          contact_id: d.contact_id || '',
          valid_until: toDateInput(d.valid_until),
          notes: d.notes || '',
          tax_rate: d.tax_rate ?? 0.15,
          tax_enabled: Number(d.tax_rate || 0) > 0,
          items: (d.items || []).length
            ? d.items
            : [{ description: '', quantity: 1, unit_price: 0, total: 0 }],
        });
        setShowModal(true);
      } else {
        toast.error(json.message || 'تعذر تحميل عرض السعر');
      }
    } catch (e) {
      console.error('Failed to load quotation:', e);
      toast.error('تعذر تحميل عرض السعر');
    }
  };

  const handleDelete = async (quotation: any) => {
    try {
      const res = await fetch(`/api/quotations/${quotation.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchData();
      } else {
        alert(json.message || 'فشل الحذف');
      }
    } catch (e) {
      alert('خطأ في الاتصال بالخادم');
    }
  };

  // طباعة عرض السعر بشكل احترافي كفاتورة، بعنوان "عرض سعر" في الأعلى.
  const printQuotation = async (quotation: any) => {
    let items = quotation.items;
    if (!items || !items.length) {
      try {
        const res = await fetch(`/api/quotations/${quotation.id}`);
        const json = await res.json();
        if (json.success) items = json.data.items;
      } catch { /* ignore */ }
    }
    const itemsHtml = (items || [])
      .map((it: any) => `<tr>
        <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:right">${escapeHtml(String(it.description || ''))}</td>
        <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:center;white-space:nowrap">${Number(it.quantity || 0)}</td>
        <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:center;white-space:nowrap">${Number(it.unit_price || 0).toFixed(2)}</td>
        <td style="padding:8px 10px;border:1px solid #d8dee9;text-align:left;white-space:nowrap;font-weight:700">${Number(it.total || 0).toFixed(2)}</td>
      </tr>`)
      .join('');
    const subtotal = Number(quotation.subtotal || 0);
    const taxAmount = Number(quotation.tax_amount || 0);
    const total = Number(quotation.total || 0);
    const companyName = escapeHtml(String(company?.name || ''));
    const companyTax = escapeHtml(String(company?.tax_number || ''));
    const companyPhone = escapeHtml(String(company?.phone || ''));
    const clientName = escapeHtml(String(quotation.contact_name || ''));
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>عرض سعر رقم ${quotation.number}</title>
      <style>
        body{font-family:Tahoma,Arial,sans-serif;color:#0f172a;padding:0;margin:0;background:#fff}
        .page{max-width:820px;margin:0 auto;padding:32px}
        .doc{border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
        .bar{height:6px;background:linear-gradient(90deg,#2563eb,#4f46e5)}
        .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:22px 26px;border-bottom:1px solid #e2e8f0}
        .title{font-size:22px;font-weight:800;color:#1d4ed8;margin:0}
        .subtitle{font-size:12px;color:#64748b;margin:2px 0 0}
        .num{background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:14px;padding:6px 12px;border-radius:8px;display:inline-block;margin-top:10px}
        .meta{font-size:12px;color:#334155;line-height:1.9;text-align:left}
        .section{padding:16px 26px;border-bottom:1px solid #e2e8f0}
        .section h3{font-size:13px;font-weight:800;color:#334155;margin:0 0 8px}
        table{width:100%;border-collapse:collapse}
        th{background:#f1f5f9;color:#334155;font-size:12px;padding:9px 10px;border:1px solid #d8dee9;text-align:right}
        td{font-size:12px;color:#0f172a}
        .totals{display:flex;flex-direction:column;gap:6px;align-items:flex-end;padding:6px 0}
        .totals .row{display:flex;justify-content:space-between;width:300px;font-size:13px;color:#334155}
        .grand{display:flex;justify-content:space-between;width:300px;font-size:16px;font-weight:800;color:#1d4ed8;border-top:2px solid #0f172a;padding-top:8px;margin-top:4px}
        .footer{text-align:center;font-size:11px;color:#94a3b8;padding:14px}
        .muted{color:#64748b;font-size:12px}
        @media print{button{display:none}.page{padding:0}.doc{border:none;border-radius:0}}
      </style></head><body>
      <div class="page"><div class="doc">
        <div class="bar"></div>
        <div class="head">
          <div>
            <h1 class="title">عرض سعر</h1>
            <p class="subtitle">Quotation — غير ملزم بالدفع</p>
            <span class="num">رقم العرض: ${quotation.number}</span>
          </div>
          <div class="meta">
            ${companyName ? `<div style="font-weight:800;font-size:14px;color:#0f172a">${companyName}</div>` : ''}
            ${companyTax ? `<div>الرقم الضريبي: ${companyTax}</div>` : ''}
            ${companyPhone ? `<div>الهاتف: ${companyPhone}</div>` : ''}
          </div>
        </div>
        <div class="section">
          <div style="display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap">
            <div><h3>العميل</h3><div style="font-weight:700;color:#0f172a">${clientName || '—'}</div></div>
            <div><h3>التاريخ</h3><div>${formatDate(quotation.date)}</div></div>
            ${quotation.valid_until ? `<div><h3>صالح حتى</h3><div>${formatDate(quotation.valid_until)}</div></div>` : ''}
          </div>
        </div>
        <div class="section">
          <table>
            <thead><tr><th style="width:46%">البيان / الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th style="text-align:left">الإجمالي</th></tr></thead>
            <tbody>${itemsHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8">لا توجد بنود</td></tr>'}</tbody>
          </table>
          <div class="totals">
            <div class="row"><span>المجموع الفرعي (قبل الضريبة)</span><span>${subtotal.toFixed(2)}</span></div>
            ${taxAmount > 0 ? `<div class="row"><span>ضريبة القيمة المضافة</span><span>${taxAmount.toFixed(2)}</span></div>` : ''}
            <div class="grand"><span>الإجمالي شامل الضريبة</span><span>${total.toFixed(2)}</span></div>
          </div>
        </div>
        ${quotation.notes ? `<div class="section"><h3>ملاحظات</h3><p class="muted" style="margin:0;line-height:1.8">${escapeHtml(String(quotation.notes))}</p></div>` : ''}
        ${quotation.terms ? `<div class="section"><h3>الشروط</h3><p class="muted" style="margin:0;line-height:1.8">${escapeHtml(String(quotation.terms))}</p></div>` : ''}
        <div class="footer">تم إنشاء هذا العرض إلكترونياً بواسطة ${companyName || 'النظام المحاسبي'} — سارٍ حتى ${quotation.valid_until ? formatDate(quotation.valid_until) : 'تاريخ لاحق'}</div>
      </div></div>
      <p style="text-align:center"><button onclick="window.print()" style="padding:10px 28px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:15px;cursor:pointer">طباعة / حفظ PDF</button></p>
      </body></html>`;
    const result = openPrintWindow(html);
    if (!result.ok) {
      toast.error(result.blocked ? 'منع المتصفح فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.' : 'تعذر فتح نافذة الطباعة.');
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { variant: 'success' | 'warning' | 'info' | 'danger'; label: string }> = {
      draft: { variant: 'warning', label: 'مسودة' },
      sent: { variant: 'info', label: 'مرسل' },
      accepted: { variant: 'success', label: 'مقبول' },
      rejected: { variant: 'danger', label: 'مرفوض' },
      converted: { variant: 'success', label: 'محول' },
    };
    const m = map[status] || { variant: 'warning', label: status };
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  const columns = [
    { key: 'number', label: 'الرقم', sortable: true, render: (row: any) => formatDocumentNumber('quotation', row.number) },
    { key: 'date', label: 'التاريخ', render: (row: any) => formatDate(row.date) },
    { key: 'contact_name', label: 'العميل', sortable: true },
    { key: 'total', label: 'الإجمالي', render: (row: any) => formatCurrency(row.total) },
    { key: 'status', label: 'الحالة', render: (row: any) => statusBadge(row.status) },
    {
      key: 'actions',
      label: 'إجراءات',
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => printQuotation(row)}
            title="طباعة عرض السعر"
          >
            <Printer size={16} className="text-blue-600" />
          </Button>
          <ActionButtons
            item={row}
            onView={async () => {
              try {
                const res = await fetch(`/api/quotations/${row.id}`);
                const json = await res.json();
                if (json.success) setViewingQuotation(json.data);
                else toast.error(json.message || 'تعذر عرض عرض السعر');
              } catch { toast.error('تعذر عرض عرض السعر'); }
            }}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={8} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="عروض الأسعار" description="إدارة عروض الأسعار" actions={<Button onClick={() => { setEditingQuotation(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عرض</Button>} />
      {quotations.length === 0 ? <EmptyState title="لا توجد عروض" actionLabel="إضافة عرض" onAction={() => setShowModal(true)} /> : <DataTable columns={columns} data={quotations} searchable searchKeys={['contact_name', 'number']} />}
      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditingQuotation(null); }} title={editingQuotation ? 'تعديل عرض سعر' : 'إضافة عرض سعر'} size="full" footer={<div className="flex gap-2"><Button variant="ghost" onClick={() => { setShowModal(false); setEditingQuotation(null); }}>إلغاء</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="التاريخ" type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} />
            <Input label="صالح حتى" type="date" value={form.valid_until} onChange={(e) => setForm({...form, valid_until: e.target.value})} />
            <Select label="العميل" value={form.contact_id} onChange={(v) => setForm({...form, contact_id: v})} options={[{ value: '', label: 'اختر عميلاً' }, ...clients.map((c: any) => ({ value: c.id, label: c.name }))]} className="col-span-2" />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} placeholder="ملاحظات عرض السعر" />
          <Checkbox label="تطبيق ضريبة القيمة المضافة (15%)" checked={form.tax_enabled} onChange={(checked: boolean) => setForm({...form, tax_enabled: checked, tax_rate: checked ? 0.15 : 0})} />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold">بنود العرض</h4>
              <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0, total: 0 }] })}>إضافة بند</Button>
            </div>
            {form.items.map((item: any, idx: number) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <input className="input-base col-span-5 text-sm" placeholder="البيان" value={item.description} onChange={(e) => {
                  const items = [...form.items]; items[idx] = { ...items[idx], description: e.target.value }; setForm({ ...form, items });
                }} />
                <input className="input-base col-span-2 text-sm" type="number" placeholder="الكمية" value={item.quantity} onChange={(e) => {
                  const q = parseFloat(e.target.value) || 0; const items = [...form.items];
                  items[idx] = { ...items[idx], quantity: q, total: q * (Number(items[idx].unit_price) || 0) }; setForm({ ...form, items });
                }} />
                <input className="input-base col-span-3 text-sm" type="number" placeholder="سعر الوحدة" value={item.unit_price} onChange={(e) => {
                  const p = parseFloat(e.target.value) || 0; const items = [...form.items];
                  items[idx] = { ...items[idx], unit_price: p, total: p * (Number(items[idx].quantity) || 0) }; setForm({ ...form, items });
                }} />
                <div className="col-span-2 text-sm font-mono flex items-center">{formatCurrency(item.total || 0)}</div>
              </div>
            ))}
          </div>
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>

      {/* Quotation Preview Modal */}
      <RecordViewModal
        isOpen={!!viewingQuotation}
        onClose={() => setViewingQuotation(null)}
        title={viewingQuotation ? `عرض سعر رقم #${viewingQuotation.number}` : 'معاينة عرض السعر'}
        record={viewingQuotation}
        footer={
          viewingQuotation ? (
            <Button variant="secondary" size="sm" leftIcon={<Printer size={16} />} onClick={() => printQuotation(viewingQuotation)}>
              طباعة / PDF
            </Button>
          ) : undefined
        }
        extra={viewingQuotation?.items?.length ? (
          <div className="border border-border rounded-xl overflow-x-auto mt-3">
            <div className="bg-bg-secondary p-2.5 font-bold text-xs border-b border-border">بنود عرض السعر</div>
            <table className="w-full text-xs text-right">
              <thead className="bg-bg-secondary/50 text-text-muted">
                <tr>
                  <th className="p-2">البيان</th>
                  <th className="p-2 text-center">الكمية</th>
                  <th className="p-2 text-center">سعر الوحدة</th>
                  <th className="p-2 text-left">المجموع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {viewingQuotation.items.map((it: any, idx: number) => (
                  <tr key={idx}>
                    <td className="p-2 font-medium">{it.description}</td>
                    <td className="p-2 text-center font-mono">{it.quantity}</td>
                    <td className="p-2 text-center font-mono">{formatCurrency(it.unit_price || 0)}</td>
                    <td className="p-2 text-left font-bold font-mono">{formatCurrency(it.total || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      />
    </div>
  );
}
