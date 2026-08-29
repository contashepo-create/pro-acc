import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDriver } from './migration-drivers.mjs';
import {
  encryptTelegramToken,
  decryptTelegramToken,
  selfTestKats,
  KAT,
} from './lib/telegram-token-crypto.mjs';

const migrationsDir = path.resolve('src/migrations');
// MIGRATION_DRIVER=postgres runs this exact suite against a REAL PostgreSQL
// server (genuine pgcrypto, real locking/concurrency) instead of in-process
// PGlite, so "migrations apply cleanly from scratch" is proven on the engine
// the product actually deploys to.
const db = await createDriver();

async function applyMigrations() {
  // Supabase pre-creates these roles.
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
  `);
  if (db.hasPgcrypto) {
    // A real server runs the genuine extension, exactly like Supabase, so the
    // migrations' own CREATE EXTENSION statements are left intact below.
    await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  } else {
    // PGlite does not ship pgcrypto, so the digest shim only lets the rest of
    // the migration compile in this test; a deployed PostgreSQL/Supabase
    // instance still executes CREATE EXTENSION.
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

  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    const tracked = await db.query('SELECT 1 FROM _migrations WHERE filename=$1', [filename]);
    // 000 is the bootstrap script and records historical 001-006 itself.
    if (tracked.rows.length) continue;
    let sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '')
      .trim();
    if (!db.hasPgcrypto) {
      // Only strip the extension when the engine genuinely cannot provide it.
      sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/gim, '').trim();
    }
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
}

async function smokeInitialSetup() {
  const accounts=['1000','1110','1150','1160','1180','1230','1290','2120','2140','3000','3200','4100','5100'].map((code)=>({
    code,name:`Setup ${code}`,name_en:`Setup ${code}`,
    type:code==='4100'?'revenue':code==='5100'?'expense':['2120','2140'].includes(code)?'liability':code.startsWith('3')?'equity':'asset',
    parent_code:null,is_header:false,
  }));
  const created=await db.query(`SELECT setup_initial_company('Bootstrap','','','setup@example.test','Owner','hash',$1::jsonb) result`,[JSON.stringify(accounts)]);
  assert.ok(created.rows[0].result.company.id);
  const setupUser=created.rows[0].result.user.id;
  // 069: every new company is bootstrapped with an open fiscal year.
  assert.equal(Number((await db.query(`SELECT count(*) count FROM fiscal_years WHERE company_id=$1`,[created.rows[0].result.company.id])).rows[0].count),1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM users WHERE email='setup@example.test' AND email_verified=TRUE`)).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT setup_initial_company('Another','','','other@example.test','Owner','hash',$1::jsonb)`,[JSON.stringify(accounts)]));

  const verifyHash='a'.repeat(64);
  await db.query(`UPDATE users SET email_verified=FALSE,email_verification_token=$1,email_verification_expires=NOW()+INTERVAL '1 hour' WHERE id=$2`,[verifyHash,setupUser]);
  const verified=await db.query(`SELECT consume_email_verification_token($1) result`,[verifyHash]);
  assert.equal(verified.rows[0].result.email,'setup@example.test');
  await assert.rejects(()=>db.query(`SELECT consume_email_verification_token($1)`,[verifyHash]));

  const resetHash='b'.repeat(64);
  await db.query(`INSERT INTO password_reset_tokens(user_id,token,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')`,[setupUser,resetHash]);
  await db.query(`SELECT consume_password_reset_token($1,'new-password-hash')`,[resetHash]);
  const resetUser=await db.query(`SELECT password_hash,token_version FROM users WHERE id=$1`,[setupUser]);
  assert.equal(resetUser.rows[0].password_hash,'new-password-hash');
  assert.equal(Number(resetUser.rows[0].token_version),1);
  await assert.rejects(()=>db.query(`SELECT consume_password_reset_token($1,'another-hash')`,[resetHash]));
}

async function smokeAdminOtp() {
  const adminId='90000000-0000-4000-8000-000000000001';
  const sessionId='c'.repeat(64); const codeHash='d'.repeat(64); const now=Date.now();
  const session={sessionId,email:'root@example.test',codeHash,step:'code_sent',codeSent:true,
    otpExpiresAt:now+300000,attempts:0,lastResendAt:now-120000,expiresAt:now+1800000};
  await db.query(`INSERT INTO admin_users(id,email,password_hash,master_password_hash,telegram_chat_id,telegram_bot_token,name,is_active,login_session_data)
    VALUES($1,'root@example.test','x','y','1','token','Root',TRUE,$2::jsonb)`,[adminId,JSON.stringify(session)]);
  const wrong=await db.query(`SELECT verify_admin_login_otp($1,$2,'root@example.test',$3) result`,[adminId,sessionId,'e'.repeat(64)]);
  assert.equal(wrong.rows[0].result.status,'invalid_code');
  const verified=await db.query(`SELECT verify_admin_login_otp($1,$2,'root@example.test',$3) result`,[adminId,sessionId,codeHash]);
  assert.equal(verified.rows[0].result.status,'verified');
  const replay=await db.query(`SELECT verify_admin_login_otp($1,$2,'root@example.test',$3) result`,[adminId,sessionId,codeHash]);
  assert.equal(replay.rows[0].result.status,'invalid_session');

  const resendSession={...session,codeSent:true,lastResendAt:now-120000};
  await db.query(`UPDATE admin_users SET login_session_data=$1::jsonb WHERE id=$2`,[JSON.stringify(resendSession),adminId]);
  const prepared=await db.query(`SELECT prepare_admin_otp_resend($1,$2,'root@example.test',$3,$4,$5) result`,
    [adminId,sessionId,'f'.repeat(64),now,now+300000]);
  assert.equal(prepared.rows[0].result.status,'prepared');
  const cooldown=await db.query(`SELECT prepare_admin_otp_resend($1,$2,'root@example.test',$3,$4,$5) result`,
    [adminId,sessionId,'a'.repeat(64),now+1,now+300001]);
  assert.equal(cooldown.rows[0].result.status,'cooldown');
}

async function smokeTelegramTokenAtRest() {
  // KAT: the script-side implementation must reproduce the pinned vector.
  // The SAME constants are asserted against the application (TS)
  // implementation by src/__tests__/telegram-token-crypto.test.ts, so the
  // two implementations can never drift apart silently.
  assert.ok(selfTestKats(), 'Telegram token KAT self-test failed');

  const TEST_KEY = KAT.key;
  const encAdmin = '90000000-0000-4000-8000-000000000002';
  const plainAdmin = '90000000-0000-4000-8000-000000000003';
  const noBotAdmin = '90000000-0000-4000-8000-000000000004';
  const adminInsert = (id, email, name, token) =>
    db.query(
      `INSERT INTO admin_users(id,email,password_hash,master_password_hash,telegram_chat_id,telegram_bot_token,name,is_active)
       VALUES($1,$2,'x','y','1',$3,$4,TRUE)`,
      [id, email, token, name]
    );

  // 1) The encrypted envelope persists byte-identically and decrypts.
  const envelope = encryptTelegramToken(KAT.token, { key: TEST_KEY });
  assert.ok(envelope.startsWith('enc:v1:'), 'envelope must carry the enc:v1: prefix');
  assert.notEqual(envelope, KAT.envelope, 'IV must be random per write (KAT uses a pinned IV)');
  await adminInsert(encAdmin, 'enc@example.test', 'Enc', envelope);
  const stored = (await db.query(`SELECT telegram_bot_token FROM admin_users WHERE id=$1`, [encAdmin])).rows[0].telegram_bot_token;
  assert.equal(stored, envelope);
  assert.equal(decryptTelegramToken(stored, { key: TEST_KEY }), KAT.token);

  // 2) NULL is a valid state: admin without a dedicated bot → the global
  //    TELEGRAM_BOT_TOKEN env var applies (081 dropped NOT NULL).
  await adminInsert(noBotAdmin, 'nobot@example.test', 'NoBot', null);
  assert.equal(
    (await db.query(`SELECT telegram_bot_token FROM admin_users WHERE id=$1`, [noBotAdmin])).rows[0].telegram_bot_token,
    null
  );

  // 3) Legacy plaintext Telegram-token-shaped values are cleared by the 081
  //    rule. The migration ran before any rows existed in this suite, so the
  //    exact 081 expression is applied here to a seeded row — this pins the
  //    shape the migration clears (and the endpoint input validation must
  //    accept, so new values can never look like legacy plaintext).
  const legacyToken = KAT.token;
  await adminInsert(plainAdmin, 'legacy@example.test', 'Legacy', legacyToken);
  await db.query(`UPDATE admin_users SET telegram_bot_token=NULL
    WHERE telegram_bot_token ~ '^[0-9]{8,10}:A[A-Za-z0-9_-]{30,100}$'`);
  assert.equal(
    (await db.query(`SELECT telegram_bot_token FROM admin_users WHERE id=$1`, [plainAdmin])).rows[0].telegram_bot_token,
    null
  );
  // ...while a non-token-shaped dev placeholder is left untouched, and the
  //    encrypted envelope survives the same sweep.
  assert.equal(
    (await db.query(`SELECT telegram_bot_token FROM admin_users WHERE id=$1`, ['90000000-0000-4000-8000-000000000001'])).rows[0].telegram_bot_token,
    'token'
  );
  assert.equal(
    (await db.query(`SELECT telegram_bot_token FROM admin_users WHERE id=$1`, [encAdmin])).rows[0].telegram_bot_token,
    envelope
  );

  // 4) A tampered envelope (or the wrong key) must fail GCM authentication.
  // envelope = 'enc:v1:<iv>:<tag>:<ct>' → split(':') has 5 parts.
  const [, , ivB64, tagB64, ctB64] = envelope.split(':');
  const flipped = ctB64.slice(0, 2) + (ctB64[2] === 'A' ? 'B' : 'A') + ctB64.slice(3);
  // async wrappers: decryptTelegramToken throws synchronously, and
  // assert.rejects only observes promise rejections.
  await assert.rejects(async () => decryptTelegramToken(`enc:v1:${ivB64}:${tagB64}:${flipped}`, { key: TEST_KEY }));
  await assert.rejects(async () => decryptTelegramToken(envelope, { key: 'ff'.repeat(32) }));
}

async function smokeAdminGlobalConfiguration() {
  const adminId='90000000-0000-4000-8000-000000000001';
  const settings=await db.query(`SELECT admin_upsert_app_settings($1,$2::jsonb) result`,[
    adminId,JSON.stringify({app_name:'Runtime Pro Acc',support_email:'runtime@example.test'}),
  ]);
  assert.equal(Number(settings.rows[0].result.updated),2);
  assert.equal((await db.query(`SELECT value FROM app_settings WHERE key='app_name'`)).rows[0].value,'Runtime Pro Acc');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM admin_audit_log WHERE admin_id=$1 AND action='update_app_settings'`,[adminId])).rows[0].count),1);

  const ad=(await db.query(`SELECT admin_manage_advertisement($1,'create',NULL,$2::jsonb) result`,[
    adminId,JSON.stringify({title:'Runtime ad',body:'Audited body',type:'upgrade',display_mode:'modal',priority:4,is_active:true}),
  ])).rows[0].result;
  assert.equal(ad.type,'upgrade');
  assert.equal(ad.display_mode,'modal');
  await db.query(`SELECT admin_manage_advertisement($1,'update',$2,$3::jsonb)`,[adminId,ad.id,JSON.stringify({is_active:false})]);
  assert.equal((await db.query(`SELECT is_active FROM advertisements WHERE id=$1`,[ad.id])).rows[0].is_active,false);
  await db.query(`SELECT admin_manage_advertisement($1,'delete',$2,'{}'::jsonb)`,[adminId,ad.id]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM advertisements WHERE id=$1`,[ad.id])).rows[0].count),0);

  const method=(await db.query(`SELECT admin_manage_payment_method($1,'create',NULL,$2::jsonb) result`,[
    adminId,JSON.stringify({code:'runtime_pay',name_ar:'دفع اختباري',is_active:true,sort_order:99}),
  ])).rows[0].result;
  const deactivated=(await db.query(`SELECT admin_manage_payment_method($1,'deactivate',$2,'{}'::jsonb) result`,[adminId,method.id])).rows[0].result;
  assert.equal(deactivated.deactivated,true);
  assert.equal((await db.query(`SELECT is_active FROM payment_methods WHERE id=$1`,[method.id])).rows[0].is_active,false);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM payment_methods WHERE id=$1`,[method.id])).rows[0].count),1);

  const inactive='90000000-0000-4000-8000-000000000099';
  await db.query(`INSERT INTO admin_users(id,email,password_hash,master_password_hash,telegram_chat_id,telegram_bot_token,name,is_active)
    VALUES($1,'inactive@example.test','x','y','1','token','Inactive',FALSE)`,[inactive]);
  await assert.rejects(()=>db.query(`SELECT admin_upsert_app_settings($1,'{"app_name":"blocked"}'::jsonb)`,[inactive]));
}

async function seedLedger() {
  const ids = {
    company: '00000000-0000-4000-8000-000000000001',
    user: '00000000-0000-4000-8000-000000000002',
    employee: '00000000-0000-4000-8000-000000000003',
    bank: '00000000-0000-4000-8000-000000000004',
    contact: '00000000-0000-4000-8000-000000000005',
    project: '00000000-0000-4000-8000-000000000006',
  };
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Test')`, [ids.company]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active)
    VALUES($1,$2,'admin@example.test','x','Admin','admin',true)`, [ids.user, ids.company]);
  ids.employee=(await db.query(`SELECT create_employee_atomic($1,'Employee','','',1000,'','','2026-01-01',$2) result`,
    [ids.company,ids.user])).rows[0].result.id;
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Client','both')`,[ids.contact,ids.company]);
  ids.project=(await db.query(`SELECT create_project_atomic($1,'Project',$2,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,
    [ids.company,ids.contact,ids.user])).rows[0].result.id;

  const accounts = [
    ['1000', 'Bank', 'asset', false], ['1110', 'Safes parent', 'asset', false], ['1120', 'Banks parent', 'asset', false],
    ['3000', 'Equity', 'equity', false], ['3100', 'Capital', 'equity', false],
    ['3200', 'Retained earnings', 'equity', false], ['1230',  'Assets', 'asset', true], ['1290', 'Accumulated depreciation', 'asset', true],
    ['1130', 'Receivables', 'asset', false], ['1135', 'Accrued revenue', 'asset', false], ['4100', 'Revenue', 'revenue', false], ['4200', 'Other revenue', 'revenue', false], ['5100', 'Expense', 'expense', false],
    ['5210', 'Salaries', 'expense', false], ['5260', 'Depreciation expense', 'expense', false], ['5400', 'General expense', 'expense', false],
    ['2110', 'Payables', 'liability', false], ['2140', 'Accrued salaries', 'liability', false], ['2145', 'Goods received not invoiced', 'liability', false], ['2150', 'Subcontractor payables', 'liability', false], ['2160', 'Retentions', 'liability', false], ['2180', 'Customer advances', 'liability', false],
    ['1160', 'Advances', 'asset', false], ['1150', 'Custodies', 'asset', false], ['1170', 'Inventory', 'asset', false],
    ['1180', 'VAT input', 'asset', false], ['2120', 'VAT output', 'liability', false],
  ];
  ids.accounts = {};
  for (let index = 0; index < accounts.length; index += 1) {
    const [code, name, type, isHeader] = accounts[index];
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    ids.accounts[code] = id;
    await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header)
      VALUES($1,$2,$3,$4,$5,$6)`, [id, ids.company, code, name, type, isHeader]);
  }
  await db.query(`INSERT INTO banks_safes(id,company_id,name,type,account_id,is_active)
    VALUES($1,$2,'Bank','bank',$3,true)`, [ids.bank, ids.company, ids.accounts['1000']]);
  await db.query(`SELECT create_journal_entry($1,'2026-01-01','opening_balance','Opening',$2,$3::jsonb)`, [
    ids.company, ids.user, JSON.stringify([
      { accountId: ids.accounts['1000'], debit: 10000, credit: 0 },
      { accountId: ids.accounts['3000'], debit: 0, credit: 10000 },
    ]),
  ]);
  return ids;
}

