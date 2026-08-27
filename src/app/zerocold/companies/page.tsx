'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Search, Loader2, RefreshCw, CheckCircle, XCircle, ChevronLeft,
  Edit3, Calendar, Ban, Eye, X
} from 'lucide-react';
import Link from 'next/link';
import { MasterPasswordModal } from '@/components/ui/MasterPasswordModal';

interface Company {
  id: string;
  name: string;
  commercial_registration: string;
  tax_number: string;
  phone: string;
  email: string;
  address: string;
  country: string;
  user_count: number;
  created_at: string;
  is_active: boolean;
  subscription?: {
    subscriber_number: number | null;
    plan_code: string;
    plan_name: string;
    status: string;
    end_date: string;
    auto_renew: boolean;
  } | null;
}

interface PlanOption { id: string; name: string; price_monthly?: number; }
interface EditForm { name: string; commercial_registration: string; tax_number: string; phone: string; email: string; address: string; country: string; }
interface DetailUser { id: string; name: string; email: string; role: string; }
interface DetailData {
  company?: { email?: string; phone?: string; address?: string; country?: string; commercial_registration?: string; tax_number?: string };
  subscription?: { subscriber_number?: number; end_date?: string; subscription_plans?: { name?: string } };
  stats?: { user_count?: number; project_count?: number };
  users?: DetailUser[];
}

