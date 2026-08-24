import type { Row } from './types';

/** Normalize any date-like value to YYYY-MM-DD for <input type="date">. */
export function toDateInput(value: unknown): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

/** Unwrap `{ success, data }` or a raw payload. */
export function unwrapData<T = Row>(json: Row): T | null {
  if (!json) return null;
  if (json.success === false) return null;
  return (json.data ?? json) as T;
}

/** Same-origin GET that never throws. Used by every edit form. */
export async function fetchRecord(url: string): Promise<{ data: unknown | null; error: string | null }> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    const json = await res.json();
    if (json?.success && json.data) return { data: json.data, error: null };
    return { data: null, error: json?.message || 'تعذر تحميل البيانات' };
  } catch {
    return { data: null, error: 'خطأ في الاتصال بالخادم' };
  }
}

/** Normalize the listed date keys so <input type="date"> shows the saved value. */
/** Normalize the listed date keys so `<input type="date">` shows the saved value. */
export function applyDates<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
  const out = { ...obj };
  for (const k of keys) {
    if (k in out) (out as Row)[k] = toDateInput(out[k]);
  }
  return out;
}

/**
 * Prefer the GET payload; if it failed, fall back to the list row so the
 * edit modal is never blank. Caller should toast `error` when data came from fallback.
 */
export function recordOrRow(fetched: unknown | null, row: unknown): Row {
  return (fetched || row || {}) as Row;
}
