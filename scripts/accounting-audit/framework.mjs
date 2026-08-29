/**
 * Independent programmatic accounting audit framework.
 *
 * Deliberately separate from scripts/test-migrations.mjs: it re-derives every
 * check from first-principles accounting invariants (double-entry, totals
 * reconciliation, per-document journalization, inventory continuity, payroll
 * math, tenant isolation, numbering) instead of trusting what previous suites
 * asserted. Each section file in ./sections drives ONE module through full
 * business scenarios and the framework validates the books afterwards.
 *
 * Usage: node scripts/accounting-audit/run.mjs [name-substring]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createDriver } from '../migration-drivers.mjs';

const TOL = 0.005; // half-cent tolerance for chained 2dp rounding

/* ------------------------------------------------------------------ */
/* DB lifecycle                                                        */
/* ------------------------------------------------------------------ */

export async function initDb() {
  const db = await createDriver();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
  `);
  if (db.hasPgcrypto) {
    await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  } else {
    await db.exec(`
      CREATE FUNCTION digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE
        AS $$ SELECT decode(md5($1),'hex') $$;
    `);
  }
  await db.exec(`
    CREATE TABLE _migrations(
      id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve('src/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const filename of files) {
    const tracked = await db.query('SELECT 1 FROM _migrations WHERE filename=$1', [filename]);
    if (tracked.rows.length) continue;
    let sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '')
      .trim();
    if (!db.hasPgcrypto) {
      sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/gim, '').trim();
    }
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw new Error(`audit framework: migration ${filename} failed: ${e.message}`);
    }
    await db.query('INSERT INTO _migrations(filename) VALUES($1)', [filename]);
  }
  return { db, migrationCount: files.length };
}

/* ------------------------------------------------------------------ */
/* Tenant seeding through the PRODUCTION registration path             */
/* ------------------------------------------------------------------ */