async function smokePostedLedgerReports() {
  const c1='67000000-0000-4000-8000-000000000001';
  const u1='67000000-0000-4000-8000-000000000002';
  const c2='67000000-0000-4000-8000-000000000003';
  const u2='67000000-0000-4000-8000-000000000004';
  const asset='67000000-0000-4000-8000-000000000010';
  const revenue='67000000-0000-4000-8000-000000000011';
  const materials='67000000-0000-4000-8000-000000000012';
  const labor='67000000-0000-4000-8000-000000000013';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Report tenant A'),($2,'Report tenant B')`,[c1,c2]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES
    ($1,$2,'report-a@example.test','x','Report A','admin',TRUE),
    ($3,$4,'report-b@example.test','x','Report B','admin',TRUE)`,[u1,c1,u2,c2]);
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1000','Report cash','asset',FALSE),($3,$2,'4100','Historical revenue','revenue',FALSE),
    ($4,$2,'5100','Materials expense','expense',FALSE),($5,$2,'5200','Labor expense','expense',FALSE)`,
    [asset,c1,revenue,materials,labor]);
  const project1=(await db.query(`SELECT create_project_atomic($1,'Report project A',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c1,u1])).rows[0].result.id;
  const project2=(await db.query(`SELECT create_project_atomic($1,'Report project B',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c2,u2])).rows[0].result.id;

  await db.query(`SELECT create_journal_entry($1,'2026-01-10','general','Posted revenue',$2,$3::jsonb)`,[
    c1,u1,JSON.stringify([{accountId:asset,debit:100,credit:0},{accountId:revenue,debit:0,credit:100}]),
  ]);
  await db.query(`UPDATE accounts SET is_active=FALSE WHERE id=$1`,[revenue]);
  await db.query(`SELECT create_journal_entry($1,'2026-01-12','general','Posted project expense',$2,$3::jsonb)`,[
    c1,u1,JSON.stringify([
      {accountId:materials,debit:25,credit:0,projectId:project1},
      {accountId:asset,debit:0,credit:25,projectId:project1},
    ]),
  ]);
  // Migration 076 makes a line-bearing entry immutable: an unposted entry is
  // created as a draft from the start, never demoted after posting. These
  // raw inserts deliberately use out-of-band numbers AFTER every RPC write
  // below (the RPC numbering is max(number)+1, so a high fixed number placed
  // earlier would steer the sequence into a collision).
  const draft={id:(await db.query(`INSERT INTO journal_entries(company_id,number,date,type,description,status,created_by)
    VALUES($1,999101,'2026-01-11','general','Draft expense','draft',$2) RETURNING id`,[c1,u1])).rows[0].id};
  await db.query(`INSERT INTO journal_lines(company_id,journal_entry_id,account_id,account_code,account_name,debit,credit,project_id)
    VALUES($1,$2,$3,'5100','Materials expense',500,0,$5),($1,$2,$4,'1000','Report cash',0,500,$5)`,
    [c1,draft.id,materials,asset,project1]);
  // Rejection belongs to the approval lifecycle: the source enters the queue
  // as 'pending' (a posted entry is never edited into 'rejected' — 076).
  const rejected={id:(await db.query(`INSERT INTO journal_entries(company_id,number,date,type,description,status,created_by)
    VALUES($1,999102,'2026-01-13','general','Rejected source','pending',$2) RETURNING id`,[c1,u1])).rows[0].id};
  await db.query(`INSERT INTO journal_lines(company_id,journal_entry_id,account_id,account_code,account_name,debit,credit)
    VALUES($1,$2,$3,'5100','Materials expense',7,0),($1,$2,$4,'1000','Report cash',0,7)`,
    [c1,rejected.id,materials,asset]);
  await db.query(`SELECT post_journal_reversal($1,$2,'report_test',$2,'Reject test',$3)`,[c1,rejected.id,u1]);
  await db.query(`UPDATE journal_entries SET status='rejected' WHERE id=$1`,[rejected.id]);

  const summary=(await db.query(`SELECT get_financial_summary($1,NULL,'2026-12-31') result`,[c1])).rows[0].result;
  assert.equal(Number(summary.revenue),100);
  assert.equal(Number(summary.expenses),25);
  const foreignSummary=(await db.query(`SELECT get_financial_summary($1,NULL,'2026-12-31') result`,[c2])).rows[0].result;
  assert.equal(Number(foreignSummary.revenue),0);
  assert.equal(Number(foreignSummary.expenses),0);
  const inactiveRow=(await db.query(`SELECT * FROM get_financial_statement_rows($1,NULL,'2026-12-31') WHERE account_id=$2`,[c1,revenue])).rows[0];
  assert.equal(Number(inactiveRow.cumulative_credit),100);
  const trialRow=(await db.query(`SELECT * FROM get_trial_balance_rows($1,'2026-12-31') WHERE account_id=$2`,[c1,revenue])).rows[0];
  assert.equal(Number(trialRow.credit),100);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM get_general_ledger($1,NULL,NULL,NULL,NULL,NULL,500,0)
    WHERE line_id IN(SELECT id FROM journal_lines WHERE journal_entry_id=$2)`,[c1,draft.id])).rows[0].count),0);

  const budget=(await db.query(`SELECT create_project_budget_atomic($1,$2,'materials','','100','total','Runtime',$3) result`,[c1,project1,u1])).rows[0].result;
  const budgetRows=await db.query(`SELECT * FROM get_project_budget_rows($1,$2)`,[c1,project1]);
  assert.equal(budgetRows.rows.length,1);
  assert.equal(Number(budgetRows.rows[0].actual_spent),25);
  assert.equal((await db.query(`SELECT count(*)::int count FROM get_project_budget_rows($1,$2)`,[c2,project1])).rows[0].count,0);
  await assert.rejects(()=>db.query(`SELECT create_project_budget_atomic($1,$2,'materials','','100','total','Cross',$3)`,[c2,project1,u2]));
  await assert.rejects(()=>db.query(`SELECT create_project_budget_atomic($1,$2,'other','','-1','total','Invalid',$3)`,[c1,project1,u1]));
  await assert.rejects(()=>db.query(`INSERT INTO project_budgets(company_id,project_id,category,amount,created_by) VALUES($1,$2,'other',1,$3)`,[c1,project1,u1]));
  const race=await Promise.allSettled([
    db.query(`SELECT create_project_budget_atomic($1,$2,'labor','','50','total','Race',$3)`,[c1,project1,u1]),
    db.query(`SELECT create_project_budget_atomic($1,$2,'labor','','50','total','Race',$3)`,[c1,project1,u1]),
  ]);
  assert.equal(race.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(race.filter((result)=>result.status==='rejected').length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type='project_budget'`,[c1])).rows[0].count),2);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM project_budgets WHERE id=$1 AND company_id=$2`,[budget.id,c1])).rows[0].count),1);
  assert.ok(project2);
}

async function smokeProjectCostingAllocation() {
  const c='74000000-0000-4000-8000-000000000001';
  const u='74000000-0000-4000-8000-000000000002';
  const c2='74000000-0000-4000-8000-000000000003';
  const u2='74000000-0000-4000-8000-000000000004';
  const asset='74000000-0000-4000-8000-000000000010';
  const mat='74000000-0000-4000-8000-000000000011';
  const labor='74000000-0000-4000-8000-000000000012';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Cost tenant'),($2,'Foreign tenant')`,[c,c2]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES
    ($1,$2,'cost-a@example.test','x','Cost A','admin',TRUE),
    ($3,$4,'cost-b@example.test','x','Cost B','admin',TRUE)`,[u,c,u2,c2]);
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1000','Cost cash','asset',FALSE),($3,$2,'5110','Materials','expense',FALSE),
    ($4,$2,'5120','Direct labor','expense',FALSE)`,[asset,c,mat,labor]);
  const project=(await db.query(`SELECT create_project_atomic($1,'Cost project',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c,u])).rows[0].result.id;
  const foreignProject=(await db.query(`SELECT create_project_atomic($1,'Foreign project',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c2,u2])).rows[0].result.id;

  // Post direct material + direct labour tagged to the project.
  await db.query(`SELECT create_journal_entry($1,'2026-02-01','general','materials',$2,$3::jsonb)`,[
    c,u,JSON.stringify([
      {accountId:mat,debit:200,credit:0,projectId:project},
      {accountId:asset,debit:0,credit:200,projectId:project},
    ]),
  ]);
  await db.query(`SELECT create_journal_entry($1,'2026-02-01','general','labor',$2,$3::jsonb)`,[
    c,u,JSON.stringify([
      {accountId:labor,debit:100,credit:0,projectId:project},
      {accountId:asset,debit:0,credit:100,projectId:project},
    ]),
  ]);

  // Two overhead rules: 10% of direct cost + 20% of direct labor.
  await db.query(`INSERT INTO overhead_allocations(company_id,name,allocation_basis,rate,is_active)
    VALUES($1::uuid,'OH-cost','direct_cost',0.10,TRUE)`,[c]);
  await db.query(`INSERT INTO overhead_allocations(company_id,name,allocation_basis,rate,is_active)
    VALUES($1::uuid,'OH-labor','direct_labor',0.20,TRUE)`,[c]);
  // Foreign tenant rule must be invisible to tenant c.
  await db.query(`INSERT INTO overhead_allocations(company_id,name,allocation_basis,rate,is_active)
    VALUES($1::uuid,'OH-foreign','direct_cost',0.99,TRUE)`,[c2]);

  const row=(await db.query(`SELECT * FROM get_project_costing_overhead($1,ARRAY[$2]::uuid[])`,[c,project])).rows[0];
  assert.equal(Number(row.direct_cost),300);          // 200 materials + 100 labor
  assert.equal(Number(row.direct_labor),100);
  // allocated = 0.10*300 + 0.20*100 = 30 + 20 = 50
  assert.equal(Number(row.allocated_overhead),50);

  const foreignRows=await db.query(`SELECT * FROM get_project_costing_overhead($1,ARRAY[$2]::uuid[])`,[c2,foreignProject]);
  // foreign has no posted costs => no row; and tenant c's rules must not leak.
  assert.equal(foreignRows.rows.length,0);

  // Salary sheet with project allocation on an item.
  const employeeId=(await db.query(`SELECT create_employee_atomic($1,'Cost worker','','',500,'','','2026-01-01',$2) result`,[
    c,u,
  ])).rows[0].result.id;
  const sheet=(await db.query(`SELECT create_salary_sheet($1,'Cost payroll',2,2026,'2026-02-15',$2::jsonb) result`,[
    c,JSON.stringify([{employee_id:employeeId,basic_salary:500,allowances:0,deductions:0,project_id:project}]),
  ])).rows[0].result;
  const savedItem=await db.query(`SELECT project_id FROM salary_items WHERE sheet_id=$1 AND company_id=$2`,[sheet.id,c]);
  assert.equal(savedItem.rows[0].project_id,project);

  // Reject a foreign project on a salary item.
  await assert.rejects(()=>db.query(`SELECT create_salary_sheet($1,'Foreign payroll',2,2026,'2026-02-15',$2::jsonb)`,[
    c,JSON.stringify([{employee_id:employeeId,basic_salary:100,allowances:0,deductions:0,project_id:foreignProject}]),
  ]));

  // Salary items reference a project that belongs to another tenant must be
  // rejected by the guard trigger too.
  await assert.rejects(()=>db.query(
    `INSERT INTO salary_items(company_id,sheet_id,employee_id,basic_salary,allowances,deductions,net_pay,project_id)
     VALUES($1,$2,$3,1,0,0,1,$4)`,[c,sheet.id,employeeId,foreignProject]));

  // Clean up the salary sheet so a later global count assertion stays at zero.
  await db.query(`SELECT delete_draft_salary_sheet($1,$2)`,[c,sheet.id]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM salary_items WHERE company_id=$1`,[c])).rows[0].count),0);
}



async function smokeAdminEntitlements(ids) {
  const adminId='90000000-0000-4000-8000-000000000001';
  const inactiveAdmin='90000000-0000-4000-8000-000000000099';
  const plan=(await db.query(`SELECT admin_manage_subscription_plan($1,'create',NULL,$2::jsonb) result`,[
    adminId,JSON.stringify({
      code:'runtime_secure',name:'Runtime secure',currency:'USD',price_monthly:25.50,
      price_yearly:250,yearly_discount_percent:20,trial_days:7,max_users:5,
      max_clients:null,max_suppliers:null,max_employees:null,max_projects:20,
      max_invoices_per_month:100,max_quotations_per_month:50,max_storage_mb:1000,
      features:['accounts','invoices'],features_modules:{accounts:true,invoices:true},is_active:true,sort_order:91,
    }),
  ])).rows[0].result;
  assert.equal(plan.code,'runtime_secure');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM admin_audit_log WHERE action='create_subscription_plan' AND target_id=$1`,[plan.id])).rows[0].count),1);

  await assert.rejects(()=>db.query(`SELECT admin_manage_subscription_plan($1,'create',NULL,$2::jsonb)`,[
    adminId,JSON.stringify({code:'invalid_integer',name:'Invalid integer',max_users:1.5}),
  ]));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM subscription_plans WHERE code='invalid_integer'`)).rows[0].count),0);
  await assert.rejects(()=>db.query(`SELECT admin_manage_subscription_plan($1,'update',$2,$3::jsonb)`,[
    inactiveAdmin,plan.id,JSON.stringify({name:'Blocked'}),
  ]));
  assert.equal((await db.query(`SELECT name FROM subscription_plans WHERE id=$1`,[plan.id])).rows[0].name,'Runtime secure');

  const subscription=(await db.query(`INSERT INTO subscriptions(company_id,plan_id,plan_code,status,start_date,end_date)
    VALUES($1,$2,'runtime_secure','active',CURRENT_DATE,CURRENT_DATE+30) RETURNING id`,[ids.company,plan.id])).rows[0].id;
  await assert.rejects(()=>db.query(`SELECT admin_manage_subscription_plan($1,'update',$2,$3::jsonb)`,[
    adminId,plan.id,JSON.stringify({code:'changed_after_use'}),
  ]));
  assert.equal((await db.query(`SELECT code FROM subscription_plans WHERE id=$1`,[plan.id])).rows[0].code,'runtime_secure');

  const companyUpdated=(await db.query(`SELECT admin_update_company_profile($1,$2,$3::jsonb) result`,[
    adminId,ids.company,JSON.stringify({name:'Updated tenant',email:'owner@example.test',vat_rate:0.14}),
  ])).rows[0].result;
  assert.equal(companyUpdated.name,'Updated tenant');
  await assert.rejects(()=>db.query(`SELECT admin_update_company_profile($1,$2,$3::jsonb)`,[
    inactiveAdmin,ids.company,JSON.stringify({name:'Blocked tenant'}),
  ]));
  assert.equal((await db.query(`SELECT name FROM companies WHERE id=$1`,[ids.company])).rows[0].name,'Updated tenant');

  const complaintId=(await db.query(`SELECT create_complaint_atomic($1,$2,'complaint','Runtime complaint','Runtime body') result`,[
    ids.company,ids.user,
  ])).rows[0].result.id;
  const complaint=(await db.query(`SELECT admin_update_complaint($1,$2,'replied','Reviewed',TRUE) result`,[
    adminId,complaintId,
  ])).rows[0].result;
  assert.equal(complaint.status,'replied');
  assert.equal((await db.query(`SELECT admin_reply FROM complaints WHERE id=$1`,[complaintId])).rows[0].admin_reply,'Reviewed');

  const sent=(await db.query(`SELECT admin_send_company_message($1,$2,'Runtime subject','Runtime body') result`,[
    adminId,ids.company,
  ])).rows[0].result;
  assert.ok(sent.id);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM admin_audit_log WHERE action='send_company_message' AND target_id=$1`,[ids.company])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT admin_send_company_message($1,'93000000-0000-4000-8000-000000000099','No tenant','Blocked')`,[adminId]));

  const paymentMethod=(await db.query(`SELECT code FROM payment_methods WHERE is_active=TRUE ORDER BY sort_order LIMIT 1`)).rows[0].code;
  const supportTicket=(await db.query(`SELECT create_support_ticket_atomic($1,$2,'Atomic support','Atomic support message','technical',NULL) result`,[
    ids.company,ids.user,
  ])).rows[0].result;
  assert.equal(supportTicket.status,'open');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_type='support_ticket' AND entity_id=$1`,[supportTicket.id])).rows[0].count),1);

  // 115: receipt images are rejected — proof goes via Telegram; the request
  // carries only the transfer metadata (p_receipt_image_url must be NULL).
  await assert.rejects(()=>db.query(`SELECT create_addon_request_atomic($1,$2,'storage_gb',2,'monthly',$3,CURRENT_DATE,'12:30',$4,'paid')`,[
    ids.company,ids.user,paymentMethod,`${ids.company}/receipts/addon.png`,
  ]));
  const addonCreated=(await db.query(`SELECT create_addon_request_atomic($1,$2,'storage_gb',2,'monthly',$3,CURRENT_DATE,'12:30',NULL,'paid') result`,[
    ids.company,ids.user,paymentMethod,
  ])).rows[0].result;
  assert.equal(Number(addonCreated.total_amount_usd),6);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND type='addon_request'`,[ids.company])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT create_addon_request_atomic($1,$2,'storage_gb',2,'monthly',$3,CURRENT_DATE,'12:30',NULL,'duplicate')`,[
    ids.company,ids.user,paymentMethod,
  ]));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND type='addon_request'`,[ids.company])).rows[0].count),1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_type='addon_request' AND company_id=$1`,[ids.company])).rows[0].count),1);

  const upgradeCreated=(await db.query(`SELECT create_upgrade_request_atomic($1,$2,$3,'monthly',$4,25.50,CURRENT_DATE,'13:00',NULL,'paid') result`,[
    ids.company,ids.user,plan.id,paymentMethod,
  ])).rows[0].result;
  assert.equal(upgradeCreated.plan_code,'runtime_secure');
  await db.query(`UPDATE upgrade_requests SET status='rejected' WHERE id=$1`,[upgradeCreated.id]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND user_id=$2 AND type='upgrade'`,[ids.company,ids.user])).rows[0].count),2);

  const addonId='93000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO addon_requests(id,company_id,user_id,addon_type,quantity,duration_type,unit_price_usd,total_amount_usd,status)
    VALUES($1,$2,$3,'extra_user',1,'monthly',10,10,'pending')`,[addonId,ids.company,ids.user]);
  await db.query(`UPDATE addon_requests SET status='rejected' WHERE id=$1`,[addonId]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND user_id=$2 AND type='addon_update'`,[ids.company,ids.user])).rows[0].count),1);

  const otherCompany='93000000-0000-4000-8000-000000000010';
  const otherUser='93000000-0000-4000-8000-000000000011';
  const mismatchedAddon='93000000-0000-4000-8000-000000000012';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Other notification tenant')`,[otherCompany]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active)
    VALUES($1,$2,'other-notify@example.test','x','Other user','admin',TRUE)`,[otherUser,otherCompany]);
  await assert.rejects(()=>db.query(`SELECT create_support_ticket_atomic($1,$2,'Cross tenant','Cross tenant message','technical',NULL)`,[
    ids.company,otherUser,
  ]));
  await assert.rejects(()=>db.query(`SELECT create_upgrade_request_atomic($1,$2,$3,'monthly',$4,25.50,CURRENT_DATE,NULL,NULL,NULL)`,[
    ids.company,otherUser,plan.id,paymentMethod,
  ]));
  await db.query(`INSERT INTO addon_requests(id,company_id,user_id,addon_type,quantity,duration_type,unit_price_usd,total_amount_usd,status)
    VALUES($1,$2,$3,'extra_user',1,'monthly',10,10,'pending')`,[mismatchedAddon,ids.company,otherUser]);
  await assert.rejects(()=>db.query(`UPDATE addon_requests SET status='approved' WHERE id=$1`,[mismatchedAddon]));
  assert.equal((await db.query(`SELECT status FROM addon_requests WHERE id=$1`,[mismatchedAddon])).rows[0].status,'pending');

  await db.query(`SELECT restrict_subscription_atomic($1,$2,'cancelled',NULL,NULL,NULL,NULL,'runtime cancellation')`,[
    subscription,adminId,
  ]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM notifications WHERE company_id=$1 AND type='warning' AND title='تم إلغاء اشتراكك'`,[ids.company])).rows[0].count),1);
}

