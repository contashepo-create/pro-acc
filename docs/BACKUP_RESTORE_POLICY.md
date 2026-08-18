# Backup & Restore Policy — pro-acc

> Goal: survive corruption / accidental deletion with **minimal data loss (RPO)** and **no or near-zero service downtime (RTO)** — while a CUSTOMER restore can never damage the platform or another tenant.

## 1. Strategy (defense in depth)

| Layer | Mechanism | Frequency | Notes |
|-------|-----------|-----------|-------|
| Managed backup | Supabase daily base backup | Daily | Automatic; retained per plan |
| Point-in-Time Recovery (PITR) | WAL archiving | Continuous | **Enable PITR** for RPO ≤ 5 min |
| Developer global backup | `pg_dump` → Supabase Storage + Telegram | Every 6 hours (configurable hourly) | See §8; retention = last 5 copies |
| Logical export | `pg_dump` → object storage (S3/R2/GCS) | Nightly | Independent copy; survives cluster loss |
| Customer backup | `/api/backup/download` JSON export (HMAC-signed) | On demand (admin) | Tenant-scoped; see §Restore safety |
| Schema restore | `npx tsx src/migrations/run.ts` | On provisioning | Idempotent; see `MIGRATIONS.md` |

## 2. RTO / RPO targets
- **RPO:** ≤ 5 minutes (PITR) · **RTO:** ≤ 1 hour for full service restore.

---

## Restore safety (customer upload path) — audited 2026-08-18

The customer restore flow is `/api/backup/validate` (dry-run) → `/api/backup/upload`
(apply). Both share the exact same checks in `src/lib/backup-validation.ts`, and the
database RPC `restore_company_backup_atomic` (migration 050) re-runs them inside the
transaction as the final authority.

### Guarantees
1. **Only the company admin** can restore, rate-limited.
2. **The file must be a genuine system export**: HMAC signature verified in-process,
   AND the calculated full HMAC must exist in `backup_logs` (created by the download
   endpoint). A foreign, edited, or re-serialized file can never pass — one changed
   character changes the HMAC.
3. **Ownership**: `metadata.company_id` (+ email) must match the authenticated company.
4. **Structure**: table allow-list (13 known tables), rows must be objects with valid
   UUID ids, size/row caps (25 MB body, 100k rows/table, 500k rows total) — oversized
   or injection-shaped input is rejected before parsing any further.
5. **No cross-tenant writes**: every row must not carry another company's id, and in
   the database a row whose id is already owned by ANOTHER company aborts the whole
   restore. All writes carry `company_id = authenticated company` and the upsert's
   conflict branch is scoped `WHERE company_id = $2`.
6. **Restore never DELETEs**: it only upserts (insert-or-update) six reference tables
   (`accounts, contacts, projects, banks_safes, inventory_items, employees`). Data that
   exists only in the live DB is never erased; data of other companies is untouched.
7. **All-or-nothing**: one transaction + advisory lock per company; any failure rolls
   everything back — no partial restore.
8. **No SQL injection surface**: table names come from a constant allow-list, column
   names from `pg_attribute`, and all values travel as JSONB parameters — nothing is
   ever string-interpolated into SQL.

### What restore does NOT do (by design)
- It does not delete rows missing from the backup (merge semantics, not wipe).
- It does not touch `users`, `settings`, `subscriptions`, or any global table.
- It does not reset passwords, roles, or Telegram bindings.

---

## 3. Backup automation (example GitHub Action / cron)
```bash
# Requires DATABASE_CA_CERT for TLS-verified dump
PGSSLMODE=verify-full PGSSLROOTCERT=$DATABASE_CA_CERT \
  pg_dump "$DATABASE_URL" | gzip > backup-$(date +%F-%H%M).sql.gz
# upload to object storage (aws s3 cp / rclone / supabase storage upload)
```
Store dumps encrypted at rest; restrict access to the CI/ops role only. Rotate the storage credentials regularly.

## 4. Restore without downtime (platform-level)
1. **Provision a fresh instance** (Supabase fork or new project) from the PITR point or the latest `pg_dump`.
2. **Verify integrity** before cutover:
   - Row counts match source.
   - Trial-balance invariant: `SELECT SUM(debit)-SUM(credit) FROM journal_lines;` → `0`.
   - Re-run `src/__tests__/financial-integrity.test.ts` against the restored DB.