// Chart aligned to the exact operational codes the accounting engine
// hard-references (049/050/094/101): 1110 cash, 1120 banks, 1130 AR,
// 1150/1160 custodies, 1170 inventory at cost, 1290 accumulated
// depreciation, 2110 AP, 2120 VAT payable, 2140 salaries payable,
// 2165 withholding (EG), 3100 capital, 3200 retained earnings,
// 4100 revenue, 4200 other income, 5100 operating expenses, 5210 salaries.
// 1140 stays a header to exercise the header-posting rejection path.
const CHART = JSON.stringify([
  { code: '1110', name: 'الخزينة', name_en: 'Cash', type: 'asset', parent_code: null, is_header: false },
  { code: '1120', name: 'البنوك', name_en: 'Banks', type: 'asset', parent_code: null, is_header: false },
  { code: '1121', name: 'الحساب الجاري', name_en: 'Current account', type: 'asset', parent_code: null, is_header: false },
  { code: '1130', name: 'العملاء', name_en: 'Accounts receivable', type: 'asset', parent_code: null, is_header: false },
  { code: '1140', name: 'المخزون (رئيسي)', name_en: 'Inventory (header)', type: 'asset', parent_code: null, is_header: true },
  { code: '1150', name: 'عهدة الموظفين', name_en: 'Employee advances', type: 'asset', parent_code: null, is_header: false },
  { code: '1160', name: 'عهدة مستحقة للمقاصة', name_en: 'Custody settlement', type: 'asset', parent_code: null, is_header: false },
  { code: '1170', name: 'المخزون بالتكلفة', name_en: 'Inventory at cost', type: 'asset', parent_code: '1140', is_header: false },
  { code: '1180', name: 'ضريبة المشتريات المدخلة', name_en: 'Input VAT', type: 'asset', parent_code: null, is_header: false },
  { code: '1135', name: 'مستخلصات المشاريع', name_en: 'Progress billings receivable', type: 'asset', parent_code: null, is_header: false },
  { code: '1210', name: 'ممتلكات', name_en: 'Property', type: 'asset', parent_code: null, is_header: false },
  { code: '1220', name: 'معدات', name_en: 'Equipment', type: 'asset', parent_code: null, is_header: false },
  { code: '1230', name: 'أصول ثابتة', name_en: 'Fixed assets (parent)', type: 'asset', parent_code: null, is_header: false },
  { code: '1290', name: 'الإهلاك المجمع', name_en: 'Accumulated depreciation', type: 'asset', parent_code: null, is_header: false },
  { code: '2110', name: 'الموردون', name_en: 'Accounts payable', type: 'liability', parent_code: null, is_header: false },
  { code: '2120', name: 'ضريبة القيمة المضافة', name_en: 'VAT payable', type: 'liability', parent_code: null, is_header: false },
  { code: '2140', name: 'الرواتب المستحقة', name_en: 'Salaries payable', type: 'liability', parent_code: null, is_header: false },
  { code: '2145', name: 'مصروفات أوامر الشراء', name_en: 'PO expenses payable', type: 'liability', parent_code: null, is_header: false },
  { code: '2150', name: 'التزامات المقاولين الباطنين', name_en: 'Subcontractor payables', type: 'liability', parent_code: null, is_header: false },
  { code: '2160', name: 'محجوزات الضمان', name_en: 'Retention liability', type: 'liability', parent_code: null, is_header: false },
  // 2165 withholding is seeded automatically by 104 for EG tenants
  { code: '3100', name: 'رأس المال', name_en: 'Capital', type: 'equity', parent_code: null, is_header: false },
  { code: '3200', name: 'الأرباح المحتجزة', name_en: 'Retained earnings', type: 'equity', parent_code: null, is_header: false },
  { code: '4100', name: 'إيرادات النشاط', name_en: 'Operating revenue', type: 'revenue', parent_code: null, is_header: false },
  { code: '4200', name: 'إيرادات أخرى', name_en: 'Other income', type: 'revenue', parent_code: null, is_header: false },
  { code: '4210', name: 'أرباح فروق العملة', name_en: 'FX gains', type: 'revenue', parent_code: null, is_header: false },
  { code: '5450', name: 'خسائر فروق العملة', name_en: 'FX losses', type: 'expense', parent_code: null, is_header: false },
  { code: '5100', name: 'المصروفات التشغيلية', name_en: 'Operating expenses', type: 'expense', parent_code: null, is_header: false },
  { code: '5110', name: 'مصروفات المشاريع', name_en: 'Project expenses', type: 'expense', parent_code: null, is_header: false },
  { code: '5210', name: 'الرواتب والأجور', name_en: 'Salaries and wages', type: 'expense', parent_code: null, is_header: false },
  { code: '5400', name: 'مصروفات عامة', name_en: 'General expenses', type: 'expense', parent_code: null, is_header: false },
  { code: '5410', name: 'مصاريف المناقصات', name_en: 'Tender costs (pre-contract suspense)', type: 'expense', parent_code: null, is_header: false },
  { code: '5195', name: 'تكاليف ما قبل التعاقد', name_en: 'Pre-contract project costs', type: 'expense', parent_code: null, is_header: false },
  { code: '5291', name: 'عمولات الضمانات', name_en: 'Bond commissions', type: 'expense', parent_code: null, is_header: false },
  { code: '5260', name: 'مصروف الإهلاك', name_en: 'Depreciation expense', type: 'expense', parent_code: null, is_header: false },
  { code: '1185', name: 'أغطية خطابات الضمان', name_en: 'Bond margins (bid)', type: 'asset', parent_code: null, is_header: false },
  { code: '1186', name: 'أغطية الضمانات الأخرى', name_en: 'Bond margins (other)', type: 'asset', parent_code: null, is_header: false },
]);

/** Deterministic well-formed UUID from a seed string (per-tenant fixtures). */
export function uid(seed) {
  let x = 2166136261;
  for (const ch of seed) { x ^= ch.codePointAt(0); x = Math.imul(x, 16777619) >>> 0; }
  const h = (n, len) => (n >>> 0).toString(16).padStart(len, '0').slice(-len);
  return `${h(x, 8)}-${h(x ^ 0x9e3779b9, 4)}-4${h(x ^ 0x517cc1b7, 3)}-8${h(x ^ 0x62b8f33d, 3)}-${h(x ^ 0x12345678, 12)}`;
}