async function smokeAdminSupport(ids) {
  const adminId='90000000-0000-4000-8000-000000000001';
  const ticketId='91000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO support_tickets(id,company_id,user_id,subject,message,category,status)
    VALUES($1,$2,$3,'Runtime support','A runtime support message','technical','open')`,[ticketId,ids.company,ids.user]);
  const updated=(await db.query(`SELECT admin_update_support_ticket($1,$2,'resolved','Completed',TRUE) result`,[adminId,ticketId])).rows[0].result;
  assert.equal(updated.status,'resolved');
  assert.equal((await db.query(`SELECT status FROM support_tickets WHERE id=$1`,[ticketId])).rows[0].status,'resolved');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND type='support'`,[ids.company])).rows[0].count),2);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM admin_audit_log WHERE admin_id=$1 AND target_id=$2`,[adminId,ticketId])).rows[0].count),1);
}

async function smokePurchasingAndInventory(ids) {
  const { company: c, user: u, contact: supplier } = ids;
  const c2='93000000-0000-4000-8000-000000000010';
  const u2='93000000-0000-4000-8000-000000000011';

  const warehouse1=(await db.query(`SELECT create_warehouse_atomic($1,'Runtime main warehouse','Cairo',$2) result`,[c,u])).rows[0].result;
  const warehouse2=(await db.query(`SELECT create_warehouse_atomic($1,'Runtime branch warehouse','Giza',$2) result`,[c,u])).rows[0].result;
  const foreignWarehouse='95000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO warehouses(id,company_id,name,location,is_active) VALUES($1,$2,'Foreign warehouse','Other',TRUE)`,[foreignWarehouse,c2]);

  const item=(await db.query(`SELECT create_inventory_item_atomic($1,'RUNTIME-STEEL','Runtime steel','kg',$2,'materials',$3) result`,[
    c,warehouse1.id,u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT create_inventory_item_atomic($1,'CROSS','Cross tenant','unit',$2,'',$3)`,[
    c,foreignWarehouse,u,
  ]));
  await assert.rejects(()=>db.query(`INSERT INTO inventory_items(company_id,code,name,unit,warehouse_id,quantity,unit_price)
    VALUES($1,'DIRECT-CROSS','Direct cross','unit',$2,0,0)`,[c,foreignWarehouse]));

  const addOne=(await db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'add',10,100,'2026-03-01','opening',NULL,$4) result`,[
    c,item.id,warehouse1.id,u,
  ])).rows[0].result;
  const addTwo=(await db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'add',10,200,'2026-03-02','weighted',NULL,$4) result`,[
    c,item.id,warehouse1.id,u,
  ])).rows[0].result;
  let stock=(await db.query(`SELECT quantity,unit_price FROM inventory_items WHERE id=$1 AND company_id=$2`,[item.id,c])).rows[0];
  assert.equal(Number(stock.quantity),20);
  assert.equal(Number(stock.unit_price),150);
  assert.equal(Number(addOne.transaction.balance_before),0);
  assert.equal(Number(addTwo.transaction.balance_after),20);
  for (const journalId of [addOne.journal_entry_id,addTwo.journal_entry_id]) {
    const totals=(await db.query(`SELECT COALESCE(sum(debit),0) debit,COALESCE(sum(credit),0) credit
      FROM journal_lines WHERE journal_entry_id=$1 AND company_id=$2`,[journalId,c])).rows[0];
    assert.equal(Number(totals.debit),Number(totals.credit));
  }

  const issueRace=await Promise.allSettled([1,2].map((n)=>db.query(
    `SELECT post_inventory_movement_atomic($1,$2,$3,'issue',12,NULL,'2026-03-03',$4,NULL,$5) result`,
    [c,item.id,warehouse1.id,`concurrent issue ${n}`,u],
  )));
  assert.equal(issueRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(issueRace.filter((result)=>result.status==='rejected').length,1);
  stock=(await db.query(`SELECT quantity,unit_price FROM inventory_items WHERE id=$1`,[item.id])).rows[0];
  assert.equal(Number(stock.quantity),8);
  assert.equal(Number(stock.unit_price),150);

  const journalCountBeforeTransfer=Number((await db.query(`SELECT count(*) count FROM journal_entries
    WHERE company_id=$1 AND reference_type='inventory_movement'`,[c])).rows[0].count);
  const transfer=(await db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'transfer',3,NULL,'2026-03-04','branch transfer',$4,$5) result`,[
    c,item.id,warehouse1.id,warehouse2.id,u,
  ])).rows[0].result;
  assert.equal(Number(transfer.source_quantity),5);
  assert.equal(Number(transfer.target_quantity),3);
  assert.equal(transfer.journal_entry_id,null);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries
    WHERE company_id=$1 AND reference_type='inventory_movement'`,[c])).rows[0].count),journalCountBeforeTransfer);
  assert.equal(Number((await db.query(`SELECT quantity FROM inventory_items WHERE company_id=$1 AND warehouse_id=$2 AND code='RUNTIME-STEEL'`,[
    c,warehouse2.id,
  ])).rows[0].quantity),3);

  // Project allocation: issuing material to an active project must tag the
  // cost journal line (5100) and the transaction with project_id, so direct
  // material costs flow into project profitability / WIP reports.
  const invProject=(await db.query(`SELECT create_project_atomic($1,'Stock project',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c,u])).rows[0].result.id;
  const foreignInvProject=(await db.query(`SELECT create_project_atomic($1,'Foreign stock project',NULL,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$2) result`,[c2,u2])).rows[0].result.id;
  // Re-add stock to source warehouse to have quantity to issue.
  await db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'add',6,100,'2026-03-06','restock',NULL,$4)`,[
    c,item.id,warehouse1.id,u,
  ]);
  const issueToProject=(await db.query(
    `SELECT post_inventory_movement_atomic($1,$2,$3,'issue',4,NULL,'2026-03-06','materials for project',NULL,$4,$5) result`,
    [c,item.id,warehouse1.id,u,invProject],
  )).rows[0].result;
  assert.equal(issueToProject.transaction.project_id,invProject);
  const costLine=(await db.query(
    `SELECT jl.project_id FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id
      WHERE jl.journal_entry_id=$1 AND a.code='5100' AND jl.company_id=$2`,
    [issueToProject.journal_entry_id,c],
  )).rows[0];
  assert.equal(costLine.project_id,invProject);

  // project_id is only valid for issue/return and for an active tenant project.
  await assert.rejects(()=>db.query(
    `SELECT post_inventory_movement_atomic($1,$2,$3,'add',1,1,'2026-03-06','wrong kind',NULL,$4,$5) result`,
    [c,item.id,warehouse1.id,u,invProject],
  ));
  await assert.rejects(()=>db.query(
    `SELECT post_inventory_movement_atomic($1,$2,$3,'issue',1,NULL,'2026-03-06','foreign project',NULL,$4,$5) result`,
    [c,item.id,warehouse1.id,u,foreignInvProject],
  ));

  await assert.rejects(()=>db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'add',1,1,'2026-03-05','cross tenant',NULL,$4)`,[
    c2,item.id,foreignWarehouse,u2,
  ]));
  await assert.rejects(()=>db.query(`SELECT update_inventory_item_atomic($1,$2,'{"name":"cross"}'::jsonb,$3)`,[c2,item.id,u2]));
  await assert.rejects(()=>db.query(`SELECT update_inventory_transaction_note_atomic($1,$2,'cross',$3)`,[
    c2,addOne.transaction.id,u2,
  ]));
  await assert.rejects(()=>db.query(`INSERT INTO inventory_transactions(
    company_id,item_id,warehouse_id,type,quantity,unit_price,total_value,date,created_by
  ) VALUES($1,$2,$3,'add',1,1,1,'2026-03-05',$4)`,[c2,item.id,foreignWarehouse,u2]));

  // Failure after entering the function leaves no stock, journal, transaction,
  // or audit residue for an isolated tenant whose ledger is incomplete.
  const rollbackCompany='95000000-0000-4000-8000-000000000010';
  const rollbackUser='95000000-0000-4000-8000-000000000011';
  const rollbackWarehouse='95000000-0000-4000-8000-000000000012';
  const rollbackItem='95000000-0000-4000-8000-000000000013';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Inventory rollback tenant')`,[rollbackCompany]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active)
    VALUES($1,$2,'inventory-rollback@example.test','x','Rollback user','admin',TRUE)`,[rollbackUser,rollbackCompany]);
  await db.query(`INSERT INTO warehouses(id,company_id,name,is_active) VALUES($1,$2,'Rollback warehouse',TRUE)`,[
    rollbackWarehouse,rollbackCompany,
  ]);
  await db.query(`INSERT INTO inventory_items(id,company_id,code,name,unit,warehouse_id,quantity,unit_price,is_active)
    VALUES($1,$2,'ROLLBACK','Rollback item','unit',$3,0,0,TRUE)`,[rollbackItem,rollbackCompany,rollbackWarehouse]);
  await assert.rejects(()=>db.query(`SELECT post_inventory_movement_atomic($1,$2,$3,'add',5,10,'2026-03-01','must roll back',NULL,$4)`,[
    rollbackCompany,rollbackItem,rollbackWarehouse,rollbackUser,
  ]));
  assert.equal(Number((await db.query(`SELECT quantity FROM inventory_items WHERE id=$1`,[rollbackItem])).rows[0].quantity),0);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM inventory_transactions WHERE company_id=$1`,[rollbackCompany])).rows[0].count),0);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1`,[rollbackCompany])).rows[0].count),0);

  const order=(await db.query(`SELECT create_purchase_order_atomic($1,$2,'2026-03-05',$3::jsonb,'partial lifecycle',$4) result`,[
    c,supplier,JSON.stringify([
      {description:'PO-RUNTIME-STEEL',quantity:4,unit_price:25},
      {description:'PO-RUNTIME-CEMENT',quantity:2,unit_price:50},
    ]),u,
  ])).rows[0].result;
  assert.equal(Number(order.total),200);
  const orderLines=(await db.query(`SELECT id,description,quantity,received_quantity FROM purchase_order_items
    WHERE company_id=$1 AND purchase_order_id=$2 ORDER BY id`,[c,order.id])).rows;
  const firstLine=orderLines[0];
  const firstPartial=Math.min(1,Number(firstLine.quantity));
  const partial=(await db.query(`SELECT receive_purchase_order_atomic($1,$2,$3::jsonb,'2026-03-06',$4) result`,[
    c,order.id,JSON.stringify({[firstLine.id]:firstPartial}),u,
  ])).rows[0].result;
  assert.equal(partial.status,'partial');

  // First line mutates before the oversized second line is reached; the thrown
  // statement must roll the earlier stock and receipt updates back as well.
  const beforeRollback=(await db.query(`SELECT id,quantity,received_quantity FROM purchase_order_items
    WHERE purchase_order_id=$1 ORDER BY id`,[order.id])).rows;
  const rollbackQuantities={
    [beforeRollback[0].id]:Number(beforeRollback[0].quantity)-Number(beforeRollback[0].received_quantity),
    [beforeRollback[1].id]:Number(beforeRollback[1].quantity)+1,
  };
  const transactionCountBefore=Number((await db.query(`SELECT count(*) count FROM inventory_transactions
    WHERE company_id=$1 AND reference_type='purchase_order' AND reference_id=$2`,[c,order.id])).rows[0].count);
  await assert.rejects(()=>db.query(`SELECT receive_purchase_order_atomic($1,$2,$3::jsonb,'2026-03-07',$4)`,[
    c,order.id,JSON.stringify(rollbackQuantities),u,
  ]));
  const afterRollback=(await db.query(`SELECT id,received_quantity FROM purchase_order_items
    WHERE purchase_order_id=$1 ORDER BY id`,[order.id])).rows;
  assert.deepEqual(afterRollback.map((line)=>Number(line.received_quantity)),beforeRollback.map((line)=>Number(line.received_quantity)));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM inventory_transactions
    WHERE company_id=$1 AND reference_type='purchase_order' AND reference_id=$2`,[c,order.id])).rows[0].count),transactionCountBefore);

  const fullyReceived=(await db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-03-08',$3) result`,[
    c,order.id,u,
  ])).rows[0].result;
  assert.equal(fullyReceived.status,'received');
  const receiptLedger=(await db.query(`SELECT a.code,COALESCE(sum(l.debit),0) debit,COALESCE(sum(l.credit),0) credit
    FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
    JOIN accounts a ON a.id=l.account_id
    WHERE j.company_id=$1 AND j.reference_type='purchase_order_receipt' AND j.reference_id=$2
    GROUP BY a.code`,[c,order.id])).rows;
  assert.equal(receiptLedger.filter((line)=>line.code==='1170').reduce((sum,line)=>sum+Number(line.debit),0),200);
  assert.equal(receiptLedger.filter((line)=>line.code==='2145').reduce((sum,line)=>sum+Number(line.credit),0),200);

  const concurrentOrder=(await db.query(`SELECT create_purchase_order_atomic($1,$2,'2026-03-05',$3::jsonb,'concurrent receipt',$4) result`,[
    c,supplier,JSON.stringify([{description:'PO-CONCURRENT',quantity:5,unit_price:30}]),u,
  ])).rows[0].result;
  const receiptRace=await Promise.all([
    db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-03-08',$3) result`,[c,concurrentOrder.id,u]),
    db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-03-08',$3) result`,[c,concurrentOrder.id,u]),
  ]);
  assert.equal(receiptRace.filter((result)=>result.rows[0].result.already_processed===true).length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM inventory_transactions
    WHERE company_id=$1 AND reference_type='purchase_order' AND reference_id=$2`,[c,concurrentOrder.id])).rows[0].count),1);

  const invoiceItems=JSON.stringify([
    {description:'PO-RUNTIME-STEEL',quantity:4,unit_price:25},
    {description:'PO-RUNTIME-CEMENT',quantity:2,unit_price:50},
  ]);
  const invoice=(await db.query(`SELECT create_purchase_invoice_atomic($1,$2,$3,NULL,NULL,FALSE,'2026-03-08',$4::jsonb,0,'linked invoice',$5) result`,[
    c,supplier,order.id,invoiceItems,u,
  ])).rows[0].result;
  assert.equal(Number(invoice.total),200);
  assert.equal(Number(invoice.paid_amount),0);
  const invoiceLedger=(await db.query(`SELECT a.code,l.debit,l.credit FROM journal_lines l
    JOIN accounts a ON a.id=l.account_id WHERE l.company_id=$1 AND l.journal_entry_id=$2`,[c,invoice.journal_entry_id])).rows;
  assert.equal(invoiceLedger.filter((line)=>line.code==='2145').reduce((sum,line)=>sum+Number(line.debit),0),200);
  assert.equal(invoiceLedger.filter((line)=>line.code==='2110').reduce((sum,line)=>sum+Number(line.credit),0),200);
  await assert.rejects(()=>db.query(`SELECT create_purchase_invoice_atomic($1,$2,$3,NULL,NULL,FALSE,'2026-03-08',$4::jsonb,0,'duplicate',$5)`,[
    c,supplier,order.id,invoiceItems,u,
  ]));
  await assert.rejects(()=>db.query(`INSERT INTO purchase_order_items(
    company_id,purchase_order_id,description,quantity,received_quantity,unit_price,total
  ) VALUES($1,$2,'cross tenant line',1,0,1,1)`,[c2,order.id]));
  await assert.rejects(()=>db.query(`INSERT INTO purchase_invoice_items(
    company_id,purchase_invoice_id,description,quantity,unit_price,total
  ) VALUES($1,$2,'cross tenant line',1,1,1)`,[c2,invoice.id]));

  const concurrentInvoiceItems=JSON.stringify([{description:'PO-CONCURRENT',quantity:5,unit_price:30}]);
  const invoiceRace=await Promise.allSettled([1,2].map((n)=>db.query(
    `SELECT create_purchase_invoice_atomic($1,$2,$3,NULL,NULL,FALSE,'2026-03-08',$4::jsonb,0,$5,$6) result`,
    [c,supplier,concurrentOrder.id,concurrentInvoiceItems,`invoice race ${n}`,u],
  )));
  assert.equal(invoiceRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(invoiceRace.filter((result)=>result.status==='rejected').length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM purchase_invoices
    WHERE company_id=$1 AND purchase_order_id=$2 AND status<>'cancelled'`,[c,concurrentOrder.id])).rows[0].count),1);

  await assert.rejects(()=>db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-03-08',$3)`,[c2,order.id,u2]));
  await assert.rejects(()=>db.query(`SELECT create_purchase_invoice_atomic($1,$2,$3,NULL,NULL,FALSE,'2026-03-08',$4::jsonb,0,'cross tenant',$5)`,[
    c2,supplier,order.id,invoiceItems,u2,
  ]));
  await assert.rejects(()=>db.query(`UPDATE purchase_orders SET company_id=$1 WHERE id=$2`,[c2,order.id]));
  assert.equal((await db.query(`SELECT company_id FROM purchase_orders WHERE id=$1`,[order.id])).rows[0].company_id,c);

  assert.ok(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1
    AND entity_type IN('warehouse','inventory_item','inventory_transaction','purchase_order','purchase_invoice')`,[c])).rows[0].count)>=10);
}

/**
 * Real critical path (CPM), migration 062.
 *
 * Network:  A(3d) → B(2d) → D(4d)
 *           A(3d) → C(1d) → D(4d)
 * Critical path is A→B→D (9 days); C carries 1 day of float. The previous
 * heuristic would have marked every unstarted task critical, including C.
 */
async function smokeCriticalPath() {
  const c='77000000-0000-4000-8000-000000000001';
  const u='77000000-0000-4000-8000-000000000002';
  const contact='77000000-0000-4000-8000-000000000003';
  const c2='77000000-0000-4000-8000-000000000004';
  const u2='77000000-0000-4000-8000-000000000005';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'CPM tenant A'),($2,'CPM tenant B')`,[c,c2]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES
    ($1,$2,'cpm-a@example.test','x','CPM A','admin',TRUE),
    ($3,$4,'cpm-b@example.test','x','CPM B','admin',TRUE)`,[u,c,u2,c2]);
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'CPM client','both')`,[contact,c]);
  const project=(await db.query(`SELECT create_project_atomic($1,'CPM project',$2,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,
    [c,contact,u])).rows[0].result.id;

  const makeTask=async(name,start,end)=>(await db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3) result`,
    [c,JSON.stringify({project_id:project,name,start_date:start,end_date:end}),u])).rows[0].result.id;
  const taskA=await makeTask('A','2026-01-01','2026-01-03');
  const taskB=await makeTask('B','2026-01-04','2026-01-05');
  const taskC=await makeTask('C','2026-01-04','2026-01-04');
  const taskD=await makeTask('D','2026-01-06','2026-01-09');
  const link=(successor,predecessor,lag=0)=>db.query(
    `SELECT create_task_dependency_atomic($1,$2,$3,$4,$5)`,[c,successor,predecessor,lag,u]);
  await link(taskB,taskA); await link(taskC,taskA); await link(taskD,taskB); await link(taskD,taskC);

  const cpm=(await db.query(`SELECT get_project_critical_path($1,$2) result`,[c,project])).rows[0].result;
  const byId=Object.fromEntries(cpm.tasks.map((task)=>[task.id,task]));
  assert.equal(Number(cpm.projectDuration),9);
  assert.equal(byId[taskA].isCritical,true);
  assert.equal(byId[taskB].isCritical,true);
  assert.equal(byId[taskD].isCritical,true);
  // The whole point of a real CPM: a task with slack is NOT critical.
  assert.equal(byId[taskC].isCritical,false);
  assert.equal(Number(byId[taskC].totalFloat),1);
  assert.equal(Number(byId[taskA].earliestStart),0);
  assert.equal(Number(byId[taskD].earliestFinish),9);
  assert.deepEqual(cpm.criticalPath,[taskA,taskB,taskD]);

  // Lag pushes the successor out and lengthens the schedule.
  const taskE=await makeTask('E','2026-01-10','2026-01-11');
  await link(taskE,taskD,3);
  const lagged=(await db.query(`SELECT get_project_critical_path($1,$2) result`,[c,project])).rows[0].result;
  assert.equal(Number(lagged.projectDuration),14);

  // Cycles must be rejected: they make CPM meaningless and non-terminating.
  await assert.rejects(()=>link(taskA,taskE));
  // Self-links, cross-project links and cross-tenant actors are rejected.
  await assert.rejects(()=>link(taskA,taskA));
  await assert.rejects(()=>db.query(`SELECT create_task_dependency_atomic($1,$2,$3,0,$4)`,[c,taskB,taskA,u2]));
  await assert.rejects(()=>db.query(`SELECT create_task_dependency_atomic($1,$2,$3,0,$4)`,[c2,taskB,taskA,u2]));
  // Direct writes bypass the cycle/tenant checks, so the guard must block them.
  await assert.rejects(()=>db.query(
    `INSERT INTO project_task_dependencies(company_id,project_id,successor_task_id,predecessor_task_id)
     VALUES($1,$2,$3,$4)`,[c,project,taskC,taskB]));
  // Another tenant cannot read this project's schedule.
  const foreign=(await db.query(`SELECT get_project_critical_path($1,$2) result`,[c2,project])).rows[0].result;
  assert.deepEqual(foreign.criticalPath,[]);
  assert.deepEqual(foreign.tasks,[]);

  // Removing the edge returns the successor to an independent schedule.
  const edge=(await db.query(
    `SELECT id FROM project_task_dependencies WHERE company_id=$1 AND successor_task_id=$2 AND predecessor_task_id=$3`,
    [c,taskC,taskA])).rows[0].id;
  await assert.rejects(()=>db.query(`SELECT delete_task_dependency_atomic($1,$2,$3)`,[c2,edge,u2]));
  await db.query(`SELECT delete_task_dependency_atomic($1,$2,$3)`,[c,edge,u]);
  assert.equal(Number((await db.query(
    `SELECT count(*) count FROM project_task_dependencies WHERE id=$1`,[edge])).rows[0].count),0);
  assert.equal(Number((await db.query(
    `SELECT count(*) count FROM audit_log WHERE entity_type='project_task_dependency' AND company_id=$1`,
    [c])).rows[0].count),6);
}

/**
 * TRUE concurrency, only meaningful on a real PostgreSQL server.
 *
 * PGlite multiplexes one in-process connection, so every "race" test that runs
 * there is actually sequential and proves nothing about locking. These cases
 * open independent connections and hit the same rows simultaneously, which is
 * the only way advisory locks, FOR UPDATE and unique constraints are really
 * exercised.
 */
