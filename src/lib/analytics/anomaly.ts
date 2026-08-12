/**
 * Anomaly detection — heuristic analytics over financial data.
 *
 * These are deterministic, rule-based detectors (no ML / no external API)
 * that flag likely data-quality or fraud issues so a finance team can
 * review them. Each returns a list of findings with severity + a human-
 * readable Arabic message. All functions are pure and unit-testable.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface AnomalyFinding {
  code: string;
  severity: Severity;
  message: string;
  /** Optional id of the offending row (invoice/expense/...). */
  refId?: string;
  /** Numeric magnitude to allow sorting by impact. */
  score: number;
}

/** Rounding tolerance for "duplicate" comparisons. */
const EPS = 0.01;

/**
 * Flag duplicate payments / invoices: same amount + same party within a short
 * window (by default 30 days) is a classic duplication indicator.
 */
export function detectDuplicateInvoices(
  invoices: Array<{ id?: string; contact_id?: string | null; amount: number; date: string }>,
  windowDays = 30
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const sorted = [...invoices].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const sameAmount = Math.abs(a.amount - b.amount) < EPS;
      // Only compare by party when both have a party id — cash invoices with no
      // party are not comparable (avoids false positives on identical cash sales).
      const sameParty =
        a.contact_id != null &&
        b.contact_id != null &&
        (a.contact_id || null) === (b.contact_id || null);
      const withinWindow =
        new Date(b.date).getTime() - new Date(a.date).getTime() <= windowDays * 86400000;
      if (sameAmount && sameParty && withinWindow) {
        findings.push({
          code: 'DUPLICATE_INVOICE',
          severity: 'medium',
          message: `فاتورتان متطابقتان (${a.amount.toFixed(2)}) لنفس الطرف خلال ${windowDays} يومًا — تحقق من تكرار.`,
          refId: `${a.id || '?'} & ${b.id || '?'}`,
          score: a.amount,
        });
      }
    }
  }
  return findings;
}

/**
 * Flag a single transaction that is unusually large relative to the dataset
 * (e.g. > `threshold`× the median of its peers) — a common override/error sign.
 */
export function detectOutliers(
  items: Array<{ id?: string; amount: number }>,
  threshold = 5
): AnomalyFinding[] {
  if (items.length < 4) return [];
  const amounts = items.map((i) => i.amount).filter((a) => Number.isFinite(a));
  if (amounts.length < 4) return [];
  const sortedAmt = [...amounts].sort((a, b) => a - b);
  const median = sortedAmt[Math.floor(sortedAmt.length / 2)];
  if (median <= 0) return [];

  const findings: AnomalyFinding[] = [];
  for (const it of items) {
    if (Number.isFinite(it.amount) && it.amount > median * threshold) {
      findings.push({
        code: 'OUTLIER_AMOUNT',
        severity: 'medium',
        message: `مبلغ (${it.amount.toFixed(2)}) أكبر من ${threshold}× الوسيط (${median.toFixed(2)}) — قد يكون خطأ أو تجاوزًا.`,
        refId: it.id,
        score: it.amount,
      });
    }
  }
  return findings;
}

/**
 * Flag an unusually large month-over-month change in a category (e.g. a cost
 * that spiked) — signals possible misposting or fraud.
 */
export function detectSpendingSpikes(
  monthlySeries: Array<{ period: string; amount: number }>,
  spikeFactor = 3,
  minBaseline = 1
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (let i = 1; i < monthlySeries.length; i++) {
    const cur = monthlySeries[i];
    const prior = monthlySeries[i - 1];
    if (prior.amount <= minBaseline) continue;
    if (cur.amount > prior.amount * spikeFactor) {
      findings.push({
        code: 'SPENDING_SPIKE',
        severity: 'high',
        message: `قفزة مصروفات: ${cur.period} (${cur.amount.toFixed(2)}) أعلى ${spikeFactor}× من ${prior.period} (${prior.amount.toFixed(2)}).`,
        refId: cur.period,
        score: cur.amount - prior.amount,
      });
    }
  }
  return findings;
}

/**
 * Flag negative / zero values that shouldn't exist (e.g. negative inventory
 * movement quantity, negative cash) — integrity issues.
 */
export function detectInvalidValues(
  items: Array<{ id?: string; label: string; value: number }>
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const it of items) {
    if (!Number.isFinite(it.value)) {
      findings.push({
        code: 'NON_FINITE',
        severity: 'high',
        message: `قيمة غير رقمية في «${it.label}».`,
        refId: it.id,
        score: 1,
      });
    } else if (it.value < 0) {
      findings.push({
        code: 'NEGATIVE_VALUE',
        severity: 'high',
        message: `قيمة سالبة غير متوقعة في «${it.label}» (${it.value}).`,
        refId: it.id,
        score: Math.abs(it.value),
      });
    }
  }
  return findings;
}
