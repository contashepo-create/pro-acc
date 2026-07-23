'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Plus, Loader2, ChevronLeft, RefreshCw, Settings, Users, DollarSign, Trash2, X } from 'lucide-react';
import Link from 'next/link';

interface Plan {
  id: string; 
  code: string; 
  name: string; 
  description: string;
  description_ar: string;
  price_monthly: number; 
  price_yearly: number; 
  yearly_discount_percent: number;
  trial_days: number;
  max_users: number;
  max_clients: number;
  max_suppliers: number;
  max_employees: number;
  max_projects: number;
  max_invoices_per_month: number;
  max_storage_mb: number;
  features_modules: any;
  is_active: boolean; 
  sort_order: number;
}

const ALL_MODULES = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: '📊' },
  { id: 'accounts', label: 'دليل الحسابات', icon: '📒' },
  { id: 'journal', label: 'القيود اليومية', icon: '📝' },
  { id: 'invoices', label: 'الفواتير', icon: '🧾' },
  { id: 'clients', label: 'العملاء', icon: '👥' },
  { id: 'contacts', label: 'جهات الاتصال', icon: '📇' },
  { id: 'banks', label: 'البنوك والخزائن', icon: '🏦' },
  { id: 'cash', label: 'الخزينة', icon: '💰' },
  { id: 'projects', label: 'المشاريع', icon: '🏗️' },
  { id: 'reports', label: 'التقارير', icon: '📈' },
  { id: 'inventory', label: 'المخزون', icon: '📦' },
  { id: 'purchases', label: 'المشتريات', icon: '🛒' },
  { id: 'employees', label: 'الموظفين', icon: '👷' },
  { id: 'payroll', label: 'الرواتب', icon: '💵' },
  { id: 'fixed-assets', label: 'الأصول الثابتة', icon: '🏢' },
  { id: 'subcontractors', label: 'مقاولي الباطن', icon: '👷‍♂️' },
  { id: 'boq', label: 'جدول الكميات', icon: '📋' },
  { id: 'progress-billing', label: 'المستخلصات', icon: '📄' },
  { id: 'settings', label: 'الإعدادات', icon: '⚙️' },
  { id: 'backup', label: 'النسخ الاحتياطي', icon: '💾' },
  { id: 'subscription', label: 'الباقات', icon: '💳' },
  { id: 'telegram_integration', label: 'ربط تيليجرام والموافقات', icon: '🤖' },
];

