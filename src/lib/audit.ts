/**
 * Financial audit trail — data integrity.
 *
 * Records every mutation (create / update / delete) on financial entities
 * (journal entries, invoices, vouchers, ...) with the actor, the before/after
 * state, and a human-readable action, so the system can answer
 * "who changed what, when, and from what to what".
 *
 * This complements (not replaces) `admin_audit_log`, which tracks the
 * superadmin panel; this trail is scoped per company for its own records.
 */

import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

export type AuditAction = 'create' | 'update' | 'delete' | 'approve' | 'reject';

export interface AuditEntry {
  company_id: string;
  user_id: string | null;
  entity_type: string;   // e.g. 'journal_entry', 'invoice', 'voucher'
  entity_id: string;
  action: AuditAction;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  summary?: string;
}

/** Only store a compact snapshot to avoid bloating the trail with huge rows. */
function compact(obj: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!obj) return null;
  const allowed: Record<string, any> = {};
  const keys = ['id', 'number', 'date', 'total', 'amount', 'status', 'type', 'vat_rate', 'vat_amount', 'subtotal', 'notes', 'description'];
  for (const k of keys) {
    if (obj[k] !== undefined) allowed[k] = obj[k];
  }
  return Object.keys(allowed).length > 0 ? allowed : null;
}

/**
 * Insert a financial audit-trail row. Never throws — logging must not break
 * the underlying business operation.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await sb().from('financial_audit_trails').insert({
      company_id: entry.company_id,
      user_id: entry.user_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      before_data: compact(entry.before),
      after_data: compact(entry.after),
      summary: entry.summary || null,
    });
  } catch (err) {
    // Fail-open by design: audit must never fail the transaction it records.
    console.error('[audit] failed to write financial audit trail:', err);
  }
}

/**
 * Compute a diff summary like "المبلغ: 100.00 → 150.00" for the trail.
 * Numerically-equivalent values (100 vs "100") are treated as unchanged.
 */
export function diffSummary(before: Record<string, any> | null, after: Record<string, any> | null): string {
  const parts: string[] = [];
  const keys = new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]);
  for (const k of keys) {
    const bv = before?.[k];
    const av = after?.[k];
    if (sameValue(bv, av)) continue;
    parts.push(`${k}: ${bv ?? '∅'} → ${av ?? '∅'}`);
  }
  return parts.join('، ');
}

function sameValue(a: any, b: any): boolean {
  if (a === b) return true;
  // Numeric equivalence (number vs numeric string)
  const aNum = typeof a === 'number' || (typeof a === 'string' && a.trim() !== '' && !isNaN(Number(a)));
  const bNum = typeof b === 'number' || (typeof b === 'string' && b.trim() !== '' && !isNaN(Number(b)));
  if (aNum && bNum) return Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}
