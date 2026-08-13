/**
 * End-to-end schema coverage audit (no DB connection required):
 *
 * Scans every API route's Supabase insert/update/upsert payload and asserts
 * that every top-level column written actually exists in the schema defined
 * by all migrations in src/migrations/*.sql.
 *
 * This catches the exact class of errors that have been plaguing this
 * codebase: API code that writes to a column that does not exist in
 * PostgreSQL, causing 42703 errors at runtime.
 *
 * It also verifies that every tenant-scoped update/delete carries a
 * company_id filter to prevent cross-tenant data leakage.
 */
import fs from 'fs';
import path from 'path';
import glob from 'fast-glob';

type Columns = Set<string>;

// ---------------------------------------------------------------------------
// 1. Build a table -> set(column) map from migrations
// ---------------------------------------------------------------------------
function buildSchema(): Record<string, Columns> {
  const tables: Record<string, Columns> = {};
  const migDir = path.resolve(__dirname, '../../src/migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();

  // Strip $$ plpgsql blocks and comments, then regex out DDL.
  function stripBlocks(sql: string): string {
    sql = sql.replace(/\$\$[\s\S]*?\$\$/g, ' ');
    sql = sql.replace(/--[^\n]*/g, ' ');
    sql = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
    return sql;
  }

  function addCol(t: string, c: string) {
    t = t.toLowerCase(); c = c.toLowerCase();
    if (!tables[t]) tables[t] = new Set();
    tables[t].add(c);
  }

  // CREATE TABLE ... ( ... )
  const ctRe = /CREATE\s+(?:MATERIALIZED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  // ALTER TABLE t ADD COLUMN [IF NOT EXISTS] c
  const acRe = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;

  for (const fn of files) {
    const raw = fs.readFileSync(path.join(migDir, fn), 'utf8');
    const sql = stripBlocks(raw);

    let m: RegExpExecArray | null;
    while ((m = ctRe.exec(sql))) {
      const name = m[1].toLowerCase();
      // Walk from '(' to matching ')' at depth 0
      let d = 1, i = m.index + m[0].length;
      while (i < sql.length && d > 0) {
        const ch = sql[i];
        if (ch === '(') d++;
        else if (ch === ')') d--;
        i++;
      }
      const body = sql.slice(m.index + m[0].length, i - 1);
      // Split on top-level commas
      const cols: string[] = [];
      let cur = '', depth = 0;
      for (const ch of body) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { cols.push(cur); cur = ''; }
        else cur += ch;
      }
      if (cur.trim()) cols.push(cur);
      for (const col of cols) {
        const tok = col.trim().split(/\s+/)[0];
        if (!tok) continue;
        // "KEY" is a valid column name (e.g. settings.key / app_settings.key),
        // so don't treat it as a reserved word.
        if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|CREATE|INDEX|REFERENCES|LIKE|EXCLUDE)$/i.test(tok)) continue;
        if (/^[a-zA-Z_]\w*$/.test(tok)) addCol(name, tok);
      }
    }

    while ((m = acRe.exec(sql))) addCol(m[1], m[2]);
  }
  return tables;
}

