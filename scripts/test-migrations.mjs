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
    ['2110', 'Payables', 'liability', false], ['2140', 'Accrued salaries', 'liability', false], ['2160', 'Retentions', 'liability', false], ['2180', 'Customer advances', 'liability', false],
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

async function smokeAtomicWriters(ids) {
  const { company: c, user: u, employee: e, bank: b, contact, project, accounts: a } = ids;
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

  const atomicSale=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,$3,'2026-02-01','2026-03-01',$4::jsonb,0.15,TRUE,'sale',50,$5,$6) result`,[
    c,contact,project,JSON.stringify([{description:'Atomic sale',quantity:2,unitPrice:50,discount:0}]),b,u,
  ])).rows[0].result;
  assert.equal(Number(atomicSale.total),115);
  assert.equal(Number(atomicSale.paid_amount),50);
  assert.equal(atomicSale.status,'partial');
  assert.ok(atomicSale.journal_entry_id);
  assert.ok(atomicSale.voucher_receipt_id);
  assert.equal((await db.query(`SELECT count(*)::int count FROM invoice_items WHERE invoice_id=$1`,[atomicSale.id])).rows[0].count,1);
  const cancellableSale=(await db.query(`SELECT create_sales_invoice_atomic($1,$2,NULL,'2026-02-01','2026-03-01',$3::jsonb,0,FALSE,'',0,NULL,$4) result`,[
    c,contact,JSON.stringify([{description:'Cancel sale',quantity:1,unitPrice:25,discount:0}]),u,
  ])).rows[0].result;
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
  const ids = await seedLedger();
  await smokeAtomicWriters(ids);
  console.log('Clean migrations and atomic RPC smoke tests passed.');
} finally {
  await db.close();
}
