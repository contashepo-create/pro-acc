

## Codely Structured Memories

### User

### Feedback

### Project
- [2026-08-27 16:20:43] Live Supabase DB is at `aws-0-eu-west-1.pooler.supabase.com`, DATABASE_URL in `.env`. Use `NODE_ENV=development` to bypass DATABASE_CA_CERT TLS check when running ad-hoc scripts. 105 migrations applied (000–098). `backup_logs` and `company_data_exports` were intentionally dropped by migration 089; `reset_company_business_data` and telegram reset functions were intentionally dropped by migration 088.
- [2026-08-27 19:32:21] Tenders & bonds feature fully implemented with Saudi/IFRS accounting (migrations 099-100, applied to live DB). 5 new accounts: 1185/1186 (bond margins), 5410 (tender suspense), 5420 (lost tender expense), 5291 (bank guarantee commissions). 6 RPCs handle the full cycle: expense recording → suspense → close-on-loss / convert-on-win → bond issue/release. Frontend pages at /tenders and /bonds with sidebar entry "المناقصات والضمانات".

### Reference