async function smokeRealConcurrency() {
  if (!db.supportsRealConcurrency) return;

  const c='78000000-0000-4000-8000-000000000001';
  const u='78000000-0000-4000-8000-000000000002';
  const contact='78000000-0000-4000-8000-000000000003';
  const c2='78000000-0000-4000-8000-000000000004';
  const u2='78000000-0000-4000-8000-000000000005';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Race tenant A'),($2,'Race tenant B')`,[c,c2]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES
    ($1,$2,'race-a@example.test','x','Race A','admin',TRUE),
    ($3,$4,'race-b@example.test','x','Race B','admin',TRUE)`,[u,c,u2,c2]);
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Race client','both')`,[contact,c]);
  const project=(await db.query(`SELECT create_project_atomic($1,'Race project',$2,1000,'2026-01-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,
    [c,contact,u])).rows[0].result.id;

  // Two concurrent budgets for the SAME project+category must not both win, or
  // the same actual cost would be counted against two budgets and variance
  // reporting would silently lie.
  const budgetAttempts=await Promise.allSettled([0,1].map(()=>db.withConnection((conn)=>
    conn.query(`SELECT create_project_budget_atomic($1,$2,'materials',NULL,1000,'total',NULL,$3)`,[c,project,u]))));
  assert.equal(budgetAttempts.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(Number((await db.query(
    `SELECT count(*) count FROM project_budgets WHERE company_id=$1 AND project_id=$2 AND category='materials'`,
    [c,project])).rows[0].count),1);

  // Concurrent journal numbering must never hand out a duplicate number:
  // duplicated journal numbers break the audit trail and statutory numbering.
  const numbers=await Promise.all(Array.from({length:8},()=>db.withConnection(async(conn)=>
    Number((await conn.query(`SELECT next_journal_number($1,2026) n`,[c])).rows[0].n))));
  assert.equal(new Set(numbers).size,numbers.length);

  // Concurrent invoice numbering, same guarantee.
  const invoiceNumbers=await Promise.all(Array.from({length:8},()=>db.withConnection(async(conn)=>
    Number((await conn.query(`SELECT next_invoice_number($1,2026) n`,[c])).rows[0].n))));
  assert.equal(new Set(invoiceNumbers).size,invoiceNumbers.length);

  // Numbering must be isolated per tenant: tenant B starts its own series and
  // cannot consume or observe tenant A's sequence.
  const foreignNumber=Number((await db.query(`SELECT next_journal_number($1,2026) n`,[c2])).rows[0].n);
  assert.equal(foreignNumber,1);

  // Concurrent balanced journal entries from separate connections must all
  // commit and all stay balanced.
  const cash='78000000-0000-4000-8000-000000000010';
  const revenue='78000000-0000-4000-8000-000000000011';
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1000','Race cash','asset',FALSE),($3,$2,'4100','Race revenue','revenue',FALSE)`,[cash,c,revenue]);
  const postings=await Promise.all(Array.from({length:5},(_,index)=>db.withConnection((conn)=>
    conn.query(`SELECT create_journal_entry($1,'2026-02-01','general',$2,$3,$4::jsonb) result`,[
      c,`Concurrent posting ${index}`,u,
      JSON.stringify([{accountId:cash,debit:100,credit:0},{accountId:revenue,debit:0,credit:100}]),
    ]))));
  assert.equal(postings.length,5);
  const postedNumbers=postings.map((row)=>Number(row.rows[0].result.number));
  assert.equal(new Set(postedNumbers).size,5);
  const unbalanced=await db.query(`
    SELECT je.id FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id=je.id
    WHERE je.company_id=$1 GROUP BY je.id HAVING sum(jl.debit)<>sum(jl.credit)`,[c]);
  assert.equal(unbalanced.rows.length,0);

  // Concurrent duplicate task-dependency edges must collapse to exactly one.
  const makeTask=async(name,start,end)=>(await db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3) result`,
    [c,JSON.stringify({project_id:project,name,start_date:start,end_date:end}),u])).rows[0].result.id;
  const first=await makeTask('Race A','2026-01-01','2026-01-02');
  const second=await makeTask('Race B','2026-01-03','2026-01-04');
  const edgeAttempts=await Promise.allSettled([0,1].map(()=>db.withConnection((conn)=>
    conn.query(`SELECT create_task_dependency_atomic($1,$2,$3,0,$4)`,[c,second,first,u]))));
  assert.equal(edgeAttempts.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(Number((await db.query(
    `SELECT count(*) count FROM project_task_dependencies WHERE successor_task_id=$1 AND predecessor_task_id=$2`,
    [second,first])).rows[0].count),1);

  // Two connections racing to build opposite edges must not create a cycle.
  const third=await makeTask('Race C','2026-01-05','2026-01-06');
  const cycleAttempts=await Promise.allSettled([
    db.withConnection((conn)=>conn.query(`SELECT create_task_dependency_atomic($1,$2,$3,0,$4)`,[c,third,second,u])),
    db.withConnection((conn)=>conn.query(`SELECT create_task_dependency_atomic($1,$2,$3,0,$4)`,[c,second,third,u])),
  ]);
  assert.ok(cycleAttempts.filter((r)=>r.status==='fulfilled').length>=1);
  const cycleCheck=await db.query(`
    WITH RECURSIVE reach(a,b) AS (
      SELECT predecessor_task_id,successor_task_id FROM project_task_dependencies WHERE company_id=$1
      UNION SELECT r.a,d.successor_task_id FROM reach r
        JOIN project_task_dependencies d ON d.predecessor_task_id=r.b AND d.company_id=$1
    ) SELECT count(*) count FROM reach WHERE a=b`,[c]);
  assert.equal(Number(cycleCheck.rows[0].count),0);
}

async function smokeAtomicWriters(ids) {
  const { company: c, user: u, employee: e, bank: b, contact, project, accounts: a } = ids;

  // The company got its open fiscal year from the 069 bootstrap trigger.
  const fiscalYear=(await db.query(`SELECT id FROM fiscal_years WHERE company_id=$1 ORDER BY start_date LIMIT 1`,[c])).rows[0].id;
  assert.ok(fiscalYear);
  await db.query(`SELECT create_journal_entry($1,'2026-01-15','general','January revenue',$2,$3::jsonb)`,[
    c,u,JSON.stringify([{accountId:a['1000'],debit:100,credit:0},{accountId:a['4100'],debit:0,credit:100}]),
  ]);
  const closeRace=await Promise.all([
    db.query(`SELECT close_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u]),
    db.query(`SELECT close_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u]),
  ]);
  assert.equal(closeRace.filter((r)=>r.rows[0].result.already_processed===false).length,1);
  // The bootstrap year spans the whole 2026 calendar, so net income includes
  // every 2026 posting made by earlier smoke tests (inventory, etc.) — assert
  // it is a real number rather than a fragile exact value.
  assert.ok(Number.isFinite(Number(closeRace.find((r)=>r.rows[0].result.already_processed===false).rows[0].result.netIncome)));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='fiscal_year_closing' AND reference_id=$2`,[c,fiscalYear])).rows[0].count),1);
  const reopened=(await db.query(`SELECT reopen_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u])).rows[0].result;
  assert.equal(reopened.status,'open');
  assert.equal(Number(reopened.reversedClosingEntries),1);
  await db.query(`SELECT close_fiscal_year_atomic($1,$2,$3)`,[c,fiscalYear,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='fiscal_year_closing' AND reference_id=$2`,[c,fiscalYear])).rows[0].count),2);
  // Leave the year open again so the rest of the smoke tests can post.
  await db.query(`SELECT reopen_fiscal_year_atomic($1,$2,$3)`,[c,fiscalYear,u]);

  const reversible=(await db.query(`SELECT create_journal_entry($1,'2026-02-01','general','Reversible',$2,$3::jsonb) result`,[
    c,u,JSON.stringify([{accountId:a['5100'],debit:20,credit:0},{accountId:a['1000'],debit:0,credit:20}]),
  ])).rows[0].result;
  const reverseRace=await Promise.all([
    db.query(`SELECT reverse_journal_entry_atomic($1,$2,'2026-02-02','Reverse runtime','journal_entry_reversal',$2,$3) result`,[c,reversible.id,u]),
    db.query(`SELECT reverse_journal_entry_atomic($1,$2,'2026-02-02','Reverse runtime','journal_entry_reversal',$2,$3) result`,[c,reversible.id,u]),
  ]);
  assert.equal(reverseRace.filter((r)=>r.rows[0].result.already_processed===false).length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reversal_of=$2`,[c,reversible.id])).rows[0].count),1);

  const quote=await db.query(`SELECT create_quotation($1,'2026-02-01',$2,$3::jsonb,'',0.15,'2026-02-10',$4) result`,[
    c,contact,JSON.stringify([{description:'Work',quantity:2,unit_price:100}]),u,
  ]);
  const quoteId=quote.rows[0].result.id;
  await db.query(`SELECT update_draft_quotation($1,$2,$3::jsonb,$4::jsonb)`,[
    c,quoteId,JSON.stringify({notes:'updated'}),JSON.stringify([{description:'Work',quantity:3,unit_price:100}]),
  ]);
  await db.query(`SELECT delete_draft_quotation($1,$2)`,[c,quoteId]);
  assert.equal(Number((await db.query('SELECT count(*) count FROM quotation_items WHERE company_id=$1',[c])).rows[0].count),0);
  const atomicProject=(await db.query(`SELECT create_project_atomic($1,'Atomic project',$2,75,'2026-02-01',NULL,'active','','',$3::jsonb,TRUE,$4) result`,[
    c,contact,JSON.stringify([{description:'Project work',unit:'unit',quantity:1,unit_price:75}]),u,
  ])).rows[0].result;
  // A project is a reference: even when p_auto_invoice is passed TRUE, no
  // invoice is created and no journal entry is posted (the app no longer
  // sends auto_invoice at all). Only invoices move the client balance.
  assert.equal(atomicProject.invoice,null);
  assert.equal(Number(atomicProject.boq_items_count),1);
  // Items inserted through the project modal get an auto-generated BOQ code.
  const projectBoq=(await db.query(`SELECT item_code FROM boq_items WHERE company_id=$1 AND project_id=$2`,[c,atomicProject.id])).rows[0];
  assert.equal(projectBoq.item_code,'BOQ-0001');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM invoices WHERE company_id=$1 AND project_id=$2`,[c,atomicProject.id])).rows[0].count),0);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='invoice' AND reference_id IN (SELECT id FROM invoices WHERE company_id=$1 AND project_id=$2)`,[c,atomicProject.id])).rows[0].count),0);
  const progressClaim=(await db.query(`SELECT create_progress_billing_atomic($1,$2,'2026-02-03','','Claim',30,0.1,0.15,FALSE,$3) result`,[c,atomicProject.id,u])).rows[0].result;
  assert.ok(progressClaim.journal_entry_id);
  assert.equal(Number(progressClaim.retention_amount),3);
  assert.equal((await db.query(`SELECT cancel_progress_billing_atomic($1,$2,$3) result`,[c,progressClaim.id,u])).rows[0].result.status,'cancelled');
  const editableProject=(await db.query(`SELECT create_project_atomic($1,'Editable',$2,20,'2026-02-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,[c,contact,u])).rows[0].result;
  // Project creation with auto_invoice=FALSE must NOT create an invoice or
  // touch the client balance — a project is a reference, only invoices move
  // the ledger (the app UI no longer sends auto_invoice at all).
  assert.equal(Number((await db.query(`SELECT count(*) count FROM invoices WHERE company_id=$1 AND project_id=$2`,[c,editableProject.id])).rows[0].count),0);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='invoice' AND reference_id IN (SELECT id FROM invoices WHERE company_id=$1 AND project_id=$2)`,[c,editableProject.id])).rows[0].count),0);
  await db.query(`SELECT update_project_atomic($1,$2,$3::jsonb,$4::jsonb,$5)`,[
    c,editableProject.id,JSON.stringify({name:'Edited',contract_value:30}),JSON.stringify([{description:'Line',unit:'u',quantity:3,unit_price:10}]),u,
  ]);
  assert.equal((await db.query(`SELECT cancel_empty_project_atomic($1,$2,$3) result`,[c,editableProject.id,u])).rows[0].result.status,'cancelled');
  const convertQuote=(await db.query(`SELECT create_quotation($1,'2026-02-01',$2,$3::jsonb,'',0.15,'2026-02-10',$4) result`,[
    c,contact,JSON.stringify([{description:'Convert work',quantity:2,unit_price:100}]),u,
  ])).rows[0].result;
  await db.query(`UPDATE quotations SET status='accepted' WHERE id=$1 AND company_id=$2`,[convertQuote.id,c]);
  const converted=await Promise.all([
    db.query(`SELECT convert_quotation_atomic($1,$2,'Converted project','2026-02-02',NULL,$3) result`,[c,convertQuote.id,u]),
    db.query(`SELECT convert_quotation_atomic($1,$2,'Converted project','2026-02-02',NULL,$3) result`,[c,convertQuote.id,u]),
  ]);
  assert.equal(converted[0].rows[0].result.id,converted[1].rows[0].result.id);
  assert.equal((await db.query(`SELECT count(*)::int count FROM projects WHERE id=$1 AND company_id=$2`,[converted[0].rows[0].result.id,c])).rows[0].count,1);

  // Purchase invoice with "other expenses" that are NOT owed to the supplier.
  const otherExpenseInvoice=(await db.query(
    `SELECT create_purchase_invoice_atomic($1,$2,NULL,NULL,NULL,TRUE,'2026-02-02',$3::jsonb,0,'other expense',$4,
       $5::jsonb,$6) result`,
    [c,contact,JSON.stringify([{description:'Goods',quantity:2,unit_price:100}]),u,
     JSON.stringify([{description:'أجرة نقل',amount:50,account_code:'5100'},{description:'صيانة',amount:30,account_code:'5100'}]),a['1000']],
  )).rows[0].result;
  assert.equal(Number(otherExpenseInvoice.other_expenses_total),80);
  // Supplier payable must equal only the items subtotal (200), not +80.
  const otherExpenseInvRow=(await db.query(`SELECT total,other_expenses_total FROM purchase_invoices WHERE id=$1`,[otherExpenseInvoice.id])).rows[0];
  assert.equal(Number(otherExpenseInvRow.total),200);
  assert.equal(Number(otherExpenseInvRow.other_expenses_total),80);
  // The other-expenses journal must balance and not touch the supplier AP.
  const oeJournalId=otherExpenseInvoice.other_expenses_journal_entry_id;
  const oeTotals=(await db.query(`SELECT COALESCE(sum(debit),0) d,COALESCE(sum(credit),0) c FROM journal_lines WHERE journal_entry_id=$1`,[oeJournalId])).rows[0];
  assert.equal(Number(oeTotals.d),Number(oeTotals.c));
  // Reject an invalid other-expense amount.
  await assert.rejects(()=>db.query(
    `SELECT create_purchase_invoice_atomic($1,$2,NULL,NULL,NULL,TRUE,'2026-02-02',$3::jsonb,0,'bad',$4,$5::jsonb,$6) result`,
    [c,contact,JSON.stringify([{description:'Goods',quantity:1,unit_price:10}]),u,
     JSON.stringify([{description:'x',amount:-5}]),b]));

  const machine=(await db.query(`SELECT create_fixed_asset($1,'Machine','A1','equipment','2026-02-01',500,5,'straight_line','','',$2,$3) result`, [c, b, u])).rows[0].result;
  const newBank=await db.query(`SELECT create_bank_safe($1,'New Bank','bank','123',500,$2) result`,[c,u]);
  assert.ok(newBank.rows[0].result.opening_journal_entry_id);
  const emptySafe=await db.query(`SELECT create_bank_safe($1,'Empty Safe','safe','',0,$2) result`,[c,u]);
  await db.query(`SELECT deactivate_bank_safe($1,$2,$3)`,[c,emptySafe.rows[0].result.id,u]);
  const bankRec=await db.query(`SELECT create_bank_reconciliation($1,$2,CURRENT_DATE,500,'[]'::jsonb,$3) result`,[c,newBank.rows[0].result.id,u]);
  assert.equal(Number(bankRec.rows[0].result.difference),0);
  await db.query(`SELECT update_bank_reconciliation($1,$2,NULL,TRUE,$3)`,[c,bankRec.rows[0].result.id,u]);
  await assert.rejects(()=>db.query(`SELECT delete_pending_bank_reconciliation($1,$2,$3)`,[c,bankRec.rows[0].result.id,u]));

  await db.query(`UPDATE companies SET tax_number='300000000000003',country_code='SA',currency_code='SAR' WHERE id=$1`,[c]);
  await db.query(`UPDATE contacts SET tax_number='310000000000003',address='Original buyer address' WHERE id=$1 AND company_id=$2`,[contact,c]);
  const atomicSale=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,$3,'2026-02-01','2026-03-01',$4::jsonb,0.15,TRUE,'sale',50,$5,$6) result`,[
    c,contact,project,JSON.stringify([{description:'Atomic sale',quantity:2,unitPrice:50,discount:0}]),b,u,
  ])).rows[0].result;
  assert.equal(Number(atomicSale.total),115);
  assert.equal(Number(atomicSale.paid_amount),50);
  assert.equal(atomicSale.status,'partial');
  assert.ok(atomicSale.journal_entry_id);
  assert.ok(atomicSale.voucher_receipt_id);
  assert.equal((await db.query(`SELECT count(*)::int count FROM invoice_items WHERE invoice_id=$1`,[atomicSale.id])).rows[0].count,1);
  const taxDocument=(await db.query(`SELECT vat_rate,tax_rate,vat_amount,tax_amount,tax_snapshot FROM invoices WHERE id=$1 AND company_id=$2`,[atomicSale.id,c])).rows[0];
  assert.equal(Number(taxDocument.vat_rate),0.15);
  assert.equal(Number(taxDocument.tax_rate),0.15);
  assert.equal(Number(taxDocument.vat_amount),15);
  assert.equal(Number(taxDocument.tax_amount),15);
  assert.equal(taxDocument.tax_snapshot.seller.vat_number,'300000000000003');
  assert.equal(taxDocument.tax_snapshot.buyer.name,'Client');
  const frozenSnapshot=JSON.stringify(taxDocument.tax_snapshot);
  await db.query(`UPDATE companies SET name='Renamed after issue',tax_number='399999999999993' WHERE id=$1`,[c]);
  await db.query(`UPDATE contacts SET name='Renamed buyer',tax_number='319999999999993' WHERE id=$1 AND company_id=$2`,[contact,c]);
  assert.equal(JSON.stringify((await db.query(`SELECT tax_snapshot FROM invoices WHERE id=$1`,[atomicSale.id])).rows[0].tax_snapshot),frozenSnapshot);
  await assert.rejects(()=>db.query(`UPDATE invoices SET total=116 WHERE id=$1 AND company_id=$2`,[atomicSale.id,c]));
  await assert.rejects(()=>db.query(`UPDATE invoice_items SET total=99 WHERE invoice_id=$1 AND company_id=$2`,[atomicSale.id,c]));
  await assert.rejects(()=>db.query(`INSERT INTO invoice_items(company_id,invoice_id,description,quantity,unit_price,total) VALUES($1,$2,'late line',1,1,1)`,[c,atomicSale.id]));

  const atomicContact=(await db.query(`SELECT create_contact_atomic($1,$2,$3::jsonb,100,'debit') result`,[
    c,u,JSON.stringify({name:'Atomic ledger contact',type:'client',email:'ledger@example.test',credit_limit:500}),
  ])).rows[0].result;
  assert.ok(atomicContact.opening_journal_id);
  assert.equal(Number((await db.query(`SELECT get_contact_balance($1,$2,NULL) balance`,[c,atomicContact.id])).rows[0].balance),100);
  await db.query(`SELECT create_journal_entry($1,CURRENT_DATE,'general','Tagged counterparts',$2,$3::jsonb)`,[
    c,u,JSON.stringify([
      {accountId:a['1130'],debit:50,credit:0,contactId:atomicContact.id},
      {accountId:a['4100'],debit:0,credit:50,contactId:atomicContact.id},
    ]),
  ]);
  const draftContactEntry=(await db.query(`INSERT INTO journal_entries(company_id,number,date,type,description,status,created_by)
    VALUES($1,999001,CURRENT_DATE,'general','Unposted contact draft','draft',$2) RETURNING id`,[c,u])).rows[0].id;
  await db.query(`INSERT INTO journal_lines(company_id,journal_entry_id,account_id,debit,credit,contact_id) VALUES
    ($1,$2,$3,999,0,$5),($1,$2,$4,0,999,$5)`,[c,draftContactEntry,a['1130'],a['4100'],atomicContact.id]);
  assert.equal(Number((await db.query(`SELECT get_contact_balance($1,$2,NULL) balance`,[c,atomicContact.id])).rows[0].balance),150);
  assert.equal(Number((await db.query(`SELECT balance FROM get_contact_balance_batch($1,ARRAY[$2]::UUID[])`,[c,atomicContact.id])).rows[0].balance),150);
  await assert.rejects(()=>db.query(`SELECT update_contact_atomic($1,$2,'{"type":"supplier"}'::jsonb,$3)`,[c,atomicContact.id,u]));
  const updatedContact=(await db.query(`SELECT update_contact_atomic($1,$2,'{"name":"Atomic ledger contact updated"}'::jsonb,$3) result`,[c,atomicContact.id,u])).rows[0].result;
  assert.equal(updatedContact.name,'Atomic ledger contact updated');
  const deactivatedContact=(await db.query(`SELECT deactivate_contact_atomic($1,$2,$3) result`,[c,atomicContact.id,u])).rows[0].result;
  assert.equal(deactivatedContact.is_active,false);
  assert.equal(Number((await db.query(`SELECT get_contact_balance($1,$2,NULL) balance`,[c,atomicContact.id])).rows[0].balance),150);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type='contact' AND entity_id=$2`,[c,atomicContact.id])).rows[0].count),3);
  const contactSummary=(await db.query(`SELECT get_contact_statement_summary($1,$2,NULL,NULL) result`,[c,atomicContact.id])).rows[0].result;
  assert.equal(Number(contactSummary.closing_balance),150);
  assert.equal(Number(contactSummary.total_count),2);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM get_contact_statement_lines($1,$2,NULL,NULL,100,0)`,[c,atomicContact.id])).rows[0].count),2);

  const agingContact=(await db.query(`SELECT create_contact_atomic($1,$2,$3::jsonb,0,'debit') result`,[
    c,u,JSON.stringify({name:'Aging contact',type:'client'}),
  ])).rows[0].result;
  const agingInvoice=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,CURRENT_DATE,CURRENT_DATE,$3::jsonb,0,FALSE,'',0,NULL,$4) result`,[
    c,agingContact.id,JSON.stringify([{description:'Aging invoice',quantity:1,unitPrice:100,discount:0}]),u,
  ])).rows[0].result;
  const agingPendingReceipt=(await db.query(`SELECT create_voucher_receipt_atomic($1,CURRENT_DATE,'client',$2,50,$3,'Pending allocation',$4::jsonb,FALSE,TRUE,$5) result`,[
    c,agingContact.id,b,JSON.stringify([{invoice_id:agingInvoice.id,amount:50}]),u,
  ])).rows[0].result;
  const pendingAging=(await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ar',CURRENT_DATE) WHERE contact_id=$2`,[c,agingContact.id])).rows[0];
  assert.equal(Number(pendingAging.open_amount),100);
  await db.query(`SELECT respond_voucher_receipt_approval($1,$2,'approve',$3,NULL,'approved')`,[c,agingPendingReceipt.approval_id,u]);
  const approvedAging=(await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ar',CURRENT_DATE) WHERE contact_id=$2`,[c,agingContact.id])).rows[0];
  assert.equal(Number(approvedAging.open_amount),50);
  await db.query(`SELECT cancel_voucher_receipt_atomic($1,$2,$3)`,[c,agingPendingReceipt.id,u]);
  const cancelledAging=(await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ar',CURRENT_DATE) WHERE contact_id=$2`,[c,agingContact.id])).rows[0];
  assert.equal(Number(cancelledAging.open_amount),100);

  const agingSupplier=(await db.query(`SELECT create_contact_atomic($1,$2,$3::jsonb,0,'credit') result`,[
    c,u,JSON.stringify({name:'Aging supplier',type:'supplier'}),
  ])).rows[0].result;
  const agingPurchase=(await db.query(`SELECT create_purchase_invoice_atomic($1,$2,NULL,NULL,NULL,FALSE,CURRENT_DATE,$3::jsonb,0,'aging',$4) result`,[
    c,agingSupplier.id,JSON.stringify([{description:'Aging purchase',quantity:1,unit_price:100}]),u,
  ])).rows[0].result;
  const pendingDisbursement=(await db.query(`SELECT create_voucher_disbursement_atomic($1,CURRENT_DATE,'supplier',$2,NULL,50,$3,'Pending supplier allocation',$4::jsonb,TRUE,$5) result`,[
    c,agingSupplier.id,b,JSON.stringify([{invoice_id:agingPurchase.id,amount:50}]),u,
  ])).rows[0].result;
  assert.equal(Number((await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ap',CURRENT_DATE) WHERE contact_id=$2`,[c,agingSupplier.id])).rows[0].open_amount),100);
  await db.query(`SELECT respond_voucher_disbursement_approval($1,$2,'approve',$3,NULL,'approved')`,[c,pendingDisbursement.approval_id,u]);
  assert.equal(Number((await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ap',CURRENT_DATE) WHERE contact_id=$2`,[c,agingSupplier.id])).rows[0].open_amount),50);
  await db.query(`SELECT cancel_voucher_disbursement_atomic($1,$2,$3)`,[c,pendingDisbursement.id,u]);
  assert.equal(Number((await db.query(`SELECT open_amount FROM get_aging_by_contact($1,'ap',CURRENT_DATE) WHERE contact_id=$2`,[c,agingSupplier.id])).rows[0].open_amount),100);

  const activeClientCount=Number((await db.query(`SELECT count(*) count FROM contacts WHERE company_id=$1 AND type IN('client','both') AND is_active=TRUE AND deleted_at IS NULL`,[c])).rows[0].count);
  const activePlanId=(await db.query(`SELECT plan_id FROM subscriptions WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`,[c])).rows[0].plan_id;
  await db.query(`UPDATE subscription_plans SET max_clients=$1 WHERE id=$2`,[activeClientCount+1,activePlanId]);
  const contactLimitRace=await Promise.allSettled([1,2].map((index)=>db.query(
    `SELECT create_contact_atomic($1,$2,$3::jsonb,0,'debit')`,
    [c,u,JSON.stringify({name:`Plan race contact ${index}`,type:'client'})],
  )));
  assert.equal(contactLimitRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(contactLimitRace.filter((result)=>result.status==='rejected').length,1);
  await db.query(`UPDATE subscription_plans SET max_clients=NULL WHERE id=$1`,[activePlanId]);
  await assert.rejects(()=>db.query(`SELECT create_contact_atomic($1,'99999999-0000-4000-8000-000000000099',$2::jsonb,0,'debit')`,[
    c,JSON.stringify({name:'Foreign actor contact',type:'client'}),
  ]));
  const atomicSubcontractor=(await db.query(`SELECT create_contact_atomic($1,$2,$3::jsonb,0,'credit') result`,[
    c,u,JSON.stringify({name:'Atomic subcontractor',type:'subcontractor'}),
  ])).rows[0].result;
  assert.equal((await db.query(`SELECT update_subcontractor_atomic($1,$2,'{"name":"Atomic subcontractor updated"}'::jsonb,$3) result`,[
    c,atomicSubcontractor.id,u,
  ])).rows[0].result.name,'Atomic subcontractor updated');
  await assert.rejects(()=>db.query(`SELECT update_subcontractor_atomic($1,$2,'{"name":"Wrong subtype"}'::jsonb,$3)`,[c,agingContact.id,u]));
  assert.equal((await db.query(`SELECT deactivate_subcontractor_atomic($1,$2,$3) result`,[c,atomicSubcontractor.id,u])).rows[0].result.is_active,false);

  const cancellableSale=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,'2026-02-01','2026-03-01',$3::jsonb,0,FALSE,'',0,NULL,$4) result`,[
    c,contact,JSON.stringify([{description:'Cancel sale',quantity:1,unitPrice:25,discount:0}]),u,
  ])).rows[0].result;
  assert.equal(Number((await db.query(`SELECT vat_rate FROM invoices WHERE id=$1`,[cancellableSale.id])).rows[0].vat_rate),0);
  const cancelledSale=(await db.query(`SELECT cancel_sales_invoice_atomic($1,$2,'mistake',$3) result`,[c,cancellableSale.id,u])).rows[0].result;
  assert.ok(cancelledSale.reversal_journal_id);
  assert.equal(cancelledSale.status,'cancelled');
  assert.equal((await db.query(`SELECT cancel_sales_invoice_atomic($1,$2,'',$3) result`,[c,cancellableSale.id,u])).rows[0].result.already_processed,true);
  const creditInvoice=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,'2026-02-01','2026-03-01',$3::jsonb,0,FALSE,'',0,NULL,$4) result`,[
    c,contact,JSON.stringify([{description:'Credit target',quantity:1,unitPrice:100,discount:0}]),u,
  ])).rows[0].result;
  const concurrentCredits=await Promise.allSettled([1,2].map((n)=>db.query(
    `SELECT create_credit_note_atomic($1,$2,NULL,NULL,'2026-02-02',$3,$4::jsonb,0,$5) result`,
    [c,creditInvoice.id,`credit ${n}`,JSON.stringify([{description:'Return',quantity:1,unit_price:60}]),u],
  )));
  assert.equal(concurrentCredits.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(concurrentCredits.filter((r)=>r.status==='rejected').length,1);
  const creditResult=concurrentCredits.find((r)=>r.status==='fulfilled').value.rows[0].result;
  assert.ok(creditResult.journal_entry_id);
  assert.equal(Number(creditResult.total),60);
  assert.equal((await db.query(`SELECT cancel_credit_note_atomic($1,$2,$3) result`,[c,creditResult.id,u])).rows[0].result.status,'cancelled');
  assert.equal((await db.query(`SELECT cancel_credit_note_atomic($1,$2,$3) result`,[c,creditResult.id,u])).rows[0].result.already_processed,true);

  const atomicPurchase=(await db.query(`SELECT create_purchase_invoice_atomic($1,$2,NULL,$3,NULL,TRUE,'2026-02-02',$4::jsonb,0.05,'purchase',$5) result`,[
    c,contact,project,JSON.stringify([{description:'Materials',quantity:2,unit_price:50}]),u,
  ])).rows[0].result;
  assert.equal(Number(atomicPurchase.total),105);
  assert.ok(atomicPurchase.journal_entry_id);
  assert.equal((await db.query(`SELECT cancel_purchase_invoice_atomic($1,$2,'error',$3) result`,[c,atomicPurchase.id,u])).rows[0].result.status,'cancelled');
  const custodyFile=(await db.query(`SELECT open_custody_file($1,$2,'2026-02-01',200,'Purchase custody',$3,$4,$5) result`,[
    c,e,b,project,u,
  ])).rows[0].result.id;
  const custodyPurchase=(await db.query(`SELECT create_purchase_invoice_atomic($1,$2,NULL,NULL,$3,TRUE,'2026-02-02',$4::jsonb,0,'custody purchase',$5) result`,[
    c,contact,custodyFile,JSON.stringify([{description:'Site item',quantity:1,unit_price:50}]),u,
  ])).rows[0].result;
  assert.equal(Number((await db.query(`SELECT remaining_amount FROM custodies WHERE id=$1`,[custodyFile])).rows[0].remaining_amount),150);
  assert.equal((await db.query(`SELECT cancel_purchase_invoice_atomic($1,$2,'',$3) result`,[c,custodyPurchase.id,u])).rows[0].result.status,'cancelled');
  assert.equal(Number((await db.query(`SELECT remaining_amount FROM custodies WHERE id=$1`,[custodyFile])).rows[0].remaining_amount),200);

  const subcontract='68000000-0000-4000-8000-000000000010';
  await db.query(`INSERT INTO subcontractor_contracts(id,company_id,contact_id,project_id,contract_number,contract_value,start_date,status)
    VALUES($1,$2,$3,$4,'SC-1',1000,'2026-01-01','active')`,[subcontract,c,contact,project]);
  const certificate=(await db.query(`SELECT create_subcontractor_certificate_atomic($1,$2,'2026-02-05',1,'Runtime certificate',1000,0.1,$3) result`,[c,subcontract,u])).rows[0].result;
  assert.ok(certificate.journal_entry_id);
  assert.equal(Number(certificate.net_amount),900);
  const paymentRace=await Promise.allSettled([
    db.query(`SELECT create_subcontractor_payment_atomic($1,$2,$3,600,'2026-02-06',$4,'first',$5)`,[c,subcontract,certificate.id,b,u]),
    db.query(`SELECT create_subcontractor_payment_atomic($1,$2,$3,600,'2026-02-06',$4,'second',$5)`,[c,subcontract,certificate.id,b,u]),
  ]);
  assert.equal(paymentRace.filter((r)=>r.status==='fulfilled').length,1);
  await db.query(`SELECT create_subcontractor_payment_atomic($1,$2,$3,300,'2026-02-07',$4,'remainder',$5)`,[c,subcontract,certificate.id,b,u]);
  assert.equal((await db.query(`SELECT status FROM subcontractor_certificates WHERE id=$1`,[certificate.id])).rows[0].status,'paid');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='subcontractor_payment'`,[c])).rows[0].count),2);

  const terminal='68000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO pos_terminals(id,company_id,code,name,bank_safe_id) VALUES($1,$2,'T1','Terminal',$3)`,[terminal,c,b]);
  const posSales=await Promise.all([
    db.query(`SELECT create_pos_sale_atomic($1,$2,10,'cash',$3) result`,[c,terminal,u]),
    db.query(`SELECT create_pos_sale_atomic($1,$2,15,'card',$3) result`,[c,terminal,u]),
  ]);
  assert.notEqual(posSales[0].rows[0].result.number,posSales[1].rows[0].result.number);
  assert.ok(posSales[0].rows[0].result.journal_entry_id);

  const purchaseInvoice='70000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO purchase_invoices(id,company_id,number,date,supplier_id,total,paid_amount,status) VALUES($1,$2,101,'2026-02-01',$3,100,0,'unpaid')`,[purchaseInvoice,c,contact]);
  const pendingVoucher=await db.query(`SELECT create_voucher_disbursement_atomic($1,'2026-02-02','supplier',$2,NULL,100,$3,'pay',$4::jsonb,TRUE,$5) result`,
    [c,contact,b,JSON.stringify([{invoice_id:purchaseInvoice,amount:100}]),u]);
  assert.ok(pendingVoucher.rows[0].result.approval_id);
  const approvedVoucher=await db.query(`SELECT respond_voucher_disbursement_approval($1,$2,'approve',$3,NULL,'ok') result`,
    [c,pendingVoucher.rows[0].result.approval_id,u]);
  assert.ok(approvedVoucher.rows[0].result.journal_entry_id);
  assert.equal((await db.query(`SELECT status FROM purchase_invoices WHERE id=$1`,[purchaseInvoice])).rows[0].status,'paid');
  assert.equal((await db.query(`SELECT cancel_voucher_disbursement_atomic($1,$2,$3) result`,[c,pendingVoucher.rows[0].result.id,u])).rows[0].result.status,'cancelled');
  assert.equal((await db.query(`SELECT status FROM purchase_invoices WHERE id=$1`,[purchaseInvoice])).rows[0].status,'unpaid');
  assert.equal((await db.query(`SELECT cancel_voucher_disbursement_atomic($1,$2,$3) result`,[c,pendingVoucher.rows[0].result.id,u])).rows[0].result.already_processed,true);
  await assert.rejects(()=>db.query(`SELECT respond_voucher_disbursement_approval($1,$2,'approve',$3,NULL,'again')`,[c,pendingVoucher.rows[0].result.approval_id,u]));
  const directVoucher=await db.query(`SELECT create_voucher_disbursement_atomic($1,'2026-02-02','other',NULL,NULL,50,$2,'expense','[]'::jsonb,FALSE,$3) result`,[c,b,u]);
  assert.ok(directVoucher.rows[0].result.journal_entry_id);
  const updatedDisbursement=(await db.query(`SELECT update_voucher_disbursement_atomic($1,$2,NULL,NULL,FALSE,NULL,FALSE,40,NULL,'updated',$3) result`,[c,directVoucher.rows[0].result.id,u])).rows[0].result;
  assert.equal(Number(updatedDisbursement.amount),40);
  assert.equal((await db.query(`SELECT cancel_voucher_disbursement_atomic($1,$2,$3) result`,[c,directVoucher.rows[0].result.id,u])).rows[0].result.status,'cancelled');
  // Supplier FIFO auto-settlement: an undirected disbursement settles the
  // oldest open purchase invoices of the same supplier.
  const fifoPo1='74000000-0000-4000-8000-000000000f01';
  const fifoPo2='74000000-0000-4000-8000-000000000f02';
  await db.query(`INSERT INTO purchase_invoices(id,company_id,number,date,supplier_id,total,paid_amount,status)
    VALUES($1,$2,500,'2026-01-05',$3,100,0,'unpaid'),($4,$2,501,'2026-01-20',$3,200,0,'unpaid')`,[fifoPo1,c,contact,fifoPo2]);
  const fifoDisp=(await db.query(`SELECT create_voucher_disbursement_atomic($1,'2026-02-03','supplier',$2,NULL,250,$3,'FIFO settle','[]'::jsonb,FALSE,$4,TRUE) result`,
    [c,contact,b,u])).rows[0].result;
  assert.equal(Number(fifoDisp.allocated_amount),250);
  assert.equal((await db.query(`SELECT status FROM purchase_invoices WHERE id=$1`,[fifoPo1])).rows[0].status,'paid');
  const fifoPo2row=(await db.query(`SELECT paid_amount,status FROM purchase_invoices WHERE id=$1`,[fifoPo2])).rows[0];
  assert.equal(Number(fifoPo2row.paid_amount),150);
  assert.equal(fifoPo2row.status,'partial');
  // Client FIFO auto-settlement via an undirected receipt.
  const fifoInv='74000000-0000-4000-8000-000000000f03';
  await db.query(`INSERT INTO invoices(id,company_id,number,date,due_date,contact_id,subtotal,vat_rate,vat_amount,total,paid_amount,status) VALUES($1,$2,900,'2026-01-05','2026-02-05',$3,120,0,0,120,0,'unpaid')`,[fifoInv,c,contact]);
  const fifoReceipt=(await db.query(`SELECT create_voucher_receipt_atomic($1,'2026-02-03','client',$2,120,$3,'FIFO receipt','[]'::jsonb,TRUE,FALSE,$4) result`,[c,contact,b,u])).rows[0].result;
  assert.equal(Number(fifoReceipt.allocated_amount),120);
  assert.equal((await db.query(`SELECT status FROM invoices WHERE id=$1`,[fifoInv])).rows[0].status,'paid');
  await db.query(`SELECT cancel_voucher_disbursement_atomic($1,$2,$3)`,[c,fifoDisp.id,u]);
  await db.query(`SELECT cancel_voucher_receipt_atomic($1,$2,$3)`,[c,fifoReceipt.id,u]);

  const salesInvoice='71000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO invoices(id,company_id,number,date,due_date,contact_id,subtotal,vat_rate,vat_amount,total,paid_amount,status) VALUES($1,$2,101,'2026-02-01','2026-03-01',$3,80,0,0,80,0,'unpaid')`,[salesInvoice,c,contact]);
  const receipt=await db.query(`SELECT create_voucher_receipt_atomic($1,'2026-02-02','client',$2,80,$3,'receipt',$4::jsonb,FALSE,FALSE,$5) result`,
    [c,contact,b,JSON.stringify([{invoice_id:salesInvoice,amount:80}]),u]);
  assert.ok(receipt.rows[0].result.journal_entry_id);
  assert.equal((await db.query(`SELECT status FROM invoices WHERE id=$1`,[salesInvoice])).rows[0].status,'paid');
  assert.equal((await db.query(`SELECT cancel_voucher_receipt_atomic($1,$2,$3) result`,[c,receipt.rows[0].result.id,u])).rows[0].result.status,'cancelled');
  assert.equal((await db.query(`SELECT status FROM invoices WHERE id=$1`,[salesInvoice])).rows[0].status,'unpaid');
  const editableReceipt=(await db.query(`SELECT create_voucher_receipt_atomic($1,'2026-02-02','general',NULL,10,$2,'general','[]'::jsonb,FALSE,FALSE,$3) result`,[c,b,u])).rows[0].result;
  assert.equal(Number((await db.query(`SELECT update_voucher_receipt_atomic($1,$2,NULL,NULL,FALSE,12,NULL,'updated',$3) result`,[c,editableReceipt.id,u])).rows[0].result.amount),12);
  assert.equal((await db.query(`SELECT cancel_voucher_receipt_atomic($1,$2,$3) result`,[c,editableReceipt.id,u])).rows[0].result.status,'cancelled');
  const gatewayInvoice='71000000-0000-4000-8000-000000000002';
  const paymentRecord='72000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO invoices(id,company_id,number,date,due_date,contact_id,subtotal,vat_rate,vat_amount,total,paid_amount,status) VALUES($1,$2,102,'2026-02-01','2026-03-01',$3,100,0,0,100,0,'unpaid')`,[gatewayInvoice,c,contact]);
  await db.query(`INSERT INTO payment_records(id,company_id,invoice_id,payment_gateway_id,amount,status,created_by,settlement_account_id) VALUES($1,$2,$3,'gateway-1',120,'pending',$4,$5)`,[paymentRecord,c,gatewayInvoice,u,a['1110']]);
  const finalizedPayment=await db.query(`SELECT finalize_gateway_payment($1,$2,'paid','{}',$3) result`,[c,paymentRecord,u]);
  assert.equal(Number(finalizedPayment.rows[0].result.customer_advance),20);
  const replayPayment=await db.query(`SELECT finalize_gateway_payment($1,$2,'paid','{}',$3) result`,[c,paymentRecord,u]);
  assert.equal(replayPayment.rows[0].result.already_processed,true);
  const approvalInvoice='71000000-0000-4000-8000-000000000003';
  await db.query(`INSERT INTO invoices(id,company_id,number,date,due_date,contact_id,subtotal,vat_rate,vat_amount,total,paid_amount,status) VALUES($1,$2,103,'2026-02-01','2026-03-01',$3,100,0,0,100,0,'unpaid')`,[approvalInvoice,c,contact]);
  const pendingReceipt=(await db.query(`SELECT create_voucher_receipt_atomic($1,'2026-02-03','client',$2,60,$3,'pending receipt',$4::jsonb,FALSE,TRUE,$5) result`,[c,contact,b,JSON.stringify([{invoice_id:approvalInvoice,amount:60}]),u])).rows[0].result;
  assert.ok(pendingReceipt.approval_id);
  assert.equal((await db.query(`SELECT journal_entry_id FROM voucher_receipts WHERE id=$1`,[pendingReceipt.id])).rows[0].journal_entry_id,null);
  assert.equal(Number((await db.query(`SELECT paid_amount FROM invoices WHERE id=$1`,[approvalInvoice])).rows[0].paid_amount),0);
  const approvedReceipt=(await db.query(`SELECT respond_voucher_receipt_approval($1,$2,'approve',$3,NULL,'ok') result`,[c,pendingReceipt.approval_id,u])).rows[0].result;
  assert.ok(approvedReceipt.journal_entry_id);
  assert.equal(Number((await db.query(`SELECT paid_amount FROM invoices WHERE id=$1`,[approvalInvoice])).rows[0].paid_amount),60);
  await assert.rejects(()=>db.query(`SELECT respond_voucher_receipt_approval($1,$2,'approve',$3,NULL,'again')`,[c,pendingReceipt.approval_id,u]));

  const supplier='73000000-0000-4000-8000-000000000001', warehouse='74000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Atomic supplier','supplier')`,[supplier,c]);
  await db.query(`INSERT INTO warehouses(id,company_id,name) VALUES($1,$2,'Main warehouse')`,[warehouse,c]);
  const poCreated=await db.query(`SELECT create_purchase_order_atomic($1,$2,'2026-02-10',$3::jsonb,'',$4) result`,[c,supplier,JSON.stringify([{description:'SKU-ATOMIC',quantity:2,unit_price:10}]),u]);
  const purchaseOrder=poCreated.rows[0].result.id;
  assert.equal(Number(poCreated.rows[0].result.total),20);
  const [receiptOne,receiptReplay]=await Promise.all([
    db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-02-11',$3) result`,[c,purchaseOrder,u]),
    db.query(`SELECT receive_purchase_order_atomic($1,$2,NULL,'2026-02-11',$3) result`,[c,purchaseOrder,u]),
  ]);
  assert.equal(receiptOne.rows[0].result.status,'received');
  assert.equal(receiptReplay.rows[0].result.status,'received');
  assert.equal(Number((await db.query(`SELECT quantity FROM inventory_items WHERE company_id=$1 AND code='SKU-ATOMIC'`,[c])).rows[0].quantity),2);
  assert.equal((await db.query(`SELECT count(*)::int count FROM inventory_transactions WHERE company_id=$1 AND reference_id=$2`,[c,purchaseOrder])).rows[0].count,1);
  const cancellable=(await db.query(`SELECT create_purchase_order_atomic($1,$2,'2026-02-10',$3::jsonb,'',$4) result`,[c,supplier,JSON.stringify([{description:'SKU-CANCEL',quantity:1,unit_price:5}]),u])).rows[0].result.id;
  assert.equal((await db.query(`SELECT cancel_purchase_order_atomic($1,$2,$3) result`,[c,cancellable,u])).rows[0].result.status,'cancelled');
  assert.equal((await db.query(`SELECT cancel_purchase_order_atomic($1,$2,$3) result`,[c,cancellable,u])).rows[0].result.already_processed,true);

  await db.query(`SELECT create_employee_advance($1,$2,'2026-02-01',100,'advance',$3,$4)`, [c, e, b, u]);
  await db.query(`SELECT post_payroll_batch($1,'2026-02-01',$2::uuid[],$3)`, [c, [e], u]);
  const payroll = await db.query('SELECT advance_deduction,net_pay,gosi_employer,gosi_employee FROM payroll WHERE company_id=$1', [c]);
  assert.equal(Number(payroll.rows[0].advance_deduction), 100);
  // GOSI (096): حصة صاحب العمل 11.75%، حصة الموظف 9.75% تدفع من الصافي
  assert.equal(Number(payroll.rows[0].gosi_employer), 117.5);
  assert.equal(Number(payroll.rows[0].gosi_employee), 97.5);
  assert.equal(Number(payroll.rows[0].net_pay), 802.5);

  await db.query(`SELECT create_salary_sheet($1,'February',2,2026,'2026-02-01',$2::jsonb)`, [
    c, JSON.stringify([{ employee_id: e, basic_salary: 1000, allowances: 10, deductions: 5 }]),
  ]);
  const sheet = await db.query('SELECT id FROM salary_sheets WHERE company_id=$1', [c]);
  await db.query('SELECT delete_draft_salary_sheet($1,$2)', [c, sheet.rows[0].id]);
  assert.equal((await db.query('SELECT count(*) count FROM salary_items')).rows[0].count, 0);

  const opened = await db.query(`SELECT open_custody_file($1,$2,'2026-02-02',200,'custody',$3,NULL,$4) result`, [c, e, b, u]);
  const custodyId = opened.rows[0].result.id;
  await db.query(`SELECT add_custody_funds($1,$2,'2026-02-02',100,'add',$3,$4)`, [c, custodyId, b, u]);
  await db.query(`SELECT post_custody_expense($1,$2,'2026-02-03',250,'expense',$3,NULL,false,NULL,NULL,$4)`, [c, custodyId, a['5100'], u]);
  await db.query(`SELECT settle_custody_file($1,$2,'2026-02-04',50,$3,'close',$4)`, [c, custodyId, b, u]);
  const custody = await db.query('SELECT status,remaining_amount FROM custodies WHERE id=$1', [custodyId]);
  assert.equal(custody.rows[0].status, 'settled');
  assert.equal(Number(custody.rows[0].remaining_amount), 0);

  const petty=await db.query(`SELECT create_petty_cash_box($1,'Petty',100,1000,'SAR',NULL,'',$2,$3,$4) result`,
    [c,a['1150'],a['3000'],u]);
  const pettyId=petty.rows[0].result.id;
  await db.query(`SELECT post_petty_cash_transaction($1,$2,'deposit',50,'fund','general',NULL,'','','2026-02-05',$3,$4)`,[c,pettyId,a['1000'],u]);
  const pettyConcurrent=await Promise.allSettled([1,2].map(()=>db.query(
    `SELECT post_petty_cash_transaction($1,$2,'withdrawal',100,'spend','general',NULL,'','','2026-02-05',$3,$4)`,[c,pettyId,a['5100'],u])));
  assert.equal(pettyConcurrent.filter((r)=>r.status==='fulfilled').length,1);
  assert.equal(pettyConcurrent.filter((r)=>r.status==='rejected').length,1);
  const pettyBalance=await db.query(`SELECT current_balance FROM get_petty_cash_balances($1,$2)`,[c,pettyId]);
  assert.equal(Number(pettyBalance.rows[0].current_balance),50);
  await db.query(`SELECT reconcile_petty_cash_box($1,$2,50,'count',$3)`,[c,pettyId,u]);
  await db.query(`SELECT post_petty_cash_transaction($1,$2,'withdrawal',50,'empty','general',NULL,'','','2026-02-05',$3,$4)`,[c,pettyId,a['5100'],u]);
  await db.query(`SELECT close_petty_cash_box($1,$2,$3)`,[c,pettyId,u]);

  const equipmentCost=await db.query(`SELECT post_equipment_cost($1,NULL,$2,'2026-02-05','fuel',25,2,'fuel',$3,$4,$5) result`,
    [c,project,a['5100'],a['1000'],u]);
  assert.ok(equipmentCost.rows[0].result.journal_entry_id);

  const projectExpense=await db.query(`SELECT post_project_expense($1,$2,'other','project cost',100,'2026-02-05',NULL,$3,$4,'',0,$5) result`,
    [c,project,b,a['5100'],u]);
  await db.query(`SELECT cancel_project_expense($1,$2,$3)`,[c,projectExpense.rows[0].result.id,u]);
  await db.query(`SELECT post_cash_transaction($1,'2026-02-05','revenue',115,$2,NULL,$3,NULL,NULL,'sale','',0.15,$4)`, [c, a['4100'], b, u]);
  // The bank row lock and in-transaction ledger check must permit exactly one
  // of two concurrent withdrawals that individually fit but jointly overdraw.
  const concurrent = await Promise.allSettled([1, 2].map(() => db.query(
    `SELECT post_cash_transaction($1,'2026-02-06','expense',6000,$2,NULL,$3,NULL,NULL,'large','',0,$4)`,
    [c, a['5100'], b, u],
  )));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);

  const transaction = await db.query(`SELECT id FROM cash_transactions
    WHERE company_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [c]);
  await db.query(`SELECT update_cash_transaction_note($1,$2,'updated',$3)`, [c, transaction.rows[0].id, u]);
  await db.query(`SELECT cancel_cash_transaction($1,$2,$3)`, [c, transaction.rows[0].id, u]);
  const reversal = await db.query(`SELECT count(*) count FROM journal_entries
    WHERE reversal_of IS NOT NULL AND reference_type='cash_transaction_reversal' AND reference_id=$1`,[transaction.rows[0].id]);
  assert.equal(Number(reversal.rows[0].count), 1);

  await db.query(`SELECT create_journal_entry($1,'2026-02-07','general','Project revenue',$2,$3::jsonb)`,[
    c,u,JSON.stringify([
      {accountId:a['1000'],debit:200,credit:0,projectId:project},
      {accountId:a['4100'],debit:0,credit:200,projectId:project},
    ]),
  ]);
  const closed=await db.query(`SELECT close_project($1,$2,'2026-02-08','done',$3) result`,[c,project,u]);
  assert.ok(closed.rows[0].result.closure_journal_entry_id);
  assert.equal((await db.query('SELECT status FROM projects WHERE id=$1',[project])).rows[0].status,'completed');
  await assert.rejects(()=>db.query(`SELECT close_project($1,$2,'2026-02-08','again',$3)`,[c,project,u]));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='project_closure' AND reference_id=$2`,[c,project])).rows[0].count),1);

  const registrationAccounts=Object.keys(a).map((code)=>({
    code,name:`Account ${code}`,name_en:`Account ${code}`,
    type:['4100'].includes(code)?'revenue':['5100','5210'].includes(code)?'expense':['2140','2120'].includes(code)?'liability':code.startsWith('3')?'equity':'asset',
    parent_code:null,is_header:false,
  }));
  const registration=await db.query(`SELECT register_company(
    'Second Company','second@example.test','', 'Egypt','EG','EGP','ج.م','ar-EG',0.14,
    'Owner','hash','verify',NOW()+INTERVAL '1 day',$1::jsonb) result`,[JSON.stringify(registrationAccounts)]);
  assert.ok(registration.rows[0].result.company.id);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM subscriptions s JOIN companies c ON c.id=s.company_id WHERE c.email='second@example.test'`)).rows[0].count),1);
  const c2=registration.rows[0].result.company.id;
  const u2=registration.rows[0].result.user.id;
  const contact2='67000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Other tenant client','client')`,[contact2,c2]);

  // Project delivery SECURITY DEFINER boundaries must enforce tenant, actor,
  // lifecycle, direct-write, and concurrent-numbering invariants internally.
  await assert.rejects(()=>db.query(`INSERT INTO projects(company_id,name,contract_value,start_date,status)
    VALUES($1,'Direct bypass',10,'2026-04-01','active')`,[c]));
  await assert.rejects(()=>db.query(`SELECT create_project_atomic($1,'Foreign actor',$2,10,'2026-04-01',NULL,'active','','','[]'::jsonb,FALSE,$3)`,[
    c,contact,u2,
  ]));
  const guardedProject=(await db.query(`SELECT create_project_atomic($1,'Guarded delivery',$2,500,'2026-04-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,[
    c,contact,u,
  ])).rows[0].result;
  const foreignProject=(await db.query(`SELECT create_project_atomic($1,'Foreign delivery',$2,500,'2026-04-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,[
    c2,contact2,u2,
  ])).rows[0].result;

  // CRM, contracts, tenders, bonds and reminders are tenant-bound RPC-only
  // lifecycles even for a service-role database client.
  await assert.rejects(()=>db.query(`INSERT INTO crm_contacts(company_id,name,type,assigned_to,created_by) VALUES($1,'Direct','lead',$2,$2)`,[c,u]));
  const crm=(await db.query(`SELECT create_crm_contact_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({name:'Guarded lead',type:'lead',assigned_to:u,estimated_value:100}),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_crm_contact_atomic($1,$2,'{"name":"Cross"}'::jsonb,$3)`,[c2,crm.id,u2]));
  await assert.rejects(()=>db.query(`SELECT update_crm_contact_atomic($1,$2,$3::jsonb,$4)`,[
    c,crm.id,JSON.stringify({assigned_to:u2}),u,
  ]));
  const followup=(await db.query(`SELECT create_crm_followup_atomic($1,$2,$3::jsonb,$4) result`,[
    c,crm.id,JSON.stringify({type:'call',scheduled_at:'2026-09-01T10:00:00Z',notes:'Tenant follow-up'}),u,
  ])).rows[0].result;
  assert.ok(followup.id);
  await assert.rejects(()=>db.query(`SELECT create_crm_followup_atomic($1,$2,$3::jsonb,$4)`,[
    c2,crm.id,JSON.stringify({scheduled_at:'2026-09-01T10:00:00Z'}),u2,
  ]));

  const draftContract=(await db.query(`SELECT create_contract_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({title:'Guarded draft contract',type:'client',project_id:guardedProject.id,contact_id:contact,
      start_date:'2026-04-01',end_date:'2026-12-31',value:500,status:'draft'}),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`UPDATE contracts SET value=1 WHERE id=$1`,[draftContract.id]));
  await assert.rejects(()=>db.query(`SELECT update_contract_atomic($1,$2,'{"description":"Cross"}'::jsonb,$3)`,[c2,draftContract.id,u2]));
  await assert.rejects(()=>db.query(`SELECT create_contract_atomic($1,$2::jsonb,$3)`,[
    c,JSON.stringify({title:'Cross contract',project_id:foreignProject.id,start_date:'2026-04-01',end_date:'2026-12-31',value:1}),u,
  ]));
  // 116: contract-document storage is cancelled — the upload RPC and the
  // table are dropped, and the draft-contract delete no longer reports
  // storage paths.
  await assert.rejects(()=>db.query(`SELECT create_contract_document_atomic($1,$2,'contract.pdf','application/pdf',$3,100,'runtime',$4)`,[
    c,draftContract.id,`storage:contract-documents/${c}/${draftContract.id}/runtime.pdf`,u,
  ]));
  assert.equal((await db.query(`SELECT to_regclass('public.contract_documents') reg`)).rows[0].reg,null);
  const deletedContract=(await db.query(`SELECT delete_draft_contract_atomic($1,$2,$3) result`,[c,draftContract.id,u])).rows[0].result;
  assert.equal(deletedContract.deleted,true);
  assert.equal(deletedContract.storage_paths,undefined);
  const activeContract=(await db.query(`SELECT create_contract_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({title:'Active contract',start_date:'2026-04-01',end_date:'2026-12-31',value:500,status:'active'}),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_contract_atomic($1,$2,'{"value":1}'::jsonb,$3)`,[c,activeContract.id,u]));
  await assert.rejects(()=>db.query(`SELECT delete_draft_contract_atomic($1,$2,$3)`,[c,activeContract.id,u]));

  const bond=(await db.query(`SELECT create_bond_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({title:'Guarded bond',type:'performance_bond',amount:50,issue_date:'2026-04-01',expiry_date:'2026-12-31',
      project_id:guardedProject.id,contact_id:contact}),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`UPDATE bonds SET amount=1 WHERE id=$1`,[bond.id]));
  await assert.rejects(()=>db.query(`SELECT update_bond_atomic($1,$2,'{"amount":1}'::jsonb,$3)`,[c2,bond.id,u2]));
  const bondRace=await Promise.all([
    db.query(`SELECT transition_bond_atomic($1,$2,'release','',$3) result`,[c,bond.id,u]),
    db.query(`SELECT transition_bond_atomic($1,$2,'release','',$3) result`,[c,bond.id,u]),
  ]);
  assert.equal(bondRace.filter((result)=>result.rows[0].result.already_processed===false).length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_type='bond' AND entity_id=$1 AND action='release'`,[bond.id])).rows[0].count),1);

  await db.query(`SELECT update_contact_atomic($1,$2,$3::jsonb,$4)`,[c,contact,JSON.stringify({phone:'201000000000'}),u]);
  const reminderInvoice=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,'2026-02-01','2026-03-01',$3::jsonb,0.15,TRUE,'sale',0,NULL,$4) result`,[
    c,contact,JSON.stringify([{description:'Reminder invoice',quantity:1,unitPrice:10,discount:0}]),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`INSERT INTO reminder_log(company_id,invoice_id,channel,status,sent_by) VALUES($1,$2,'whatsapp','sent',$3)`,[
    c,reminderInvoice.id,u,
  ]));
  await assert.rejects(()=>db.query(`SELECT begin_invoice_reminder_attempt_atomic($1,$2,$3)`,[c2,reminderInvoice.id,u2]));
  const reminderRace=await Promise.allSettled([
    db.query(`SELECT begin_invoice_reminder_attempt_atomic($1,$2,$3) result`,[c,reminderInvoice.id,u]),
    db.query(`SELECT begin_invoice_reminder_attempt_atomic($1,$2,$3) result`,[c,reminderInvoice.id,u]),
  ]);
  assert.equal(reminderRace.filter((result)=>result.status==='fulfilled').length,1);
  const reminder=reminderRace.find((result)=>result.status==='fulfilled').value.rows[0].result;
  const finishedReminder=(await db.query(`SELECT finish_invoice_reminder_attempt_atomic($1,$2,$3,TRUE,'https://wa.me/test',NULL) result`,[
    c,reminder.reminder_id,u,
  ])).rows[0].result;
  assert.equal(finishedReminder.status,'sent');
  assert.equal((await db.query(`SELECT finish_invoice_reminder_attempt_atomic($1,$2,$3,TRUE,'https://wa.me/test',NULL) result`,[
    c,reminder.reminder_id,u,
  ])).rows[0].result.already_processed,true);

  await assert.rejects(()=>db.query(`SELECT create_boq_item_atomic($1,$2,'CROSS','cross','u',1,1,$3)`,[
    c,foreignProject.id,u,
  ]));
  await assert.rejects(()=>db.query(`INSERT INTO boq_items(company_id,project_id,item_code,description,unit,quantity,unit_price,total)
    VALUES($1,$2,'DIRECT','bypass','u',1,1,1)`,[c,guardedProject.id]));
  const boqRace=await Promise.allSettled([1,2].map(()=>db.query(
    `SELECT create_boq_item_atomic($1,$2,'RACE','race','u',1,10,$3) result`,[c,guardedProject.id,u],
  )));
  assert.equal(boqRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(boqRace.filter((result)=>result.status==='rejected').length,1);
  const guardedBoq=boqRace.find((result)=>result.status==='fulfilled').value.rows[0].result;
  await db.query(`SELECT update_boq_item_atomic($1,$2,'{"quantity":2}'::jsonb,$3)`,[c,guardedBoq.id,u]);
  await assert.rejects(()=>db.query(`UPDATE boq_items SET quantity=3 WHERE id=$1`,[guardedBoq.id]));
  await assert.rejects(()=>db.query(`SELECT update_boq_item_atomic($1,$2,'{"quantity":3}'::jsonb,$3)`,[c2,guardedBoq.id,u2]));

  // Empty code auto-generates a project-scoped BOQ-#### code instead of asking
  // the user to type one. This is 086-boq-auto-item-code.sql behaviour.
  const autoBoq1=(await db.query(`SELECT create_boq_item_atomic($1,$2,'','auto-a','u',1,5,$3) result`,[c,guardedProject.id,u])).rows[0].result;
  const autoBoq2=(await db.query(`SELECT create_boq_item_atomic($1,$2,'','auto-b','u',1,6,$3) result`,[c,guardedProject.id,u])).rows[0].result;
  assert.equal(autoBoq1.item_code,'BOQ-0001');
  assert.equal(autoBoq2.item_code,'BOQ-0002');
  // A blank code in an update never wipes the existing code.
  await db.query(`SELECT update_boq_item_atomic($1,$2,'{"quantity":7}'::jsonb,$3)`,[c,autoBoq1.id,u]);
  const keptCode=(await db.query(`SELECT item_code FROM boq_items WHERE id=$1`,[autoBoq1.id])).rows[0].item_code;
  assert.equal(keptCode,'BOQ-0001');

  const changeRace=await Promise.all([1,2].map((index)=>db.query(
    `SELECT create_change_order_atomic($1,$2,$3,'',25,'submitted',$4) result`,[c,guardedProject.id,`Change ${index}`,u],
  )));
  assert.equal(new Set(changeRace.map((result)=>result.rows[0].result.number)).size,2);
  const guardedChange=changeRace[0].rows[0].result;
  await db.query(`SELECT update_change_order_atomic($1,$2,'{"status":"approved"}'::jsonb,$3)`,[c,guardedChange.id,u]);
  await assert.rejects(()=>db.query(`SELECT update_change_order_atomic($1,$2,'{"change_amount":1}'::jsonb,$3)`,[c,guardedChange.id,u]));
  await assert.rejects(()=>db.query(`UPDATE change_orders SET change_amount=1 WHERE id=$1`,[guardedChange.id]));
  await assert.rejects(()=>db.query(`SELECT update_change_order_atomic($1,$2,'{"status":"invoiced"}'::jsonb,$3)`,[c2,guardedChange.id,u2]));
  await db.query(`SELECT update_change_order_atomic($1,$2,'{"status":"invoiced"}'::jsonb,$3)`,[c,guardedChange.id,u]);

  await assert.rejects(()=>db.query(`UPDATE progress_billing SET gross_amount=1 WHERE id=$1`,[progressClaim.id]));
  await assert.rejects(()=>db.query(`UPDATE project_expenses SET amount=1 WHERE id=$1`,[projectExpense.rows[0].result.id]));
  const guardedEquipment=(await db.query(`SELECT create_equipment_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({name:'Guarded loader',type:'heavy',assigned_project_id:guardedProject.id,purchase_cost:100}),u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT create_equipment_atomic($1,$2::jsonb,$3)`,[
    c,JSON.stringify({name:'Cross loader',type:'heavy',assigned_project_id:foreignProject.id}),u,
  ]));
  await assert.rejects(()=>db.query(`UPDATE equipment SET status='maintenance' WHERE id=$1`,[guardedEquipment.id]));
  await assert.rejects(()=>db.query(`INSERT INTO equipment_maintenance(company_id,equipment_id,maintenance_date,description,cost)
    VALUES($1,$2,'2026-04-02','direct',1)`,[c,guardedEquipment.id]));
  const maintenance=(await db.query(`SELECT record_equipment_maintenance_atomic($1,$2,'2026-04-02','routine','service',10,'','2026-05-02','',$3) result`,[
    c,guardedEquipment.id,u,
  ])).rows[0].result;
  assert.ok(maintenance.id);
  await assert.rejects(()=>db.query(`SELECT record_equipment_maintenance_atomic($1,$2,'2026-04-03','routine','cross',0,'',NULL,'',$3)`,[
    c2,guardedEquipment.id,u2,
  ]));
  await db.query(`SELECT decommission_equipment_atomic($1,$2,$3)`,[c,guardedEquipment.id,u]);
  await assert.rejects(()=>db.query(`INSERT INTO daily_workers(company_id,name,daily_wage) VALUES($1,'direct',10)`,[c]));
  const guardedWorker=(await db.query(`SELECT create_daily_worker_atomic($1,'Guard worker','010',100,$2) result`,[c,u])).rows[0].result;
  await db.query(`SELECT update_daily_worker_atomic($1,$2,'{"daily_wage":110}'::jsonb,$3)`,[c,guardedWorker.id,u]);
  await assert.rejects(()=>db.query(`SELECT update_daily_worker_atomic($1,$2,'{"daily_wage":1}'::jsonb,$3)`,[c2,guardedWorker.id,u2]));
  await db.query(`SELECT deactivate_daily_worker_atomic($1,$2,$3)`,[c,guardedWorker.id,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type IN
    ('boq_item','change_order','equipment','equipment_maintenance','daily_worker')`,[c])).rows[0].count)>=10,true);

  // Cash/bank/POS SECURITY DEFINER boundaries must reject foreign actors and
  // links even though the database client itself has service-role privileges.
  const guardedSafe=(await db.query(`SELECT create_bank_safe($1,'Guarded Safe','safe','',0,$2) result`,[c,u])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT deactivate_bank_safe($1,$2,$3)`,[c,guardedSafe.id,u2]));
  assert.equal((await db.query(`SELECT is_active FROM banks_safes WHERE id=$1`,[guardedSafe.id])).rows[0].is_active,true);
  await assert.rejects(()=>db.query(`SELECT update_bank_safe_metadata_atomic($1,$2,'{"name":"cross"}'::jsonb,$3)`,[
    c,guardedSafe.id,u2,
  ]));
  const guardedReconciliation=(await db.query(`SELECT create_bank_reconciliation($1,$2,'2026-12-31',500,'[]'::jsonb,$3) result`,[
    c,newBank.rows[0].result.id,u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_bank_reconciliation($1,$2,500,FALSE,$3)`,[
    c,guardedReconciliation.id,u2,
  ]));
  assert.equal((await db.query(`SELECT status FROM bank_reconciliation WHERE id=$1`,[guardedReconciliation.id])).rows[0].status,'pending');
  await assert.rejects(()=>db.query(`INSERT INTO bank_reconciliation_items(company_id,reconciliation_id,transaction_type,amount,date)
    VALUES($1,$2,'cross',1,'2026-12-31')`,[c2,guardedReconciliation.id]));

  const activeCash=(await db.query(`SELECT id,reason,amount FROM cash_transactions WHERE company_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,[c])).rows[0];
  await assert.rejects(()=>db.query(`SELECT update_cash_transaction_note($1,$2,'foreign actor',$3)`,[c,activeCash.id,u2]));
  assert.equal((await db.query(`SELECT reason FROM cash_transactions WHERE id=$1`,[activeCash.id])).rows[0].reason,activeCash.reason);
  await assert.rejects(()=>db.query(`UPDATE cash_transactions SET amount=amount+1 WHERE id=$1`,[activeCash.id]));
  const cashCountBefore=Number((await db.query(`SELECT count(*) count FROM cash_transactions WHERE company_id=$1`,[c])).rows[0].count);
  await assert.rejects(()=>db.query(`SELECT post_cash_transaction($1,'2026-02-08','revenue',10,$2,NULL,$3,NULL,NULL,'foreign actor','',0,$4)`,[
    c,a['4100'],b,u2,
  ]));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM cash_transactions WHERE company_id=$1`,[c])).rows[0].count),cashCountBefore);
  const preciseCash=(await db.query(`SELECT post_cash_transaction($1,'2026-02-08','revenue',100,$2,NULL,$3,NULL,NULL,'precise tax','',0.1234,$4) result`,[
    c,a['4100'],b,u,
  ])).rows[0].result;
  assert.equal(Number((await db.query(`SELECT tax_rate FROM cash_transactions WHERE id=$1`,[preciseCash.id])).rows[0].tax_rate),0.1234);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type='cash_transaction' AND entity_id=$2 AND action='post'`,[
    c,preciseCash.id,
  ])).rows[0].count),1);
  const guardedTerminal=(await db.query(`SELECT create_pos_terminal_atomic($1,'GUARDED-POS','Guarded POS',$2,NULL,$3) result`,[c,b,u])).rows[0].result;
  assert.ok(guardedTerminal.id);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_type='pos_terminal' AND entity_id=$1`,[guardedTerminal.id])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT create_pos_terminal_atomic($1,'CROSS-POS','Cross POS',$2,NULL,$3)`,[c2,b,u2]));
  await assert.rejects(()=>db.query(`INSERT INTO pos_terminals(company_id,code,name,bank_safe_id) VALUES($1,'DIRECT-CROSS','Cross',$2)`,[c2,b]));
  const bankBalances=await db.query(`SELECT current_balance FROM get_bank_safe_balances($1,ARRAY[$2]::UUID[])`,[c,b]);
  assert.equal(bankBalances.rows.length,1);
  await assert.rejects(()=>db.query(`INSERT INTO audit_log(company_id,user_id,action) VALUES($1,$2,'cross')`,[c,u2]));

  const guardedCustody=(await db.query(`SELECT open_custody_file($1,$2,'2026-02-09',100,'guarded custody',$3,NULL,$4) result`,[
    c,e,b,u,
  ])).rows[0].result;
  const custodyMetadata=(await db.query(`SELECT update_custody_metadata_atomic($1,$2,'{"notes":"audited metadata"}'::jsonb,$3) result`,[
    c,guardedCustody.id,u,
  ])).rows[0].result;
  assert.equal(custodyMetadata.notes,'audited metadata');
  await assert.rejects(()=>db.query(`SELECT update_custody_metadata_atomic($1,$2,'{"notes":"foreign actor"}'::jsonb,$3)`,[
    c,guardedCustody.id,u2,
  ]));
  await assert.rejects(()=>db.query(`SELECT add_custody_funds($1,$2,'2026-02-09',1,'cross',$3,$4)`,[
    c2,guardedCustody.id,b,u2,
  ]));
  await assert.rejects(()=>db.query(`UPDATE custodies SET notes='direct bypass' WHERE id=$1`,[guardedCustody.id]));
  await assert.rejects(()=>db.query(`INSERT INTO custody_transactions(company_id,custody_id,type,amount,description,created_by)
    VALUES($1,$2,'addition',1,'direct bypass',$3)`,[c,guardedCustody.id,u]));
  const custodyExpenseRace=await Promise.allSettled([1,2].map(()=>db.query(
    `SELECT post_custody_expense($1,$2,'2026-02-10',80,'race expense',$3,NULL,FALSE,NULL,NULL,$4)`,
    [c,guardedCustody.id,a['5100'],u],
  )));
  assert.equal(custodyExpenseRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(custodyExpenseRace.filter((result)=>result.status==='rejected').length,1);
  assert.equal(Number((await db.query(`SELECT remaining_amount FROM custodies WHERE id=$1`,[guardedCustody.id])).rows[0].remaining_amount),20);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type='custody' AND entity_id=$2`,[
    c,guardedCustody.id,
  ])).rows[0].count)>=3,true);

  const guardedEmployee=(await db.query(`SELECT create_employee_atomic($1,'Guard Employee','010','','600','Ops','Tester','2026-02-01',$2) result`,[
    c,u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_employee_atomic($1,$2,'{"salary":700}'::jsonb,$3)`,[
    c,guardedEmployee.id,u2,
  ]));
  await assert.rejects(()=>db.query(`SELECT deactivate_employee_atomic($1,$2,$3)`,[c,guardedEmployee.id,u2]));
  await assert.rejects(()=>db.query(`UPDATE employees SET salary=999 WHERE id=$1`,[guardedEmployee.id]));
  assert.equal(Number((await db.query(`SELECT salary FROM employees WHERE id=$1`,[guardedEmployee.id])).rows[0].salary),600);

  const guardedAdvance=(await db.query(`SELECT create_employee_advance($1,$2,'2026-03-01',40,'guarded advance',$3,$4) result`,[
    c,guardedEmployee.id,b,u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_employee_advance_note_atomic($1,$2,'foreign',$3)`,[
    c,guardedAdvance.id,u2,
  ]));
  await assert.rejects(()=>db.query(`UPDATE employee_advances SET amount=1 WHERE id=$1`,[guardedAdvance.id]));
  const payrollRace=await Promise.allSettled([1,2].map(()=>db.query(
    `SELECT post_payroll_batch($1,'2026-03-01',ARRAY[$2]::UUID[],$3) result`,[c,guardedEmployee.id,u],
  )));
  assert.equal(payrollRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(payrollRace.filter((result)=>result.status==='rejected').length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM payroll WHERE company_id=$1 AND employee_id=$2 AND date='2026-03-01'`,[
    c,guardedEmployee.id,
  ])).rows[0].count),1);
  await assert.rejects(()=>db.query(`UPDATE payroll SET net_pay=1 WHERE company_id=$1 AND employee_id=$2`,[c,guardedEmployee.id]));
  await assert.rejects(()=>db.query(`SELECT cancel_employee_advance_atomic($1,$2,$3)`,[c,guardedAdvance.id,u]));
  const cancellableAdvance=(await db.query(`SELECT create_employee_advance($1,$2,'2026-03-02',25,'cancel me',$3,$4) result`,[
    c,guardedEmployee.id,b,u,
  ])).rows[0].result;
  const cancelledAdvance=(await db.query(`SELECT cancel_employee_advance_atomic($1,$2,$3) result`,[
    c,cancellableAdvance.id,u,
  ])).rows[0].result;
  assert.equal(cancelledAdvance.status,'cancelled');
  assert.ok(cancelledAdvance.reversal_journal_id);

  const fixedMetadata=(await db.query(`SELECT update_fixed_asset_metadata_atomic($1,$2,'{"notes":"guarded"}'::jsonb,$3) result`,[
    c,machine.id,u,
  ])).rows[0].result;
  assert.equal(fixedMetadata.notes,'guarded');
  await assert.rejects(()=>db.query(`SELECT update_fixed_asset_metadata_atomic($1,$2,'{"notes":"cross"}'::jsonb,$3)`,[
    c,machine.id,u2,
  ]));
  await assert.rejects(()=>db.query(`UPDATE fixed_assets SET purchase_cost=1 WHERE id=$1`,[machine.id]));
  const depreciationRace=await Promise.all([
    db.query(`SELECT depreciate_fixed_assets_batch($1,'2026-03-01',$2) result`,[c,u]),
    db.query(`SELECT depreciate_fixed_assets_batch($1,'2026-03-01',$2) result`,[c,u]),
  ]);
  assert.equal(depreciationRace.reduce((sum,result)=>sum+Number(result.rows[0].result.count),0),1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM depreciation_log WHERE company_id=$1 AND asset_id=$2 AND date='2026-03-01'`,[
    c,machine.id,
  ])).rows[0].count),1);
  await assert.rejects(()=>db.query(`INSERT INTO depreciation_log(company_id,asset_id,date,amount,journal_entry_id)
    SELECT $1,$2,'2026-04-01',1,journal_entry_id FROM fixed_assets WHERE id=$2`,[c,machine.id]));
  const disposable=(await db.query(`SELECT create_fixed_asset($1,'Disposable','D1','equipment','2026-03-02',50,5,'straight_line','','',$2,$3) result`,[
    c,b,u,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT dispose_fixed_asset_atomic($1,$2,$3)`,[c,disposable.id,u2]));
  assert.equal((await db.query(`SELECT status FROM fixed_assets WHERE id=$1`,[disposable.id])).rows[0].status,'active');
  const disposed=(await db.query(`SELECT dispose_fixed_asset_atomic($1,$2,$3) result`,[c,disposable.id,u])).rows[0].result;
  assert.equal(disposed.status,'disposed');
  assert.ok(disposed.disposal_journal_id); // 095: الشطب يرحل قيد استبعاد صريحاً بدل عكس الشراء
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND entity_type IN('employee','employee_advance','payroll','fixed_asset','fixed_assets')`,[c])).rows[0].count)>=8,true);

  await assert.rejects(()=>db.query(`SELECT update_contact_atomic($1,$2,$3::jsonb,$4)`,[
    c,contact2,JSON.stringify({name:'Cross tenant overwrite'}),u,
  ]));
  await assert.rejects(()=>db.query(`SELECT deactivate_contact_atomic($1,$2,$3)`,[c,contact2,u]));
  await assert.rejects(()=>db.query(`SELECT create_contact_atomic($1,$2,$3::jsonb,0,'debit')`,[
    c,u2,JSON.stringify({name:'Wrong tenant actor',type:'client'}),
  ]));
  await assert.rejects(()=>db.query(`UPDATE contacts SET company_id=$1 WHERE id=$2`,[c,contact2]));
  await assert.rejects(()=>db.query(`UPDATE contacts SET account_id=$1 WHERE id=$2`,[a['1130'],contact2]));
  assert.equal(Number((await db.query(`SELECT get_contact_balance($1,$2,NULL) balance`,[c,contact2])).rows[0].balance),0);
  assert.equal((await db.query(`SELECT name FROM contacts WHERE id=$1`,[contact2])).rows[0].name,'Other tenant client');
  const trialBefore=(await db.query(`SELECT end_date FROM subscriptions WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`,[c2])).rows[0].end_date;
  const trialRace=await Promise.all([
    db.query(`SELECT extend_company_trial_atomic($1,$2,7,'test') result`,[c2,'90000000-0000-4000-8000-000000000001']),
    db.query(`SELECT extend_company_trial_atomic($1,$2,7,'test') result`,[c2,'90000000-0000-4000-8000-000000000001']),
  ]);
  assert.equal(trialRace.filter(x=>x.rows[0].result.already_extended===false).length,1);
  const trialAfter=(await db.query(`SELECT end_date,trial_extended FROM subscriptions WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1`,[c2])).rows[0];
  assert.equal((new Date(trialAfter.end_date)-new Date(trialBefore))/86400000,7);
  assert.equal(trialAfter.trial_extended,true);

  const restrictedSubscription=(await db.query(`UPDATE subscriptions SET extra_users=5,extra_branches=3,extra_storage_gb=10
    WHERE company_id=$1 RETURNING id`,[c2])).rows[0].id;
  await Promise.allSettled([
    db.query(`SELECT restrict_subscription_atomic($1,$2,NULL,NULL,2,NULL,NULL,'race two')`,[restrictedSubscription,'90000000-0000-4000-8000-000000000001']),
    db.query(`SELECT restrict_subscription_atomic($1,$2,NULL,NULL,4,NULL,NULL,'race four')`,[restrictedSubscription,'90000000-0000-4000-8000-000000000001']),
  ]);
  assert.equal(Number((await db.query(`SELECT extra_users FROM subscriptions WHERE id=$1`,[restrictedSubscription])).rows[0].extra_users),2);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM admin_audit_log WHERE target_id=$1 AND action='restrict_subscription'`,[restrictedSubscription])).rows[0].count)>=1,true);
  await assert.rejects(()=>db.query(`SELECT restrict_subscription_atomic($1,$2,NULL,NULL,3,NULL,NULL,'regrant')`,[restrictedSubscription,'90000000-0000-4000-8000-000000000001']));

  const adminId='90000000-0000-4000-8000-000000000001';
  const activationPlaintext='RUNTIME-ACTIVATION-CODE';
  const activationHash=createHash('sha256').update(activationPlaintext).digest('hex');
  await db.query(`SELECT create_activation_code_batch_atomic($1,'start',1,$2,CURRENT_DATE+7,NULL,NULL,'runtime',$3::jsonb)`,
    [adminId,c2,JSON.stringify([activationHash])]);
  // PGlite's test-only digest shim uses MD5 because pgcrypto is unavailable,
  // so the stored hash must be rewritten to match what the shim will compute.
  // On a real PostgreSQL/Supabase server pgcrypto genuinely hashes SHA-256, so
  // the value inserted above is already correct and must be left untouched.
  if (!db.hasPgcrypto) {
    await db.query(`UPDATE activation_codes SET code_hash=$1 WHERE code_hash=$2`,
      [createHash('md5').update(activationPlaintext).digest('hex'),activationHash]);
  }
  const activationResult=(await db.query(`SELECT redeem_activation_code($1,$2,$3) result`,[c2,u2,activationPlaintext])).rows[0].result;
  assert.equal(activationResult.type,'plan');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE company_id=$1 AND user_id=$2 AND action='redeem_activation_code'`,[c2,u2])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT redeem_activation_code($1,$2,$3)`,[c2,u2,activationPlaintext]));

  await db.query(`SELECT set_company_status_atomic($1,$2,FALSE)`,[c2,adminId]);
  assert.equal((await db.query(`SELECT is_active FROM companies WHERE id=$1`,[c2])).rows[0].is_active,false);
  await db.query(`SELECT set_company_status_atomic($1,$2,TRUE)`,[c2,adminId]);
  const disposablePlan='61000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO subscription_plans(id,code,name,duration_days) VALUES($1,'disposable','Disposable',30)`,[disposablePlan]);
  await db.query(`SELECT delete_unused_subscription_plan_atomic($1,$2)`,[disposablePlan,adminId]);
  await assert.rejects(()=>db.query(`SELECT delete_unused_subscription_plan_atomic(plan_id,$1) FROM subscriptions WHERE id=$2`,[adminId,restrictedSubscription]));

  await assert.rejects(()=>db.query(`SELECT create_subcontractor_certificate_atomic($1,$2,CURRENT_DATE,2,'cross',10,0,$3)`,[c2,subcontract,u2]));
  await assert.rejects(()=>db.query(`SELECT create_subcontractor_payment_atomic($1,$2,$3,1,CURRENT_DATE,$4,'cross',$5)`,[c2,subcontract,certificate.id,b,u2]));
  await assert.rejects(()=>db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,CURRENT_DATE,CURRENT_DATE,$3::jsonb,0,FALSE,'',0,NULL,$4)`,[
    c,contact2,JSON.stringify([{description:'Cross tenant',quantity:1,unitPrice:10,discount:0}]),u,
  ]));
  await assert.rejects(()=>db.query(`SELECT cancel_sales_invoice_atomic($1,$2,'',$3)`,[c2,atomicSale.id,u2]));
  assert.equal((await db.query(`SELECT status FROM invoices WHERE id=$1 AND company_id=$2`,[atomicSale.id,c])).rows[0].status,'partial');

  const approver='65000000-0000-4000-8000-000000000001';
  const approvalId='65000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES($1,$2,'approver@example.test','x','Approver','manager',TRUE)`,[approver,c]);
  await db.query(`INSERT INTO approval_requests(id,company_id,entity_type,entity_id,requester_id,approver_id,status) VALUES($1,$2,'purchase_invoice',$3,$4,$5,'pending')`,[approvalId,c,purchaseInvoice,u,approver]);
  await assert.rejects(()=>db.query(`SELECT respond_approval_request_atomic($1,$2,'approve',$3,'')`,[c,approvalId,u]));
  await assert.rejects(()=>db.query(`SELECT respond_approval_request_atomic($1,$2,'approve',$3,'')`,[c2,approvalId,u2]));
  const approvalRace=await Promise.all([
    db.query(`SELECT respond_approval_request_atomic($1,$2,'approve',$3,'ok') result`,[c,approvalId,approver]),
    db.query(`SELECT respond_approval_request_atomic($1,$2,'approve',$3,'ok') result`,[c,approvalId,approver]),
  ]);
  assert.equal(approvalRace.filter(x=>x.rows[0].result.replayed===true).length,1);
  assert.equal((await db.query(`SELECT status FROM purchase_invoices WHERE id=$1`,[purchaseInvoice])).rows[0].status,'unpaid');
  assert.equal((await db.query(`SELECT approved_by FROM purchase_invoices WHERE id=$1`,[purchaseInvoice])).rows[0].approved_by,approver);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_id=$1 AND action='approve_approval'`,[approvalId])).rows[0].count),1);

  // Communications are RPC-only, tenant-bound, replay-safe, and audited.
  await assert.rejects(()=>db.query(`INSERT INTO complaints(company_id,user_id,type,subject,body) VALUES($1,$2,'complaint','Direct','Blocked')`,[c,u]));
  const tenantComplaint=(await db.query(`SELECT create_complaint_atomic($1,$2,'complaint','Tenant complaint','Tenant body') result`,[c,u])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT update_company_complaint_atomic($1,$2,$3,'{"subject":"Cross"}'::jsonb)`,[c2,u2,tenantComplaint.id]));
  const updatedComplaint=(await db.query(`SELECT update_company_complaint_atomic($1,$2,$3,'{"subject":"Updated tenant complaint"}'::jsonb) result`,[c,u,tenantComplaint.id])).rows[0].result;
  assert.equal(updatedComplaint.subject,'Updated tenant complaint');
  const archivedComplaint=(await db.query(`SELECT archive_company_complaint_atomic($1,$2,$3) result`,[c,u,tenantComplaint.id])).rows[0].result;
  assert.equal(archivedComplaint.archived,true);
  const publicComplaint=(await db.query(`SELECT create_complaint_atomic(NULL,NULL,'suggestion','Public suggestion','Public body') result`)).rows[0].result;
  assert.ok(publicComplaint.id);

  await assert.rejects(()=>db.query(`INSERT INTO messages(company_id,subject,body,direction) VALUES($1,'Direct','Blocked','company_to_admin')`,[c]));
  const outgoing=(await db.query(`SELECT send_company_message_atomic($1,$2,'Runtime subject','Runtime body') result`,[c,u])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT archive_company_message_atomic($1,$2,$3)`,[c2,u2,outgoing.id]));
  const archived=(await db.query(`SELECT archive_company_message_atomic($1,$2,$3) result`,[c,u,outgoing.id])).rows[0].result;
  assert.equal(archived.archived,true);
  const archivedReplay=(await db.query(`SELECT archive_company_message_atomic($1,$2,$3) result`,[c,u,outgoing.id])).rows[0].result;
  assert.equal(archivedReplay.already_processed,true);
  const adminMessage=(await db.query(`SELECT admin_send_company_message($1,$2,'Admin subject','Admin body') result`,[
    '90000000-0000-4000-8000-000000000001',c,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT mark_company_message_read_atomic($1,$2,$3)`,[c2,u2,adminMessage.id]));
  const readMessage=(await db.query(`SELECT mark_company_message_read_atomic($1,$2,$3) result`,[c,u,adminMessage.id])).rows[0].result;
  assert.equal(readMessage.is_read,true);

  const configPayload=(chat)=>JSON.stringify({chat_id:chat,is_enabled:true,notify_invoices:true,
    notify_cash_transactions:true,notify_user_logins:true,approvals_enabled:true,approval_threshold:100});
  await db.query(`SELECT save_telegram_config_atomic($1,$2,$3::jsonb)`,[c,u,configPayload('1')]);
  await db.query(`SELECT save_telegram_config_atomic($1,$2,$3::jsonb)`,[c2,u2,configPayload('2')]);
  await assert.rejects(()=>db.query(`UPDATE company_telegram_configs SET chat_id='99' WHERE company_id=$1`,[c]));
  await assert.rejects(()=>db.query(`SELECT save_telegram_config_atomic($1,$2,$3::jsonb)`,[c2,u2,configPayload('1')]));

  await assert.rejects(()=>db.query(`INSERT INTO telegram_test_runs(company_id,status,created_by) VALUES($1,'pending',$2)`,[c,u]));
  const testRun=(await db.query(`SELECT create_telegram_test_run_atomic($1,$2) result`,[c,u])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT finish_telegram_test_run_atomic($1,'2','accept')`,[testRun.id]));
  const finishedTest=(await db.query(`SELECT finish_telegram_test_run_atomic($1,'1','accept') result`,[testRun.id])).rows[0].result;
  assert.equal(finishedTest.status,'accepted');
  await assert.rejects(()=>db.query(`SELECT finish_telegram_test_run_atomic($1,'1','accept')`,[testRun.id]));
  const testRace=await Promise.allSettled([
    db.query(`SELECT create_telegram_test_run_atomic($1,$2) result`,[c,u]),
    db.query(`SELECT create_telegram_test_run_atomic($1,$2) result`,[c,u]),
  ]);
  assert.equal(testRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(testRace.filter((result)=>result.status==='rejected').length,1);
  const pendingTest=testRace.find((result)=>result.status==='fulfilled').value.rows[0].result;
  await db.query(`SELECT expire_telegram_test_run_atomic($1,$2,$3)`,[c,pendingTest.id,u]);

  const approvalJournal=(await db.query(`SELECT create_journal_entry($1,'2026-08-01','general','Telegram approval source',$2,$3::jsonb) result`,[
    c,u,JSON.stringify([{accountId:a['5100'],debit:15,credit:0},{accountId:a['1000'],debit:0,credit:15}]),
  ])).rows[0].result;
  const telegramApproval=(await db.query(`SELECT create_approval_request_atomic($1,'journal_entry',$2,'Telegram runtime',$3) result`,[
    c,approvalJournal.id,approver,
  ])).rows[0].result;
  await assert.rejects(()=>db.query(`SELECT respond_approval_by_telegram_atomic($1,'approve','2','')`,[telegramApproval.id]));
  const telegramRace=await Promise.all([
    db.query(`SELECT respond_approval_by_telegram_atomic($1,'approve','1','') result`,[telegramApproval.id]),
    db.query(`SELECT respond_approval_by_telegram_atomic($1,'approve','1','') result`,[telegramApproval.id]),
  ]);
  assert.equal(telegramRace.filter((result)=>result.rows[0].result.replayed===true).length,1);
  assert.equal((await db.query(`SELECT approver_chat_id FROM approval_requests WHERE id=$1`,[telegramApproval.id])).rows[0].approver_chat_id,'1');
  assert.equal((await db.query(`SELECT status FROM journal_entries WHERE id=$1`,[approvalJournal.id])).rows[0].status,'posted');
  const rejectedJournal=(await db.query(`SELECT create_journal_entry($1,'2026-08-02','general','Rejected approval source',$2,$3::jsonb) result`,[
    c,u,JSON.stringify([{accountId:a['5100'],debit:12,credit:0},{accountId:a['1000'],debit:0,credit:12}]),
  ])).rows[0].result;
  const rejectedApproval=(await db.query(`SELECT create_approval_request_atomic($1,'journal_entry',$2,'Reject runtime',$3) result`,[
    c,rejectedJournal.id,approver,
  ])).rows[0].result;
  const rejectedResult=(await db.query(`SELECT respond_approval_request_atomic($1,$2,'reject',$3,'rejected') result`,[
    c,rejectedApproval.id,u,
  ])).rows[0].result;
  assert.equal(rejectedResult.status,'rejected');
  const rejectedSource=(await db.query(`SELECT status,reversed_by FROM journal_entries WHERE id=$1`,[rejectedJournal.id])).rows[0];
  assert.equal(rejectedSource.status,'rejected');
  assert.ok(rejectedSource.reversed_by);
  const rejectReplay=(await db.query(`SELECT respond_approval_request_atomic($1,$2,'reject',$3,'rejected') result`,[
    c,rejectedApproval.id,u,
  ])).rows[0].result;
  assert.equal(rejectReplay.replayed,true);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE reversal_of=$1`,[rejectedJournal.id])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT create_approval_request_atomic($1,'journal_entry',$2,'Cross tenant',$3)`,[c2,approvalJournal.id,u2]));

  await assert.rejects(()=>db.query(`INSERT INTO push_subscriptions(company_id,user_id,endpoint) VALUES($1,$2,'https://push.invalid/direct')`,[c,u]));
  const endpoint='https://push.example.test/runtime';
  const pushSub=(await db.query(`SELECT upsert_push_subscription_atomic($1,$2,$3,'p256','auth','runtime') result`,[c,u,endpoint])).rows[0].result;
  assert.ok(pushSub.id);
  await assert.rejects(()=>db.query(`SELECT upsert_push_subscription_atomic($1,$2,$3,'p256','auth','runtime')`,[c2,u2,endpoint]));
  await assert.rejects(()=>db.query(`SELECT queue_push_notifications_atomic($1,$2,$3::jsonb)`,[
    c,u,JSON.stringify({title:'Cross',message:'Blocked',target_user_id:u2}),
  ]));
  const queued=(await db.query(`SELECT queue_push_notifications_atomic($1,$2,$3::jsonb) result`,[
    c,u,JSON.stringify({title:'Runtime push',message:'Tenant bound',url:'/dashboard',target_user_id:u,
      actions:[{action:'open',title:'Open'}]}),
  ])).rows[0].result;
  assert.equal(Number(queued.users),1);
  assert.equal(Number(queued.queued),1);
  await assert.rejects(()=>db.query(`INSERT INTO push_notification_log(company_id,subscription_id,user_id,title,body) VALUES($1,$2,$3,'Direct','Blocked')`,[c,pushSub.id,u]));
  await assert.rejects(()=>db.query(`SELECT deactivate_push_subscription_atomic($1,$2,$3)`,[c2,u2,endpoint]));
  const unsubscribed=(await db.query(`SELECT deactivate_push_subscription_atomic($1,$2,$3) result`,[c,u,endpoint])).rows[0].result;
  assert.equal(unsubscribed.unsubscribed,true);

  const deactivatedUser=(await db.query(`SELECT deactivate_company_user_atomic($1,$2,$3) result`,[c,approver,u])).rows[0].result;
  assert.equal(deactivatedUser.is_active,false);
  assert.equal((await db.query(`SELECT is_active FROM users WHERE id=$1`,[approver])).rows[0].is_active,false);

  const moduleId='64000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO custom_modules(id,company_id,name,code,is_system,created_by) VALUES($1,$2,'Runtime module','runtime_module',FALSE,$3)`,[moduleId,c,u]);
  await db.query(`INSERT INTO user_permissions(company_id,user_id,module,permissions) VALUES($1,$2,'Runtime module','["read"]'::jsonb)`,[c,u]);
  await db.query(`SELECT delete_custom_module_atomic($1,$2,$3)`,[c,moduleId,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM user_permissions WHERE company_id=$1 AND module='Runtime module'`,[c])).rows[0].count),0);

  const parentTask=(await db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({project_id:project,name:'Parent',start_date:'2026-01-01',end_date:'2026-01-02',progress:0}),u,
  ])).rows[0].result.id;
  const childTask=(await db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({project_id:project,name:'Child',start_date:'2026-01-01',end_date:'2026-01-02',progress:0,parent_task_id:parentTask}),u,
  ])).rows[0].result.id;
  const grandTask=(await db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({project_id:project,name:'Grand',start_date:'2026-01-01',end_date:'2026-01-02',progress:0,parent_task_id:childTask}),u,
  ])).rows[0].result.id;
  await assert.rejects(()=>db.query(`SELECT create_project_task_atomic($1,$2::jsonb,$3)`,[
    c,JSON.stringify({project_id:foreignProject.id,name:'Cross task',start_date:'2026-01-01',end_date:'2026-01-02'}),u,
  ]));
  await assert.rejects(()=>db.query(`SELECT update_project_task_atomic($1,$2,$3::jsonb,$4)`,[
    c,parentTask,JSON.stringify({parent_task_id:grandTask}),u,
  ]));
  await assert.rejects(()=>db.query(`UPDATE project_tasks SET name='Direct' WHERE id=$1`,[parentTask]));
  const deletedTasks=(await db.query(`SELECT delete_unstarted_project_task_atomic($1,$2,$3) result`,[c,parentTask,u])).rows[0].result;
  assert.equal(Number(deletedTasks.deleted_tasks),3);

  await assert.rejects(()=>db.query(`INSERT INTO tenders(company_id,title,client_name,status,created_by) VALUES($1,'Direct tender','Client','draft',$2)`,[c,u]));
  const wonTender=(await db.query(`SELECT create_tender_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({title:'Won runtime tender',client_name:'Client',contact_id:contact,estimated_value:500,
      project_duration_months:2,status:'preparing'}),u,
  ])).rows[0].result.id;
  await assert.rejects(()=>db.query(`SELECT update_tender_atomic($1,$2,'{"title":"Cross"}'::jsonb,$3)`,[c2,wonTender,u2]));
  await db.query(`SELECT transition_tender_atomic($1,$2,'submitted','',$3)`,[c,wonTender,u]);
  await db.query(`SELECT transition_tender_atomic($1,$2,'won','',$3)`,[c,wonTender,u]);
  const tenderRace=await Promise.all([
    db.query(`SELECT convert_won_tender_to_project_atomic($1,$2,$3) result`,[c,wonTender,u]),
    db.query(`SELECT convert_won_tender_to_project_atomic($1,$2,$3) result`,[c,wonTender,u]),
  ]);
  assert.equal(tenderRace.filter(x=>x.rows[0].result.already_processed===false).length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM projects WHERE company_id=$1 AND tender_id=$2`,[c,wonTender])).rows[0].count),1);
  const draftTender=(await db.query(`SELECT create_tender_atomic($1,$2::jsonb,$3) result`,[
    c,JSON.stringify({title:'Draft runtime tender',client_name:'Client'}),u,
  ])).rows[0].result.id;
  await db.query(`SELECT create_tender_cost_item_atomic($1,$2,$3::jsonb,$4)`,[
    c,draftTender,JSON.stringify({category:'materials',amount:10}),u,
  ]);
  await db.query(`SELECT delete_draft_tender_atomic($1,$2,$3)`,[c,draftTender,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM tender_cost_items WHERE tender_id=$1`,[draftTender])).rows[0].count),0);

  // 089: ميزة «نسخة قاعدة البيانات + الاستعادة» أزيلت نهائياً بقرار المالك.
  // جداولا backup_logs وcompany_data_exports أُسقطا — والاختبار يمنع عودتهما.
  assert.equal((await db.query(`SELECT to_regclass('public.backup_logs') t`)).rows[0].t, null);
  assert.equal((await db.query(`SELECT to_regclass('public.company_data_exports') t`)).rows[0].t, null);

  const vatSummary=(await db.query(`SELECT get_vat_return_summary($1,'2026-01-01','2026-02-28') result`,[c])).rows[0].result;
  const vatFiling=(await db.query(`SELECT create_vat_return_filing_atomic($1,'2026-01-01','2026-02-28','filed','runtime',$2) result`,[c,u])).rows[0].result;
  assert.equal(Number(vatFiling.output_vat),Number(vatSummary.outputVat));
  assert.equal(Number(vatFiling.input_vat),Number(vatSummary.inputVat));
  await assert.rejects(()=>db.query(`SELECT create_vat_return_filing_atomic($1,'2026-01-01','2026-02-28','filed','duplicate',$2)`,[c,u]));
  await assert.rejects(()=>db.query(`SELECT create_vat_return_filing_atomic($1,'2026-02-15','2026-03-31','draft','overlap',$2)`,[c,u]));
  const filingRace=await Promise.allSettled([
    db.query(`SELECT create_vat_return_filing_atomic($1,'2026-04-01','2026-05-31','filed','race one',$2)`,[c,u]),
    db.query(`SELECT create_vat_return_filing_atomic($1,'2026-05-01','2026-06-30','filed','race two',$2)`,[c,u]),
  ]);
  assert.equal(filingRace.filter((result)=>result.status==='fulfilled').length,1);
  assert.equal(filingRace.filter((result)=>result.status==='rejected').length,1);
  await db.query(`SELECT create_vat_return_filing_atomic($1,'2026-07-01','2026-07-15','draft','draft one',$2)`,[c,u]);
  await db.query(`SELECT create_vat_return_filing_atomic($1,'2026-07-10','2026-07-31','draft','draft two',$2)`,[c,u]);
  await assert.rejects(()=>db.query(`SELECT create_vat_return_filing_atomic($1,'2026-03-01','2026-03-31','filed','cross',$2)`,[c2,u]));

  const expiredCompany='66000000-0000-4000-8000-000000000001';
  const expiredUser='66000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO companies(id,name,is_active) VALUES($1,'Expired tenant',TRUE)`,[expiredCompany]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active,created_at,last_activity) VALUES($1,$2,'expired@example.test','x','Old','admin',TRUE,NOW()-INTERVAL '30 days',NOW()-INTERVAL '30 days')`,[expiredUser,expiredCompany]);
  await db.query(`INSERT INTO subscriptions(company_id,plan_code,status,start_date,end_date) VALUES($1,'start','expired',CURRENT_DATE-60,CURRENT_DATE-30)`,[expiredCompany]);
  const deactivated=(await db.query(`SELECT deactivate_inactive_expired_companies(NOW()-INTERVAL '16 days') result`)).rows[0].result;
  assert.ok(Number(deactivated.deactivated_companies)>=1);
  assert.equal((await db.query(`SELECT is_active FROM companies WHERE id=$1`,[expiredCompany])).rows[0].is_active,false);
  assert.equal((await db.query(`SELECT count(*)::int count FROM companies WHERE id=$1`,[expiredCompany])).rows[0].count,1);

  await db.query(`SELECT save_telegram_config_atomic($1,$2,$3::jsonb)`,[
    c,u,JSON.stringify({chat_id:'1',is_enabled:true,notify_invoices:true,notify_cash_transactions:true,
      notify_user_logins:true,approvals_enabled:true,approval_threshold:100}),
  ]);
  // 088: تصفير قاعدة بيانات الشركة أُزيل نهائياً (قرار تشغيلي) — دواله محذوفة
  // من القاعدة نفسها؛ الاختبار يمنع عودة أي منها.
  const removedFns = [
    'start_telegram_reset_session_atomic(UUID,UUID)',
    'approve_telegram_reset_session_atomic(TEXT,TEXT,TIMESTAMPTZ)',
    'reset_company_business_data(UUID,UUID,TEXT)',
  ];
  for (const fnSig of removedFns) {
    const reg = (await db.query('SELECT to_regprocedure($1) t', [`public.${fnSig}`])).rows[0].t;
    assert.equal(reg, null, `${fnSig} must stay removed (migration 088)`);
  }
}

