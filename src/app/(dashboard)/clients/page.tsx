'use client';

import { useState, useEffect } from 'react';
import { Plus, FileText, Building2, User, Phone, Mail, MapPin, CreditCard, FileText as Notes, Calendar } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { ActionButtons } from '@/components/ui/ActionButtons';
import { toast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/utils';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [form, setForm] = useState<any>({
    name: '', type: 'client', phone: '', email: '', address: '',
    tax_number: '', commercial_registration: '', credit_limit: 0,
    contact_person: '', contact_person_phone: '', contact_person_email: '',
    city: '', region: '', country: 'السعودية', postal_code: '',
    website: '', iban: '', bank_name: '', swift_code: '',
    opening_balance: 0, opening_balance_type: 'debit',
    payment_terms: 'immediate', notes: '',
    date_of_birth: '', gender: '', national_id: '', category: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/clients');
      const json = await res.json();
      if (json.success) setClients(json.data?.clients || []);
      else { setError(json.message || 'فشل'); toast.error(json.message || 'فشل تحميل البيانات'); }
    } catch { setError('فشل تحميل البيانات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSave = async () => {
    if (!form.name) { setSaveError('اسم العميل مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const url = editingClient ? `/api/clients/${editingClient.id}` : '/api/clients';
      const method = editingClient ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json();
      if (json.success) {
        setShowModal(false); setEditingClient(null);
        setForm({ name: '', type: 'client', phone: '', email: '', address: '', tax_number: '', commercial_registration: '', credit_limit: 0, contact_person: '', contact_person_phone: '', contact_person_email: '', city: '', region: '', country: 'السعودية', postal_code: '', website: '', iban: '', bank_name: '', swift_code: '', opening_balance: 0, opening_balance_type: 'debit', payment_terms: 'immediate', notes: '', date_of_birth: '', gender: '', national_id: '', category: '' });
        toast.success(editingClient ? 'تم تحديث العميل' : 'تم إضافة العميل');
        fetchData();
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); }
    finally { setSaving(false); }
  };

  const handleEdit = async (client: any) => {
    try {
      const res = await fetch(`/api/clients/${client.id}`);
      const json = await res.json();
      if (json.success) {
        setEditingClient(client);
        const d = json.data;
        setForm({
          name: d.name || '', type: d.type || 'client', phone: d.phone || '', email: d.email || '',
          address: d.address || '', tax_number: d.tax_number || '', commercial_registration: d.commercial_registration || '',
          credit_limit: d.credit_limit || 0, contact_person: d.contact_person || '', contact_person_phone: d.contact_person_phone || '',
          contact_person_email: d.contact_person_email || '', city: d.city || '', region: d.region || '',
          country: d.country || 'السعودية', postal_code: d.postal_code || '', website: d.website || '',
          iban: d.iban || '', bank_name: d.bank_name || '', swift_code: d.swift_code || '',
          opening_balance: d.opening_balance || 0, opening_balance_type: d.opening_balance_type || 'debit',
          payment_terms: d.payment_terms || 'immediate', notes: d.notes || '',
          date_of_birth: d.date_of_birth || '', gender: d.gender || '', national_id: d.national_id || '', category: d.category || '',
        });
        setShowModal(true);
      }
    } catch { toast.error('فشل تحميل البيانات'); }
  };

  const handleDelete = async (client: any) => {
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) { toast.success('تم حذف العميل'); fetchData(); }
      else toast.error(json.message || 'فشل الحذف');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const columns = [
    { key: 'name', label: 'اسم العميل', sortable: true, render: (row: any) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.name}</span>
        {row.category && <Badge variant="info">{row.category}</Badge>}
      </div>
    ) },
    { key: 'phone', label: 'الجوال', render: (row: any) => <span dir="ltr">{row.phone || '—'}</span> },
    { key: 'city', label: 'المدينة', render: (row: any) => row.city || '—' },
    { key: 'tax_number', label: 'الرقم الضريبي' },
    { key: 'balance', label: 'الرصيد', render: (row: any) => {
      const bal = parseFloat(row.balance) || 0;
      return (
        <div className="flex items-center gap-2">
          <span className={`font-bold ${bal > 0 ? 'text-green-600' : bal < 0 ? 'text-red-600' : 'text-text-muted'}`}>{formatCurrency(Math.abs(bal))}</span>
          {bal !== 0 && <Badge variant={bal > 0 ? 'success' : 'danger'}>{bal > 0 ? 'مدين' : 'دائن'}</Badge>}
        </div>
      );
    }, sortable: true },
    { key: 'credit_limit', label: 'الحد الائتماني', render: (row: any) => formatCurrency(row.credit_limit) },
    { key: 'actions', label: 'إجراءات', render: (row: any) => (
      <div className="flex items-center gap-2">
        <a href={`/clients/${row.id}/statement`} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" title="كشف حساب"><FileText size={16} className="text-blue-600" /></Button>
        </a>
        <ActionButtons item={row} onEdit={handleEdit} onDelete={handleDelete} />
      </div>
    ) },
  ];

  if (loading) return <LoadingSkeleton variant="table" count={6} />;
  if (error) return <div className="p-6"><div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-danger">{error}</div></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="العملاء"
        description="إدارة شاملة لبيانات العملاء"
        actions={<Button onClick={() => { setEditingClient(null); setShowModal(true); }} leftIcon={<Plus size={18} />}>إضافة عميل</Button>}
      />

      {clients.length === 0 ? (
        <EmptyState title="لا يوجد عملاء" actionLabel="إضافة عميل" onAction={() => setShowModal(true)} />
      ) : (
        <DataTable columns={columns} data={clients} searchable searchKeys={['name', 'phone', 'tax_number', 'city']} />
      )}

      {/* Comprehensive Client Form */}
      <Modal
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingClient(null); }}
        title={editingClient ? `تعديل: ${editingClient.name}` : 'إضافة عميل جديد'}
        size="xl"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setShowModal(false); setEditingClient(null); }}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Basic Info */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">البيانات الأساسية</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="اسم العميل *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="col-span-2" />
              <Select label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })}
                options={[{ value: 'client', label: 'عميل' }, { value: 'supplier', label: 'مورد' }, { value: 'both', label: 'عميل ومورد' }]} />
              <Input label="التصنيف" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="مثال: VIP, عادي..." />
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Phone size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">معلومات التواصل</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="رقم الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
              <Input label="البريد الإلكتروني" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
              <Input label="الموقع الإلكتروني" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} dir="ltr" />
            </div>
          </div>

          {/* Address */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">العنوان</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="الدولة" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
              <Input label="المدينة" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              <Input label="المنطقة" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
              <Input label="الرمز البريدي" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} dir="ltr" />
              <Input label="العنوان التفصيلي" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="col-span-2" />
            </div>
          </div>

          {/* Tax & Legal */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">البيانات القانونية والضريبية</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="الرقم الضريبي" value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} dir="ltr" />
              <Input label="السجل التجاري" value={form.commercial_registration} onChange={(e) => setForm({ ...form, commercial_registration: e.target.value })} dir="ltr" />
              <Input label="رقم الهوية" value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} dir="ltr" />
              <Select label="الجنس" value={form.gender} onChange={(v) => setForm({ ...form, gender: v })}
                options={[{ value: '', label: '—' }, { value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }]} />
              <Input label="تاريخ الميلاد" type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
            </div>
          </div>

          {/* Contact Person */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <User size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">الشخص المسؤول للتواصل</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="اسم المسؤول" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
              <Input label="هاتف المسؤول" value={form.contact_person_phone} onChange={(e) => setForm({ ...form, contact_person_phone: e.target.value })} dir="ltr" />
              <Input label="بريد المسؤول" type="email" value={form.contact_person_email} onChange={(e) => setForm({ ...form, contact_person_email: e.target.value })} dir="ltr" />
            </div>
          </div>

          {/* Banking */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CreditCard size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">البيانات البنكية</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="اسم البنك" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
              <Input label="رقم الآيبان (IBAN)" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} dir="ltr" />
              <Input label="رمز السويفت (SWIFT)" value={form.swift_code} onChange={(e) => setForm({ ...form, swift_code: e.target.value })} dir="ltr" />
            </div>
          </div>

          {/* Financial */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CreditCard size={18} className="text-accent" />
              <h3 className="font-bold text-text-primary">البيانات المالية</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="الحد الائتماني" type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: parseFloat(e.target.value) || 0 })} />
              <Select label="شروط الدفع" value={form.payment_terms} onChange={(v) => setForm({ ...form, payment_terms: v })}
                options={[
                  { value: 'immediate', label: 'فوري' },
                  { value: 'net_15', label: '15 يوم' },
                  { value: 'net_30', label: '30 يوم' },
                  { value: 'net_45', label: '45 يوم' },
                  { value: 'net_60', label: '60 يوم' },
                  { value: 'net_90', label: '90 يوم' },
                ]} />
              <Input label="الرصيد الافتتاحي" type="number" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: parseFloat(e.target.value) || 0 })} />
              <Select label="نوع الرصيد الافتتاحي" value={form.opening_balance_type} onChange={(v) => setForm({ ...form, opening_balance_type: v })}
                options={[{ value: 'debit', label: 'مدين (له)' }, { value: 'credit', label: 'دائن (عليه)' }]} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <Textarea label="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="أي ملاحظات إضافية..." />
          </div>

          {saveError && <div className="bg-danger/10 border border-danger/20 text-danger text-sm rounded-lg p-3">{saveError}</div>}
        </div>
      </Modal>
    </div>
  );
}
