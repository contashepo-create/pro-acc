/**
 * Pro Acc — live RPC adversarial audit on a REAL PostgreSQL server.
 * Boots an ephemeral embedded-postgres, applies the full migration chain
 * (src/migrations, the same chain `npm run migrate` applies), then attacks the
 * security- and accounting-critical RPCs with adversarial inputs.
 *
 * Run:  MIGRATION_DRIVER=postgres node scripts/audit-live-db.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createDriver } from './migration-drivers.mjs';

const RESULTS = [];
function record(name, expected, actual, note = '') {
  const pass = expected === actual;
  RESULTS.push({ pass, name, expected, actual, note });
  console.log(`${pass ? '✅' : '❌'} ${name}${note ? ' — ' + note : ''}`);
}

const db = await createDriver();
const migrationsDir = path.resolve('src/migrations');

// ---- apply migrations ----
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
await db.exec(`CREATE TABLE _migrations(id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ DEFAULT NOW());`);
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const filename of files) {
  const tracked = await db.query('SELECT 1 FROM _migrations WHERE filename=$1', [filename]);
  if (tracked.rows.length) continue;
  const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
    .replace(/^\s*BEGIN\s*;\s*$/gim, '').replace(/^\s*COMMIT\s*;\s*$/gim, '').trim();
  await db.exec('BEGIN');
  try {
    if (sql) await db.exec(sql);
    await db.query('INSERT INTO _migrations(filename) VALUES($1)', [filename]);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw new Error(`${filename}: ${error.message}`, { cause: error });
  }
}
console.log(`applied ${files.length} migrations\n`);

const uuid = () => randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
const CO_B = uuid();
const USER_B = uuid();

const accounts = ['1000','1110','1150','1160','2120','2140','3000','3200','4100','5100'].map((code) => ({
  code, name: `Acct ${code}`, name_en: `Acct ${code}`,
  type: code === '4100' ? 'revenue' : code === '5100' ? 'expense' : ['2120','2140'].includes(code) ? 'liability' : code.startsWith('3') ? 'equity' : 'asset',
  parent_code: null, is_header: false,
}));

// ============ SETUP ============
const setup = await db.query(`SELECT setup_initial_company('Company A','','','a@example.test','Admin A','hashpass', $1::jsonb) result`, [JSON.stringify(accounts)]);
const setupRes = setup.rows[0].result;
const coARealId = setupRes.company.id;
const adminA = setupRes.user.id;
record('setup_initial_company creates first company', true, !!coARealId);

let secondSetupRejected = false;
try { await db.query(`SELECT setup_initial_company('Second','','','b@example.test','Admin B','hashpass', $1::jsonb)`, [JSON.stringify(accounts)]); } catch { secondSetupRejected = true; }
record('setup_initial_company rejects second company (bootstrap protection)', true, secondSetupRejected);

// second tenant inserted directly (simulates another onboarded company)
await db.query(`INSERT INTO companies(id, name, is_active) VALUES ($1,'Company B',TRUE)`, [CO_B]);
await db.query(`INSERT INTO users(id, company_id, email, name, role, password_hash, email_verified, is_active) VALUES ($1,$2,'u@b.example.test','User B','admin','x:y',TRUE,TRUE)`, [USER_B, CO_B]);
await db.query(`INSERT INTO accounts(company_id, code, name, type, is_active) VALUES ($1,'4100','Rev B','revenue',TRUE)`, [CO_B]);
const accB = (await db.query(`SELECT id FROM accounts WHERE company_id=$1 AND code='4100'`, [CO_B])).rows[0].id;
const accA1000 = (await db.query(`SELECT id FROM accounts WHERE company_id=$1 AND code='1000'`, [coARealId])).rows[0].id;
const accA1110 = (await db.query(`SELECT id FROM accounts WHERE company_id=$1 AND code='1110'`, [coARealId])).rows[0].id;

// ============ create_journal_entry adversarial ============
const line = (accountId, debit, credit) => ({ accountId, accountCode: 'x', debit, credit, description: null, contactId: null, projectId: null });
const post = (company, user, lines) => db.query(`SELECT create_journal_entry($1::uuid,$2::date,'general','test',$3::uuid,$4::jsonb)`, [company, '2026-01-15', user, JSON.stringify(lines)]);

// 1. debit-only unbalanced (classic NULL-total bypass) must be rejected
let debitOnlyRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100, 0), line(accA1110, 50, 0)]); } catch { debitOnlyRejected = true; }
record('journal: debit-only unbalanced entry rejected (NULL-total bypass)', true, debitOnlyRejected);

// 2. unbalanced
let unbalancedRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100, 0), line(accA1110, 0, 99.99)]); } catch { unbalancedRejected = true; }
record('journal: unbalanced entry rejected', true, unbalancedRejected);

// 3. negative amount
let negativeRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100, 0), line(accA1110, 0, -100)]); } catch { negativeRejected = true; }
record('journal: negative line rejected', true, negativeRejected);

// 4. both sides on one line
let bothSidesRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100, 100), line(accA1110, 0, 0)]); } catch { bothSidesRejected = true; }
record('journal: line with debit AND credit rejected', true, bothSidesRejected);

// 5. cross-tenant account (company B account in company A entry)
let crossTenantRejected = false;
try { await post(coARealId, adminA, [line(accB, 100, 0), line(accA1110, 0, 100)]); } catch { crossTenantRejected = true; }
record('journal: cross-tenant account rejected', true, crossTenantRejected);

// 6. same account both sides across two lines
let sameAccountBothSidesRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100, 0), line(accA1000, 0, 100)]); } catch { sameAccountBothSidesRejected = true; }
record('journal: same account debit+credit in one entry rejected', true, sameAccountBothSidesRejected);

// 7. >2 decimals
let tooManyDecimalsRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100.001, 0), line(accA1110, 0, 100.001)]); } catch { tooManyDecimalsRejected = true; }
record('journal: >2 decimal places rejected', true, tooManyDecimalsRejected);

// 8. created_by not in company
const stranger = uuid();
let strangerRejected = false;
try { await post(coARealId, stranger, [line(accA1000, 100, 0), line(accA1110, 0, 100)]); } catch { strangerRejected = true; }
record('journal: creator outside company rejected', true, strangerRejected);

// 9. valid balanced entry
let validPosted = false;
try { const r = await post(coARealId, adminA, [line(accA1000, 100, 0), line(accA1110, 0, 100)]); validPosted = r.rows[0].create_journal_entry?.id != null; } catch { }
record('journal: valid balanced entry posted', true, validPosted);

// 10. tolerance: diff of exactly 0.01
let toleranceRejected = false;
try { await post(coARealId, adminA, [line(accA1000, 100.01, 0), line(accA1110, 0, 100)]); } catch { toleranceRejected = true; }
record('journal: 0.01 imbalance rejected (tolerance ≤0.005)', true, toleranceRejected);

// 11. CLOSED FISCAL YEAR posting — expected to be rejected by an ERP, observed behaviour:
const fy = await db.query(`INSERT INTO fiscal_years(company_id, name, start_date, end_date, status) VALUES ($1,'FY2026','2026-01-01','2026-12-31','open') RETURNING id`, [coARealId]);
const fyId = fy.rows[0].id;
let closed = false;
try { await db.query(`SELECT close_fiscal_year_atomic($1::uuid,$2::uuid,$3::uuid)`, [coARealId, fyId, adminA]); closed = true; } catch (e) { console.log('close failed:', e.message); }
record('fiscal: year closed', true, closed);
let postingIntoClosedAccepted = false;
try { await post(coARealId, adminA, [line(accA1000, 10, 0), line(accA1110, 0, 10)]); postingIntoClosedAccepted = true; } catch { }
record('fiscal: posting journal into CLOSED year REJECTED (hardening expectation)', false, postingIntoClosedAccepted,
  postingIntoClosedAccepted ? '⚠ CONFIRMED BUG: entry posted into closed fiscal year' : 'rejected (good)');

// 12. journal number sequence skipped on rejected entries (cosmetic)
const seq = await db.query(`SELECT last_number FROM journal_sequences WHERE company_id=$1 AND year=2026`, [coARealId]);
console.log(`(info) journal sequence after tests: ${seq.rows[0]?.last_number ?? 'n/a'} (gaps after rejected entries)`);

// ============ email verification token single-use ============
await db.query(`UPDATE users SET email_verified=FALSE WHERE id=$1`, [USER_B]);
await db.query(`UPDATE users SET email_verification_token=$1, email_verification_expires=NOW()+INTERVAL '1 day' WHERE id=$2 RETURNING 1`, ['a'.repeat(64), USER_B]);
let firstOk = false, secondOk = true;
try { firstOk = !!(await db.query(`SELECT consume_email_verification_token($1)`, ['a'.repeat(64)])).rows[0]; } catch {}
try { await db.query(`SELECT consume_email_verification_token($1)`, ['a'.repeat(64)]); } catch { secondOk = false; }
record('verify-email: token consumed once', true, firstOk);
record('verify-email: replay rejected', true, !secondOk);

// ============ registration rate-limit store ============
const regTable = await db.query(`SELECT to_regclass('public.registration_attempts') AS t`);
record('registration_attempts table exists (registration rate-limit store)', 'registration_attempts', String(regTable.rows[0]?.t || ''));

// ============ tenant isolation through RPC snapshot ============
const snapA = await db.query(`SELECT get_assistant_company_snapshot($1::uuid) s`, [coARealId]);
const snapB = await db.query(`SELECT get_assistant_company_snapshot($1::uuid) s`, [CO_B]);
let leak = false;
try {
  const sa = snapA.rows[0].s, sb2 = snapB.rows[0].s;
  if (sa && sb2 && JSON.stringify(sa).includes('Rev B')) leak = true;
  if (sa && sb2 && JSON.stringify(sb2).includes('Company A')) leak = true;
} catch {}
record('tenant isolation: assistant snapshot does not leak other company data', false, leak);

console.log('\n==== SUMMARY ====');
const failed = RESULTS.filter((r) => !r.pass);
console.log(`passed ${RESULTS.length - failed.length}/${RESULTS.length}`);
process.exit(failed.length ? 1 : 0);
