# Backup & Restore Policy — pro-acc

> Goal: survive corruption / accidental deletion with **minimal data loss (RPO)** and
> **no or near-zero service downtime (RTO)** — while NO customer can ever obtain a
> restorable copy of the database or push uploaded data back into the platform.

## 1. Strategy (defense in depth)

| Layer | Mechanism | Frequency | Notes |
|-------|-----------|-----------|-------|
| Managed backup | Supabase daily base backup | Daily | Automatic; retained per plan |
| Point-in-Time Recovery (PITR) | WAL archiving | Continuous | **Enable PITR** for RPO ≤ 5 min |
| Developer global backup | `pg_dump` → Supabase Storage + Telegram | Every 6 hours (configurable hourly) | See §4; retention = last 5 copies |
| Logical export | `pg_dump` → object storage (S3/R2/GCS) | Nightly | Independent copy; survives cluster loss |
| Customer data download | `/api/company/export-download` — **tables only, Excel/CSV** | On demand (company admin) | See §2; **no restore path exists** |
| Schema restore | `npx tsx src/migrations/run.ts` | On provisioning | Idempotent; see `MIGRATIONS.md` |

## 2. Customer data download (السياسة النهائية — updated 2026-08-26)

**There is no customer "database copy" and no customer restore. Ever.**

- The only self-service download is `/api/company/export-download`: readable
  **tables** of the company's own data, in **Excel (.xls) or CSV only** — the two
  formats other accounting platforms accept for manual import. This matches the
  data-portability conventions of mainstream accounting software.
- The former JSON whole-database export (`/api/company/data-export*`) and the
  backup/restore endpoints (`/api/backup/download|upload|validate|auto`) were
  **removed from the codebase**, and migration
  `089-remove-company-db-copy-and-restore.sql` drops their tables
  (`company_data_exports`, `backup_logs`) and purges the `company-exports`
  storage bucket.
- These rules apply to **every** customer state — active, trial, expired,
  suspended, or new.
- **Nothing a customer downloads can be uploaded back.** The only remaining
  upload surfaces accept images/PDF receipts for billing and support flows.
  Re-entering data on this platform is **manual entry only** (client by client,
  invoice by invoice).
- The table export remains available **after subscription expiry** (whitelisted
  in `src/lib/subscription-guard.ts`) so a churned customer can always leave
  with their data.

### Why
1. **Tax-system integrity:** posted invoices/journals are immutable; a restore
   primitive would be a back door around that immutability.
2. **Multi-tenant safety:** a restorable file format is one parsing bug away
   from a cross-tenant incident; a format that cannot be restored cannot leak
   tenants.
3. **No silent data replacement:** customers reviewing or migrating their data
   need readable tables, not a serialized database they cannot inspect.

## 3. Restore paths that DO exist (platform side only)

| Path | Operator | Controls |
|------|----------|----------|
| Supabase dashboard / PITR | Platform owner | Managed credentials |
| `scripts/restore-global-backup.ts` | Platform developer | Verified signed dump from the developer backup journal |
| `/api/admin/database/backup` / `restore` (zerocold) | Platform admin | Master password; the web restore endpoint is **permanently closed** (returns 403 and audit-logs the attempt) |

No company-facing role reaches any of these.

## 4. Developer global backup (unchanged)

`npx tsx scripts/global-backup.ts` dumps the whole database with `pg_dump`,
verifies it, stores it, delivers it to the developer's Telegram, and prunes
everything beyond the last N copies (`BACKUP_RETAIN`, default 5). Scheduling is
owned by `.github/workflows/global-backup.yml`. Retention logic lives in
`src/lib/backup-retention.ts` (pure, unit-tested in
`src/__tests__/backup-retention.test.ts`).

## 5. RTO / RPO targets

- **RPO:** ≤ 5 minutes (PITR) · **RTO:** ≤ 1 hour for full service restore.
