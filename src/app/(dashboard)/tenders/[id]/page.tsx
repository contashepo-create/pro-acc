'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight, Plus, Trophy, XCircle, Send, FileText, Banknote,
  Building2, Calendar, MapPin, Percent, Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { toast } from '@/components/ui/Toast';
import { formatDate, formatCurrency } from '@/lib/utils';


interface TenderDetail {
  id: string;
  title: string;
  client_name: string;
  contact_name?: string | null;
  reference_number?: string;
  description?: string;
  estimated_value?: number;
  bid_bond_amount?: number;
  submission_deadline?: string;
  opening_date?: string;
  project_location?: string;
  project_duration_months?: number;
  status: string;
  win_probability?: number;
  notes?: string;
  project_id?: string | null;
  cost_center_id?: string | null;
  cost_items?: CostItem[];
  total_cost?: number;
  bid_amount?: number;
  profit_margin?: number;
  expenses?: TenderExpense[];
  total_expenses?: number;
  bonds?: LinkedBond[];
}

interface CostItem {
  id: string; category: string; description?: string; amount: number;
}
interface TenderExpense {
  id: string; expense_type: string; amount: number; vat_amount: number;
  description?: string; date: string; journal_entry_id?: string;
}
interface LinkedBond {
  id: string; title: string; type: string; amount: number; status: string; expiry_date: string;
}
interface BankSafe { id: string; name: string; type: string; }

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة', preparing: 'قيد التحضير', submitted: 'مُقدَّمة',
  won: 'رابحة', lost: 'خاسرة', cancelled: 'ملغاة',
};
const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'default'> = {
  draft: 'default', preparing: 'info', submitted: 'warning',
  won: 'success', lost: 'danger', cancelled: 'default',
};
const EXPENSE_LABELS: Record<string, string> = {
  karasa: 'كراسة الشروط', platform_fee: 'رسوم المنصة',
  bid_bond_margin: 'غطاء ضمان ابتدائي', bid_bond_commission: 'عمولة ضمان',
  consulting: 'استشارات', other: 'أخرى',
};
const EXPENSE_FORM_OPTIONS = [
  { value: 'karasa', label: 'كراسة الشروط' },
  { value: 'platform_fee', label: 'رسوم المنصة' },
  { value: 'consulting', label: 'استشارات' },
  { value: 'other', label: 'أخرى' },
];