export async function seedTenant(db, { name, email, country = 'SA' }) {
  const cfg = country === 'EG'
    ? { country: 'مصر', code: 'EG', currency: 'EGP', symbol: 'ج.م', locale: 'ar-EG', vat: 0.14 }
    : { country: 'المملكة العربية السعودية', code: 'SA', currency: 'SAR', symbol: 'ر.س', locale: 'ar-SA', vat: 0.15 };
  const res = await db.query(`SELECT register_company(
    $1, $2, '', $3, $4, $5, $6, $7, $8::NUMERIC, 'أدمن', 'hash-audit', 'verify-hash',
    NOW() + INTERVAL '24 hours', $9::jsonb) r`,
    [name, email, cfg.country, cfg.code, cfg.currency, cfg.symbol, cfg.locale, cfg.vat, CHART]);
  const r = res.rows[0].r;
  const companyId = r.company.id;
  const userId = r.user.id;

  const accs = await db.query('SELECT id, code FROM accounts WHERE company_id=$1', [companyId]);
  const byCode = Object.fromEntries(accs.rows.map((a) => [a.code, a.id]));

  const banks = uid(email + ':bank');
  const safe = uid(email + ':safe');
  await db.query(`INSERT INTO banks_safes(id, company_id, name, type, account_id, opening_balance, is_active)
    VALUES ($1, $2, 'بنك الاختبار', 'bank', $3, 0, TRUE),
           ($4, $2, 'خزينة الاختبار', 'safe', $5, 0, TRUE)`,
    [banks, companyId, byCode['1121'], safe, byCode['1110']]);

  const warehouse = uid(email + ':warehouse');
  await db.query(`INSERT INTO warehouses(id, company_id, name, location, is_active)
    VALUES ($1, $2, 'مستودع الاختبار', 'القاهرة', TRUE)`, [warehouse, companyId]);

  const contacts = {};
  for (const [key, cname, type] of [
    ['client', 'عميل المراجعة', 'client'],
    ['supplier', 'مورد المراجعة', 'supplier'],
  ]) {
    const id = uid(email + ':contact:' + key);
    await db.query(`INSERT INTO contacts(id, company_id, name, type, phone, email)
      VALUES ($1, $2, $3, $4, '01000000000', 'x@example.test')`, [id, companyId, cname, type]);
    contacts[key] = id;
  }

  // The overdraft guard trusts the LEDGER (get_account_balance), so fixtures
  // need real funds: post an opening capital entry on the FY start date
  // (works for both the SA Jan-Dec and the EG Jul-Jun fiscal year).
  const fyStart = (await db.query(
    'SELECT MIN(start_date) d FROM fiscal_years WHERE company_id=$1', [companyId])).rows[0].d;
  const fund = async (bankSafeId, code, amount) => {
    await db.query(`SELECT create_journal_entry($1,$2::date,'general','تسوية رأس المال', $3, $4::jsonb)`,
      [companyId, fyStart, userId, JSON.stringify([
        { accountId: byCode[code], debit: amount, credit: 0 },
        { accountId: byCode['3100'], debit: 0, credit: amount },
      ])]);
  };
  await fund(banks, '1121', 1000000);
  await fund(safe, '1110', 500000);

  return { companyId, userId, byCode, banks, safe, warehouse, contacts, cfg };
}

/* ------------------------------------------------------------------ */
/* RPC introspection — call the FINAL live definition by arg names     */
/* ------------------------------------------------------------------ */

