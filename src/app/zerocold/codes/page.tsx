'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Key, Plus, Loader2, Copy, Check, ChevronLeft, ShieldAlert, RefreshCw
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
  const [planCode, setPlanCode] = useState('monthly');
  const [duration, setDuration] = useState(12);
  const [generatedCode, setGeneratedCode] = useState('');
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

  useEffect(() => { fetchCodes(); }, []);

  const generateCode = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/activation-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode, durationMonths: duration }),
      });
      const body = await res.json();
      if (body.success) { setGeneratedCode(body.data.code); fetchCodes(); }
    } finally { setSaving(false); }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href="/zerocold/" className="p-2 rounded-lg hover:bg-[#12101a] transition-all">
              <ChevronLeft size={18} className="text-amber-500/70" />
            </Link>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-amber-50">أكواد التفعيل</h1>
              <p className="text-[0.7rem] text-amber-400/50">{codes.length} كود</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowForm(true); setGeneratedCode(''); }} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm flex items-center gap-2 transition-colors">
              <Plus size={16} />توليد كود
            </button>
            <button onClick={fetchCodes} className="p-2 rounded-xl bg-[#12101a] border border-[#2a1f0a] text-amber-500/70 hover:text-amber-400 transition-all" title="تحديث">
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
          <div className="bg-[#12101a] border border-[#2a1f0a] rounded-2xl p-5 mb-6">
            <h3 className="text-amber-50 font-bold mb-4">توليد كود تفعيل جديد</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-40">
                <label className="block text-xs text-amber-400/60 mb-1">الخطة</label>
                <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm">
                  <option value="trial">تجريبي</option>
                  <option value="monthly">شهري</option>
                  <option value="yearly">سنوي</option>
                  <option value="starter">مبتدئ</option>
                  <option value="professional">احترافي</option>
                  <option value="enterprise">مؤسسات</option>
                </select>
              </div>
              <div className="w-32">
                <label className="block text-xs text-amber-400/60 mb-1">المدة (أشهر)</label>
                <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={1} max={120} className="w-full px-4 py-2.5 bg-[#1a1625] border border-[#2a1f0a] rounded-xl text-amber-50 text-sm" />
              </div>
              <button onClick={generateCode} disabled={saving} className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-amber-800 text-white rounded-xl text-sm flex items-center gap-2">{saving && <Loader2 size={16} className="animate-spin" />}توليد</button>
            </div>
            {generatedCode && (
              <div className="mt-4 p-3 bg-amber-950/30 border border-amber-700/30 rounded-xl flex items-center gap-3">
                <code className="flex-1 text-amber-300 text-sm font-mono">{generatedCode}</code>
                <button onClick={copyCode} className="p-2 hover:bg-amber-900/30 rounded-lg transition-colors">
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} className="text-amber-400" />}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="bg-[#12101a] border border-[#2a1f0a] rounded-xl overflow-hidden">
          {codes.length === 0 ? (
            <div className="p-8 text-center">
              <Key size={32} className="text-amber-600/30 mx-auto mb-2" />
              <p className="text-amber-600/50 text-sm">لا توجد أكواد تفعيل</p>
            </div>
          ) : (
            <div className="divide-y divide-[#1f1725]">
              {codes.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 hover:bg-[#1a1625] transition-all">
                  <Key size={16} className="text-amber-600 shrink-0" />
                  <code className="flex-1 text-amber-300/80 text-sm font-mono">{c.code}</code>
                  <span className="text-xs text-amber-400/60">{c.plan_code}</span>
                  <span className="text-xs text-amber-400/60">{c.duration_months} أشهر</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${c.is_used ? 'bg-amber-900/30 text-amber-400' : 'bg-green-900/30 text-green-400'}`}>{c.is_used ? 'مستخدم' : 'جديد'}</span>
                  {c.company_name && <span className="text-xs text-amber-400/60">{c.company_name}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
