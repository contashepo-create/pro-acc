import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const migrationsDir = path.resolve('src/migrations');
const db = new PGlite();

async function applyMigrations() {
  // Supabase pre-creates these roles. PGlite does not ship pgcrypto, so the
  // digest shim only lets the rest of the migration compile in this test; a
  // deployed PostgreSQL/Supabase instance still executes CREATE EXTENSION.
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE FUNCTION digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE
      AS $$ SELECT decode(md5($1),'hex') $$;
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
      .replace(/^CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*$/gim, '')
      .trim();
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
  await db.query(`INSERT INTO employees(id,company_id,name,salary,hire_date,is_active)
    VALUES($1,$2,'Employee',1000,'2026-01-01',true)`, [ids.employee, ids.company]);
  await db.query(`INSERT INTO contacts(id,company_id,name,type) VALUES($1,$2,'Client','client')`,[ids.contact,ids.company]);
  await db.query(`INSERT INTO projects(id,company_id,name,start_date,status) VALUES($1,$2,'Project','2026-01-01','active')`,[ids.project,ids.company]);

  const accounts = [
    ['1000', 'Bank', 'asset', false], ['1110', 'Safes parent', 'asset', false], ['1120', 'Banks parent', 'asset', false],
    ['3000', 'Equity', 'equity', false], ['3100', 'Capital', 'equity', false],
    ['3200', 'Retained earnings', 'equity', false], ['1230',  'Assets', 'asset', true], ['1290', 'Accumulated depreciation', 'asset', true],
    ['1130', 'Receivables', 'asset', false], ['1135', 'Accrued revenue', 'asset', false], ['4100', 'Revenue', 'revenue', false], ['4200', 'Other revenue', 'revenue', false], ['5100', 'Expense', 'expense', false],
    ['5210', 'Salaries', 'expense', false], ['5400', 'General expense', 'expense', false],
    ['2110', 'Payables', 'liability', false], ['2140', 'Accrued salaries', 'liability', false], ['2150', 'Subcontractor payables', 'liability', false], ['2160', 'Retentions', 'liability', false], ['2180', 'Customer advances', 'liability', false],
    ['1160', 'Advances', 'asset', false], ['1150', 'Custodies', 'asset', false],
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

  const complaintId='92000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO complaints(id,company_id,user_id,type,subject,body)
    VALUES($1,$2,$3,'complaint','Runtime complaint','Runtime body')`,[complaintId,ids.company,ids.user]);
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

  const addonCreated=(await db.query(`SELECT create_addon_request_atomic($1,$2,'storage_gb',2,'monthly',$3,CURRENT_DATE,'12:30',$4,'paid') result`,[
    ids.company,ids.user,paymentMethod,`${ids.company}/receipts/addon.png`,
  ])).rows[0].result;
  assert.equal(Number(addonCreated.total_amount_usd),6);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND type='addon_request'`,[ids.company])).rows[0].count),1);
  await assert.rejects(()=>db.query(`SELECT create_addon_request_atomic($1,$2,'storage_gb',2,'monthly',$3,CURRENT_DATE,'12:30',$4,'duplicate')`,[
    ids.company,ids.user,paymentMethod,`${ids.company}/receipts/addon-2.png`,
  ]));
  assert.equal(Number((await db.query(`SELECT count(*) count FROM company_messages WHERE company_id=$1 AND type='addon_request'`,[ids.company])).rows[0].count),1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM audit_log WHERE entity_type='addon_request' AND company_id=$1`,[ids.company])).rows[0].count),1);

  const upgradeCreated=(await db.query(`SELECT create_upgrade_request_atomic($1,$2,$3,'monthly',$4,25.50,CURRENT_DATE,'13:00',$5,'paid') result`,[
    ids.company,ids.user,plan.id,paymentMethod,`${ids.company}/receipts/upgrade.png`,
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
  await assert.rejects(()=>db.query(`SELECT create_upgrade_request_atomic($1,$2,$3,'monthly',$4,25.50,CURRENT_DATE,NULL,$5,NULL)`,[
    ids.company,otherUser,plan.id,paymentMethod,`${ids.company}/receipts/cross.png`,
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

async function smokeAtomicWriters(ids) {
  const { company: c, user: u, employee: e, bank: b, contact, project, accounts: a } = ids;

  const fiscalYear='60000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO fiscal_years(id,company_id,name,start_date,end_date,status)
    VALUES($1,$2,'January 2026','2026-01-01','2026-01-31','open')`,[fiscalYear,c]);
  await db.query(`SELECT create_journal_entry($1,'2026-01-15','general','January revenue',$2,$3::jsonb)`,[
    c,u,JSON.stringify([{accountId:a['1000'],debit:100,credit:0},{accountId:a['4100'],debit:0,credit:100}]),
  ]);
  const closeRace=await Promise.all([
    db.query(`SELECT close_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u]),
    db.query(`SELECT close_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u]),
  ]);
  assert.equal(closeRace.filter((r)=>r.rows[0].result.already_processed===false).length,1);
  assert.equal(Number(closeRace.find((r)=>r.rows[0].result.already_processed===false).rows[0].result.netIncome),100);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='fiscal_year_closing' AND reference_id=$2`,[c,fiscalYear])).rows[0].count),1);
  const reopened=(await db.query(`SELECT reopen_fiscal_year_atomic($1,$2,$3) result`,[c,fiscalYear,u])).rows[0].result;
  assert.equal(reopened.status,'open');
  assert.equal(Number(reopened.reversedClosingEntries),1);
  await db.query(`SELECT close_fiscal_year_atomic($1,$2,$3)`,[c,fiscalYear,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM journal_entries WHERE company_id=$1 AND reference_type='fiscal_year_closing' AND reference_id=$2`,[c,fiscalYear])).rows[0].count),2);

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
  assert.ok(atomicProject.invoice.id);
  assert.equal(Number(atomicProject.boq_items_count),1);
  const progressClaim=(await db.query(`SELECT create_progress_billing_atomic($1,$2,'2026-02-03','','Claim',30,0.1,0.15,FALSE,$3) result`,[c,atomicProject.id,u])).rows[0].result;
  assert.ok(progressClaim.journal_entry_id);
  assert.equal(Number(progressClaim.retention_amount),3);
  assert.equal((await db.query(`SELECT cancel_progress_billing_atomic($1,$2,$3) result`,[c,progressClaim.id,u])).rows[0].result.status,'cancelled');
  const editableProject=(await db.query(`SELECT create_project_atomic($1,'Editable',$2,20,'2026-02-01',NULL,'active','','','[]'::jsonb,FALSE,$3) result`,[c,contact,u])).rows[0].result;
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

  await db.query(`SELECT create_fixed_asset($1,'Machine','A1','equipment','2026-02-01',500,5,'straight_line','','',$2,$3)`, [c, b, u]);
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
  const custodyFile='69000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO custodies(id,company_id,employee_id,amount,total_received,total_expenses,remaining_amount,date,status,project_id) VALUES($1,$2,$3,200,200,0,200,'2026-01-01','open',$4)`,[custodyFile,c,e,project]);
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
  const payroll = await db.query('SELECT advance_deduction,net_pay FROM payroll WHERE company_id=$1', [c]);
  assert.equal(Number(payroll.rows[0].advance_deduction), 100);
  assert.equal(Number(payroll.rows[0].net_pay), 900);

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
  // PGlite's test-only digest shim uses MD5 because pgcrypto is unavailable;
  // production PostgreSQL keeps the SHA-256 value inserted above.
  await db.query(`UPDATE activation_codes SET code_hash=$1 WHERE code_hash=$2`,
    [createHash('md5').update(activationPlaintext).digest('hex'),activationHash]);
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
  const deactivatedUser=(await db.query(`SELECT deactivate_company_user_atomic($1,$2,$3) result`,[c,approver,u])).rows[0].result;
  assert.equal(deactivatedUser.is_active,false);
  assert.equal((await db.query(`SELECT is_active FROM users WHERE id=$1`,[approver])).rows[0].is_active,false);

  const moduleId='64000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO custom_modules(id,company_id,name,code,is_system,created_by) VALUES($1,$2,'Runtime module','runtime_module',FALSE,$3)`,[moduleId,c,u]);
  await db.query(`INSERT INTO user_permissions(company_id,user_id,module,permissions) VALUES($1,$2,'Runtime module','["read"]'::jsonb)`,[c,u]);
  await db.query(`SELECT delete_custom_module_atomic($1,$2,$3)`,[c,moduleId,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM user_permissions WHERE company_id=$1 AND module='Runtime module'`,[c])).rows[0].count),0);

  const parentTask='63000000-0000-4000-8000-000000000001';
  const childTask='63000000-0000-4000-8000-000000000002';
  const grandTask='63000000-0000-4000-8000-000000000003';
  await db.query(`INSERT INTO project_tasks(id,company_id,project_id,name,start_date,end_date,progress,created_by) VALUES
    ($1,$4,$5,'Parent','2026-01-01','2026-01-02',0,$6),($2,$4,$5,'Child','2026-01-01','2026-01-02',0,$6),($3,$4,$5,'Grand','2026-01-01','2026-01-02',0,$6)`,[parentTask,childTask,grandTask,c,project,u]);
  await db.query(`UPDATE project_tasks SET parent_task_id=$1 WHERE id=$2`,[parentTask,childTask]);
  await db.query(`UPDATE project_tasks SET parent_task_id=$1 WHERE id=$2`,[childTask,grandTask]);
  const deletedTasks=(await db.query(`SELECT delete_unstarted_project_task_atomic($1,$2,$3) result`,[c,parentTask,u])).rows[0].result;
  assert.equal(Number(deletedTasks.deleted_tasks),3);

  const wonTender='62000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO tenders(id,company_id,title,client_name,contact_id,estimated_value,status,project_duration_months,created_by) VALUES($1,$2,'Won runtime tender','Client',$3,500,'won',2,$4)`,[wonTender,c,contact,u]);
  const tenderRace=await Promise.all([
    db.query(`SELECT convert_won_tender_to_project_atomic($1,$2,$3) result`,[c,wonTender,u]),
    db.query(`SELECT convert_won_tender_to_project_atomic($1,$2,$3) result`,[c,wonTender,u]),
  ]);
  assert.equal(tenderRace.filter(x=>x.rows[0].result.already_processed===false).length,1);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM projects WHERE company_id=$1 AND tender_id=$2`,[c,wonTender])).rows[0].count),1);
  const draftTender='62000000-0000-4000-8000-000000000002';
  await db.query(`INSERT INTO tenders(id,company_id,title,client_name,status,created_by) VALUES($1,$2,'Draft runtime tender','Client','draft',$3)`,[draftTender,c,u]);
  await db.query(`INSERT INTO tender_cost_items(tender_id,company_id,category,amount,created_by) VALUES($1,$2,'materials',10,$3)`,[draftTender,c,u]);
  await db.query(`SELECT delete_draft_tender_atomic($1,$2,$3)`,[c,draftTender,u]);
  assert.equal(Number((await db.query(`SELECT count(*) count FROM tender_cost_items WHERE tender_id=$1`,[draftTender])).rows[0].count),0);

  const backupHmac='a'.repeat(64);
  await db.query(`INSERT INTO backup_logs(company_id,user_id,backup_type,file_hash,hmac_signature) VALUES($1,$2,'json','hash',$3)`,[c,u,backupHmac]);
  const accountBackup=(await db.query(`SELECT to_jsonb(a) row FROM accounts a WHERE id=$1`,[a['1000']])).rows[0].row;
  const originalAccountName=accountBackup.name;
  const tamperedRestore={
    accounts:[{...accountBackup,name:'Must roll back'}],
    contacts:[{id:contact2,company_id:c,name:'Cross tenant overwrite',type:'client'}],
  };
  await assert.rejects(()=>db.query(`SELECT restore_company_backup_atomic($1,$2,$3,$4::jsonb)`,[c,u,backupHmac,JSON.stringify(tamperedRestore)]));
  assert.equal((await db.query(`SELECT name FROM accounts WHERE id=$1`,[a['1000']])).rows[0].name,originalAccountName);
  const restored=await db.query(`SELECT restore_company_backup_atomic($1,$2,$3,$4::jsonb) result`,[
    c,u,backupHmac,JSON.stringify({accounts:[{...accountBackup,name:'Restored account'}]}),
  ]);
  assert.equal(Number(restored.rows[0].result.restored_records),1);
  assert.equal((await db.query(`SELECT name FROM accounts WHERE id=$1`,[a['1000']])).rows[0].name,'Restored account');

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

  const codeHash=createHash('sha256').update('123456').digest('hex');
  const session={step:'approved_and_code_sent',code_hash:codeHash,attempts:0,requester_id:u,expires_at:new Date(Date.now()+300000).toISOString()};
  await db.query(`INSERT INTO company_telegram_configs(company_id,chat_id,is_enabled,reset_session_data)
    VALUES($1,'1',true,$2::jsonb)`,[c,JSON.stringify(session)]);
  const retainedUsers=Number((await db.query('SELECT count(*) count FROM users WHERE company_id=$1',[c])).rows[0].count);
  const invalid=await db.query(`SELECT reset_company_business_data($1,$2,$3) result`,[c,u,'0'.repeat(64)]);
  assert.equal(invalid.rows[0].result.status,'invalid_code');
  const reset=await db.query(`SELECT reset_company_business_data($1,$2,$3) result`,[c,u,codeHash]);
  assert.equal(reset.rows[0].result.status,'reset_success');
  assert.equal(Number((await db.query('SELECT count(*) count FROM journal_entries')).rows[0].count),0);
  assert.equal(Number((await db.query('SELECT count(*) count FROM users WHERE company_id=$1',[c])).rows[0].count),retainedUsers);
}

try {
  await applyMigrations();
  await smokeInitialSetup();
  await smokeAdminOtp();
  await smokeAdminGlobalConfiguration();
  const ids = await seedLedger();
  await smokeAdminEntitlements(ids);
  await smokeAdminSupport(ids);
  await smokeAtomicWriters(ids);
  console.log('Clean migrations and atomic RPC smoke tests passed.');
} finally {
  await db.close();
}
