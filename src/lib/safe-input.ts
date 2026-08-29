/** Security-oriented validation shared by messaging, uploads and payment proof. */

export function safeInternalPath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = value.trim();
  // Only same-application absolute paths. Protocol-relative and escaped paths
  // can navigate away from the tenant UI and are rejected.
  if (!path.startsWith('/') || path.startsWith('//') || /[\u0000-\u001f\\]/.test(path)) return null;
  return path;
}

export function safeHttpsUrl(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Payment proofs must refer to our receipt storage, not an arbitrary attacker
 * URL. A storage object path returned by the upload endpoint is preferred;
 * legacy HTTPS Supabase Storage URLs are accepted only on the configured host.
 */
export function trustedReceiptReference(value: unknown, companyId: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  const ref = value.trim();
  if (ref.startsWith(`${companyId}/`) && !ref.includes('..') && !/[\u0000-\u001f\\]/.test(ref)) {
    return ref;
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return null;
  try {
    const parsed = new URL(ref);
    const configured = new URL(base);
    if (parsed.protocol !== 'https:' || parsed.host !== configured.host) return null;
    if (!parsed.pathname.includes('/storage/v1/object/')) return null;
    if (!decodeURIComponent(parsed.pathname).includes(`/${companyId}/`)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
