'use client';

import { useState, useEffect } from 'react';
import { Plus, FileText, Trophy, XCircle, Clock, TrendingUp } from 'lucide-react';
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
import { formatDate, formatCurrency } from '@/lib/utils';
import { toDateInput } from '@/lib/form-utils';

interface TenderRow {
  id: string;
  title: string;
  client_name: string;
  contact_name?: string | null;
  reference_number?: string;
  estimated_value?: number;
  bid_bond_amount?: number;
  submission_deadline?: string;
  opening_date?: string;
  status: string;
  win_probability?: number;
  project_id?: string | null;
  daysUntilDeadline?: number | null;
  isOverdue?: boolean;
}

interface Stats {
  total: number;
  draft: number;
  preparing: number;
  submitted: number;
  won: number;
  lost: number;
  cancelled: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  preparing: 'قيد التحضير',
  submitted: 'مُقدَّمة',
  won: 'رابحة',
  lost: 'خاسرة',
  cancelled: 'ملغاة',
};

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'> = {
  draft: 'default',
  preparing: 'info',
  submitted: 'warning',
  won: 'success',
  lost: 'danger',
  cancelled: 'default',
};

export default function TendersPage() {
  const [tenders, setTenders] = useState<TenderRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [form, setForm] = useState({
    title: '',
    client_name: '',
    contact_id: '',
    reference_number: '',
    description: '',
    estimated_value: '',
    bid_bond_amount: '',
    submission_deadline: '',
    opening_date: '',
    project_location: '',
    project_duration_months: '',
    win_probability: '',
    notes: '',
    status: 'draft',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/tenders' + (statusFilter ? `?status=${statusFilter}` : ''));
      const json = await res.json();
      if (json.success) {
        setTenders(json.data?.tenders || []);
        setStats(json.data?.stats || null);
      } else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [statusFilter]);

  const handleSave = async () => {
    if (!form.title.trim()) { setSaveError('العنوان مطلوب'); return; }
    if (!form.client_name.trim()) { setSaveError('اسم العميل مطلوب'); return; }
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/tenders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (json.success) {
        setShowModal(false);
        setForm({
          title: '', client_name: '', contact_id: '', reference_number: '', description: '',
          estimated_value: '', bid_bond_amount: '', submission_deadline: '', opening_date: '',
          project_location: '', project_duration_months: '', win_probability: '', notes: '', status: 'draft',
        });
        fetchData();
        toast.success('تم إنشاء المناقصة');
      } else setSaveError(json.message || 'فشل الحفظ');
    } catch { setSaveError('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  const columns = [
    { key: 'title', label: 'العنوان', render: (row: TenderRow) => (
      <a href={`/tenders/${row.id}`} className="text-accent hover:underline font-medium">{row.title}</a>
    )},
    { key: 'client_name', label: 'العميل' },
    { key: 'estimated_value', label: 'القيمة التقديرية', render: (row: TenderRow) =>
      row.estimated_value ? formatCurrency(row.estimated_value) : '—' },
    { key: 'submission_deadline', label: 'موعد التقديم', render: (row: TenderRow) => {
      if (!row.submission_deadline) return '—';
      const overdue = row.isOverdue;
      const days = row.daysUntilDeadline;
      return (
        <div>
          <span className={overdue ? 'text-red-500' : days != null && days <= 7 ? 'text-amber-500' : ''}>
            {formatDate(row.submission_deadline)}
          </span>
          {days != null && days > 0 && !overdue && (
            <span className="text-xs text-text-secondary mr-1">({days} يوم)</span>
          )}
          {overdue && <span className="text-xs text-red-500 mr-1">(منتهي)</span>}
        </div>
      );
    }},
    { key: 'status', label: 'الحالة', render: (row: TenderRow) =>
      <Badge variant={STATUS_VARIANTS[row.status] || 'default'}>{STATUS_LABELS[row.status] || row.status}</Badge> },
    { key: 'win_probability', label: 'الاحتمالية', render: (row: TenderRow) =>
      row.win_probability != null ? `${row.win_probability}%` : '—' },
  ];

  return (
    <div>
      <PageHeader title="المناقصات" description="إدارة المناقصات والعطاءات والضمانات البنكية" />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard icon={<FileText size={18} />} label="الإجمالي" value={stats.total} color="text-blue-500" />
          <StatCard icon={<Clock size={18} />} label="مسودة" value={stats.draft} color="text-gray-500" />
          <StatCard icon={<Clock size={18} />} label="قيد التحضير" value={stats.preparing} color="text-blue-500" />
          <StatCard icon={<FileText size={18} />} label="مُقدَّمة" value={stats.submitted} color="text-amber-500" />
          <StatCard icon={<Trophy size={18} />} label="رابحة" value={stats.won} color="text-green-500" />
          <StatCard icon={<XCircle size={18} />} label="خاسرة" value={stats.lost} color="text-red-500" />
        </div>
      )}

      {/* Filter + Add */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          className="w-48"
          options={[
            { value: '', label: 'كل الحالات' },
            ...Object.entries(STATUS_LABELS).map(([val, label]) => ({ value: val, label })),
          ]}
        />
        <Button onClick={() => setShowModal(true)}>
          <Plus size={18} className="ml-1" />
          مناقصة جديدة
        </Button>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="text-center text-red-500 py-8">{error}</div>
      ) : tenders.length === 0 ? (
        <EmptyState
          icon={<FileText size={48} />}
          title="لا توجد مناقصات"
          description="ابدأ بإنشاء مناقصة جديدة لتتبع التكاليف والضمانات"
          actionLabel="مناقصة جديدة"
          onAction={() => setShowModal(true)}
        />
      ) : (
        <DataTable data={tenders} columns={columns} />
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="مناقصة جديدة"
        size="lg"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Input
              label="عنوان المناقصة *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="مثال: إنشاء مبنى إداري"
            />
          </div>
          <Input
            label="اسم العميل / الجهة *"
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            placeholder="مثال: وزارة الإسكان"
          />
          <Input
            label="رقم المرجع"
            value={form.reference_number}
            onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
          />
          <Input
            label="القيمة التقديرية"
            value={form.estimated_value}
            onChange={(e) => setForm({ ...form, estimated_value: e.target.value })}
            type="number"
            placeholder="0.00"
          />
          <Input
            label="مبلغ خطاب الضمان الابتدائي"
            value={form.bid_bond_amount}
            onChange={(e) => setForm({ ...form, bid_bond_amount: e.target.value })}
            type="number"
            placeholder="0.00"
          />
          <Input
            label="موعد تقديم العرض"
            value={form.submission_deadline}
            onChange={(e) => setForm({ ...form, submission_deadline: e.target.value })}
            type="date"
          />
          <Input
            label="تاريخ فتح الأظرف"
            value={form.opening_date}
            onChange={(e) => setForm({ ...form, opening_date: e.target.value })}
            type="date"
          />
          <Input
            label="مدة التنفيذ (أشهر)"
            value={form.project_duration_months}
            onChange={(e) => setForm({ ...form, project_duration_months: e.target.value })}
            type="number"
          />
          <Input
            label="احتمالية الفوز (%)"
            value={form.win_probability}
            onChange={(e) => setForm({ ...form, win_probability: e.target.value })}
            type="number"
            min="0" max="100"
          />
          <div className="md:col-span-2">
            <Input
              label="موقع المشروع"
              value={form.project_location}
              onChange={(e) => setForm({ ...form, project_location: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <Textarea
              label="الوصف"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="md:col-span-2">
            <Textarea
              label="ملاحظات"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
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

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="bg-bg-card rounded-xl border border-border p-4">
      <div className={`flex items-center gap-2 mb-1 ${color}`}>
        {icon}
        <span className="text-xs text-text-secondary">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