export default function PlansPageEnhanced() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [form, setForm] = useState<any>({
    code: '', name: '', description_ar: '', description: '',
    price_monthly: 0, price_yearly: 0, yearly_discount_percent: 20,
    trial_days: 7, max_users: 1, max_clients: 10, max_suppliers: 10,
    max_employees: 5, max_projects: 2, max_invoices_per_month: 50, max_storage_mb: 100,
    features_modules: {},
    is_active: true, sort_order: 0
  });
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePlan, setDeletePlan] = useState<Plan | null>(null);
  const [migrateTo, setMigrateTo] = useState('');
  const [deleting, setDeleting] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/subscription-plans');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const body = await res.json();
      if (body.success) setPlans(body.data?.plans ?? []);
      else setError(body.message || 'حدث خطأ');
    } catch {
      setError('حدث خطأ في الاتصال');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm({
      code: plan.code,
      name: plan.name,
      description_ar: plan.description_ar || plan.description || '',
      description: plan.description || '',
      price_monthly: plan.price_monthly,
      price_yearly: plan.price_yearly || plan.price_monthly * 12,
      yearly_discount_percent: plan.yearly_discount_percent || 20,
      trial_days: plan.trial_days || 7,
      max_users: plan.max_users,
      max_clients: plan.max_clients || 10,
      max_suppliers: plan.max_suppliers || 10,
      max_employees: plan.max_employees || 5,
      max_projects: plan.max_projects || 2,
      max_invoices_per_month: plan.max_invoices_per_month || 50,
      max_storage_mb: plan.max_storage_mb || 100,
      features_modules: plan.features_modules || {},
      is_active: plan.is_active,
      sort_order: plan.sort_order || 0,
    });
    setShowForm(true);
  };

  const openNew = () => {
    setEditingPlan(null);
    setForm({
      code: '', name: '', description_ar: '', description: '',
      price_monthly: 199, price_yearly: 1990, yearly_discount_percent: 20,
      trial_days: 7, max_users: 3, max_clients: 50, max_suppliers: 50,
      max_employees: 20, max_projects: 10, max_invoices_per_month: 200, max_storage_mb: 500,
      features_modules: { dashboard: true, accounts: true, journal: true, invoices: true, clients: true, reports: true, settings: true, subscription: true },
      is_active: true, sort_order: plans.length
    });
    setShowForm(true);
  };

  const savePlan = async () => {
    setSaving(true);
    try {
      const url = editingPlan ? `/api/admin/subscription-plans/${editingPlan.id}` : '/api/admin/subscription-plans';
      const method = editingPlan ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (body.success) { setShowForm(false); fetchPlans(); }
      else setError(body.message);
    } finally { setSaving(false); }
  };

  const toggleModule = (moduleId: string) => {
    setForm((prev: any) => ({
      ...prev,
      features_modules: {
        ...prev.features_modules,
        [moduleId]: !prev.features_modules[moduleId]
      }
    }));
  };

  const openDelete = (plan: Plan) => {
    setDeletePlan(plan);
    setMigrateTo('');
    setShowDeleteModal(true);
  };

  const doDelete = async () => {
    if (!deletePlan) return;
    setDeleting(true);
    try {
      const url = `/api/admin/subscription-plans/${deletePlan.id}${migrateTo ? `?migrate_to=${migrateTo}` : ''}`;
      const res = await fetch(url, { method: 'DELETE' });
      const body = await res.json();
      if (body.success) {
        setShowDeleteModal(false);
        setDeletePlan(null);
        fetchPlans();
        alert(body.migrated > 0 ? `تم حذف الباقة وترحيل ${body.migrated} مشترك` : 'تم حذف الباقة');
      } else {
        alert(body.message || 'فشل الحذف');
      }
    } catch { alert('خطأ في الاتصال'); }
    finally { setDeleting(false); }
  };

  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><Loader2 size={32} className="text-amber-500 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-amber-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a]"><ChevronLeft size={18} className="text-amber-500/70" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center"><Package className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-lg font-bold">تخصيص الباقات المرن</h1>
              <p className="text-[0.7rem] text-amber-400/50">{plans.length} باقة - تحكم كامل في الأقسام والحدود</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={openNew} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center gap-2"><Plus size={16} />إضافة باقة</button>
            <button onClick={fetchPlans} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70"><RefreshCw size={16} /></button>
          </div>
        </div>

        {error && <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 mb-4">{error}</div>}

        <div className="grid gap-4">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5 hover:border-amber-800/50 transition-colors">
              <div className="flex justify-between items-start">
                <div className="cursor-pointer flex-1" onClick={() => openEdit(plan)}>
                  <h3 className="font-bold text-lg flex items-center gap-2">{plan.name} <code className="text-xs bg-amber-950/30 px-2 py-0.5 rounded text-amber-600">{plan.code}</code></h3>
                  <p className="text-amber-400/50 text-sm mt-1">{plan.description_ar || plan.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${plan.is_active ? 'bg-green-500' : 'bg-red-500'}`}></div>
                  <button onClick={(e) => { e.stopPropagation(); openDelete(plan); }} className="p-1.5 rounded-lg bg-red-950/20 text-red-400/70 border border-red-800/20 hover:bg-red-950/40" title="حذف الباقة">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
                <div className="bg-[#1a1625] rounded-lg p-2"><span className="text-amber-400/50">شهري: </span><strong>{plan.price_monthly} ر.س</strong></div>
                <div className="bg-[#1a1625] rounded-lg p-2"><span className="text-amber-400/50">سنوي: </span><strong>{plan.price_yearly} ر.س ({plan.yearly_discount_percent}% خصم)</strong></div>
                <div className="bg-[#1a1625] rounded-lg p-2"><span className="text-amber-400/50">تجريبي: </span><strong>{plan.trial_days} يوم</strong></div>
                <div className="bg-[#1a1625] rounded-lg p-2"><span className="text-amber-400/50">مستخدمين: </span><strong>{plan.max_users}</strong></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(plan.features_modules || {}).filter(([, v]) => v).map(([k]) => (
                  <span key={k} className="text-[10px] bg-amber-950/30 border border-amber-900/30 text-amber-400 px-2 py-1 rounded-full">{ALL_MODULES.find(m=>m.id===k)?.label || k}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={() => setShowForm(false)}>
            <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-xl font-bold mb-6">{editingPlan ? 'تعديل الباقة' : 'باقة جديدة - تحكم مرن'}</h2>
              
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input placeholder="الكود (مثال: basic)" value={form.code} onChange={(e) => setForm({...form, code: e.target.value})} className="px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                  <input placeholder="اسم الباقة" value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />
                </div>
                <input placeholder="الوصف العربي" value={form.description_ar} onChange={(e) => setForm({...form, description_ar: e.target.value})} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-sm" />

                <div className="border-t border-[#2a1f0a] pt-4">
                  <h3 className="font-bold flex items-center gap-2 mb-3"><DollarSign size={16} /> الأسعار والمدة</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div><label className="text-xs text-amber-400/70">شهري (ر.س)</label><input type="number" value={form.price_monthly} onChange={(e) => setForm({...form, price_monthly: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border border-[#2a1f0a] rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">سنوي (ر.س)</label><input type="number" value={form.price_yearly} onChange={(e) => setForm({...form, price_yearly: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border border-[#2a1f0a] rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">خصم السنوي %</label><input type="number" value={form.yearly_discount_percent} onChange={(e) => setForm({...form, yearly_discount_percent: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border border-[#2a1f0a] rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">تجريبي (أيام)</label><input type="number" value={form.trial_days} onChange={(e) => setForm({...form, trial_days: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border border-[#2a1f0a] rounded-lg text-sm" /></div>
                  </div>
                </div>

                <div className="border-t border-[#2a1f0a] pt-4">
                  <h3 className="font-bold flex items-center gap-2 mb-3"><Users size={16} /> الحدود والأعداد (تحكم مرن)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div><label className="text-xs text-amber-400/70">مستخدمين</label><input type="number" value={form.max_users} onChange={(e) => setForm({...form, max_users: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">عملاء</label><input type="number" value={form.max_clients} onChange={(e) => setForm({...form, max_clients: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">موردين</label><input type="number" value={form.max_suppliers} onChange={(e) => setForm({...form, max_suppliers: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">موظفين</label><input type="number" value={form.max_employees} onChange={(e) => setForm({...form, max_employees: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">مشاريع</label><input type="number" value={form.max_projects} onChange={(e) => setForm({...form, max_projects: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">فواتير/شهر</label><input type="number" value={form.max_invoices_per_month} onChange={(e) => setForm({...form, max_invoices_per_month: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                    <div><label className="text-xs text-amber-400/70">تخزين MB</label><input type="number" value={form.max_storage_mb} onChange={(e) => setForm({...form, max_storage_mb: Number(e.target.value)})} className="w-full mt-1 px-3 py-2 bg-[#1a1625] border rounded-lg text-sm" /></div>
                  </div>
                </div>

                <div className="border-t border-[#2a1f0a] pt-4">
                  <h3 className="font-bold flex items-center gap-2 mb-3"><Settings size={16} /> الأقسام المسموحة (علم لإتاحة القسم)</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto p-2 bg-[#0a0a0f] rounded-xl">
                    {ALL_MODULES.map((mod) => (
                      <label key={mod.id} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${form.features_modules[mod.id] ? 'bg-amber-900/30 border border-amber-700/50' : 'bg-[#1a1625] border border-transparent hover:border-[#2a1f0a]'}`}>
                        <input type="checkbox" checked={!!form.features_modules[mod.id]} onChange={() => toggleModule(mod.id)} className="w-4 h-4 rounded accent-amber-600" />
                        <span className="text-sm">{mod.icon}</span>
                        <span className="text-xs">{mod.label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-400/50 mt-2">✓ علم على الأقسام اللي عايز تتيحها في الباقة دي. إلغاء العلم يخفي القسم تماماً للمشتركين في الباقة الأقل.</p>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 bg-[#1a1625] border border-[#2a1f0a] text-amber-300 rounded-xl text-sm">إلغاء</button>
                <button onClick={savePlan} disabled={saving || !form.name} className="flex-1 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center justify-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}حفظ الباقة المرنة</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Modal */}
        {showDeleteModal && deletePlan && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowDeleteModal(false)}>
            <div className="bg-[#12101a] border border-red-900/40 rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-red-400">حذف الباقة: {deletePlan.name}</h2>
                <button onClick={() => setShowDeleteModal(false)} className="text-amber-500/50"><X size={18} /></button>
              </div>
              <p className="text-amber-400/70 text-sm mb-4">سيتم حذف الباقة نهائياً. إذا كان هناك مشتركون على هذه الباقة، يجب اختيار باقة بديلة لترحيلهم إليها.</p>
              <div className="space-y-3">
                <select className="w-full bg-[#0a0a0f] border border-[#2a1f0a] rounded-lg px-3 py-2.5 text-sm text-amber-50 focus:outline-none focus:border-red-600" value={migrateTo} onChange={e => setMigrateTo(e.target.value)}>
                  <option value="">— بدون ترحيل (يُرفض الحذف إذا يوجد مشتركون) —</option>
                  {plans.filter(p => p.id !== deletePlan.id).map(p => (
                    <option key={p.id} value={p.id}>ترحيل إلى: {p.name}</option>
                  ))}
                </select>
                <div className="flex gap-3">
                  <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-2.5 bg-[#1a1625] border border-[#2a1f0a] text-amber-300 rounded-xl text-sm">إلغاء</button>
                  <button onClick={doDelete} disabled={deleting} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm flex items-center justify-center gap-2">
                    {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} حذف الباقة
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