/**
 * Tenant isolation under Supabase's role model (migration 063).
 *
 * Everything else in this suite runs as the database owner, which BYPASSES row
 * level security — so a broken policy stays invisible here no matter how many
 * atomic writers pass. Supabase serves requests as `anon`/`authenticated`,
 * roles that RLS genuinely applies to. These assertions run as `authenticated`
 * with a forged JWT claim, which is the only way the following regressions are
 * observable:
 *
 *   - a legacy `USING (true)` policy left on `invoices` by 011 that OR-ed the
 *     real isolation policy away and exposed every tenant's invoices;
 *   - a policy keyed to a GUC (`app.current_company`) that nothing sets, which
 *     silently denies all rows;
 *   - a SECURITY DEFINER helper reachable by `anon` without a pinned
 *     search_path.
 */
async function smokeTenantIsolationUnderRls() {
  const A = '78000000-0000-4000-8000-00000000000a';
  const B = '78000000-0000-4000-8000-00000000000b';
  const ca = '78000000-0000-4000-8000-00000000000c';
  const cb = '78000000-0000-4000-8000-00000000000d';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'RLS tenant A'),($2,'RLS tenant B')`, [A, B]);
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'RLS A','both'),($3,$4,'RLS B','both')`,
    [ca, A, cb, B]);
  await db.query(`INSERT INTO invoices(company_id,number,date,due_date,contact_id,
      subtotal,vat_rate,tax_rate,vat_amount,tax_amount,total)
    VALUES($1,9001,CURRENT_DATE,CURRENT_DATE,$3,100,0,0,0,0,100),
          ($2,9001,CURRENT_DATE,CURRENT_DATE,$4,200,0,0,0,0,200)`, [A, B, ca, cb]);

  // No table carrying a company_id may be left with RLS switched off. 027
  // enrolled tables from a hardcoded list, so 51 tables added afterwards were
  // silently unprotected; discovering them from the catalogue is what keeps
  // that from drifting again as new tenant tables are added.
  const unprotected = await db.query(`
    SELECT c.relname AS tbl FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped)`);
  assert.deepEqual(unprotected.rows.map((r) => r.tbl), [],
    'every table with a company_id must have RLS enabled');

  // Every tenant table must use ONE policy shape. A second shape means a table
  // drifted away from 027 and is either leaking or dead.
  const shapes = await db.query(`
    SELECT DISTINCT pg_get_expr(pol.polqual, pol.polrelid) AS expr
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped)`);
  assert.deepEqual(shapes.rows.map((r) => r.expr), ['(company_id = tenant_company_id())'],
    'every tenant policy must use the canonical tenant_company_id() shape');

  // No tenant table may have RLS on with no policy: that denies all rows.
  const denyAll = await db.query(`
    SELECT c.relname AS tbl FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
      AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped)
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`);
  assert.deepEqual(denyAll.rows.map((r) => r.tbl), [], 'tenant tables with RLS on must carry a policy');

  // Supabase's linter (0011_function_search_path_mutable) flags EVERY
  // function without a pinned search_path, not just SECURITY DEFINER ones —
  // an unpinned function resolves object names through the caller's
  // search_path, which is a name-shadowing vector for any function that
  // privileged code (RPCs, triggers, policies) calls. 064 pins the whole
  // catalogue; this asserts no later migration regresses it. Extension-owned
  // members (deptype 'e') are excluded, same as 064's sweep.
  const unpinned = await db.query(`
    SELECT p.proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname='public' AND p.prokind IN ('f','p') AND l.lanname IN ('sql','plpgsql')
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) cfg WHERE cfg LIKE 'search_path=%')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`);
  assert.deepEqual(unpinned.rows.map((r) => r.proname), [],
    'every function must pin search_path (Supabase linter 0011)');

  // Materialized views bypass RLS entirely, so API roles must never hold
  // privileges on them (Supabase linter 0016_materialized_view_in_api).
  const mvGrants = await db.query(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='m'
      AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT'))`);
  assert.deepEqual(mvGrants.rows.map((r) => r.relname), [],
    'materialized views must not be readable by anon/authenticated');

  // The behavioural proof: read `invoices` as a role RLS applies to.
  await db.exec('GRANT SELECT ON invoices TO authenticated');
  await db.exec('SET ROLE authenticated');
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ company_id: A })]);
  const visible = await db.query('SELECT company_id FROM invoices WHERE number = 9001');
  await db.exec('RESET ROLE');
  assert.equal(visible.rows.length, 1, 'tenant A must not see tenant B invoices');
  assert.equal(visible.rows[0].company_id, A);

  // A missing/blank claim must deny rather than expose everything.
  await db.exec('SET ROLE authenticated');
  await db.query(`SELECT set_config('request.jwt.claims', '', false)`);
  const anonymous = await db.query('SELECT company_id FROM invoices WHERE number = 9001');
  await db.exec('RESET ROLE');
  assert.equal(anonymous.rows.length, 0, 'a request without a company claim must see nothing');
}