/** Returns [{name, type}] of the current definition of fn (null if absent). */
export async function rpcArgs(db, name) {
  const r = await db.query(`
    SELECT p.proargnames::text names, p.proargtypes::regtype[] types
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname = $1 AND p.prokind IN ('f','p')`, [name]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  const names = row.names ? row.names.replace(/^[{]+|[}]+$/g, '').split(',') : [];
  const types = row.types || [];
  return names.map((n, i) => ({ name: n, type: types[i] || 'unknown' }));
}

/** Call an RPC with named args — works against the final live signature. */
export function callRpc(db, fn, args) {
  const named = Object.entries(args)
    .map(([k, v], i) => `${k} := $${i + 1}`)
    .join(', ');
  return db.query(`SELECT public.${fn}(${named}) result`, Object.values(args));
}

/* ------------------------------------------------------------------ */
/* Check bookkeeping                                                   */
/* ------------------------------------------------------------------ */

const P = [];

export function check(label, ok, detail = '') {
  P.push({ label, ok, detail });
  if (process.env.AUDIT_VERBOSE) console.log(`  · ${label}${ok ? '' : ' ← FAIL'}`);
  if (!ok) console.log(`  ✗ FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

export function assertBalance(a, b, label) {
  return check(label, Math.abs(Number(a) - Number(b)) <= TOL, `expected ${a} == ${b}`);
}

export function rejects(promise, label, match) {
  return promise
    .then(() => check(label, false, 'operation unexpectedly succeeded'))
    .catch((e) => check(label, match ? e.message.includes(match) : true,
      match ? `rejected with "${e.message}" (wanted "${match}")` : e.message));
}

export function resetChecks() { P.length = 0; return P; }
export function currentChecks() { return P.slice(); }

/* ------------------------------------------------------------------ */
/* Accounting invariants (first principles)                            */
/* ------------------------------------------------------------------ */

/** Every journal entry must be perfectly double-entry. */
export async function invDoubleEntry(db, companyId) {
  const bad = await db.query(`
    SELECT je.id, je.date, je.type,
           SUM(jl.debit) d, SUM(jl.credit) c
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    WHERE je.company_id = $1 AND je.deleted_at IS NULL
    GROUP BY je.id, je.date, je.type
    HAVING ABS(SUM(jl.debit) - SUM(jl.credit)) > 0.005`, [companyId]);
  return check('double-entry: every journal entry debits == credits', bad.rows.length === 0,
    bad.rows.slice(0, 3).map((r) => `${r.type} @${r.date}: D=${r.d} C=${r.c}`).join('; '));
}

/** Trial balance: total debits == total credits across the company. */
export async function invTrialBalance(db, companyId) {
  const row = await db.query(`
    SELECT COALESCE(SUM(jl.debit),0) d, COALESCE(SUM(jl.credit),0) c
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE je.company_id = $1 AND je.deleted_at IS NULL`, [companyId]);
  return assertBalance(row.rows[0].d, row.rows[0].c, 'trial balance: total debits == total credits');
}

/** Books must balance even for a company mid-business: assets+expenses == liabilities+equity+revenue. */
export async function invBalanceSheet(db, companyId) {
  const row = await db.query(`
    SELECT
      COALESCE(SUM(CASE WHEN a.type IN ('asset','expense') THEN jl.debit - jl.credit ELSE 0 END),0) left_side,
      COALESCE(SUM(CASE WHEN a.type IN ('liability','equity','revenue') THEN jl.credit - jl.debit ELSE 0 END),0) right_side
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = $1 AND je.deleted_at IS NULL`, [companyId]);
  return assertBalance(row.rows[0].left_side, row.rows[0].right_side, 'balance sheet identity: A+E == L+Eq+R');
}

/**
 * Invoice totals must reconcile with their components. Note: tax_amount/tax_rate
 * are denormalized copies of vat_amount/vat_rate in this schema, so the total
 * identity is subtotal + vat_amount, plus a copy-consistency check.
 */
export async function invInvoiceMath(db, companyId) {
  const bad = await db.query(`
    SELECT number, subtotal, vat_amount, tax_amount, total
    FROM invoices
    WHERE company_id = $1 AND deleted_at IS NULL
      AND ABS(subtotal + COALESCE(vat_amount,0) - total) > 0.01`, [companyId]);
  const copyDrift = await db.query(`
    SELECT number FROM invoices
    WHERE company_id = $1 AND deleted_at IS NULL
      AND ABS(COALESCE(tax_amount,0) - COALESCE(vat_amount,0)) > 0.005`, [companyId]);
  check('invoices: subtotal + vat == total', bad.rows.length === 0,
    bad.rows.map((r) => `#${r.number}: ${r.subtotal}+${r.vat_amount} != ${r.total}`).join('; '));
  check('invoices: tax_amount denormalized copy stays in sync with vat_amount',
    copyDrift.rows.length === 0, copyDrift.rows.map((r) => `#${r.number}`).join('; '));
}

/** VAT on each invoice must equal subtotal * rate (2dp). */
export async function invVatRate(db, companyId) {
  const bad = await db.query(`
    SELECT number, subtotal, vat_rate, vat_amount
    FROM invoices
    WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(vat_rate,0) > 0
      AND ABS(vat_amount - ROUND(subtotal * vat_rate, 2)) > 0.01`, [companyId]);
  return check('invoices: vat_amount == ROUND(subtotal * vat_rate, 2)', bad.rows.length === 0,
    bad.rows.map((r) => `#${r.number}: vat ${r.vat_amount} vs ${r.subtotal}*${r.vat_rate}`).join('; '));
}

/** Purchase invoices: total == subtotal + tax; withholding math when applied. */
export async function invPurchaseInvoiceMath(db, companyId) {
  const bad = await db.query(`
    SELECT number, subtotal, tax_amount, total
    FROM purchase_invoices
    WHERE company_id = $1
      AND ABS(subtotal + COALESCE(tax_amount,0) - total) > 0.01`, [companyId]);
  const wh = await db.query(`
    SELECT number, subtotal, withholding_rate, withholding_amount
    FROM purchase_invoices
    WHERE company_id = $1 AND COALESCE(withholding_rate,0) > 0
      AND ABS(withholding_amount - ROUND(subtotal * withholding_rate, 2)) > 0.01`, [companyId]);
  check('purchase invoices: subtotal + tax == total', bad.rows.length === 0,
    bad.rows.map((r) => `#${r.number}`).join('; '));
  check('purchase invoices: withholding_amount == ROUND(subtotal * rate, 2)', wh.rows.length === 0,
    wh.rows.map((r) => `#${r.number}`).join('; '));
}

/**
 * Every posted voucher must be journalized: the receipt's journal entry
 * carries a DEBIT of exactly the voucher amount on the safe/bank's account;
 * a disbursement carries a CREDIT of exactly its amount.
 */
export async function invVouchersJournalized(db, companyId) {
  const badR = await db.query(`
    SELECT v.number, v.amount, bs.account_id,
           MAX(CASE WHEN jl.debit = v.amount AND jl.account_id = bs.account_id THEN 1 ELSE 0 END) hit
    FROM voucher_receipts v
    JOIN banks_safes bs ON bs.id = v.bank_safe_id
    LEFT JOIN journal_lines jl ON jl.journal_entry_id = v.journal_entry_id
    WHERE v.company_id = $1 AND v.status <> 'cancelled' AND v.journal_entry_id IS NOT NULL
    GROUP BY v.id, v.number, v.amount, bs.account_id
    HAVING MAX(CASE WHEN jl.debit = v.amount AND jl.account_id = bs.account_id THEN 1 ELSE 0 END) = 0
    LIMIT 3`, [companyId]);
  const badD = await db.query(`
    SELECT v.number, v.amount, bs.account_id,
           MAX(CASE WHEN jl.credit = v.amount AND jl.account_id = bs.account_id THEN 1 ELSE 0 END) hit
    FROM voucher_disbursements v
    JOIN banks_safes bs ON bs.id = v.bank_safe_id
    LEFT JOIN journal_lines jl ON jl.journal_entry_id = v.journal_entry_id
    WHERE v.company_id = $1 AND v.status <> 'cancelled' AND v.journal_entry_id IS NOT NULL
    GROUP BY v.id, v.number, v.amount, bs.account_id
    HAVING MAX(CASE WHEN jl.credit = v.amount AND jl.account_id = bs.account_id THEN 1 ELSE 0 END) = 0
    LIMIT 3`, [companyId]);
  check('receipts: JE debits the receiving bank/safe account for the full amount', badR.rows.length === 0,
    badR.rows.map((r) => `receipt #${r.number} (${r.amount})`).join('; '));
  check('disbursements: JE credits the paying bank/safe account for the full amount', badD.rows.length === 0,
    badD.rows.map((r) => `disb #${r.number} (${r.amount})`).join('; '));
}

/** Inventory continuity: balance_before(n) == balance_after(n-1); last == item.quantity. */
export async function invInventoryContinuity(db, companyId) {
  const breaks = await db.query(`
    WITH ordered AS (
      SELECT item_id, type, quantity, balance_before, balance_after,
             LAG(balance_after) OVER (PARTITION BY item_id ORDER BY number, created_at) prev_after
      FROM inventory_transactions
      WHERE company_id = $1 AND status <> 'cancelled'
    )
    SELECT item_id, type, balance_before, prev_after
    FROM ordered
    WHERE prev_after IS NOT NULL AND ABS(balance_before - prev_after) > 0.001
    LIMIT 3`, [companyId]);
  const mismatch = await db.query(`
    SELECT i.name, i.quantity, t.last_after
    FROM inventory_items i
    JOIN (
      SELECT item_id, (ARRAY_AGG(balance_after ORDER BY number DESC, created_at DESC))[1] last_after
      FROM inventory_transactions WHERE company_id = $1 GROUP BY item_id
    ) t ON t.item_id = i.id
    WHERE i.company_id = $1 AND i.is_active AND ABS(i.quantity - t.last_after) > 0.001
    LIMIT 3`, [companyId]);
  check('inventory: movement chain continuity (balance_before == prev balance_after)', breaks.rows.length === 0,
    breaks.rows.map((r) => `before ${r.balance_before} vs prev after ${r.prev_after}`).join('; '));
  check('inventory: item.quantity == last balance_after', mismatch.rows.length === 0,
    mismatch.rows.map((r) => `${r.name}: ${r.quantity} vs ${r.last_after}`).join('; '));
}

/** Payroll row math: net == basic + allowances - all deductions; GOSI at the country rates. */
export async function invPayrollMath(db, companyId) {
  const bad = await db.query(`
    SELECT name, basic_salary, allowances, deductions, advance_deduction, custody_deduction, net_pay,
           gosi_employer, gosi_employee
    FROM payroll p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.company_id = $1
      AND ABS(p.net_pay - (p.basic_salary + p.allowances - p.deductions - COALESCE(p.advance_deduction,0) - COALESCE(p.custody_deduction,0))) > 0.01
    LIMIT 3`, [companyId]);
  check('payroll: net_pay == basic + allowances - deductions - advance - custody', bad.rows.length === 0,
    bad.rows.map((r) => `${r.name}: net ${r.net_pay}`).join('; '));
  // GOSI/EOSB rates depend on the operating country — check internally:
  // employee GOSI deduction must equal a consistent share of the employer share.
  const rates = await db.query(`
    SELECT setting_value FROM settings WHERE company_id=$1 AND key='operating_country'`, [companyId])
      .catch(() => ({ rows: [] }));
  const code = rates.rows[0]?.setting_value || 'SA';
  const emp = code === 'EG' ? 0.11 : 0.0975;
  const eosb = code === 'EG' ? 0.0625 : 0; // part of employer side for EG in some configs — keep employer check loose
  const gosi = await db.query(`
    SELECT e.name, p.gosi_employee, p.gosi_employer, (p.basic_salary + p.allowances) gross
    FROM payroll p JOIN employees e ON e.id = p.employee_id
    WHERE p.company_id = $1 AND p.gosi_employee IS NOT NULL
      AND ABS(p.gosi_employee - ROUND((p.basic_salary + p.allowances) * $2::NUMERIC, 2)) > 0.01
    LIMIT 3`, [companyId, emp]);
  check(`payroll: employee social-insurance == ROUND(gross * ${emp}, 2) (${code})`, gosi.rows.length === 0,
    gosi.rows.map((r) => `${r.name}: ${r.gosi_employee} vs gross ${r.gross}`).join('; '));
}

/** Fixed assets: NBV == cost - accumulated; straight-line consistency. */
export async function invFixedAssetsMath(db, companyId) {
  const bad = await db.query(`
    SELECT name, purchase_cost, accumulated_depreciation, net_book_value
    FROM fixed_assets
    WHERE company_id = $1 AND status <> 'disposed'
      AND ABS(net_book_value - (purchase_cost - accumulated_depreciation)) > 0.01
    LIMIT 3`, [companyId]);
  return check('fixed assets: net_book_value == purchase_cost - accumulated_depreciation', bad.rows.length === 0,
    bad.rows.map((r) => `${r.name}: NBV ${r.net_book_value}`).join('; '));
}

/** Tax return math: net == output - input. */
export async function invTaxReturnMath(db, companyId) {
  const bad = await db.query(`
    SELECT period_from, period_to, output_vat, input_vat, net_vat
    FROM tax_returns
    WHERE company_id = $1 AND ABS(net_vat - (output_vat - input_vat)) > 0.01
    LIMIT 3`, [companyId]);
  return check('tax returns: net_vat == output_vat - input_vat', bad.rows.length === 0,
    bad.rows.map((r) => `${r.period_from}..${r.period_to}`).join('; '));
}

/** BOQ line math. */
export async function invBoqMath(db, companyId) {
  const bad = await db.query(`
    SELECT code, quantity, unit_price, total FROM boq_items
    WHERE company_id = $1 AND ABS(total - (quantity * unit_price)) > 0.01 LIMIT 3`, [companyId]);
  return check('BOQ: line total == quantity * unit_price', bad.rows.length === 0,
    bad.rows.map((r) => `${r.code}`).join('; '));
}

/** Progress billing: net == gross - retention. */
export async function invProgressBillingMath(db, companyId) {
  const bad = await db.query(`
    SELECT claim_number, gross_amount, retention_amount, net_amount
    FROM progress_billing
    WHERE company_id = $1 AND cancelled_at IS NULL
      AND ABS(net_amount - (gross_amount - COALESCE(retention_amount,0))) > 0.01
    LIMIT 3`, [companyId]);
  return check('progress billing: net == gross - retention', bad.rows.length === 0,
    bad.rows.map((r) => `${r.claim_number}`).join('; '));
}

/** No duplicate document numbers within a company. */
export async function invNoDuplicateNumbers(db, companyId, table) {
  const bad = await db.query(
    `SELECT number, COUNT(*) n FROM ${table} WHERE company_id=$1 GROUP BY number HAVING COUNT(*)>1 LIMIT 3`,
    [companyId]);
  return check(`${table}: no duplicate numbers per company`, bad.rows.length === 0,
    bad.rows.map((r) => `#${r.number} x${r.n}`).join('; '));
}

/**
 * Tenant isolation for the journal: a line's tenant must equal both its entry's
 * tenant and its account's tenant (no cross-tenant mixing), and no journal row
 * may reference a company that does not exist.
 */
export async function invTenantScope(db, companyId) {
  const mixed = await db.query(`
    SELECT COUNT(*) n FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE (jl.company_id IS DISTINCT FROM je.company_id
       OR jl.company_id IS DISTINCT FROM a.company_id)`);
  const dangling = await db.query(`
    SELECT COUNT(*) n FROM journal_lines jl
    WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = jl.company_id)`);
  check('tenant isolation: line tenant == entry tenant == account tenant',
    Number(mixed.rows[0].n) === 0, `${mixed.rows[0].n} mixed rows`);
  check('tenant isolation: no journal line references a missing company',
    Number(dangling.rows[0].n) === 0, `${dangling.rows[0].n} dangling rows`);
}

/** Closing entries must net the P&L to zero within the fiscal year. */
export async function invPnlClosed(db, companyId, fiscalYearId) {
  const fy = (await db.query('SELECT start_date, end_date FROM fiscal_years WHERE id=$1', [fiscalYearId])).rows[0];
  const row = await db.query(`
    SELECT COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END),0)
         - COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END),0) pnl
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.company_id = $1 AND je.deleted_at IS NULL
      AND je.date BETWEEN $2 AND $3`, [companyId, fy.start_date, fy.end_date]);
  return assertBalance(row.rows[0].pnl, 0, 'P&L nets to zero after closing');
}

/* ------------------------------------------------------------------ */
/* Section runner                                                      */
/* ------------------------------------------------------------------ */

export async function runSection(name, runFn, ctx) {
  console.log(`\n=== ${name} ===`);
  resetChecks();
  const t0 = Date.now();
  let status = 'PASS';
  try {
    await runFn(ctx);
  } catch (e) {
    status = 'ERROR';
    console.log(`  ✗ SECTION ERROR: ${e.message}`);
    if (process.env.AUDIT_STACK) console.log(e.stack);
  }
  const checks = currentChecks();
  const failed = checks.filter((c) => !c.ok);
  const final = failed.length || status === 'ERROR' ? 'FAIL' : 'PASS';
  console.log(`  [${final}] ${checks.length} checks, ${failed.length} failed, ${Date.now() - t0}ms`);
  return { name, status: final, checks, failed: failed.length, ms: Date.now() - t0 };
}

export function printSummary(results) {
  console.log('\n' + '='.repeat(64));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(64));
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.name.padEnd(46)} ${r.checks.length} checks, ${r.failed} failed, ${r.ms}ms`);
  }
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.log('-'.repeat(64));
  console.log(`  ${results.length} sections | ${results.filter((r) => r.status === 'PASS').length} pass | ${totalFailed} failed checks`);
  return totalFailed === 0 && results.every((r) => r.status === 'PASS');
}
