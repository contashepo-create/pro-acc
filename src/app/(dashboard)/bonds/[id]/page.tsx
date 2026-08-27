'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck, Banknote, Calendar, Building2, FileText, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';

interface BondDetail {
  id: string;
  title: string;
  type: string;
  amount: number;
  currency: string;
  issue_date: string;
  expiry_date: string;
  issuing_bank?: string;
  beneficiary_name?: string;
  reference_number?: string;
  status: string;
  notes?: string;
  project_name?: string | null;
  contact_name?: string | null;
  tender_title?: string | null;
  journal_entry_id?: string;
  release_journal_entry_id?: string;
  daysUntilExpiry?: number | null;
  daysActive?: number | null;
}

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

export default function BondDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [bond, setBond] = useState<BondDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBond = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/bonds/${id}`);
      const json = await res.json();
      if (json.success) setBond(json.data);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchBond(); }, [id]);

  const handleRelease = async () => {
    if (!confirm('سيتم تحرير الضمان وإرجاع الغطاء للبنك. متابعة؟')) return;
    try {
      const res = await fetch(`/api/bonds/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release' }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحرير الضمان');
        fetchBond();
      } else toast.error(json.message || 'فشل');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  if (loading) return <LoadingSkeleton />;
  if (error || !bond) return <div className="text-center text-red-500 py-8">{error || 'غير موجود'}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/bonds')}>
            <ArrowRight size={18} />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{bond.title}</h1>
            <p className="text-text-secondary text-sm">{TYPE_LABELS[bond.type] || bond.type}</p>
          </div>
          <Badge variant={STATUS_VARIANTS[bond.status] || 'default'}>{STATUS_LABELS[bond.status]}</Badge>
        </div>
        {bond.status === 'active' && (
          <Button variant="outline" onClick={handleRelease}>
            <Unlock size={16} className="ml-1" /> تحرير الضمان
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <InfoCard icon={<Banknote size={16} />} label="المبلغ" value={formatCurrency(bond.amount)} />
        <InfoCard icon={<Calendar size={16} />} label="تاريخ الإصدار" value={formatDate(bond.issue_date)} />
        <InfoCard icon={<Calendar size={16} />} label="تاريخ الانتهاء" value={formatDate(bond.expiry_date)} />
        <InfoCard icon={<Building2 size={16} />} label="البنك المُصدر" value={bond.issuing_bank || '—'} />
        <InfoCard icon={<FileText size={16} />} label="المستفيد" value={bond.beneficiary_name || '—'} />
        <InfoCard icon={<FileText size={16} />} label="رقم المرجع" value={bond.reference_number || '—'} />
      </div>

      {/* Linked entities */}
      <div className="bg-bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="text-sm font-medium text-text-secondary mb-3">الارتباطات</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <span className="text-xs text-text-secondary">المناقصة</span>
            <p className="font-medium">{bond.tender_title || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-text-secondary">المشروع</span>
            <p className="font-medium">{bond.project_name || '—'}</p>
          </div>
          <div>
            <span className="text-xs text-text-secondary">العميل</span>
            <p className="font-medium">{bond.contact_name || '—'}</p>
          </div>
        </div>
      </div>

      {/* Accounting linkage */}
      <div className="bg-bg-card rounded-xl border border-border p-4 mb-4">
        <h3 className="text-sm font-medium text-text-secondary mb-3">الارتباط المحاسبي</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <span className="text-xs text-text-secondary">قيد الإصدار</span>
            <p className="font-medium">{bond.journal_entry_id ? `#${bond.journal_entry_id.slice(0, 8)}` : '—'}</p>
          </div>
          <div>
            <span className="text-xs text-text-secondary">قيد التحرير</span>
            <p className="font-medium">{bond.release_journal_entry_id ? `#${bond.release_journal_entry_id.slice(0, 8)}` : '—'}</p>
          </div>
        </div>
      </div>

      {bond.notes && (
        <div className="bg-bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-2">ملاحظات</h3>
          <p>{bond.notes}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-4 bg-bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-text-secondary mb-3">المدة</h3>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-secondary">عُمر الضمان: {bond.daysActive ?? '—'} يوم</span>
          {bond.daysUntilExpiry !== null && bond.daysUntilExpiry !== undefined && bond.status === 'active' && (
            <span className={bond.daysUntilExpiry <= 30 ? 'text-amber-500' : 'text-green-500'}>
              متبقي: {bond.daysUntilExpiry} يوم
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-text-secondary text-xs mb-1">
        {icon} {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