/**
 * Regression for migration 068: an additional (non-admin) user's voucher above
 * the approval threshold must be answerable from the Telegram-bound chat even
 * when company_telegram_configs.configured_by is NULL (legacy rows) or stale.
 * Previously the decision RPC raised and the admin saw the generic "انتهى
 * الطلب أو لا تملك صلاحية معالجته" message on every approve press.
 */
async function smokeTelegramApprovalActorFallback() {
  const c = '81000000-0000-4000-8000-000000000001';
  const admin = '81000000-0000-4000-8000-000000000002';
  const clerk = '81000000-0000-4000-8000-000000000003';
  const bank = '81000000-0000-4000-8000-000000000004';
  const contact = '81000000-0000-4000-8000-000000000005';
  const cashAccount = '81000000-0000-4000-8000-000000000006';
  const payableAccount = '81000000-0000-4000-8000-000000000007';

  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Telegram approval fallback')`, [c]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES
    ($1,$2,'tg-admin@example.test','x','Admin','admin',TRUE),
    ($3,$2,'tg-clerk@example.test','x','Clerk','accountant',TRUE)`, [admin, c, clerk]);
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Supplier','supplier')`, [contact, c]);
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1110','Cash','asset',FALSE),($3,$2,'2110','Payables','liability',FALSE)`, [cashAccount, c, payableAccount]);
  await db.query(`INSERT INTO banks_safes(id,company_id,name,type,account_id,is_active) VALUES($1,$2,'Bank','bank',$3,TRUE)`, [bank, c, cashAccount]);
  await db.query(`SELECT create_journal_entry($1,'2026-01-01','opening_balance','Opening',$2,$3::jsonb)`, [
    c, admin, JSON.stringify([
      { accountId: cashAccount, debit: 10000, credit: 0 },
      { accountId: payableAccount, debit: 0, credit: 10000 },
    ]),
  ]);

  // Enable approvals bound to chat '900'.
  await db.query(`SELECT save_telegram_config_atomic($1,$2,$3::jsonb)`, [
    c, admin, JSON.stringify({
      chat_id: '900', is_enabled: true, notify_invoices: true,
      notify_cash_transactions: true, notify_user_logins: true,
      approvals_enabled: true, approval_threshold: 100,
    }),
  ]);

  // Simulate a legacy configuration: configured_by is missing. The
  // communication write guard requires the audited-function GUC.
  await db.query(`DO $$
    BEGIN
      PERFORM set_config('app.communication_write_company', '${c}', TRUE);
      UPDATE company_telegram_configs SET configured_by = NULL WHERE company_id = '${c}';
    END $$;`);

  // The additional user requests a disbursement above the threshold.
  const pending = await db.query(
    `SELECT create_voucher_disbursement_atomic($1,'2026-02-01','supplier',$2,NULL,250,$3,'legacy approval',$4::jsonb,TRUE,$5) result`,
    [c, contact, bank, JSON.stringify([]), clerk],
  );
  const approvalId = pending.rows[0].result.approval_id;
  assert.ok(approvalId);

  // The bound chat answers "approve": the decision must succeed despite
  // configured_by being NULL.
  const decision = await db.query(`SELECT respond_approval_by_telegram_atomic($1,'approve','900','') result`, [approvalId]);
  assert.equal(decision.rows[0].result.status, 'approved');
  assert.ok(decision.rows[0].result.journal_entry_id);
  assert.equal((await db.query(`SELECT status FROM voucher_disbursements WHERE id=$1`, [pending.rows[0].result.id])).rows[0].status, 'approved');
  assert.equal((await db.query(`SELECT status FROM approval_requests WHERE id=$1`, [approvalId])).rows[0].status, 'approved');

  // A chat that is not the bound chat must still be rejected.
  const pending2 = await db.query(
    `SELECT create_voucher_disbursement_atomic($1,'2026-02-02','supplier',$2,NULL,120,$3,'wrong chat',$4::jsonb,TRUE,$5) result`,
    [c, contact, bank, JSON.stringify([]), clerk],
  );
  await assert.rejects(() => db.query(`SELECT respond_approval_by_telegram_atomic($1,'approve','901','')`, [pending2.rows[0].result.approval_id]));
}

