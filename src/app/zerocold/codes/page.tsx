'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Key, Plus, Loader2, Copy, Check, ChevronLeft, RefreshCw
} from 'lucide-react';
import Link from 'next/link';

interface ActivationCode {
  id: string; code: string; plan_code: string; duration_months: number;
  is_used: boolean; company_name: string; created_at: string;
}

export default function CodesPage() {
  const router = useRouter();
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [plans, setPlans] = useState<Array<{ code: string; name: string }>>([]);
  const [planCode, setPlanCode] = useState('');
  const [duration, setDuration] = useState(12);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchCodes = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/activation-codes');
      if (res.status === 401) { router.replace('/zerocold/login'); return; }
      const body = await res.json();
      if (body.success) setCodes(body.data?.codes ?? (Array.isArray(body.data) ? body.data : []));
      else setError(body.message || 'حدث خطأ');
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/subscription-plans');
        if (res.status === 401) return;
        const body = await res.json();
        const list = Array.isArray(body?.data?.plans)
          ? body.data.plans
          : (Array.isArray(body?.data) ? body.data : []);
        if (body.success && list.length > 0) {
          const active = list.filter((p: { is_active?: boolean; code?: string }) => p.is_active !== false && !!p.code);
          setPlans(active.map((p: { code: string; name: string }) => ({ code: p.code, name: p.name })));
          if (active.length) {
            setPlanCode((current) => (active.some((p: { code: string }) => p.code === current) ? current : active[0].code));
          }
        }
      } catch { /* fallback to manual entry below */ }
    })();
  }, []);

  const generateCode = async () => {
    setError('');
    if (!planCode) { setError('اختر الباقة أولاً'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/activation-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, durationMonths: duration }),
      });
      const body = await res.json();
      if (body.success) {
        const list: string[] = Array.isArray(body.data?.codes) ? body.data.codes : [];
        setGeneratedCodes(list);
        fetchCodes();
      } else {
        setError(body.message || 'تعذر توليد الكود');
      }
    } catch {
      setError('حدث خطأ في الاتصال بالخادم');
    } finally { setSaving(false); }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <Loader2 size={32} className="text-text-secondary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-bg-card transition-all">
              <ChevronLeft size={18} className="text-text-secondary" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">أكواد التفعيل</h1>
              <p className="text-[0.7rem] text-text-muted">{codes.length} كود</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowForm(true); setGeneratedCodes([]); }} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm flex items-center gap-2 transition-colors">
              <Plus size={16} />توليد كود
            </button>
            <button onClick={fetchCodes} className="p-2 rounded-xl bg-bg-card border border-border text-text-secondary hover:text-accent transition-all" title="تحديث">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/40 text-red-400 text-sm rounded-xl px-4 py-2.5 text-center mb-4">
            {error}
          </div>
        )}

        {showForm && (
          <div className="bg-bg-card border border-border rounded-2xl p-5 mb-6">
            <h3 className="text-text-primary font-bold mb-4">توليد كود تفعيل جديد</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-40">
                <label className="block text-xs text-text-secondary mb-1">الخطة</label>
                {plans.length > 0 ? (
                  <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-text-primary text-sm focus:outline-none focus:border-accent">
                    {plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
                  </select>
                ) : (
                  <input value={planCode} onChange={(e) => setPlanCode(e.target.value)} placeholder="كود الباقة (مثل monthly)" dir="ltr" className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-text-primary text-sm focus:outline-none focus:border-accent" />
                )}
              </div>
              <div className="w-32">
                <label className="block text-xs text-text-secondary mb-1">المدة (أشهر)</label>
                <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} max={120} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-text-primary text-sm focus:outline-none focus:border-accent" />
              </div>
              <button onClick={generateCode} disabled={saving} className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-xl text-sm flex items-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}توليد</button>
            </div>
            {generatedCodes.length > 0 && (
              <div className="mt-4 p-3 bg-accent/10 border border-accent/20 rounded-xl">
                <p className="text-[0.7rem] text-accent mb-2">⚠️ هذه الأكواد تُعرض مرة واحدة فقط — انسخها واحفظها الآن:</p>
                {generatedCodes.map((code) => (
                  <div key={code} className="flex items-center gap-3 py-1">
                    <code className="flex-1 text-accent text-sm font-mono font-bold">{code}</code>
                  </div>
                ))}
                <button onClick={copyCode} className="mt-2 p-2 hover:bg-accent/20 rounded-lg transition-colors flex items-center gap-2 text-xs text-accent">
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  {copied ? 'تم النسخ' : 'نسخ الكود'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="bg-bg-card border border-border rounded-xl overflow-x-auto">
          {codes.length === 0 ? (
            <div className="p-8 text-center">
              <Key size={32} className="text-text-muted mx-auto mb-2 opacity-40" />
              <p className="text-text-muted text-sm">لا توجد أكواد تفعيل</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {codes.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-bg-secondary transition-all">
                  <Key size={16} className="text-accent shrink-0" />
                  <code className="flex-1 text-accent font-semibold text-sm font-mono">{c.code}</code>
                  <span className="text-xs text-text-secondary">{c.plan_code}</span>
                  <span className="text-xs text-text-secondary">{c.duration_months} أشهر</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${c.is_used ? 'bg-bg-secondary text-text-muted' : 'bg-success-light text-success font-semibold'}`}>{c.is_used ? 'مستخدم' : 'جديد'}</span>
                  {c.company_name && <span className="text-xs text-text-secondary">{c.company_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
