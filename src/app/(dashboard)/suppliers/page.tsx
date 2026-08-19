'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { Pagination } from '@/components/ui/Pagination';
import { toast } from '@/components/ui/Toast';
import { openPrintWindow } from '@/lib/print';
import { escapeHtml } from '@/lib/utils';

const emptySupplier = {
  name: '', phone: '', email: '', tax_number: '', commercial_registration: '',
  address: '', city: '', region: '', country: '', postal_code: '', website: '',
  contact_person: '', contact_person_phone: '', contact_person_email: '',
  bank_name: '', iban: '', swift_code: '', payment_terms: '', category: '', notes: '',
};

export default function SuppliersPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [form, setForm] = useState<any>({ ...emptySupplier });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`/api/contacts?type=supplier&page=${page}&pageSize=${pageSize}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.data?.contacts || []);
        setTotal(Number(json.data?.total) || 0);
      } else { setError(json.message || 'فشل'); toast.error(json.message || 'فشل تحميل البيانات'); }
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => {
    // The effect intentionally refreshes server-backed rows when pagination changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!form.name) { setSaveError('اسم المورد مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editing ? `/api/contacts/${editing.id}` : '/api/contacts';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, type: editing?.type || 'supplier' }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false); setEditing(null);
        setForm({ ...emptySupplier });
        toast.success(editing ? 'تم تحديث المورد' : 'تم إضافة المورد');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleEdit = (row: any) => {
    setEditing(row);
    setForm(Object.fromEntries(Object.keys(emptySupplier).map((key) => [key, row[key] || ''])));
    setShowModal(true);
  };

  const handleDelete = async (row: any) => {
    try {
      const res = await fetch(`/api/contacts/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تعطيل المورد مع الاحتفاظ بسجله التاريخي');
        if (rows.length === 1 && page > 1) setPage((value) => value - 1);
        else fetchData();
      } else toast.error(json.message || 'فشل التعطيل');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const handlePrint = (supplier: any) => {
    const fields: Array<[string, unknown]> = [
      ['اسم المورد', supplier.name], ['الهاتف', supplier.phone], ['البريد الإلكتروني', supplier.email],
      ['الرقم الضريبي', supplier.tax_number], ['السجل التجاري', supplier.commercial_registration],
      ['العنوان', supplier.address], ['المدينة', supplier.city], ['المنطقة', supplier.region],
      ['الدولة', supplier.country], ['الرمز البريدي', supplier.postal_code], ['الموقع الإلكتروني', supplier.website],
      ['مسؤول الاتصال', supplier.contact_person], ['هاتف مسؤول الاتصال', supplier.contact_person_phone],
      ['بريد مسؤول الاتصال', supplier.contact_person_email], ['البنك', supplier.bank_name],
      ['IBAN', supplier.iban], ['SWIFT', supplier.swift_code], ['شروط السداد', supplier.payment_terms],
      ['التصنيف', supplier.category], ['ملاحظات', supplier.notes],
    ];
    const rowsHtml = fields.filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(String(value))}</td></tr>`).join('');
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>بيانات المورد - ${escapeHtml(supplier.name || '')}</title><style>
      body{font-family:Tahoma,Arial,sans-serif;color:#172033;padding:32px}header{border-bottom:3px solid #2563eb;padding-bottom:14px;margin-bottom:20px}h1{margin:0;font-size:24px}p{color:#64748b}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:right}th{width:32%;background:#f8fafc;color:#334155}@media print{body{padding:0}}
    </style></head><body><header><h1>بطاقة بيانات مورد</h1><p>${escapeHtml(supplier.name || '')}</p></header><table>${rowsHtml}</table></body></html>`;
    const result = openPrintWindow(html);
    if (!result.ok) toast.error(result.blocked ? 'اسمح بالنوافذ المنبثقة لإتمام الطباعة' : 'تعذر فتح نافذة الطباعة');
  };

  const columns = [
    { key: 'name', label: 'اسم المورد', sortable: true },
    { key: 'phone', label: 'الجوال', render: (r: any) => <span dir="ltr">{r.phone || '—'}</span> },
    { key: 'email', label: 'البريد', render: (r: any) => <span dir="ltr">{r.email || '—'}</span> },
    { key: 'tax_number', label: 'الرقم الضريبي' },
    { key: 'notes', label: 'ملاحظات' },
    { key: 'actions', label: 'إجراءات', render: (r: any) => <ActionButtons item={r} onEdit={handleEdit} onDelete={handleDelete} onPrint={handlePrint} deleteMode="deactivate" /> },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="الموردون"
        description="إدارة الموردين بشكل منفصل عن العملاء"
        actions={<Button onClick={() => { setEditing(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة مورد</Button>}
      />
      {rows.length === 0 ? (
        <EmptyState title="لا يوجد موردون" actionLabel="إضافة مورد" onAction={() => setShowModal(true)} />
      ) : (
        <>
          <DataTable columns={columns} data={rows} searchable searchKeys={['name', 'phone', 'tax_number']} />
          <Pagination
            currentPage={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPage(1); setPageSize(size); }}
          />
        </>
      )}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditing(null); }}
        title={editing ? `تعديل: ${editing.name}` : 'إضافة مورد جديد'}
        size="xl"
        footer={<div className="flex gap-2">
          <Button variant="ghost" onClick={() => { setShowModal(false); setEditing(null); }}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
        </div>}
      >
        <div className="space-y-4">
          <Input label="اسم المورد *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
            <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} dir="ltr" />
            <Input label="السجل التجاري" value={form.commercial_registration} onChange={(e) => setForm({ ...form, commercial_registration: e.target.value })} />
            <Input label="العنوان" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <Input label="المدينة" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Input label="المنطقة" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            <Input label="الدولة" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            <Input label="الرمز البريدي" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
            <Input label="الموقع الإلكتروني" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} dir="ltr" />
            <Input label="مسؤول الاتصال" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            <Input label="هاتف مسؤول الاتصال" value={form.contact_person_phone} onChange={(e) => setForm({ ...form, contact_person_phone: e.target.value })} dir="ltr" />
            <Input label="بريد مسؤول الاتصال" value={form.contact_person_email} onChange={(e) => setForm({ ...form, contact_person_email: e.target.value })} dir="ltr" />
            <Input label="اسم البنك" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            <Input label="IBAN" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} dir="ltr" />
            <Input label="SWIFT" value={form.swift_code} onChange={(e) => setForm({ ...form, swift_code: e.target.value })} dir="ltr" />
            <Input label="شروط السداد" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="مثال: 30 يوماً" />
            <Input label="التصنيف" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="أي تعليمات أو ملاحظات خاصة بالمورد" />
          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