/**
 * Migration 069 fiscal-year controls: one open year per company, and ledger
 * postings must fall inside an open fiscal year.
 */
async function smokeFiscalYearControls() {
  const c = '82000000-0000-4000-8000-000000000001';
  const u = '82000000-0000-4000-8000-000000000002';
  const cash = '82000000-0000-4000-8000-000000000003';
  const revenue = '82000000-0000-4000-8000-000000000004';
  const retained = '82000000-0000-4000-8000-000000000005';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Fiscal control tenant')`, [c]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active) VALUES($1,$2,'fiscal@example.test','x','Fiscal admin','admin',TRUE)`, [u, c]);
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1000','Cash','asset',FALSE),
    ($3,$2,'4100','Revenue','revenue',FALSE),
    ($4,$2,'3200','Retained earnings','equity',FALSE)`, [cash, c, revenue, retained]);

  // The bootstrap trigger created exactly one open fiscal year.
  const boot = (await db.query(`SELECT id,status FROM fiscal_years WHERE company_id=$1`, [c])).rows[0];
  assert.equal(boot.status, 'open');
  assert.equal(Number((await db.query(`SELECT count(*) count FROM fiscal_years WHERE company_id=$1 AND status='open'`, [c])).rows[0].count), 1);

  // A second open year is rejected, as is any overlapping period.
  await assert.rejects(() => db.query(`SELECT create_fiscal_year_atomic($1,'Second open','2026-06-01','2026-06-30',$2)`, [c, u]));
  await assert.rejects(() => db.query(`SELECT create_fiscal_year_atomic($1,'Overlapping','2026-06-01','2027-06-30',$2)`, [c, u]));

  // A posting outside the open year is rejected.
  await assert.rejects(() => db.query(`SELECT create_journal_entry($1,'2027-03-01','general','outside year',$2,$3::jsonb)`, [
    c, u, JSON.stringify([{ accountId: cash, debit: 1, credit: 0 }, { accountId: revenue, debit: 0, credit: 1 }]),
  ]));

  // A posting inside the open year succeeds.
  await db.query(`SELECT create_journal_entry($1,'2026-05-01','general','inside year',$2,$3::jsonb)`, [
    c, u, JSON.stringify([{ accountId: cash, debit: 10, credit: 0 }, { accountId: revenue, debit: 0, credit: 10 }]),
  ]);

  // Closing the year blocks further postings inside it.
  await db.query(`SELECT close_fiscal_year_atomic($1,$2,$3)`, [c, boot.id, u]);
  await assert.rejects(() => db.query(`SELECT create_journal_entry($1,'2026-06-01','general','into closed year',$2,$3::jsonb)`, [
    c, u, JSON.stringify([{ accountId: cash, debit: 1, credit: 0 }, { accountId: revenue, debit: 0, credit: 1 }]),
  ]));

  // A new open year can now be created...
  const next = (await db.query(`SELECT create_fiscal_year_atomic($1,'السنة المالية 2027','2027-01-01','2027-12-31',$2) result`, [c, u])).rows[0].result;
  assert.equal(next.status, 'open');
  // ...but reopening the closed year while another is open is rejected.
  await assert.rejects(() => db.query(`SELECT reopen_fiscal_year_atomic($1,$2,$3)`, [c, boot.id, u]));
  // Editing a year's dates into an overlap is rejected at the DB level too.
  await assert.rejects(() => db.query(`UPDATE fiscal_years SET start_date='2026-06-01' WHERE id=$1`, [next.id]));
  assert.equal((await db.query(`SELECT start_date FROM fiscal_years WHERE id=$1`, [next.id])).rows[0].start_date.toISOString().slice(0, 10), '2027-01-01');
}

/**
 * Migration 076: a line-bearing journal entry is immutable and every
 * completed entry is exactly balanced — enforced in the database on every
 * write path, not only in the application code and the atomic RPCs.
 */
async function smokeJournalImmutabilityAndBalance() {
  const c = '83000000-0000-4000-8000-000000000001';
  const u = '83000000-0000-4000-8000-000000000002';
  const cash = '83000000-0000-4000-8000-000000000010';
  const revenue = '83000000-0000-4000-8000-000000000011';
  await db.query(`INSERT INTO companies(id,name) VALUES($1,'Journal guard tenant')`, [c]);
  await db.query(`INSERT INTO users(id,company_id,email,password_hash,name,role,is_active)
    VALUES($1,$2,'journal-guard@example.test','x','Guard admin','admin',TRUE)`, [u, c]);
  await db.query(`INSERT INTO accounts(id,company_id,code,name,type,is_header) VALUES
    ($1,$2,'1000','Cash','asset',FALSE),($3,$2,'4100','Revenue','revenue',FALSE)`, [cash, c, revenue]);

  const source=(await db.query(`SELECT create_journal_entry($1,'2026-04-01','general','Guard source',$2,$3::jsonb) result`,[
    c,u,JSON.stringify([{accountId:cash,debit:500,credit:0},{accountId:revenue,debit:0,credit:500}]),
  ])).rows[0].result;

  // A completed (line-bearing) posted entry is immutable: every financial
  // field and the delete itself are rejected at the database level, and the
  // row survives untouched.
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET date='2026-04-02' WHERE id=$1`,[source.id]),/immutable/);
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET description='tampered' WHERE id=$1`,[source.id]),/immutable/);
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET number=999 WHERE id=$1`,[source.id]),/immutable/);
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET type='accrual' WHERE id=$1`,[source.id]),/immutable/);
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET deleted_at=NOW() WHERE id=$1`,[source.id]),/immutable/);
  await assert.rejects(()=>db.query(`DELETE FROM journal_entries WHERE id=$1`,[source.id]),/cannot be deleted/);
  assert.equal((await db.query(`SELECT count(*)::int n FROM journal_entries
    WHERE id=$1 AND date='2026-04-01' AND description='Guard source'`,[source.id])).rows[0].n,1);

  // Whole-entry balance is enforced at COMMIT for direct writes: an
  // unbalanced line insert cannot reach the ledger even though every line
  // passes the per-row integrity checks individually.
  await db.exec('BEGIN');
  const unbalanced=(await db.query(`INSERT INTO journal_entries(company_id,number,date,type,description,created_by)
    VALUES($1,999301,'2026-04-01','general','unbalanced',$2) RETURNING id`,[c,u])).rows[0].id;
  await db.query(`INSERT INTO journal_lines(company_id,journal_entry_id,account_id,account_code,account_name,debit,credit)
    VALUES($1,$2,$3,'1000','Cash',500,0),($1,$2,$4,'4100','Revenue',0,400)`,[c,unbalanced,cash,revenue]);
  await assert.rejects(()=>db.exec('COMMIT'),/unbalanced/);
  await db.exec('ROLLBACK');

  // Editing a line of a balanced posted entry out of balance is rejected too,
  // and deleting one side of the pair is rejected as well.
  await db.exec('BEGIN');
  await db.query(`UPDATE journal_lines SET debit=400 WHERE journal_entry_id=$1 AND debit>0`,[source.id]);
  await assert.rejects(()=>db.exec('COMMIT'),/unbalanced/);
  await db.exec('ROLLBACK');
  await db.exec('BEGIN');
  await db.query(`DELETE FROM journal_lines WHERE journal_entry_id=$1 AND debit>0`,[source.id]);
  await assert.rejects(()=>db.exec('COMMIT'),/unbalanced/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query(`SELECT count(*)::int n FROM journal_lines WHERE journal_entry_id=$1`,[source.id])).rows[0].n,2);

  // A line-less orphan (failed line-insert cleanup) remains deletable — the
  // header-only cleanup path of the application writers depends on it.
  const orphan=(await db.query(`INSERT INTO journal_entries(company_id,number,date,type,description,created_by)
    VALUES($1,999302,'2026-04-01','general','orphan',$2) RETURNING id`,[c,u])).rows[0].id;
  await db.query(`DELETE FROM journal_entries WHERE id=$1`,[orphan.id]);
  assert.equal((await db.query(`SELECT count(*)::int n FROM journal_entries WHERE id=$1`,[orphan.id])).rows[0].n,0);

  // The sanctioned lifecycle still works: the audited reversal links the
  // source, reference links are updatable, and the approval transitions
  // posted -> pending and pending -> posted are allowed — while a direct
  // posted -> rejected tamper is rejected.
  const reversal=(await db.query(`SELECT post_journal_reversal($1,$2,'guard_reversal',$2,'Guard reversal',$3) rev`,[c,source.id,u])).rows[0].rev;
  assert.ok(reversal);
  await db.query(`UPDATE journal_entries SET reference_type='guard_test',reference_id=$2 WHERE id=$1`,[source.id,u]);
  await db.query(`UPDATE journal_entries SET status='pending' WHERE id=$1`,[source.id]);
  assert.equal((await db.query(`SELECT status FROM journal_entries WHERE id=$1`,[source.id])).rows[0].status,'pending');
  await db.query(`UPDATE journal_entries SET status='posted' WHERE id=$1`,[source.id]);
  await assert.rejects(()=>db.query(`UPDATE journal_entries SET status='rejected' WHERE id=$1`,[source.id]),/status transition/);
  const linked=(await db.query(`SELECT reversed_by,reference_type FROM journal_entries WHERE id=$1`,[source.id])).rows[0];
  assert.equal(linked.reversed_by,reversal);
  assert.equal(linked.reference_type,'guard_test');

  // The company-wide reset (the same transaction-scoped GUC every other
  // tenant guard honours) may still wipe the ledger.
  const plain=(await db.query(`SELECT create_journal_entry($1,'2026-04-02','general','Reset target',$2,$3::jsonb) result`,[
    c,u,JSON.stringify([{accountId:cash,debit:5,credit:0},{accountId:revenue,debit:0,credit:5}]),
  ])).rows[0].result;
  await db.exec('BEGIN');
  await db.query(`SELECT set_config('app.business_data_reset',$1,TRUE)`,[c]);
  await db.query(`DELETE FROM journal_lines WHERE journal_entry_id=$1 AND company_id=$2`,[plain.id,c]);
  await db.query(`DELETE FROM journal_entries WHERE id=$1 AND company_id=$2`,[plain.id,c]);
  await db.exec('COMMIT');
  assert.equal((await db.query(`SELECT count(*)::int n FROM journal_entries WHERE id=$1`,[plain.id])).rows[0].n,0);
}

