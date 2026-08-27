'use client';

import { AlertTriangle } from 'lucide-react';

/** Lightweight confirmation dialog for destructive/irreversible actions. */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  confirmClassName = 'bg-red-600 hover:bg-red-500',
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="bg-bg-card border border-border rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-red-950/40 border border-red-800/30 flex items-center justify-center">
            <AlertTriangle size={16} className="text-red-400" />
          </div>
          <h3 className="font-bold text-text-primary">{title}</h3>
        </div>
        {message && <p className="text-sm text-text-secondary leading-relaxed">{message}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-bg-hover">{cancelLabel}</button>
          <button onClick={onConfirm} className={`flex-1 py-2 rounded-lg text-white text-sm font-medium ${confirmClassName}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
