# Backup & Restore Policy — pro-acc

> Goal: survive corruption / accidental deletion with **minimal data loss (RPO)** and **no or near-zero service downtime (RTO)**.

## 1. Strategy (defense in depth)

| Layer | Mechanism | Frequency | Notes |
|-------|-----------|-----------|-------|
| Managed backup | Supabase daily base backup | Daily | Automatic; retained per plan |
| Point-in-Time Recovery (PITR) | WAL archiving | Continuous | **Enable PITR** for RPO ≤ 5 min |
| Logical export | `pg_dump` → object storage (S3/R2/GCS) | Nightly | Independent copy; survives cluster loss |
| Schema restore | `npx tsx src/migrations/run.ts` | On provisioning | Idempotent; see `MIGRATIONS.md` |

## 2. RTO / RPO targets
- **RPO:** ≤ 5 minutes (PITR) · **RTO:** ≤ 1 hour for full service restore.

## 3. Backup automation (example GitHub Action / cron)
```bash
# Requires DATABASE_CA_CERT for TLS-verified dump
PGSSLMODE=verify-full PGSSLROOTCERT=$DATABASE_CA_CERT \
  pg_dump "$DATABASE_URL" | gzip > backup-$(date +%F-%H%M).sql.gz
# upload to object storage (aws s3 cp / rclone / supabase storage upload)
```
Store dumps encrypted at rest; restrict access to the CI/ops role only. Rotate the storage credentials regularly.

## 4. Restore without downtime
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