3. **Cut over** by repointing `DATABASE_URL` (via connection pooler / env) — no app redeploy needed. Keep the old instance warm until verified.
4. For schema-only restores use `npx tsx src/migrations/run.ts` (idempotent, never `supabase db push` with the divergent `supabase/migrations` — see `MIGRATIONS.md`).

## 5. Verification (mandatory drill)
- **Monthly restore test** into an isolated staging DB; assert the checks in §4.2.
- Alert on backup job failure; treat a failed backup as a P1 incident.

## 6. Security
- Backups inherit DB encryption-at-rest.
- `DATABASE_CA_CERT` must be present wherever a dump is taken (enforced in `src/lib/db.ts` for production).
- Audit access to backup storage; backups are part of the audit scope.

## 7. Disaster Recovery runbook (short)
1. Detect / declare incident. 2. Identify last good PITR timestamp. 3. Restore to staging. 4. Run integrity checks. 5. Repoint `DATABASE_URL`. 6. Smoke-test login + create invoice + post journal. 7. Communicate, monitor, close.

---

## 8. Developer global backup (all tenants, scheduled, to Telegram)

`scripts/global-backup.ts` + `.github/workflows/global-backup.yml` produce a **whole-
database** `pg_dump` (custom format, compressed — restorable with `pg_restore`) every
**6 hours**, deliver it to the developer's Telegram, keep it in Supabase Storage, and
**prune everything older than the last 5 copies** (deleting the storage object, the
Telegram message, and the journal row).

### Setup (one time)
1. Repo secrets (Settings → Secrets → Actions): `DATABASE_URL`
   (append `?sslmode=require`), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. Apply migration 066 (`npm run migrate` or the migration runner).
3. Add `.github/workflows/global-backup.yml` to the repository (the file ships
   ready in the repo root of the project's working copy; if your git credential
   cannot push workflow files, paste it via GitHub web: repo → Actions → New
   workflow → set up a workflow yourself). Scheduled workflows run from the
   default branch — merge to main first.
4. The workflow runs automatically every 6 hours; `workflow_dispatch` allows manual runs.

### Restore a global backup
```bash
# 1) List contents without writing anything:
npx tsx scripts/restore-global-backup.ts ./backup-20260818-140509.dump
# 2) Restore into a SEPARATE database (recommended):
npx tsx scripts/restore-global-backup.ts ./backup-20260818-140509.dump --target postgresql://...fresh
# Restoring on top of the live DATABASE_URL is refused unless you pass --force.
```
Dumps larger than 45 MB are storage-only (Telegram's bot upload limit is 50 MB);
the bot receives a metadata message instead.

### Cost / feasibility — honest answers
| Question | Answer |
|----------|--------|
| Is Telegram delivery free? | Yes — the Bot API is free and unlimited. |
| Is every-6-hours free? | Effectively yes: GitHub Actions is free/unlimited for public repos (private: ~120 runs × ~1.5 min ≈ 180 min/month, well inside the 2,000 free minutes). |
| Can it run every hour? | Yes — change the workflow cron to `0 * * * *`. GitHub/Telegram cost stays ≈ zero (private repo: ~720 runs ≈ 1,000 min/month — still inside the free tier). |
| Any real cost? | The only billable factor is **Supabase egress**: every dump downloads the DB. Free plan includes 5 GB/month; 6-hourly × 100 MB DB ≈ 1.2 GB (fine). Hourly × 100 MB ≈ 7.2 GB (exceeds Free — Pro plan's 250 GB covers it). Small DBs: everything is free. |
| What does Supabase itself cost? | Daily platform backups are included free; PITR (point-in-time) is a paid add-on (~$100/month) — optional, the 6-hourly dump is the cheap safety net. |

**Retention**: `BACKUP_RETAIN=5` (default) keeps exactly the latest 5 copies —
older storage objects, Telegram messages and journal rows are deleted automatically.

## 9. Customer backup sizes
`/api/backup/download` supports companies up to 500k rows per table with a loud error
beyond that (never a silent truncation). Hosting platforms cap request bodies
(Vercel ~4.5 MB): companies larger than that should use `/api/company/data-export`
(storage-backed) — customer restore stays within the same limits by design.
