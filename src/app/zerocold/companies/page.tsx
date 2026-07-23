'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, Search, Loader2, RefreshCw, CheckCircle, XCircle, ChevronLeft,
  CreditCard, Edit3, Calendar, Ban, Eye, X
} from 'lucide-react';
import Link from 'next/link';

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
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [editForm, setEditForm] = useState<any>({});
  const [planForm, setPlanForm] = useState<any>({ plan_id: '', duration_days: 30, auto_renew: false });
  const [masterPassword, setMasterPassword] = useState('');
  const [detailData, setDetailData] = useState<any>(null);

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
    if (body.success) setPlans(body.data || []);
  };

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

  const openPlanChange = (company: Company) => {
    setSelectedCompany(company);
    setPlanForm({ plan_id: '', duration_days: 30, auto_renew: false });
    setShowPlanModal(true);
  };

  const doToggleStatus = async (company: Company) => {
    const mp = prompt('كلمة السر الرئيسية:');
    if (!mp) return;
    setActionLoading(company.id);
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': mp },
        body: JSON.stringify({ action: 'toggle_status', is_active: !company.is_active }),
      });
      const body = await res.json();
      if (body.success) { fetchCompanies(); }
      else alert(body.message || 'فشل');
    } catch { alert('خطأ في الاتصال'); }
    finally { setActionLoading(null); }
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

  const doChangePlan = async () => {
    setActionLoading('plan');
    try {
      const res = await fetch(`/api/admin/companies/${selectedCompany!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': masterPassword },
        body: JSON.stringify({ action: 'change_plan', ...planForm }),
      });
      const body = await res.json();
      if (body.success) { setShowPlanModal(false); setMasterPassword(''); fetchCompanies(); }
      else alert(body.message || 'فشل');
    } catch { alert('خطأ في الاتصال'); }
    finally { setActionLoading(null); }
  };

  const doExtend = async (company: Company, days: number) => {
    const mp = prompt('كلمة السر الرئيسية:');
    if (!mp) return;
    setActionLoading('extend');
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': mp },
        body: JSON.stringify({ action: 'extend_subscription', days }),
      });
      const body = await res.json();
      if (body.success) { fetchCompanies(); alert(body.message); }
      else alert(body.message || 'فشل');
    } catch { alert('خطأ في الاتصال'); }
    finally { setActionLoading(null); }
  };

  const doCancel = async (company: Company) => {
    if (!confirm(`إلغاء اشتراك ${company.name}؟`)) return;
    const mp = prompt('كلمة السر الرئيسية:');
    if (!mp) return;
    setActionLoading('cancel');
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-master-password': mp },
        body: JSON.stringify({ action: 'cancel_subscription' }),
      });
      const body = await res.json();
      if (body.success) { fetchCompanies(); alert(body.message); }
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
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><Loader2 size={32} className="text-amber-500 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a]"><ChevronLeft size={18} className="text-amber-500/70" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-600 to-blue-700 flex items-center justify-center"><Building2 className="w-5 h-5 text-white" /></div>
            <div><h1 className="text-lg font-bold text-amber-50">إدارة الشركات</h1><p className="text-[0.7rem] text-amber-400/50">{companies.length} شركة</p></div>
          </div>
          <button onClick={fetchCompanies} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400"><RefreshCw size={16} /></button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600/50" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم، الرقم الضريبي، رقم المشترك..."
            className="w-full pr-10 pl-4 py-2.5 bg-[#12101a] border border-[#2a1f0a] rounded-xl text-amber-50 placeholder-amber-700/50 focus:outline-none focus:border-amber-600 text-sm" />
        </div>

        {error && <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">{error}</div>}

        {/* Table */}
        {filtered.length === 0 && !error ? (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl p-8 text-center">
            <Building2 size={32} className="text-amber-600/30 mx-auto mb-2" />
            <p className="text-amber-600/50 text-sm">لا توجد شركات</p>
          </div>
        ) : (
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a1f0a]">
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">اسم الشركة</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">رقم المشترك</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">الباقة</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الحالة</th>
                    <th className="text-right p-3 text-[0.7rem] text-amber-500/60 font-medium">انتهاء الاشتراك</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">المستخدمين</th>
                    <th className="text-center p-3 text-[0.7rem] text-amber-500/60 font-medium">الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(c => (
                    <tr key={c.id} className="border-b border-[#1f1725] last:border-0 hover:bg-[#1a1625]">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${c.is_active ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <div>
                            <span className="text-sm text-amber-200 font-medium block">{c.name}</span>
                            <span className="text-[0.65rem] text-amber-500/40">{c.tax_number || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        {c.subscription?.subscriber_number ? (
                          <span className="text-sm text-amber-300 font-mono font-bold">#{c.subscription.subscriber_number}</span>
                        ) : <span className="text-amber-600/30 text-xs">—</span>}
                      </td>
                      <td className="p-3">
                        <span className="text-xs text-amber-400/70">{c.subscription?.plan_name || '—'}</span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium ${
                          !c.subscription ? 'bg-gray-800/40 text-gray-500 border border-gray-700/30' :
                          c.subscription.status === 'active' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/30' :
                          c.subscription.status === 'trial' ? 'bg-blue-950/40 text-blue-400 border border-blue-800/30' :
                          'bg-red-950/40 text-red-400 border border-red-800/30'
                        }`}>
                          {!c.subscription ? 'لا اشتراك' : c.subscription.status === 'active' ? 'نشط' : c.subscription.status === 'trial' ? 'تجريبي' : c.subscription.status}
                        </span>
                      </td>
                      <td className="p-3"><span className="text-xs text-amber-400/60">{c.subscription?.end_date || '—'}</span></td>
                      <td className="p-3 text-center"><span className="text-xs text-amber-400/80 font-mono">{c.user_count}</span></td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openDetail(c)} title="تفاصيل" className="p-1.5 rounded-lg bg-sky-950/20 text-sky-400/70 border border-sky-800/20 hover:bg-sky-950/40"><Eye size={13} /></button>
                          <button onClick={() => openEdit(c)} title="تعديل" className="p-1.5 rounded-lg bg-amber-950/20 text-amber-400/70 border border-amber-800/20 hover:bg-amber-950/40"><Edit3 size={13} /></button>
                          <button onClick={() => openPlanChange(c)} title="تغيير الباقة" className="p-1.5 rounded-lg bg-purple-950/20 text-purple-400/70 border border-purple-800/20 hover:bg-purple-950/40"><CreditCard size={13} /></button>
                          <button onClick={() => doExtend(c, 30)} disabled={actionLoading === 'extend'} title="تمديد 30 يوم" className="p-1.5 rounded-lg bg-emerald-950/20 text-emerald-400/70 border border-emerald-800/20 hover:bg-emerald-950/40"><Calendar size={13} /></button>
                          <button onClick={() => doCancel(c)} disabled={actionLoading === 'cancel'} title="إلغاء الاشتراك" className="p-1.5 rounded-lg bg-red-950/20 text-red-400/70 border border-red-800/20 hover:bg-red-950/40"><Ban size={13} /></button>
                          <button onClick={() => doToggleStatus(c)} disabled={actionLoading === c.id} title={c.is_active ? 'تعليق' : 'تفعيل'} className={`p-1.5 rounded-lg border ${c.is_active ? 'bg-red-950/20 text-red-400/70 border-red-800/20' : 'bg-emerald-950/20 text-emerald-400/70 border-emerald-800/20'}`}>
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
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-[#2a1f0a]">
                <h3 className="font-bold text-amber-50">تفاصيل: {selectedCompany.name}</h3>
                <button onClick={() => setShowDetailModal(false)} className="text-amber-500/50 hover:text-amber-400"><X size={18} /></button>
              </div>
              {detailData ? (
                <div className="p-4 space-y-3">
                  <div className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-4 text-center">
                    <p className="text-xs text-amber-500/50 mb-1">رقم المشترك</p>
                    <p className="text-2xl font-bold text-amber-300 font-mono">#{detailData.subscription?.subscriber_number || '—'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">البريد</p><p className="text-amber-200" dir="ltr">{detailData.company?.email || '—'}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">الهاتف</p><p className="text-amber-200" dir="ltr">{detailData.company?.phone || '—'}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">العنوان</p><p className="text-amber-200">{detailData.company?.address || '—'}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">البلد</p><p className="text-amber-200">{detailData.company?.country || '—'}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">الباقة</p><p className="text-amber-200">{detailData.subscription?.subscription_plans?.name || '—'}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3"><p className="text-xs text-amber-500/50">انتهاء الاشتراك</p><p className="text-amber-200" dir="ltr">{detailData.subscription?.end_date || '—'}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#0a0a0f] rounded-lg p-3 text-center"><p className="text-xs text-amber-500/50">المستخدمين</p><p className="text-xl font-bold text-amber-300">{detailData.stats?.user_count || 0}</p></div>
                    <div className="bg-[#0a0a0f] rounded-lg p-3 text-center"><p className="text-xs text-amber-500/50">المشاريع</p><p className="text-xl font-bold text-amber-300">{detailData.stats?.project_count || 0}</p></div>
                  </div>
                  {detailData.users?.length > 0 && (
                    <div className="bg-[#0a0a0f] rounded-lg p-3">
                      <p className="text-xs text-amber-500/50 mb-2">المستخدمون</p>
                      {detailData.users.map((u: any, i: number) => (
                        <div key={u.id} className="flex items-center gap-2 py-1.5 border-b border-[#1f1725] last:border-0">
                          <span className="text-xs text-amber-400/60">{i + 1}.</span>
                          <span className="text-sm text-amber-200">{u.name}</span>
                          <span className="text-xs text-amber-500/40" dir="ltr">{u.email}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-amber-950/30 text-amber-500/60 rounded">{u.role}</span>
                          {i === 0 && <span className="text-xs px-1.5 py-0.5 bg-amber-600/20 text-amber-400 rounded">مدير</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : <div className="p-8 text-center text-amber-500/50"><Loader2 size={24} className="animate-spin mx-auto" /></div>}
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {showEditModal && selectedCompany && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEditModal(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-[#2a1f0a]">
                <h3 className="font-bold text-amber-50">تعديل بيانات الشركة</h3>
                <button onClick={() => setShowEditModal(false)} className="text-amber-500/50"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="اسم الشركة" value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="الرقم الضريبي" value={editForm.tax_number || ''} onChange={e => setEditForm({ ...editForm, tax_number: e.target.value })} />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="الهاتف" value={editForm.phone || ''} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} dir="ltr" />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="البريد" value={editForm.email || ''} onChange={e => setEditForm({ ...editForm, email: e.target.value })} dir="ltr" />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="العنوان" value={editForm.address || ''} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="كلمة السر الرئيسية" type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} />
                <button onClick={doEdit} disabled={actionLoading === 'edit'} className="w-full py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-500 disabled:opacity-50">
                  {actionLoading === 'edit' ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'حفظ التعديلات'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Change Plan Modal */}
        {showPlanModal && selectedCompany && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPlanModal(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-[#2a1f0a]">
                <h3 className="font-bold text-amber-50">تغيير باقة: {selectedCompany.name}</h3>
                <button onClick={() => setShowPlanModal(false)} className="text-amber-500/50"><X size={18} /></button>
              </div>
              <div className="p-4 space-y-3">
                <select className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" value={planForm.plan_id} onChange={e => setPlanForm({ ...planForm, plan_id: e.target.value })}>
                  <option value="">— اختر الباقة —</option>
                  {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.price_monthly || 0}/شهر)</option>)}
                </select>
                <input type="number" className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="عدد الأيام" value={planForm.duration_days} onChange={e => setPlanForm({ ...planForm, duration_days: parseInt(e.target.value) || 30 })} />
                <label className="flex items-center gap-2 text-sm text-amber-200"><input type="checkbox" checked={planForm.auto_renew} onChange={e => setPlanForm({ ...planForm, auto_renew: e.target.checked })} /> تجديد تلقائي</label>
                <input className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-600" placeholder="كلمة السر الرئيسية" type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} />
                <button onClick={doChangePlan} disabled={actionLoading === 'plan'} className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-50">
                  {actionLoading === 'plan' ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'تغيير الباقة'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
