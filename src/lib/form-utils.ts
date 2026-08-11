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
export function unwrapData<T = any>(json: any): T | null {
  if (!json) return null;
  if (json.success === false) return null;
  return (json.data ?? json) as T;
}