/**
 * Migration 077: the shared atomic rate-limit store must enforce the
 * distributed budget exactly — the in-memory limiter alone can be rotated
 * around on serverless, so the DB share is what actually binds.
 */
async function smokeRateLimitStore() {
  const key = 'smoke:tenant-a';
  const key2 = 'smoke:tenant-b';
  const key3 = 'smoke:concurrent';

  // A budget of 3 is consumed exactly, then blocks with a positive retry.
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await db.query(`SELECT hit_rate_limit($1, 60000, 3) r`, [key])).rows[0].r.allowed, true);
  }
  const blocked = (await db.query(`SELECT hit_rate_limit($1, 60000, 3) r`, [key])).rows[0].r;
  assert.equal(blocked.allowed, false);
  assert.ok(Number(blocked.retry_after_seconds) >= 1);

  // A different key keeps its own independent budget.
  assert.equal((await db.query(`SELECT hit_rate_limit($1, 60000, 3) r`, [key2])).rows[0].r.allowed, true);

  // The window rolls over: an aged window resets the counter.
  await db.query(`UPDATE rate_limit_buckets SET window_start = NOW() - INTERVAL '2 minutes' WHERE key = $1`, [key]);
  assert.equal((await db.query(`SELECT hit_rate_limit($1, 60000, 3) r`, [key])).rows[0].r.allowed, true);

  // Concurrent hits on a fresh key with a budget of 5: exactly five pass —
  // the ON CONFLICT row lock must serialize the read-modify-write even when
  // the fleet hammers the same key at once.
  const race = await Promise.allSettled(Array.from({ length: 10 }, () =>
    db.withConnection((conn) => conn.query(`SELECT hit_rate_limit($1, 60000, 5) r`, [key3]))
      .then((q) => q.rows[0].r.allowed)));
  const allowed = race.filter((x) => x.status === 'fulfilled' && x.value).length;
  assert.equal(allowed, 5, 'concurrent hits must never over-allocate the shared budget');

  // Invalid parameters are rejected up front.
  await assert.rejects(() => db.query(`SELECT hit_rate_limit(NULL, 60000, 3)`));
  await assert.rejects(() => db.query(`SELECT hit_rate_limit('smoke:x', 100, 3)`));
  await assert.rejects(() => db.query(`SELECT hit_rate_limit('smoke:x', 60000, 0)`));

  // Pruning removes stale buckets and keeps fresh ones.
  await db.query(`UPDATE rate_limit_buckets SET window_start = NOW() - INTERVAL '1 hour' WHERE key = $1`, [key2]);
  assert.ok(Number((await db.query(`SELECT prune_rate_limit_buckets(600000) n`)).rows[0].n) >= 1);
  assert.equal((await db.query(`SELECT count(*)::int n FROM rate_limit_buckets WHERE key = $1`, [key2])).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int n FROM rate_limit_buckets WHERE key = $1`, [key3])).rows[0].n, 1);
  await assert.rejects(() => db.query(`SELECT prune_rate_limit_buckets(100)`));
}

try {
  await applyMigrations();
  await smokeInitialSetup();
  await smokeAdminOtp();
  await smokeTelegramTokenAtRest();
  await smokeAdminGlobalConfiguration();
  const ids = await seedLedger();
  await smokePostedLedgerReports();
  await smokeProjectCostingAllocation();
  await smokeAdminEntitlements(ids);
  await smokeAdminSupport(ids);
  await smokePurchasingAndInventory(ids);
  await smokeAtomicWriters(ids);
  await smokeCriticalPath();
  await smokeRealConcurrency();
  await smokeTenantIsolationUnderRls();
  await smokeTelegramApprovalActorFallback();
  await smokeFiscalYearControls();
  await smokeJournalImmutabilityAndBalance();
  await smokeRateLimitStore();
  console.log('Clean migrations and atomic RPC smoke tests passed.');
} finally {
  await db.close();
}
