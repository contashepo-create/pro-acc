# Pre-Launch Testing Plan — pro-acc

**Repo:** `contashepo-create/pro-acc` · **Stack:** Next.js 16 + TypeScript (strict) + Supabase (Postgres, `service_role` key server-side) + Jest/ts-jest.

> **Note:** The repo is a Next.js web app, not Electron — Electron only shows up as a transitive dependency of a dev tool (`embedded-postgres`), it isn't the app's runtime.

---

## Current State (as of 2026-08-20)

Before writing this plan, the actual codebase was inspected. Here's what already exists:

| Area | Coverage |
|------|----------|
| Unit/integration tests | **917 tests across 99 suites**, all passing |
| API surface guard | `api-surface-guard.test.ts` — statically walks all route files and enforces every tenant route filters by `company_id` (critical because `service_role` bypasses RLS) |
| ZATCA QR/TLV tests | `zatca.test.ts`, `zatca-qr-branches.test.ts`, **`golden-zatca-qr.test.ts`** *(new)* |
| SQL-level VAT golden tests | **`golden-invoice-vat-sql.db.test.ts`** *(new)* — runs `create_sales_invoice_atomic()` in a real PGlite Postgres with all 75 migrations applied |
| Migration testing | `test:migrations` (PGlite) + `test:migrations:pg` (real Postgres via embedded-postgres) |
| Input fuzzing | `scripts/audit-fuzz.mts` |
| Live DB attack simulation | `scripts/audit-live-db.mjs` |
| Invoice concurrency/numbering | Covered in existing test suite |
| Double-entry invariants | Covered in `accounting.test.ts`, `invoice-integrity.test.ts`, etc. |
| RBAC / multi-tenancy | Covered across multiple test files |
| Audit trail immutability | Covered in `audit-trail.test.ts`, `audit-hardening-regression.test.ts` |
| Backup authorization | Covered in `backup-integrity.test.ts` |
| TypeScript strict mode | `tsc --noEmit` passes clean |
| Build | `next build` passes |
| Vulnerabilities | `npm audit` at 0 |

**So the question is not "what tests should exist for an accounting app" — it's "what's still missing that would bite you after publishing."**

---

## Priority Key

- **P0** — Don't publish without this. Direct financial-compliance or money/security risk.
- **P1** — Before "generally available" / before real customers scale up.
- **P2** — Hardening. Do once P0/P1 are done.

---

## P0 — Before Any Production Traffic

### 1. End-to-End Browser Tests (Playwright)

**Why #1:** You have 917 unit/integration tests, but **zero tests that drive an actual browser**. `@playwright/test` is not a direct dependency, no `playwright.config.ts` exists, no `e2e/` folder. Every test today asserts on functions, HTTP handlers, or SQL — none prove that a real user can log in → create an invoice → get a correct printed document. This is where UI wiring bugs hide (a button that doesn't call the API, a field that doesn't reach the payload) even when backend logic is 100% tested.

**Minimum Coverage:**
1. Register/login → create company → land on dashboard (RTL renders, no console errors)
2. Create a sales invoice end-to-end: pick client, add items, apply VAT, save → confirm displayed total and VAT match hand-calculated values
3. Generate ZATCA e-invoice (QR + XML) from the UI → confirm QR renders and download link works
4. Print/export invoice (A4) → confirm print window opens (this is the exact bug class `print.test.ts` had to catch at unit level)
5. Switch between two companies/tenants as the same user → confirm data isolation
6. Attempt action a lower-privilege role shouldn't see (e.g. data-entry user can't see "close period" button)