export default function ZerocoldCompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [, setPlans] = useState<PlanOption[]>([]);
  const [editForm, setEditForm] = useState<EditForm>({} as EditForm);
  const [masterPassword, setMasterPassword] = useState('');
  const [mpAction, setMpAction] = useState<null | { kind: 'toggle' | 'extend' | 'cancel' | 'edit'; company?: Company }>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);

  const fetchCompanies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/companies');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const body = await res.json();
      if (!body.success) { setError(body.message || 'حدث خطأ'); return; }
      setCompanies(body.data?.companies || []);
    } catch { setError('حدث خطأ في الاتصال بالخادم'); }
    finally { setLoading(false); }
  };

  const fetchPlans = async () => {
    const res = await fetch('/api/admin/subscription-plans');
    const body = await res.json();
    if (body.success) {
      const planList = Array.isArray(body.data?.plans)
        ? body.data.plans
        : (Array.isArray(body.data) ? body.data : []);
      setPlans(planList);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- standard fetch pattern
  useEffect(() => { fetchCompanies(); fetchPlans(); }, []);

  const openDetail = async (company: Company) => {
    setSelectedCompany(company);
    setShowDetailModal(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`);
      const body = await res.json();
      if (body.success) setDetailData(body.data);
    } catch {}
  };

  const openEdit = (company: Company) => {
    setEditForm({
      name: company.name, commercial_registration: company.commercial_registration,
      tax_number: company.tax_number, phone: company.phone, email: company.email,
      address: company.address, country: company.country,
    });
    setSelectedCompany(company);
    setShowEditModal(true);
  };

  const doToggleStatus = (company: Company) => setMpAction({ kind: 'toggle', company });
  const doExtend = (company: Company) => setMpAction({ kind: 'extend', company });
  const doCancel = (company: Company) => setMpAction({ kind: 'cancel', company });

  const runMasterAction = async (password: string, extra?: string) => {
    if (!mpAction?.company) return;
    const company = mpAction.company;
    const headers = { 'Content-Type': 'application/json', 'x-master-password': password };
    let res: Response;
    if (mpAction.kind === 'toggle') {
      res = await fetch('/api/admin/companies/' + company.id, { method: 'PATCH', headers,
        body: JSON.stringify({ action: 'toggle_status', is_active: !company.is_active }) });
    } else if (mpAction.kind === 'extend') {
      res = await fetch('/api/admin/companies/' + company.id + '/extend-trial', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 7, reason: extra, masterPassword: password }) });
    } else {
      res = await fetch('/api/admin/companies/' + company.id, { method: 'PATCH', headers,
        body: JSON.stringify({ action: 'cancel_subscription', ...(extra ? { cancel_reason: extra } : {}) }) });
    }
    const body = await res.json();
    if (!body.success) throw new Error(body.message || 'فشلت العملية');
    setMpAction(null);
    fetchCompanies();
  };

  const doEdit = async () => {
    setActionLoading('edit');
    try {
      const res = await fetch(`/api/admin/companies/${selectedCompany!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': masterPassword },
        body: JSON.stringify({ action: 'edit_company', ...editForm }),
      });
      const body = await res.json();
      if (body.success) { setShowEditModal(false); setMasterPassword(''); fetchCompanies(); }
      else alert(body.message || 'فشل');
    } catch { alert('خطأ في الاتصال'); }
    finally { setActionLoading(null); }
  };

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.tax_number?.toLowerCase().includes(search.toLowerCase()) ||
    (c.subscription?.subscriber_number?.toString() || '').includes(search)
  );

  if (loading) {
    return <div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 size={32} className="text-text-secondary animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-bg-card"><ChevronLeft size={18} className="text-text-secondary" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center"><Building2 className="w-5 h-5 text-white" /></div>
            <div><h1 className="text-lg font-bold text-text-primary">إدارة الشركات</h1><p className="text-[0.7rem] text-text-muted">{companies.length} شركة</p></div>
          </div>
          <button onClick={fetchCompanies} className="p-2 rounded-xl bg-bg-card border border-border text-text-secondary hover:text-accent"><RefreshCw size={16} /></button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم، الرقم الضريبي، رقم المشترك..."
            className="w-full pr-10 pl-4 py-2.5 bg-bg-card border border-border rounded-xl text-text-primary placeholder-text-muted focus:outline-none focus:border-accent text-sm" />
        </div>

        {error && <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">{error}</div>}

        {/* Table */}
        {filtered.length === 0 && !error ? (
          <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
            <Building2 size={32} className="text-text-muted mx-auto mb-2 opacity-50" />
            <p className="text-text-muted text-sm">لا توجد شركات</p>
          </div>
        ) : (
          <div className="bg-bg-card border border-border rounded-xl overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right p-3 text-[0.7rem] text-text-secondary/60 font-medium">اسم الشركة</th>
                    <th className="text-center p-3 text-[0.7rem] text-text-secondary/60 font-medium">رقم المشترك</th>
                    <th className="text-right p-3 text-[0.7rem] text-text-secondary/60 font-medium">الباقة</th>
                    <th className="text-center p-3 text-[0.7rem] text-text-secondary/60 font-medium">الحالة</th>
                    <th className="text-right p-3 text-[0.7rem] text-text-secondary/60 font-medium">انتهاء الاشتراك</th>
                    <th className="text-center p-3 text-[0.7rem] text-text-secondary/60 font-medium">المستخدمين</th>
                    <th className="text-center p-3 text-[0.7rem] text-text-secondary/60 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg-secondary">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${c.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <div>
                            <span className="text-sm text-text-primary font-medium block">{c.name}</span>
                            <span className="text-[0.65rem] text-text-muted">{c.tax_number || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {c.subscription?.subscriber_number ? (
                          <span className="text-sm text-accent font-mono font-bold">#{c.subscription.subscriber_number}</span>
                        ) : <span className="text-text-muted text-xs">—</span>}
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-text-secondary">{c.subscription?.plan_name || '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium ${
                          !c.subscription ? 'bg-bg-secondary text-text-muted border border-border' :
                          c.subscription.status === 'active' ? 'bg-success-light text-success border border-emerald-500/30' :
                          c.subscription.status === 'trial' ? 'bg-accent/15 text-accent border border-accent/30' :
                          'bg-danger-light text-danger border border-red-500/30'
                        }`}>
                          {!c.subscription ? 'لا اشتراك' : c.subscription.status === 'active' ? 'نشط' : c.subscription.status === 'trial' ? 'تجريبي' : c.subscription.status}
                        </span>
                      </td>
                      <td className="p-3"><span className="text-xs text-text-secondary font-mono" dir="ltr">{c.subscription?.end_date || '—'}</span></td>
                      <td className="p-3 text-center"><span className="text-xs text-text-primary font-mono font-medium">{c.user_count}</span></td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetail(c)} title="تفاصيل" className="p-1.5 rounded-lg bg-bg-secondary text-text-secondary border border-border hover:bg-bg-hover"><Eye size={13} /></button>
                          <button onClick={() => openEdit(c)} title="تعديل" className="p-1.5 rounded-lg bg-bg-secondary text-text-secondary border border-border hover:bg-bg-hover"><Edit3 size={13} /></button>
                          <button onClick={() => doExtend(c)} disabled={actionLoading === 'extend'} title="تمديد التجربة 7 أيام" className="p-1.5 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"><Calendar size={13} /></button>
                          <button onClick={() => doCancel(c)} disabled={actionLoading === 'cancel'} title="إلغاء الاشتراك" className="p-1.5 rounded-lg bg-red-600 text-white border border-red-400/60 hover:bg-red-500"><Ban size={13} /></button>
                          <button onClick={() => doToggleStatus(c)} disabled={actionLoading === c.id} title={c.is_active ? 'تعليق' : 'تفعيل'} className={`p-1.5 rounded-lg border ${c.is_active ? 'bg-red-600 text-white border border-red-400/60 hover:bg-red-500' : 'bg-emerald-600 text-white border border-emerald-400/60 hover:bg-emerald-500'}`}>
                            {actionLoading === c.id ? <Loader2 size={13} className="animate-spin" /> : c.is_active ? <XCircle size={13} /> : <CheckCircle size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Detail Modal */}
        {showDetailModal && selectedCompany && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDetailModal(false)}>
            <div className="bg-bg-card border border-border rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="font-bold text-text-primary">تفاصيل: {selectedCompany.name}</h3>
                <button onClick={() => setShowDetailModal(false)} className="text-text-secondary hover:text-accent"><X size={18} /></button>
              </div>
              {detailData ? (
                <div className="p-4 space-y-3">
                  <div className="bg-bg-secondary border border-border rounded-xl p-4 text-center">
                    <p className="text-xs text-text-muted mb-1">رقم المشترك</p>
                    <p className="text-2xl font-bold text-accent font-mono">#{detailData.subscription?.subscriber_number || '—'}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">البريد</p><p className="text-text-primary font-medium" dir="ltr">{detailData.company?.email || '—'}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">الهاتف</p><p className="text-text-primary font-medium" dir="ltr">{detailData.company?.phone || '—'}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">العنوان</p><p className="text-text-primary font-medium">{detailData.company?.address || '—'}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">البلد</p><p className="text-text-primary font-medium">{detailData.company?.country || '—'}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">الباقة</p><p className="text-text-primary font-medium">{detailData.subscription?.subscription_plans?.name || '—'}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3"><p className="text-xs text-text-muted">انتهاء الاشتراك</p><p className="text-text-primary font-medium" dir="ltr">{detailData.subscription?.end_date || '—'}</p></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-bg-primary rounded-lg p-3 text-center"><p className="text-xs text-text-muted">المستخدمين</p><p className="text-xl font-bold text-accent">{detailData.stats?.user_count || 0}</p></div>
                    <div className="bg-bg-primary rounded-lg p-3 text-center"><p className="text-xs text-text-muted">المشاريع</p><p className="text-xl font-bold text-accent">{detailData.stats?.project_count || 0}</p></div>
                  </div>
                  {detailData.users && detailData.users.length > 0 && (
                    <div className="bg-bg-primary rounded-lg p-3">
                      <p className="text-xs text-text-muted mb-2 font-bold">المستخدمون</p>
                      {detailData.users.map((u, i: number) => (
                        <div key={u.id} className="flex items-center gap-2 py-1.5 border-b border-border last:border-0">
                          <span className="text-xs text-text-secondary">{i + 1}.</span>
                          <span className="text-sm text-text-primary">{u.name}</span>
                          <span className="text-xs text-text-muted" dir="ltr">({u.email})</span>
                          <span className="text-xs px-1.5 py-0.5 bg-bg-secondary text-text-secondary rounded">{u.role}</span>
                          {i === 0 && <span className="text-xs px-1.5 py-0.5 bg-accent/20 text-accent rounded font-medium">مدير</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div className="p-8 text-center text-text-secondary"><Loader2 size={24} className="animate-spin mx-auto" /></div>}
            </div>
          </div>
        )}

        {/* Master-password modal for sensitive actions (toggle / extend / cancel) */}
        {mpAction?.company && (
          <MasterPasswordModal
            isOpen={true}
            title={
              mpAction.kind === 'toggle'
                ? (mpAction.company.is_active ? 'تعليق شركة: ' : 'تفعيل شركة: ') + mpAction.company.name
                : mpAction.kind === 'extend'
                ? 'تمديد فترة التجربة: ' + mpAction.company.name
                : 'إلغاء اشتراك شركة: ' + mpAction.company.name
            }
            extraLabel={
              mpAction.kind === 'extend' ? 'سبب التمديد (اختياري)'
                : mpAction.kind === 'cancel' ? 'سبب الإلغاء (اختياري)'
                : undefined
            }
            submitLabel={
              mpAction.kind === 'toggle'
                ? (mpAction.company.is_active ? 'تأكيد التعليق' : 'تأكيد التفعيل')
                : mpAction.kind === 'cancel' ? 'تأكيد الإلغاء' : 'تأكيد التمديد'
            }
            submitClassName={mpAction.kind === 'cancel' ? 'bg-red-600 hover:bg-red-500' : 'bg-accent hover:bg-accent-hover'}
            onCancel={() => setMpAction(null)}
            onSubmit={(password, extra) => runMasterAction(password, extra)}
          />
        )}

        {/* Edit Modal */}
        {showEditModal && selectedCompany && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEditModal(false)}>
            <div className="bg-bg-card border border-border rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="font-bold text-text-primary">تعديل بيانات الشركة</h3>
                <button onClick={() => setShowEditModal(false)} className="text-text-secondary"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="اسم الشركة" value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="الرقم الضريبي" value={editForm.tax_number || ''} onChange={e => setEditForm({ ...editForm, tax_number: e.target.value })} />
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="الهاتف" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} dir="ltr" />
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="البريد" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} dir="ltr" />
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="العنوان" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                <input className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent" placeholder="كلمة السر الرئيسية" type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} />
                <button onClick={doEdit} disabled={actionLoading === 'edit'} className="w-full py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover disabled:opacity-50">
                  {actionLoading === 'edit' ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'حفظ التعديلات'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
