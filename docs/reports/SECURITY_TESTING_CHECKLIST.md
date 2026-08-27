# Security & Financial Data-Protection Testing Checklist — pro-acc

> Maps the launch testing protocol to the **current state of pro-acc**.
> Legend: ✅ DONE (implemented & verified) · 🟡 PARTIAL · ⬜ TODO (recommended before public launch)

## 1. Mathematical & Accounting Logic
- ✅ **Trial-balance equation (∑Debits = ∑Credits)** — `createJournalEntry` (`src/lib/journal-utils.ts`) rejects unbalanced entries (tolerance 0.01); the journal route uses the atomic RPC `create_journal_entry` which validates balance *before* insert. Covered by `src/__tests__/financial-integrity.test.ts`.
- 🟡 **Floating-point precision** — amounts computed as JS numbers; Postgres columns should be `NUMERIC`/`DECIMAL` (verify schema). Business math (VAT/totals) unit-tested.
- ✅ **Chart of Accounts routing** — `DEFAULT_CHART_OF_ACCOUNTS` + `ACCOUNT_CODES` constants drive posting; account codes validated.
- 🟡 **Period closing / roll-forward** — implement manual verification; no automated test yet.

## 2. Concurrency & Transactional Integrity
- ✅ **Sequential numbering** — atomic RPCs (`next_invoice_number`, `next_journal_number`, `next_voucher_number`, …) prevent duplicates/gaps.
- 🟡 **Negative inventory prevention** — inventory module exists; add a concurrency test (JMeter/K6) before launch.
- ⬜ **Deadlock prevention** — relies on Postgres lock ordering; verify under load test.

## 3. Audit Trail & Immutability
- 🟡 **Audit-log immutability** — `security_audit_log` + `admin_audit_log` tables exist; enforce `INSERT-ONLY` at DB level and block hard-delete of posted documents (reversal entries only).
- ✅ **Document state machine** — invoices/credit-notes use reversing entries; no hard-delete of posted records in code paths reviewed.

## 4. Security, RBAC & Multi-Tenancy
- ✅ **Multi-tenant isolation** — every data path filters by `company_id`; IDOR scan clean; verified in `financial-integrity`/route reviews.
- ✅ **RBAC** — `requireModulePermission` / `requireRole` / `requireAdminAuth` (`src/lib/api-helpers.ts`); unit-tested (`rbac.test.ts`).
- ✅ **Injection defense** — parameterized queries + Supabase client; `next build` passes.
- ✅ **CSRF** — mitigated by `SameSite: lax` cookies (frontend does not emit CSRF tokens); documented.
- ✅ **TLS in transit** — `DATABASE_CA_CERT` is **mandatory in production** (`src/lib/db.ts` throws if missing).
- 🟡 **TLS at rest / secrets** — ensure DB encryption-at-rest (Supabase default) and rotate `TOKEN_SECRET`, `PRO_ACCOUNTANT_LICENSE_SALT`, Stripe/Supabase keys before go-live.

## 5. Performance & Load
- ⬜ **Heavy report performance** — seed ≥1M journal rows and assert GL/Trial-Balance < 3s (CI Postgres service available).
- ⬜ **Throughput** — 200–500 concurrent invoice/payment workers; error rate < 0.01%, p95 < 300ms.

## 6. Tax & Regulatory
- ✅ **VAT / inclusive-exclusive pricing** — unit-tested.
- ✅ **ZATCA e-invoicing** — TLV QR + UBL hash + XML validated (`zatca.test.ts`).

## 7. Integration & Idempotency
- 🟡 **Payment-webhook idempotency** — verify duplicate webhooks mark invoice Paid exactly once.
- 🟡 **Partial-failure recovery** — external API timeouts must roll back local transaction.

## 8. Backup & Restore
- See `BACKUP_RESTORE_POLICY.md` (PITR + verified restores).

## 9. Usability & Edge Cases
- ✅ **Input validation** — Zod schemas + API helpers reject invalid/negative amounts, empty required fields.
- 🟡 **Print layout** — verify A4 / thermal (80mm) invoice & receipt output.

## 10. Pre-Flight Launch Checklist
- [ ] `NODE_ENV=production`; debug off.
- [ ] Rotate all staging/test secrets → production credentials.
- [ ] TLS 1.2+ enforced, HSTS on, SSL Labs grade A+.
- [ ] Rate limiting on login / reset / financial-submit endpoints.
- [ ] Error monitoring (Sentry/Datadog) active; no sensitive payload logging.
- [ ] **Backup restore drill passed**; PITR pipeline active.
- [ ] Opening balances of chart of accounts audited by a qualified accountant.
- [ ] `DATABASE_CA_CERT` set in production environment.

*This checklist is maintained alongside `SECURITY-REVIEW.md` and `MIGRATIONS.md`.*