**Setup:**
```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

Create `playwright.config.ts`:
```typescript
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'ar-SA',
    timezoneId: 'Asia/Riyadh',
  },
  webServer: {
    command: 'npm run build && npm start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

Create test files:
- `e2e/auth.spec.ts`
- `e2e/invoice-lifecycle.spec.ts`
- `e2e/zatca-export.spec.ts`
- `e2e/tenant-isolation.spec.ts`
- `e2e/rbac-ui.spec.ts`

Add `data-testid` attributes to critical elements (invoice total, VAT field, save button) — especially important with Arabic RTL text where CSS selectors are fragile.

Add to `package.json`:
```json
"test:e2e": "playwright test"
```

---

### 2. Validate ZATCA Output Against the Real Schema/Simulator

**Why:** `zatca.test.ts` tests your own XML/QR construction logic, but nothing validates against the **actual ZATCA XSD** or the **Fatoora Compliance/Simulation Portal**. Since the project already had a real ZATCA-adjacent bug (VAT column mismatch producing zero VAT in invoices/XML), this category is most likely to have another silent regression with direct legal/tax exposure in KSA.

**Plan:**
1. Get the official ZATCA XSD schemas from ZATCA's developer portal
2. Add an offline schema-validation step in Jest using `libxmljs2` or `xmllint` via shell:
   - Generate sample UBL invoice XML for: standard 15%, zero-rated, exempt
   - Validate each against the XSD
3. Submit generated invoices to ZATCA's sandbox/simulation environment before going live
4. Keep cleared samples as fixtures for regression testing

```bash
npm install -D libxmljs2
```

Create `src/__tests__/zatca-xsd-validation.test.ts`:
```typescript
import { generateUBLInvoice } from '@/lib/zatca/ubl-builder';
import { parseXml } from 'libxmljs2';
import fs from 'fs';

const xsd = fs.readFileSync('fixtures/zatca/UBL-Invoice-2.1.xsd', 'utf8');

test('standard invoice XML validates against ZATCA XSD', () => {
  const xml = generateUBLInvoice(sampleInvoice);
  const doc = parseXml(xml);
  const xsdDoc = parseXml(xsd);
  expect(doc.validate(xsdDoc)).toBe(true);
});
```

---

### 3. Golden / Canary Tests for Tax and Totals Math ✅ DONE

**Status:** Implemented and passing.

**Files created:**
- `src/__tests__/golden-zatca-qr.test.ts` — 4 tests using an independent reference TLV encoder (not the production code) to verify QR output byte-for-byte. Covers: multi-byte UTF-8 Arabic names (TLV length = bytes, not JS chars), IEEE-754 edge cases (0.1+0.2), zero VAT, large totals.
- `src/__tests__/golden-invoice-vat-sql.db.test.ts` — 6 tests running the real `create_sales_invoice_atomic()` SQL function inside PGlite with all 75 migrations applied. Covers: 15% VAT, zero-rated, VAT-disabled, rounding (999.99 × 15% = 149.9985 → 150.00), discount, and journal entry balance verification (debit = credit).
- `src/__tests__/helpers/pglite-schema.ts` — Reusable helper that bootstraps a full PGlite database with migrations + company data.

**Run commands:**
```bash
npm test                    # includes golden-zatca-qr (917/917 pass)
npm run test:db             # runs golden-invoice-vat-sql (6/6 pass)
```

---

## P1 — Before General Availability

### 4. Component/UI Tests (Jest `.tsx` support)

**Why:** `jest.config.js`'s `testMatch` does match `*.test.tsx`, but `testEnvironment` is `node` globally, and no `.test.tsx` files exist. All UI-level logic (form validation messages, number/currency formatting, RTL-specific rendering, disabled states) is untested below the E2E layer.

**Setup:**
```bash
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom
```

Update `jest.config.js` to use `projects`:
```javascript
module.exports = {
  projects: [
    {
      displayName: 'logic',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.test.ts'],
      testPathIgnorePatterns: ['\\.db\\.test\\.ts$'],
      // ... existing config
    },
    {
      displayName: 'components',
      preset: 'ts-jest',
      testEnvironment: 'jsdom',
      testMatch: ['**/__tests__/**/*.test.tsx'],
      setupFilesAfterSetup: ['@testing-library/jest-dom'],
      // ... existing config
    },
  ],
};
```

**Priority components to test first:**
- Invoice line-item editor (live VAT/total recalculation)
- Payment/voucher form
- Currency formatting for Arabic locale
- Any component that does math in the render path

---

### 5. Payment Webhook Idempotency & Signature Verification

**Why:** No dedicated payment-webhook route exists in `src/app/api` yet, even though `next.config.ts`'s CSP already allow-lists `api.moyasar.com`. **This item is conditional** — the moment you wire a real gateway webhook receiver:

**Tests to add:**
1. Send the same "payment succeeded" webhook 5× → assert invoice marked paid exactly once, only one receipt row created
2. Reject webhooks with invalid/missing signatures
3. This mirrors §7.1 of your existing `Accounting_Web_App_Testing_Protocol.md`

---

### 6. Load Testing Beyond the Single k6 Script

**Why:** `tests/load/` has only `invoices.k6.js`. Your testing protocol (§5) sets targets — reports under 5M+ journal rows in <3s, 500 concurrent users at <0.01% error — but nothing shows these were actually run.

**Add:**
- `tests/load/reports.k6.js` — heavy trial-balance/GL report under seeded large dataset
- `tests/load/concurrent-numbering.k6.js` — hammer document numbering to confirm zero duplicates under real latency

**Run against staging sized like production.** Save results. Treat hitting §5 targets as a launch gate.

---

### 7. Real Disaster-Recovery Drill

**Why:** `backup-integrity.test.ts` covers authorization (only admins can export/restore, HMAC anti-tamper, cross-company rejection), but doesn't prove a real backup restores into a real, empty Supabase project and produces a balanced ledger.

**Plan (do once before go-live, then quarterly):**
1. Take a real backup from staging
2. Spin up a fresh isolated Supabase project
3. Restore into it
4. Run `test:integration` + trial-balance query against the restored copy
5. Time the process and record against RTO/RPO targets from `docs/BACKUP_RESTORE_POLICY.md`

---

## P2 — Hardening

### 8. Visual/Print Regression

**Why:** `print.test.ts` proves `window.open()` is called (JS-level regression), but nothing checks the printed invoice actually looks right on A4 vs 80mm thermal, or that Arabic RTL text doesn't overlap/truncate.

**Solution:** Playwright's `toHaveScreenshot()` on the print-preview route for 2–3 fixed invoices.

---

### 9. Migration Rollback at Production Scale

**Why:** `test:migrations` and `test:migrations:pg` run against fixture-sized data. Confirm they work with production-sized datasets so a slow/locking migration doesn't surprise you.

---

### 10. Accessibility Baseline

**Why:** No accessibility tooling found (no `axe-core`/`jest-axe`). Worth a baseline pass with `@axe-core/playwright` inside the E2E suite, especially for keyboard navigation on data-entry screens.

---

## Suggested Timeline

| Week | Items | Notes |
|------|-------|-------|
| 1 | Playwright setup + 5 critical-path E2E specs (item 1) | Highest impact |
| 1 | Golden math fixtures (item 3) | ✅ Already done |
| 1–2 | ZATCA XSD/sandbox validation (item 2) | Backend-only, can run in parallel with item 1 |
| 2 | Component test harness + first `.tsx` tests (item 4) | Invoice/VAT UI components first |
| 2–3 | Load test expansion (item 6) + DR drill (item 7) | Need staging environment |
| Before go-live | Run Pre-Flight Launch Checklist from `docs/Accounting_Web_App_Testing_Protocol.md` §10 | Final go/no-go gate |
| After launch | Items 5, 8, 9, 10 | Ongoing hardening |

---

## What You Don't Need to Redo

These are already covered and working:

- ✅ Double-entry / trial-balance invariants (§1–4 of testing protocol)
- ✅ Static "every route filters by company_id" guard (`api-surface-guard.test.ts`)
- ✅ Input fuzzing (`npm run audit:fuzz`)
- ✅ Live-DB RPC attack simulation (`npm run audit:db`)
- ✅ Migration consistency (`test:migrations`, `test:migrations:pg`)
- ✅ Backup authorization (HMAC, cross-company rejection)
- ✅ Invoice concurrency/numbering
- ✅ RBAC at the API level
- ✅ Audit trail immutability
- ✅ TypeScript strict mode compliance
- ✅ Zero npm audit vulnerabilities

---

## Files Added in This Plan

| File | Purpose | Run with |
|------|---------|----------|
| `src/__tests__/golden-zatca-qr.test.ts` | Independent QR TLV verification (4 tests) | `npm test` |
| `src/__tests__/golden-invoice-vat-sql.db.test.ts` | Real SQL VAT calculation verification (6 tests) | `npm run test:db` |
| `src/__tests__/helpers/pglite-schema.ts` | Reusable PGlite full-schema bootstrap helper | (imported by db tests) |
| `docs/PRE_LAUNCH_TESTING_PLAN.md` | This document | — |

Config changes:
- `jest.config.js` — added `testPathIgnorePatterns: ['\\.db\\.test\\.ts$']`
- `package.json` — added `test:db` script
