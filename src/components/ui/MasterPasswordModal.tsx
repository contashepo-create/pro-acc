'use client';

import { useState } from 'react';
import { Loader2, KeyRound } from 'lucide-react';

/** Unified master-password confirmation dialog for sensitive admin actions. */
export function MasterPasswordModal({
  isOpen,
  title,
  description,
  extraLabel,
  extraRequired,
  submitLabel = 'تأكيد',
  submitClassName = 'bg-amber-600 hover:bg-amber-500',
  disabled,
  onCancel,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  description?: string;
  /** Optional secondary text field (e.g. reason for trial extension). */
  extraLabel?: string;
  /** Require the secondary field to be filled before submitting. */
  extraRequired?: boolean;
  /** Label for the confirm button (default "تأكيد"). */
  submitLabel?: string;
  /** Tailwind classes for the confirm button (default amber). */
  submitClassName?: string;
  /** Disable the confirm button (e.g. when a prerequisite is missing). */
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (masterPassword: string, extra?: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const submit = async () => {
    if (!password) { setError('أدخل كلمة المرور الرئيسية'); return; }
    if (extraRequired && !extra.trim()) { setError(extraLabel ? `${extraLabel} مطلوب` : 'الحقل الإضافي مطلوب'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit(password, extra.trim() || undefined);
      setPassword(''); setExtra('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشلت العملية');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-red-950/40 border border-red-800/30 flex items-center justify-center">
            <KeyRound size={16} className="text-red-400" />
          </div>
          <h3 className="font-bold text-text-primary">{title}</h3>
        </div>
        {description && <p className="text-xs text-text-secondary">{description}</p>}
        <input
          type="password"
          autoFocus
          className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-amber-600"
          placeholder="كلمة المرور الرئيسية"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        {extraLabel && (
          <input
            type="text"
            className="w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-amber-600"
            placeholder={extraLabel}
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
          />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-bg-hover">إلغاء</button>
          <button onClick={() => void submit()} disabled={busy || disabled} className={`flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center ${submitClassName}`}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : 'تأكيد'}
          </button>
        </div>
      </div>
    </div>
  );
}
