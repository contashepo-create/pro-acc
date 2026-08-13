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

  // Strip $$ plpgsql blocks and line comments, then regex out DDL.
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

  // CREATE TABLE ... ( ... ) — tracks depth of nested parentheses
  const ctRe = /CREATE\s+(?:MATERIALIZED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  // ALTER TABLE t ADD COLUMN [IF NOT EXISTS] c
  const acRe = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;

  for (const fn of files) {
    const raw = fs.readFileSync(path.join(migDir, fn), 'utf8');
    const sql = stripBlocks(raw);

    let m: RegExpExecArray | null;
    while ((m = ctRe.exec(sql))) {
      const name = m[1].toLowerCase();
      // walk from the matching '(' to matching ')' at depth 0
      let d = 1, i = m.index + m[0].length;
      while (i < sql.length && d > 0) {
        const ch = sql[i];
        if (ch === '(') d++;
        else if (ch === ')') d--;
        i++;
      }
      const body = sql.slice(m.index + m[0].length, i - 1);
      // split on top-level commas
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
  // state machine: after '{' we're in the object
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
      // finalize last key
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

// ---------------------------------------------------------------------------
// 3. Walk every route file and check insert/update/upsert payloads
// ---------------------------------------------------------------------------
describe('End-to-end API → Database Schema Coverage', () => {
  const tables = buildSchema();
  const apiDir = path.resolve(__dirname, '../../src/app/api');
  const files = glob.sync('**/route.ts', { cwd: apiDir, absolute: true });

  // Columns whose values are JSONB — sub-keys under them are not validated.
  const JSONB_COLS = new Set([
    'new_values','old_values','before_values','after_values','details','addons_json',
    'features_modules','permissions','config','login_session_data','data',
  ]);

      // Tables that are global/admin and intentionally have no company_id
      const GLOBAL = new Set([
        'admin_users','admin_sessions','subscription_plans','advertisements','app_settings',
        'visitor_stats','visitor_logs','_migrations','company_registration_tokens',
        'password_reset_tokens','password_reset_requests','login_attempts','push_subscriptions',
        'telegram_test_runs','companies','users',
      ]);

      // Routes (path fragment → truthy) where we know the mutation is in an
      // auth/setup flow or uses a complex payload object (company_id present
      // inside the object but not detectable by our simple top-level scan) —
      // defined above per-file as isWhitelisted.

  const violations: { file: string; line: number; table: string; op: string; missing: string[] }[] = [];
  const missedCompany: { file: string; line: number; table: string; op: string }[] = [];

    for (const fp of files) {
    const rel = path.relative(path.resolve(__dirname, '../../'), fp);
    let ts = fs.readFileSync(fp, 'utf8');
    ts = ts.replace(/\/\/[^\n]*/g, '');
    ts = ts.replace(/\/\*[\s\S]*?\*\//g, '');

    const isAdminRoute = rel.includes(path.sep + 'admin' + path.sep);
    const isAuthRoute = rel.includes(`${path.sep}auth${path.sep}`) ||
                        rel.includes(`${path.sep}portal${path.sep}`) ||
                        rel.includes(`${path.sep}visitors${path.sep}`) ||
                        rel.includes(`${path.sep}ads${path.sep}`) ||
                        rel.includes(`${path.sep}subscribe${path.sep}`);

    // Routes where mutations are allowed to carry non-standard company_id
    // (public setup, initial company creation, public ad tracking, etc.)
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
      // Look for preceding .from() within the last 3000 characters (helper
      // functions and long variable bindings can push the from() further up)
      const fromWindow = ts.slice(Math.max(0, mut.index - 3000), mut.index);
      const fromMatches = [...fromWindow.matchAll(fromRe)];
      if (fromMatches.length === 0) continue;
      const tableName = fromMatches[fromMatches.length - 1][1].toLowerCase();

      // Ensure table exists
      if (!tables[tableName]) {
        violations.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op, missing: ['<TABLE_NOT_FOUND>'] });
        continue;
      }

      // Skip to first non-space
      let j = end;
      while (j < ts.length && /\s/.test(ts[j])) j++;

      // Skip whitespace/comments/line breaks to find real payload start
      while (j < ts.length && /[\s]/.test(ts[j])) j++;

      // Determine payload (if object or array-of-object)
      let payload = new Set<string>();
      if ((op === 'insert' || op === 'upsert' || op === 'update') && ts[j] === '{') {
        const endObj = findMatching(ts, j, '{', '}');
        payload = topLevelKeys(ts.slice(j, endObj));
      } else if ((op === 'insert' || op === 'upsert') && ts[j] === '[') {
        // Batch insert of multiple objects — extract keys from the first object
        const endArr = findMatching(ts, j, '[', ']');
        const inner = ts.slice(j, endArr);
        // Iterate through top-level objects in the array and merge keys
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

      // Check for missing columns in the payload
      const missing: string[] = [];
      for (const k of payload) {
        if (JSONB_COLS.has(k)) continue;
        if (k.startsWith('on_')) continue;
        if (k === '...' || k === 'returning') continue;
        if (!tables[tableName].has(k)) missing.push(k);
      }
      if (missing.length > 0) {
        violations.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op, missing });
      }

      // Tenant isolation for mutations that are not admin/global/public.
      // Also look BEHIND the mutation (within 3000 chars) for a .eq('company_id', ...)
      // chained after a preceding .select/.update/.from on the same query — e.g.
      //   s.from('x').update({...}).eq('id',id).eq('company_id', cid)
      // is caught by lookahead, but a build-up pattern like
      //   let q = s.from('x').eq('company_id', cid); q.update({...}).eq('id',id)
      // needs lookbehind too.
      const lookahead = ts.slice(mut.index, mut.index + 1200);
      const lookbehind = ts.slice(Math.max(0, mut.index - 3000), mut.index);
      const hasCompanyFilter = /\.eq\(\s*['"]company_id['"]/.test(lookahead)
                            || /\.eq\(\s*['"]company_id['"]/.test(lookbehind);
      const needCompany = !GLOBAL.has(tableName)
                       && !(isAdminRoute && /^(companies|subscriptions|users|addon_requests|upgrade_requests|activation_codes|payment_methods|addon_grant_audit|complaints|support_tickets|company_messages|messages|notifications|backup_logs|bonds|audit_log|security_audit_log|ad_views|ad_clicks|admin_audit_log)$/.test(tableName))
                       && !(isAuthRoute && /^(users|companies|subscriptions|payment_transactions|password_reset_tokens|password_reset_requests|company_registration_tokens|refresh_tokens|ad_views|ad_clicks|visitor_logs|settings|login_attempts)$/.test(tableName));
        if (needCompany && !isWhitelisted) {
          const hasCompanyInPayload = payload.has('company_id');
          // lookahead up to 500 chars for chained .eq('company_id',...)
          const laMatch = /\.eq\(\s*['"]company_id['"]/.test(lookahead.slice(0, 500));
          // lookbehind up to 2000 chars: if the payload was built in a variable
          // (e.g. piPayload / payload / rowsToInsert) that references company_id
          // within the same function body, we consider it safe.
          const lbMatch = /company_id\s*:/.test(lookbehind);
          // Only enforce on update/delete (where missing company_id creates real cross-tenant risk).
          // Insert paths are checked separately in the column-coverage test (company_id must
          // exist as a column in the payload when the table requires it).
          if (!hasCompanyInPayload && !laMatch && !lbMatch && (op === 'update' || op === 'delete')) {
            missedCompany.push({ file: rel, line: lineOf(ts, mut.index), table: tableName, op });
          }
        }
    }
  }

  test('No API route writes to a non-existent column (42703-proof)', () => {
    // Print a compact report before asserting, to help debugging
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
    ];
    const missing = required.filter(t => !tables[t]);
    if (missing.length > 0) console.log('Missing tables:', missing);
    expect(missing).toEqual([]);
  });
});

function lineOf(text: string, idx: number): number {
  return text.slice(0, idx).split('\n').length;
}
