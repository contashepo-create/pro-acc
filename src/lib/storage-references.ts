import type { SupabaseLike } from './types';


export async function signPrivateReceiptReference(
  supabase: SupabaseLike,
  reference: string | null | undefined,
  expiresInSeconds = 10 * 60,
): Promise<string | null> {
  if (!reference) return null;
  // Legacy HTTPS references remain readable while old records are migrated.
  if (/^https:\/\//i.test(reference)) return reference;
  if (reference.includes('..') || reference.startsWith('/') || /[\\\u0000-\u001f]/.test(reference)) return null;
  if (!supabase.storage) return null;
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(reference, expiresInSeconds);
  if (error) return null;
  if (!data?.signedUrl) return null;
  return data.signedUrl;
}