// ---------------------------------------------------------------------------
// 2. Extract top-level keys from a TS object literal starting at position 0
// ---------------------------------------------------------------------------
function topLevelKeys(block: string): Set<string> {
  const keys = new Set<string>();
  let i = 0, d = 0, inStr: string | null = null, esc = false;
  let cur = '';
  while (i < block.length) {
    const ch = block[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{' || ch === '[' || ch === '(') d++;
    else if (ch === '}' || ch === ']' || ch === ')') d--;
    if (d === 0 && ch === '}') {
      const km = cur.match(/^\s*([a-zA-Z_]\w*)\s*:/);
      if (km) keys.add(km[1].toLowerCase());
      break;
    }
    if (ch === ',' && d === 1) {
      const km = cur.match(/^\s*([a-zA-Z_]\w*)\s*:/);
      if (km) keys.add(km[1].toLowerCase());
      cur = '';
    } else {
      cur += ch;
    }
    i++;
  }
  return keys;
}

function findMatching(text: string, from: number, open: string, close: string): number {
  let d = 0, i = from, inStr: string | null = null, esc = false;
  while (i < text.length) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === open) d++;
    else if (ch === close) {
      d--;
      if (d === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}

function lineOf(text: string, idx: number): number {
  return text.slice(0, idx).split('\n').length;
}

// ---------------------------------------------------------------------------
// 3. Walk every route file and check insert/update/upsert payloads
// ---------------------------------------------------------------------------
describe('End-to-end API → Database Schema Coverage', () => {
  const tables = buildSchema();
  const apiDir = path.resolve(__dirname, '../../src/app/api');
  const files = glob.sync('**/route.ts', { cwd: apiDir, absolute: true });

  // Columns whose values are JSONB — sub-keys under them are not validated.
  const JSONB_COLS = new Set([
    'new_values', 'old_values', 'before_values', 'after_values', 'details',
    'addons_json', 'features_modules', 'permissions', 'config',
    'login_session_data', 'data',
  ]);

  // Tables that are global/admin and intentionally have no company_id
  const GLOBAL = new Set([
    'admin_users', 'admin_sessions', 'subscription_plans', 'advertisements',
    'app_settings', 'visitor_stats', 'visitor_logs', '_migrations',
    'company_registration_tokens', 'password_reset_tokens',
    'password_reset_requests', 'login_attempts', 'push_subscriptions',
    'telegram_test_runs', 'companies', 'users',
  ]);

  // Admin routes are allowed to operate on tenant tables without company_id
  // (they're post-authentication admin panel endpoints that act on any tenant).
  const ADMIN_ALLOWED_TABLES = new Set([
    'companies', 'subscriptions', 'users', 'addon_requests', 'upgrade_requests',
    'activation_codes', 'payment_methods', 'addon_grant_audit', 'complaints',
    'support_tickets', 'company_messages', 'messages', 'notifications',
    'backup_logs', 'bonds', 'audit_log', 'security_audit_log', 'ad_views',
    'ad_clicks', 'admin_audit_log', 'financial_audit_log', 'advertisements',
    'app_settings', 'subscription_plans', 'crm_contacts', 'crm_followups',
  ]);

  // Auth / public routes can operate on these tables without company_id
  // (registration, setup, public ad tracking, visitor analytics, etc.).
  const AUTH_ALLOWED_TABLES = new Set([
    'users', 'companies', 'subscriptions', 'payment_transactions',
    'password_reset_tokens', 'password_reset_requests',
    'company_registration_tokens', 'refresh_tokens', 'ad_views', 'ad_clicks',
    'visitor_logs', 'visitor_stats', 'settings', 'login_attempts',
  ]);

  const violations: { file: string; line: number; table: string; op: string; missing: string[] }[] = [];
  const missedCompany: { file: string; line: number; table: string; op: string }[] = [];

  for (const fp of files) {
    const rel = path.relative(path.resolve(__dirname, '../../'), fp);
    let ts = fs.readFileSync(fp, 'utf8');
    ts = ts.replace(/\/\/[^\n]*/g, '');
    ts = ts.replace(/\/\*[\s\S]*?\*\//g, '');

    const isAdminRoute = rel.includes(path.sep + 'admin' + path.sep);
    const isAuthOrPublic =
      rel.includes(`${path.sep}auth${path.sep}`) ||
      rel.includes(`${path.sep}portal${path.sep}`) ||
      rel.includes(`${path.sep}visitors${path.sep}`) ||
      rel.includes(`${path.sep}ads${path.sep}`) ||
      rel.includes(`${path.sep}subscribe${path.sep}`);

    const isWhitelisted =
      rel.includes('/api/auth/') ||
      rel.includes('/api/portal/') ||
      rel.includes('/api/visitors/') ||
      rel.includes('/api/ads/') ||
      rel.includes('/api/advertisements/') ||
      rel.includes('/api/setup/') ||
      rel.includes('/api/subscribe/');

    const fromRe = /\.from\(\s*['"](\w+)['"]\s*\)/g;
    const mutRe = /\.(insert|update|upsert|delete)\s*\(/g;

    let mut: RegExpExecArray | null;
    while ((mut = mutRe.exec(ts))) {
      const op = mut[1];
      const end = mut.index + mut[0].length;
      // Look back up to 3000 chars for the nearest preceding .from('table').
      const fromWindow = ts.slice(Math.max(0, mut.index - 3000), mut.index);
      const fromMatches = [...fromWindow.matchAll(fromRe)];
      if (fromMatches.length === 0) continue;
      const tableName = fromMatches[fromMatches.length - 1][1].toLowerCase();

      if (!tables[tableName]) {
        violations.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op, missing: ['<TABLE_NOT_FOUND>'] });
        continue;
      }

      let j = end;
      while (j < ts.length && /\s/.test(ts[j])) j++;

      let payload = new Set<string>();
      if ((op === 'insert' || op === 'upsert' || op === 'update') && ts[j] === '{') {
        const endObj = findMatching(ts, j, '{', '}');
        payload = topLevelKeys(ts.slice(j, endObj));
      } else if ((op === 'insert' || op === 'upsert') && ts[j] === '[') {
        const endArr = findMatching(ts, j, '[', ']');
        const inner = ts.slice(j, endArr);
        let k = 0;
        while (k < inner.length) {
          const ob = inner.indexOf('{', k);
          if (ob === -1) break;
          const endObj = findMatching(inner, ob, '{', '}');
          const keys2 = topLevelKeys(inner.slice(ob, endObj));
          keys2.forEach(kk => payload.add(kk));
          k = endObj;
        }
      }

      // Column coverage: every payload key must exist in schema
      const missing: string[] = [];
      for (const k of payload) {
        if (JSONB_COLS.has(k)) continue;
        if (k.startsWith('on_')) continue; // e.g. on_conflict keys
        if (k === '...' || k === 'returning') continue;
        if (!tables[tableName].has(k)) missing.push(k);
      }
      if (missing.length > 0) {
        violations.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op, missing });
      }

      // Tenant isolation for update/delete
      const needCompany =
        !GLOBAL.has(tableName) &&
        !(isAdminRoute && ADMIN_ALLOWED_TABLES.has(tableName)) &&
        !(isAuthOrPublic && AUTH_ALLOWED_TABLES.has(tableName)) &&
        !isWhitelisted;

      if (needCompany && (op === 'update' || op === 'delete')) {
        const hasCompanyInPayload = payload.has('company_id');
        const lookahead = ts.slice(mut.index, mut.index + 800);
        const lookbehind = ts.slice(Math.max(0, mut.index - 2000), mut.index);
        const laMatch = /\.eq\(\s*['"]company_id['"]/.test(lookahead);
        // If the payload object was bound to a variable earlier (e.g.
        //   const payload = { company_id: auth.companyId, ... };
        //   await s.from('x').update(payload).eq('id',id);
        // ), then within 2000 chars before the mutation we should see
        // "company_id:" — treat as safe.
        const lbMatch = /company_id\s*:/.test(lookbehind);
        if (!hasCompanyInPayload && !laMatch && !lbMatch) {
          missedCompany.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op });
        }
      }
    }
  }

  test('No API route writes to a non-existent column (42703-proof)', () => {
    if (violations.length > 0) {
      console.log('Column-coverage violations:');
      for (const v of violations) {
        console.log(`  ${v.file}:${v.line}  ${v.op} ${v.table}  missing=${v.missing.join(',')}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test('Every tenant-scoped mutation carries company_id (tenant-isolation proof)', () => {
    if (missedCompany.length > 0) {
      console.log('Missing company_id on tenant mutation:');
      for (const v of missedCompany) {
        console.log(`  ${v.file}:${v.line}  ${v.op} ${v.table}`);
      }
    }
    expect(missedCompany).toEqual([]);
  });

  test('All required app tables exist in migrations', () => {
    const required = [
      'users','companies','accounts','journal_entries','journal_lines','invoices','invoice_items',
      'quotations','quotation_items','contacts','projects','employees','inventory_items',
      'inventory_transactions','purchase_invoices','purchase_invoice_items','purchase_orders',
      'purchase_order_items','voucher_receipts','voucher_disbursements','cash_transactions',
      'banks_safes','cost_centers','branches','currencies','credit_notes','credit_note_items',
      'depreciation_log','fixed_assets','equipment','equipment_costs','equipment_maintenance',
      'equipment_usage','budgets','budget_lines','bonds','tenders','contracts','boq_items',
      'progress_claims','progress_billing','project_expenses','timesheets','daily_workers',
      'payroll','salary_sheets','salary_items','custodies','custody_transactions',
      'petty_cash_boxes','petty_cash_transactions','petty_cash_reconciliation',
      'notifications','support_tickets','company_messages','messages','approval_requests',
      'subscription_plans','subscriptions','upgrade_requests','addon_requests','activation_codes',
      'addon_grant_audit','payment_methods','payment_records','payment_transactions','invoice_payments',
      'payment_disbursements','push_subscriptions','push_notification_log','reminder_log',
      'ad_views','ad_clicks','advertisements','visitor_logs','visitor_stats','app_settings',
      'custom_modules','custom_actions','user_permissions','vat_return_filings','tax_returns',
      'withholding_taxes','company_telegram_configs','gosi_settings','manufacturing_boms',
      'manufacturing_bom_lines','manufacturing_orders','manufacturing_order_materials',
      'pos_terminals','pos_sales','pos_sale_items','properties','property_leases','property_maintenance',
      'company_registration_tokens','refresh_tokens','admin_users','admin_sessions','_migrations',
      'audit_log','financial_audit_log','security_audit_log','backup_logs',
      'financial_audit_trails','transaction_categories','crm_contacts','crm_followups',
      'bank_reconciliation','bank_reconciliation_items','daily_worker_records',
      'daily_worker_settlements','disbursement_invoice_items','receipt_invoice_items',
      'tender_cost_items','salary_items','contract_documents',
      'company_data_exports',
    ];
    const missing = required.filter(t => !tables[t]);
    if (missing.length > 0) console.log('Missing tables:', missing);
    expect(missing).toEqual([]);
  });
});