export default function TenderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [tender, setTender] = useState<TenderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'costs' | 'expenses' | 'bonds'>('overview');
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [banksSafes, setBanksSafes] = useState<BankSafe[]>([]);
  const [saving, setSaving] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    expense_type: 'karasa',
    amount: '',
    vat_amount: '',
    bank_safe_id: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
  });

  const fetchTender = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tenders/${id}`);
      const json = await res.json();
      if (json.success) setTender(json.data);
      else setError(json.message || 'فشل');
    } catch { setError('فشل تحميل البيانات'); } finally { setLoading(false); }
  };

  const fetchBanks = async () => {
    try {
      const res = await fetch('/api/banks');
      const json = await res.json();
      if (json.success) {
        const all = [...(json.data?.banks || []), ...(json.data?.safes || [])];
        setBanksSafes(all);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTender(); }, [id]);
  useEffect(() => { fetchBanks(); }, []);

  const handleStatusChange = async (newStatus: string) => {
    if (!confirm(`تأكيد تغيير حالة المناقصة إلى "${STATUS_LABELS[newStatus]}"؟`)) return;
    try {
      const res = await fetch(`/api/tenders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_status', status: newStatus }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحديث الحالة');
        fetchTender();
      } else toast.error(json.message || 'فشل');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const handleConvertToProject = async () => {
    if (!confirm('سيتم تحويل المناقصة إلى مشروع مع نقل كل المصاريف. متابعة؟')) return;
    try {
      const res = await fetch(`/api/tenders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'convert_to_project' }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('تم تحويل المناقصة إلى مشروع');
        fetchTender();
      } else toast.error(json.message || 'فشل');
    } catch { toast.error('خطأ في الاتصال'); }
  };

  const handleSaveExpense = async () => {
    if (!expenseForm.amount || Number(expenseForm.amount) <= 0) { toast.error('المبلغ مطلوب'); return; }
    if (!expenseForm.bank_safe_id) { toast.error('يجب اختيار البنك/الخزينة'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenders/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expenseForm),
      });
      const json = await res.json();
      if (json.success) {
        setShowExpenseModal(false);
        setExpenseForm({ expense_type: 'karasa', amount: '', vat_amount: '', bank_safe_id: '', description: '', date: new Date().toISOString().split('T')[0] });
        toast.success('تم تسجيل المصروف');
        fetchTender();
      } else toast.error(json.message || 'فشل');
    } catch { toast.error('خطأ في الاتصال'); } finally { setSaving(false); }
  };

  if (loading) return <LoadingSkeleton />;
  if (error || !tender) return <div className="text-center text-red-500 py-8">{error || 'غير موجود'}</div>;

  const canTransition = (status: string) => {
    const transitions: Record<string, string[]> = {
      draft: ['preparing', 'submitted', 'cancelled'],
      preparing: ['submitted', 'cancelled'],
      submitted: ['won', 'lost', 'cancelled'],
    };
    return (transitions[tender.status] || []).includes(status);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => router.push('/tenders')}>
            <ArrowRight size={18} />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{tender.title}</h1>
            <p className="text-text-secondary text-sm">{tender.client_name}</p>
          </div>
          <Badge variant={STATUS_VARIANTS[tender.status] || 'default'}>{STATUS_LABELS[tender.status]}</Badge>
        </div>
        <div className="flex gap-2">
          {canTransition('submitted') && (
            <Button variant="outline" onClick={() => handleStatusChange('submitted')}>
              <Send size={16} className="ml-1" /> تقديم
            </Button>
          )}
          {canTransition('won') && (
            <Button variant="outline" onClick={() => handleStatusChange('won')}>
              <Trophy size={16} className="ml-1" /> فوز
            </Button>
          )}
          {canTransition('lost') && (
            <Button variant="outline" onClick={() => handleStatusChange('lost')}>
              <XCircle size={16} className="ml-1" /> خسارة
            </Button>
          )}
          {canTransition('cancelled') && (
            <Button variant="ghost" onClick={() => handleStatusChange('cancelled')}>إلغاء</Button>
          )}
          {tender.status === 'won' && !tender.project_id && (
            <Button onClick={handleConvertToProject}>
              <Building2 size={16} className="ml-1" /> تحويل إلى مشروع
            </Button>
          )}
          {tender.project_id && (
            <Button variant="outline" onClick={() => router.push('/projects')}>
              <Building2 size={16} className="ml-1" /> المشروع
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {[
          { key: 'overview', label: 'نظرة عامة' },
          { key: 'costs', label: `بنود التكلفة (${tender.cost_items?.length || 0})` },
          { key: 'expenses', label: `المصاريف الفعلية (${tender.expenses?.length || 0})` },
          { key: 'bonds', label: `الضمانات (${tender.bonds?.length || 0})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <InfoCard icon={<Hash size={16} />} label="رقم المرجع" value={tender.reference_number || '—'} />
          <InfoCard icon={<Banknote size={16} />} label="القيمة التقديرية" value={tender.estimated_value ? formatCurrency(tender.estimated_value) : '—'} />
          <InfoCard icon={<Percent size={16} />} label="احتمالية الفوز" value={tender.win_probability != null ? `${tender.win_probability}%` : '—'} />
          <InfoCard icon={<Calendar size={16} />} label="موعد التقديم" value={tender.submission_deadline ? formatDate(tender.submission_deadline) : '—'} />
          <InfoCard icon={<Calendar size={16} />} label="تاريخ الفتح" value={tender.opening_date ? formatDate(tender.opening_date) : '—'} />
          <InfoCard icon={<MapPin size={16} />} label="الموقع" value={tender.project_location || '—'} />
          {tender.description && (
            <div className="md:col-span-3">
              <div className="text-sm text-text-secondary mb-1">الوصف</div>
              <p className="text-text-primary">{tender.description}</p>
            </div>
          )}
          {tender.notes && (
            <div className="md:col-span-3">
              <div className="text-sm text-text-secondary mb-1">ملاحظات</div>
              <p className="text-text-primary">{tender.notes}</p>
            </div>
          )}
          {/* Financial Summary */}
          <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-bg-card rounded-xl border border-border p-4">
              <div className="text-xs text-text-secondary mb-1">إجمالي بنود التكلفة</div>
              <div className="text-lg font-bold">{formatCurrency(tender.total_cost || 0)}</div>
            </div>
            <div className="bg-bg-card rounded-xl border border-border p-4">
              <div className="text-xs text-text-secondary mb-1">المصاريف الفعلية</div>
              <div className="text-lg font-bold">{formatCurrency(tender.total_expenses || 0)}</div>
            </div>
            <div className="bg-bg-card rounded-xl border border-border p-4">
              <div className="text-xs text-text-secondary mb-1">القيمة التقديرية</div>
              <div className="text-lg font-bold">{formatCurrency(tender.bid_amount || 0)}</div>
            </div>
            <div className="bg-bg-card rounded-xl border border-border p-4">
              <div className="text-xs text-text-secondary mb-1">هامش الربح</div>
              <div className="text-lg font-bold text-green-500">{(tender.profit_margin || 0).toFixed(1)}%</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'costs' && (
        <div>
          {tender.cost_items && tender.cost_items.length > 0 ? (
            <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-hover">
                  <tr>
                    <th className="text-right p-3">الفئة</th>
                    <th className="text-right p-3">الوصف</th>
                    <th className="text-left p-3">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {tender.cost_items.map((item) => (
                    <tr key={item.id} className="border-t border-border">
                      <td className="p-3"><Badge variant="info">{item.category}</Badge></td>
                      <td className="p-3">{item.description || '—'}</td>
                      <td className="p-3 text-left font-medium">{formatCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-bg-hover">
                    <td colSpan={2} className="p-3 font-bold">الإجمالي</td>
                    <td className="p-3 text-left font-bold">{formatCurrency(tender.total_cost || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center text-text-secondary py-8">لا توجد بنود تكلفة</div>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div>
          <div className="flex justify-end mb-3">
            <Button onClick={() => setShowExpenseModal(true)}>
              <Plus size={16} className="ml-1" /> تسجيل مصروف
            </Button>
          </div>
          {tender.expenses && tender.expenses.length > 0 ? (
            <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-hover">
                  <tr>
                    <th className="text-right p-3">النوع</th>
                    <th className="text-right p-3">الوصف</th>
                    <th className="text-right p-3">التاريخ</th>
                    <th className="text-left p-3">المبلغ</th>
                    <th className="text-left p-3">الضريبة</th>
                    <th className="text-left p-3">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {tender.expenses.map((exp) => (
                    <tr key={exp.id} className="border-t border-border">
                      <td className="p-3"><Badge variant="warning">{EXPENSE_LABELS[exp.expense_type] || exp.expense_type}</Badge></td>
                      <td className="p-3">{exp.description || '—'}</td>
                      <td className="p-3">{formatDate(exp.date)}</td>
                      <td className="p-3 text-left">{formatCurrency(exp.amount)}</td>
                      <td className="p-3 text-left">{formatCurrency(exp.vat_amount)}</td>
                      <td className="p-3 text-left font-medium">{formatCurrency(exp.amount + exp.vat_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-bg-hover">
                    <td colSpan={5} className="p-3 font-bold">الإجمالي</td>
                    <td className="p-3 text-left font-bold">{formatCurrency(tender.total_expenses || 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center text-text-secondary py-8">
              <FileText size={48} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد مصاريف مسجلة</p>
              <p className="text-xs mt-1">سجّل مصاريف الكراسة والمنصة وخطابات الضمان</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'bonds' && (
        <div>
          <div className="flex justify-end mb-3">
            <Button onClick={() => router.push(`/bonds?tender_id=${tender.id}`)}>
              <Plus size={16} className="ml-1" /> خطاب ضمان
            </Button>
          </div>
          {tender.bonds && tender.bonds.length > 0 ? (
            <div className="bg-bg-card rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-bg-hover">
                  <tr>
                    <th className="text-right p-3">العنوان</th>
                    <th className="text-right p-3">النوع</th>
                    <th className="text-left p-3">المبلغ</th>
                    <th className="text-right p-3">الحالة</th>
                    <th className="text-right p-3">الانتهاء</th>
                  </tr>
                </thead>
                <tbody>
                  {tender.bonds.map((bond) => (
                    <tr key={bond.id} className="border-t border-border hover:bg-bg-hover cursor-pointer"
                      onClick={() => router.push(`/bonds/${bond.id}`)}>
                      <td className="p-3 font-medium">{bond.title}</td>
                      <td className="p-3"><Badge variant="accent">{bond.type}</Badge></td>
                      <td className="p-3 text-left">{formatCurrency(bond.amount)}</td>
                      <td className="p-3"><Badge variant={bond.status === 'active' ? 'success' : 'default'}>{bond.status}</Badge></td>
                      <td className="p-3">{formatDate(bond.expiry_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-text-secondary py-8">
              <Banknote size={48} className="mx-auto mb-2 opacity-30" />
              <p>لا توجد خطابات ضمان</p>
            </div>
          )}
        </div>
      )}

      {/* Expense Modal */}
      <Modal isOpen={showExpenseModal} onClose={() => setShowExpenseModal(false)} title="تسجيل مصروف مناقصة" size="md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="نوع المصروف *"
            value={expenseForm.expense_type}
            onChange={(v) => setExpenseForm({ ...expenseForm, expense_type: v })}
            options={EXPENSE_FORM_OPTIONS}
          />
          <Input label="التاريخ" type="date" value={expenseForm.date}
            onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })} />
          <Input label="المبلغ *" type="number" value={expenseForm.amount}
            onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} placeholder="0.00" />
          <Input label="الضريبة (15%)" type="number" value={expenseForm.vat_amount}
            onChange={(e) => setExpenseForm({ ...expenseForm, vat_amount: e.target.value })} placeholder="0.00" />
          <Select
            label="البنك / الخزينة *"
            value={expenseForm.bank_safe_id}
            onChange={(v) => setExpenseForm({ ...expenseForm, bank_safe_id: v })}
            options={[
              { value: '', label: 'اختر...' },
              ...banksSafes.map((b) => ({
                value: b.id,
                label: `${b.name} (${b.type === 'bank' ? 'بنك' : 'خزينة'})`,
              })),
            ]}
          />
          <div className="md:col-span-2">
            <Textarea label="الوصف" value={expenseForm.description}
              onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setShowExpenseModal(false)}>إلغاء</Button>
          <Button onClick={handleSaveExpense} loading={saving}>حفظ</Button>
        </div>
      </Modal>
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
