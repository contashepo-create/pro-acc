'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, 'id'>) => string;
  removeToast: (id: string) => void;
}

const listeners: Set<(state: ToastState) => void> = new Set();
let toastState: ToastState = {
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(2);
    toastState = {
      ...toastState,
      toasts: [...toastState.toasts, { ...toast, id }],
    };
    listeners.forEach((l) => l(toastState));
    return id;
  },
  removeToast: (id) => {
    toastState = {
      ...toastState,
      toasts: toastState.toasts.filter((t) => t.id !== id),
    };
    listeners.forEach((l) => l(toastState));
  },
};

export const toast = {
  success: (message: string, duration = 4000) =>
    toastState.addToast({ type: 'success', message, duration }),
  error: (message: string, duration = 5000) =>
    toastState.addToast({ type: 'error', message, duration }),
  info: (message: string, duration = 4000) =>
    toastState.addToast({ type: 'info', message, duration }),
  warning: (message: string, duration = 4000) =>
    toastState.addToast({ type: 'warning', message, duration }),
  dismiss: (id: string) => toastState.removeToast(id),
};

const icons: Record<string, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 flex-shrink-0" />,
  error: <AlertCircle className="w-5 h-5 flex-shrink-0" />,
  info: <Info className="w-5 h-5 flex-shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 flex-shrink-0" />,
};

export { Toast as ToastContainer };

export function Toast() {
  const [state, setState] = useState<ToastState>(toastState);

  useEffect(() => {
    const handler = (newState: ToastState) => setState({ ...newState });
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return (
    <div className="toast-container">
      {state.toasts.map((t) => (
        <ToastItemComponent key={t.id} toast={t} onDismiss={state.removeToast} />
      ))}
    </div>
  );
}

function ToastItemComponent({
  toast: t,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(t.id), 300);
    }, t.duration ?? 4000);
    return () => clearTimeout(timer);
  }, [t.id, t.duration, onDismiss]);

  return (
    <div
      className={`toast toast-${t.type}`}
      style={{ animation: exiting ? 'toast-exit 0.3s ease-in forwards' : undefined }}
    >
      {icons[t.type]}
      <span className="flex-1">{t.message}</span>
      <button
        onClick={() => {
          setExiting(true);
          setTimeout(() => onDismiss(t.id), 300);
        }}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="إغلاق"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
