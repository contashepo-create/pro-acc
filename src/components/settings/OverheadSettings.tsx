'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { basisLabel } from '@/lib/project-overhead';

type Rule = {
  id: string;
  name: string;
  allocation_basis: 'direct_cost' | 'direct_labor';
  rate: number;
  is_active: boolean;
};

export default function OverheadSettings() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [basis, setBasis] = useState<'direct_cost' | 'direct_labor'>('direct_cost');
  const [ratePct, setRatePct] = useState('10');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects/overhead');
      const d = await res.json();
      if (d.success) setRules(d.data.rows || []);
      else setError(d.message || 'تعذر تحميل قواعد التخصيص');
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const addRule = async () => {
    if (!name.trim()) { setError('اسم القاعدة مطلوب'); return; }
    const rate = Number(ratePct) / 100;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) { setError('النسبة يجب أن تكون بين 0 و 100'); return; }
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/projects/overhead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), allocation_basis: basis, rate }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || 'تعذر الحفظ'); return; }
      setName(''); setRatePct('10'); flash('تمت إضافة قاعدة التخصيص');
      await load();
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (r: Rule) => {
    const res = await fetch(`/api/projects/overhead/${r.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !r.is_active }),
    });
    const d = await res.json();
    if (!d.success) { setError(d.message || 'تعذر التحديث'); return; }
    flash('تم تحديث الحالة');
    await load();
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/projects/overhead/${id}`, { method: 'DELETE' });
    const d = await res.json();
    if (!d.success) { setError(d.message || 'تعذر الحذف'); return; }
    flash('تم حذف القاعدة');
    await load();
  };

  return (
    <div className="space-y-4">
      <Card title="تخصيص النفقات العامة (التكاليف غير المباشرة) على المشاريع">
        <p className="text-sm text-text-muted leading-relaxed mb-4">
          النفقات غير المباشرة (إشراف، إدارة، إيجار، مصاريف عامة) لا تُعزى لمشروع واحد. هنا تُعرّف
          قواعد توزيع عادلة لها على المشاريع وفق أساسين شائعين:
          <span className="font-medium text-text-secondary"> نسبة من التكلفة المباشرة </span>أو
          <span className="font-medium text-text-secondary"> نسبة من تكلفة العمالة المباشرة</span>.
          يظهر المبلغ المخصّص منفصلاً في تقرير ربحية المشروع (ربح مباشر ثم ربح بعد التحميل).
        </p>

        {toast && <div className="mb-3 p-2.5 rounded-md bg-success/10 text-success text-sm">{toast}</div>}
        {error && <div className="mb-3 p-2.5 rounded-md bg-danger/10 text-danger text-sm">{error}</div>}

        {loading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري التحميل...
          </div>
        ) : rules.length === 0 ? (
          <div className="py-4 text-sm text-text-muted">لا توجد قواعد تخصيص بعد. أضف أول قاعدة أدناه.</div>
        ) : (
          <div className="space-y-2 mb-4">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-surface">
                <div>
                  <div className="font-medium text-sm">{r.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {basisLabel(r.allocation_basis)} — {(Number(r.rate) * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={r.is_active ? 'success' : 'danger'}>{r.is_active ? 'مفعّلة' : 'متوقفة'}</Badge>
                  <button
                    onClick={() => toggle(r)}
                    className="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-hover"
                  >
                    {r.is_active ? 'إيقاف' : 'تفعيل'}
                  </button>
                  <button onClick={() => remove(r.id)} className="text-danger hover:opacity-70" title="حذف">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-border pt-4">
          <Input label="اسم القاعدة" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: مصاريف الإدارة" />
          <Select
            label="أساس التخصيص"
            value={basis}
            onChange={(v) => setBasis(v as any)}
            options={[
              { value: 'direct_cost', label: 'نسبة من التكلفة المباشرة' },
              { value: 'direct_labor', label: 'نسبة من تكلفة العمالة المباشرة' },
            ]}
          />
          <Input label="النسبة (%)" type="number" value={ratePct} onChange={(e) => setRatePct(e.target.value)} min={0} max={100} />
        </div>
        <div className="mt-4">
          <Button onClick={addRule} leftIcon={<Plus size={16} />} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={16} />} إضافة القاعدة
          </Button>
        </div>
      </Card>
    </div>
  );
}
