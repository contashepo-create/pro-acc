'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Plus, RefreshCw, DollarSign, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface PaymentMethod {
  id: string;
  code: string;
  name_ar: string;
  account_number: string;
  account_name: string;
  instructions: string;
  is_active: boolean;
}

const EMPTY_FORM = { code: '', name_ar: '', account_number: '', account_name: '', instructions: '', is_active: true };

export default function PaymentMethodsPage() {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchMethods = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/payment-methods');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const data = await res.json();
      if (data.success) setMethods(data.data.methods || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (m: PaymentMethod) => {
    setEditingId(m.id);
    setForm({ code: m.code, name_ar: m.name_ar, account_number: m.account_number || '', account_name: m.account_name || '', instructions: m.instructions || '', is_active: m.is_active });
    setShowForm(true);
  };

  const saveMethod = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const isEdit = !!editingId;
      const res = await fetch('/api/admin/payment-methods', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, name_ar: form.name_ar, account_number: form.account_number, account_name: form.account_name, instructions: form.instructions, is_active: form.is_active } : form),
      });
      const data = await res.json();
      if (data.success) {
        setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); fetchMethods();
        setFeedback({ type: 'success', text: isEdit ? 'تم تعديل طريقة الدفع بنجاح' : 'تمت إضافة طريقة الدفع بنجاح' });
      } else setFeedback({ type: 'error', text: data.message || 'فشل الحفظ' });
    } finally { setSaving(false); }
  };

  const deleteMethod = async (m: PaymentMethod) => {
    if (!confirm(`هل تريد إلغاء تفعيل طريقة الدفع "${m.name_ar}"؟ سيبقى سجل الطلبات السابقة محفوظاً.`)) return;
    setFeedback(null);
    const res = await fetch(`/api/admin/payment-methods?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      setFeedback({ type: 'success', text: 'تم إلغاء تفعيل طريقة الدفع مع حفظ السجل السابق' });
      fetchMethods();
    } else {
      setFeedback({ type: 'error', text: data.message || 'فشل الحذف' });
    }
  };

  const toggleActive = async (m: PaymentMethod) => {
    await fetch('/api/admin/payment-methods', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, is_active: !m.is_active }),
    });
    fetchMethods();
  };

  if (loading) return <div className="min-h-screen bg-bg-primary flex items-center justify-center"><Loader2 className="animate-spin text-text-secondary" size={32} /></div>;

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/"><ChevronLeft size={18} className="text-text-secondary" /></Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center"><DollarSign className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-lg font-bold">طرق الدفع</h1>
              <p className="text-xs text-text-secondary">تحكم في طرق الدفع المتاحة للعملاء (انستا باي، أورنج كاش، بنكي)</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={openCreate} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm flex items-center gap-2"><Plus size={16} />إضافة طريقة</button>
            <button onClick={fetchMethods} className="p-2 rounded-xl bg-bg-card border border-border text-text-secondary"><RefreshCw size={16} /></button>
          </div>
        </div>

        {feedback && (
          <div className={`mb-4 rounded-xl p-3 text-sm font-medium border ${feedback.type === 'success' ? 'bg-success-light border-success text-success' : 'bg-danger-light border-danger text-danger'}`}>
            {feedback.text}
          </div>
        )}

        <div className="grid gap-4">
          {methods.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-2xl p-12 text-center text-text-secondary">لا توجد طرق دفع - أضف انستا باي، أورنج كاش، تحويل بنكي</div>
          ) : methods.map((m) => (
            <div key={m.id} className="bg-bg-card border border-border rounded-2xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold">{m.name_ar} <code className="text-xs bg-bg-secondary px-2 py-1 rounded ml-2">{m.code}</code></h3>
                  <div className="text-xs text-text-secondary mt-1">حساب: {m.account_number || 'غير محدد'} - {m.account_name || ''}</div>
                  <div className="text-xs text-text-muted mt-1">{m.instructions}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(m)} title="تعديل" className="p-2 rounded-lg bg-bg-secondary border border-border text-text-secondary hover:text-accent hover:border-accent transition-colors"><Pencil size={15} /></button>
                  <button onClick={() => deleteMethod(m)} title="حذف نهائي" className="p-2 rounded-lg bg-bg-secondary border border-border text-text-secondary hover:text-danger hover:border-danger transition-colors"><Trash2 size={15} /></button>
                  <button onClick={() => toggleActive(m)} title={m.is_active ? 'إلغاء التفعيل' : 'تفعيل'} className={`w-12 h-6 rounded-full transition-colors relative ${m.is_active ? 'bg-green-600' : 'bg-bg-secondary border border-border'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${m.is_active ? 'right-0.5' : 'right-6'}`}></div>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
            <div className="bg-bg-card border border-border rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-bold text-lg mb-4">{editingId ? 'تعديل طريقة دفع' : 'إضافة طريقة دفع'}</h2>
              <div className="space-y-3">
                <input placeholder="الكود (مثلاً: instapay)" value={form.code} disabled={!!editingId} onChange={(e) => setForm({...form, code: e.target.value})} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm disabled:opacity-60" />
                <input placeholder="الاسم عربي (مثلاً: انستا باي)" value={form.name_ar} onChange={(e) => setForm({...form, name_ar: e.target.value})} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm" />
                <input placeholder="رقم الحساب" value={form.account_number} onChange={(e) => setForm({...form, account_number: e.target.value})} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm" />
                <input placeholder="اسم صاحب الحساب" value={form.account_name} onChange={(e) => setForm({...form, account_name: e.target.value})} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm" />
                <textarea placeholder="تعليمات الدفع" value={form.instructions} onChange={(e) => setForm({...form, instructions: e.target.value})} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm h-20"></textarea>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 bg-bg-secondary border border-border rounded-xl text-sm">إلغاء</button>
                <button onClick={saveMethod} disabled={saving || !form.code || !form.name_ar} className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm flex items-center justify-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}حفظ</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
