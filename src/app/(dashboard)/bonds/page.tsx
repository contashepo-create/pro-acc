'use client';

import { useState, useEffect } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { parseCompanyVatRate, vatOnAmount, vatPercentLabel } from '@/lib/company-vat';
import { useCompanyMoney } from '@/hooks/use-company-money';

interface BondRow {
  id: string;
  title: string;
  type: string;
  amount: number;
  currency: string;
  issue_date: string;
  expiry_date: string;
  issuing_bank?: string;
  beneficiary_name?: string;
  status: string;
  project_name?: string | null;
  contact_name?: string | null;
  bank_name?: string | null;
  daysUntilExpiry?: number | null;
  isExpiringSoon?: boolean;
  isExpired?: boolean;
}

interface BankSafe { id: string; name: string; type: string; }
interface TenderOption { id: string; title?: string; reference_number?: string; }

const TYPE_LABELS: Record<string, string> = {
  bid_bond: 'ضمان ابتدائي', performance_bond: 'ضمان نهائي', advance_payment: 'دفعات مقدمة',
  retention: 'محجوزات', warranty: 'ضمان', insurance: 'تأمين', other: 'أخرى',
};
const STATUS_LABELS: Record<string, string> = {
  active: 'ساري', expired: 'منتهي', released: 'مُحرَّر', cancelled: 'ملغى',
};
const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'> = {
  active: 'success', expired: 'danger', released: 'default', cancelled: 'default',
};

export default function BondsPage() {
  const { money, code: companyCurrency } = useCompanyMoney();
  const [bonds, setBonds] = useState<BondRow[]>([]);
  const [banksSafes, setBanksSafes] = useState<BankSafe[]>([]);
  const [tenders, setTenders] = useState<TenderOption[]>([]);
  const [companyVatRate, setCompanyVatRate] = useState(0.15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [form, setForm] = useState({
    title: '', type: 'bid_bond', amount: '', currency: companyCurrency,
    issue_date: new Date().toISOString().split('T')[0], expiry_date: '',
    issuing_bank: '', bank_safe_id: '', beneficiary_name: '',
    reference_number: '', commission: '', vat_amount: '', margin_amount: '', notes: '',
    tender_id: '', project_id: '', contact_id: '',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      const [bondsRes, banksRes, tendersRes, meRes] = await Promise.all([
        fetch('/api/bonds' + (params.toString() ? `?${params}` : '')),
        fetch('/api/banks'),
        fetch('/api/tenders'),
        fetch('/api/auth/me'),
      ]);
      const [bondsJson, banksJson, tendersJson, meJson] = await Promise.all([
        bondsRes.json(), banksRes.json(), tendersRes.json(), meRes.json(),
      ]);
      if (bondsJson.success) setBonds(bondsJson.data?.bonds || []);
      else setError(bondsJson.message || 'فشل');
      if (banksJson.success) {
        const all = [...(banksJson.data?.banks || []), ...(banksJson.data?.safes || [])];
        setBanksSafes(all);
      }
      if (tendersJson.success) setTenders(tendersJson.data?.tenders || []);
      if (meJson.success) setCompanyVatRate(parseCompanyVatRate(meJson.data?.company));
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [statusFilter, typeFilter]);

  useEffect(() => {
    const tenderId = new URLSearchParams(window.location.search).get('tender_id');
    if (tenderId) {
      setForm((prev) => ({ ...prev, tender_id: tenderId }));
      setShowModal(true);
    }
  }, []);

  const handleSave = async () => {
    if (!form.title.trim()) { setSaveError('العنوان مطلوب'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setSaveError('المبلغ مطلوب'); return; }
    if (!form.bank_safe_id) { setSaveError('البنك مطلوب'); return; }
    if (!form.expiry_date) { setSaveError('تاريخ الانتهاء مطلوب'); return; }
    if (form.margin_amount && Number(form.margin_amount) > Number(form.amount)) {
      setSaveError('الغطاء النقدي لا يجوز أن يتجاوز قيمة الخطاب'); return;
    }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/bonds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, currency: companyCurrency }),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          title: '', type: 'bid_bond', amount: '', currency: companyCurrency,
          issue_date: new Date().toISOString().split('T')[0], expiry_date: '',
          issuing_bank: '', bank_safe_id: '', beneficiary_name: '',
          reference_number: '', commission: '', vat_amount: '', margin_amount: '', notes: '',
          tender_id: '', project_id: '', contact_id: '',
        });
        fetchData();
        toast.success('تم إنشاء خطاب الضمان');
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const columns = [
    { key: 'title', label: 'العنوان', render: (row: BondRow) => (
      <a href={`/bonds/${row.id}`} className="text-accent hover:underline font-medium">{row.title}</a>
    )},
    { key: 'type', label: 'النوع', render: (row: BondRow) => <Badge variant="accent">{TYPE_LABELS[row.type] || row.type}</Badge> },
    { key: 'amount', label: 'المبلغ', render: (row: BondRow) => money(row.amount) },
    { key: 'beneficiary_name', label: 'المستفيد', render: (row: BondRow) => row.beneficiary_name || '—' },
    { key: 'expiry_date', label: 'الانتهاء', render: (row: BondRow) => {
      if (!row.expiry_date) return '—';
      return (
        <div>
          <span className={row.isExpired ? 'text-red-500' : row.isExpiringSoon ? 'text-amber-500' : ''}>
            {formatDate(row.expiry_date)}
          </span>
          {row.isExpiringSoon && !row.isExpired && <span className="text-xs text-amber-500 mr-1">(قريب)</span>}
          {row.isExpired && <span className="text-xs text-red-500 mr-1">(منتهي)</span>}
        </div>
      );
    }},
    { key: 'status', label: 'الحالة', render: (row: BondRow) => <Badge variant={STATUS_VARIANTS[row.status] || 'default'}>{STATUS_LABELS[row.status] || row.status}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="خطابات الضمان" description="إدارة الضمانات البنكية والاعتمادات" />

      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            className="w-40"
            options={[
              { value: '', label: 'كل الحالات' },
              ...Object.entries(STATUS_LABELS).map(([val, label]) => ({ value: val, label })),
            ]}
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            className="w-40"
            options={[
              { value: '', label: 'كل الأنواع' },
              ...Object.entries(TYPE_LABELS).map(([val, label]) => ({ value: val, label })),
            ]}
          />
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={18} className="ml-1" />
          خطاب ضمان جديد
        </Button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-center text-red-500 py-8">{error}</div>
      ) : bonds.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={48} />}
          title="لا توجد خطابات ضمان"
          description="أنشئ خطاب ضمان جديد لربطه بمناقصة أو مشروع"
          actionLabel="خطاب جديد"
          onAction={() => setShowModal(true)}
        />
      ) : (
        <DataTable data={bonds} columns={columns} />
      )}

      {/* Create Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="خطاب ضمان جديد" size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input label="العنوان *" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="مثال: ضمان ابتدائي لمناقصة الوزارة" />
          </div>
          <Select
            label="النوع *"
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v })}
            options={Object.entries(TYPE_LABELS).map(([val, label]) => ({ value: val, label }))}
          />
          <Input label="قيمة الخطاب (اسمية) *" type="number" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
          <Input label="الغطاء النقدي (إن وُجد)" type="number" value={form.margin_amount}
            onChange={(e) => setForm({ ...form, margin_amount: e.target.value })} placeholder="0.00" />
          <Input label="تاريخ الإصدار *" type="date" value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
          <Input label="تاريخ الانتهاء *" type="date" value={form.expiry_date}
            onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          <Input label="البنك المُصدر" value={form.issuing_bank}
            onChange={(e) => setForm({ ...form, issuing_bank: e.target.value })}
            placeholder="مثال: الراجحي" />
          <Select
            label="حساب البنك *"
            value={form.bank_safe_id}
            onChange={(v) => setForm({ ...form, bank_safe_id: v })}
            options={[
              { value: '', label: 'اختر...' },
              ...banksSafes.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <Input label="المستفيد" value={form.beneficiary_name}
            onChange={(e) => setForm({ ...form, beneficiary_name: e.target.value })} />
          <Input label="رقم المرجع" value={form.reference_number}
            onChange={(e) => setForm({ ...form, reference_number: e.target.value })} />
          <Input label="عمولة الإصدار" type="number" value={form.commission}
            onChange={(e) => {
              const commission = e.target.value;
              const vat = vatOnAmount(Number(commission) || 0, companyVatRate);
              setForm({ ...form, commission, vat_amount: vat ? String(vat) : '' });
            }} placeholder="0.00" />
          <Input label={`ضريبة العمولة (${vatPercentLabel(companyVatRate)}%)`} type="number" value={form.vat_amount}
            onChange={(e) => setForm({ ...form, vat_amount: e.target.value })} placeholder="0.00" />
          <Select
            label="المناقصة (اختياري)"
            value={form.tender_id}
            onChange={(v) => setForm({ ...form, tender_id: v })}
            options={[
              { value: '', label: 'بدون مناقصة' },
              ...tenders.map((t) => ({
                value: t.id,
                label: t.reference_number ? `${t.title || 'مناقصة'} — ${t.reference_number}` : (t.title || t.id),
              })),
            ]}
          />
          <div className="md:col-span-2">
            <Textarea label="ملاحظات" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        {saveError && <div className="text-red-500 text-sm mt-3">{saveError}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setShowModal(false)}>إلغاء</Button>
          <Button onClick={handleSave} loading={saving}>حفظ</Button>
        </div>
      </Modal>
    </div>
  );
}
