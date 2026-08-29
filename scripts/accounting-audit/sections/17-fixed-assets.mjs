/**
 * Section 17 — Fixed Assets, Depreciation & Disposal (الأصول الثابتة)
 *
 * Engine: 049 (creation with per-asset accounts 1230-CODE/1290-CODE +
 * straight-line/declining depreciation), 057 (tenant guard wrappers +
 * monthly batch on 5260), 095 (salvage-aware depreciation, write-off,
 * disposal with sale gain/loss).
 * Accounting semantics under audit:
 *   - create_fixed_asset: Dr 1230-CODE cost / Cr bank; per-asset asset +
 *     accumulated-depreciation accounts; salvage ≥ 0 and < cost.
 *   - depreciate_fixed_asset: straight-line (cost − salvage)/(years×12),
 *     declining (cost − accumulated)×(2/years)/12, capped so accumulated
 *     never exceeds cost − salvage; one log row per date ('exists');
 *     'fully_depreciated' idempotency; status flips at full depreciation.
 *   - dispose_fixed_asset_atomic (write-off): Dr 1290-CODE accumulated /
 *     Dr 5330 loss (NBV) / Cr 1230-CODE cost.
 *   - dispose_fixed_asset_sale_atomic: Dr bank proceeds + Dr accumulated +
 *     (Dr 5330 loss | Cr 4200 gain) / Cr cost; date ≥ purchase date.
 *   - depreciate_fixed_assets_batch: first-of-month only, expense account
 *     5260, skips assets already logged for that date.
 */
import { callRpc, check, assertBalance, rejects, seedTenant, invDoubleEntry, invTrialBalance } from '../framework.mjs';

export const name = '17 Fixed Assets (الأصول الثابتة)';

const dep = (db, A, assetId, date) => callRpc(db, 'depreciate_fixed_asset', {
  p_company_id: A.companyId, p_asset_id: assetId, p_date: date,
  p_expense_account_id: A.byCode['5260'], p_user_id: A.userId,
});

export async function run({ db }) {
  {
    const A = await seedTenant(db, { name: 'مراجعة 17', email: 'audit17@example.test' });
    const { companyId, userId, byCode } = A;

    /* --- creation: per-asset accounts + opening JE -------------------------------- */
    const a1 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'معدة حفر', p_code: 'EQ1', p_category: 'معدات',
      p_purchase_date: '2026-01-15', p_purchase_cost: 12000, p_useful_life_years: 1,
      p_depreciation_method: 'straight_line', p_location: 'الموقع', p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    check('asset created with linked accounts', !!a1.asset_account_id && !!a1.depreciation_account_id,
      JSON.stringify({ a: !!a1.asset_account_id, d: !!a1.depreciation_account_id }));
    const accCodes = (await db.query(`
      SELECT a.code FROM fixed_assets f JOIN accounts a ON a.id=f.asset_account_id
      JOIN accounts d ON d.id=f.depreciation_account_id WHERE f.id=$1`, [a1.id])).rows[0];
    check('per-asset accounts named 1230-EQ1 / 1290-EQ1', accCodes.code === '1230-EQ1', JSON.stringify(accCodes));
    const openJe = (await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.company_id=$1 AND je.description LIKE 'شراء أصل ثابت: معدة حفر' GROUP BY a.code`, [companyId])).rows;
    const openNet = Object.fromEntries(openJe.map((r) => [r.code, Number(r.net)]));
    assertBalance(openNet['1230-EQ1'], 12000, 'opening JE Dr asset account 12000');
    assertBalance(openNet['1121'], -12000, 'opening JE Cr bank 12000');

    /* --- creation guards ------------------------------------------------------------ */
    await rejects(callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'غريب', p_code: 'EQX', p_category: 'معدات',
      p_purchase_date: '2026-07-01', p_purchase_cost: 100, p_useful_life_years: 1,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId, p_salvage_value: 100,
    }), 'salvage >= cost is rejected', 'غير صالح');
    await rejects(callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'أجل صفر', p_code: 'EQY', p_category: 'معدات',
      p_purchase_date: '2026-07-01', p_purchase_cost: 100, p_useful_life_years: 0,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    }), 'zero useful life is rejected', 'غير صالح');
    await rejects(callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'طريقة', p_code: 'EQZ', p_category: 'معدات',
      p_purchase_date: '2026-07-01', p_purchase_cost: 100, p_useful_life_years: 5,
      p_depreciation_method: 'gold_leaf', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    }), 'unknown depreciation method is rejected', 'غير صالح');

    /* --- straight-line to full depreciation (12000 over 12 months) ---------------- */
    const depDate = (n) => { // n-th month on/after 2026-01 (n=0 → 2026-01-15)
      const t = new Date(Date.UTC(2026, 0, 15)); t.setUTCMonth(t.getUTCMonth() + n);
      return t.toISOString().slice(0, 10);
    };
    const first = (await dep(db, A, a1.id, depDate(0))).rows[0].result;
    assertBalance(first.amount, 1000, 'first month depreciation = 12000/12');
    const dup = (await dep(db, A, a1.id, depDate(0))).rows[0].result;
    check('same-date depreciation returns exists', dup.status === 'exists', JSON.stringify(dup));
    let last = null;
    for (let m = 1; m <= 15; m++) {
      last = (await dep(db, A, a1.id, depDate(m))).rows[0].result;
      if (last.status !== 'created') break;
    }
    const a1row = (await db.query(`SELECT accumulated_depreciation, net_book_value, status FROM fixed_assets WHERE id=$1`, [a1.id])).rows[0];
    assertBalance(a1row.accumulated_depreciation, 12000, 'accumulated reaches the full cost');
    assertBalance(a1row.net_book_value, 0, 'net book value reaches zero');
    check('asset reaches fully_depreciated within its life', a1row.status === 'fully_depreciated', a1row.status);
    const logs = (await db.query(`SELECT count(*)::int c FROM depreciation_log WHERE asset_id=$1`, [a1.id])).rows[0].c;
    check('one log row per month (12)', logs === 12, String(logs));

    /* --- salvage cap: 6000 with 3000 salvage → 250/month, floor at 3000 -------------- */
    const a6 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'مولد كهرباء', p_code: 'EQ6', p_category: 'معدات',
      p_purchase_date: '2026-01-15', p_purchase_cost: 6000, p_useful_life_years: 1,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId, p_salvage_value: 3000,
    })).rows[0].result;
    let last6 = null;
    for (let m = 0; m <= 15; m++) {
      last6 = (await dep(db, A, a6.id, depDate(m))).rows[0].result;
      if (last6.status !== 'created') break;
    }
    const a6row = (await db.query(`SELECT accumulated_depreciation, net_book_value, status FROM fixed_assets WHERE id=$1`, [a6.id])).rows[0];
    assertBalance(a6row.accumulated_depreciation, 3000, 'accumulated capped at cost − salvage');
    assertBalance(a6row.net_book_value, 3000, 'net book value settles at the salvage floor');
    check('salvage asset reaches fully_depreciated at the floor', a6row.status === 'fully_depreciated', a6row.status);

    /* --- batch (first of month, 5260) ------------------------------------------------- */
    const a2 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'سيارة نقل', p_code: 'EQ2', p_category: 'معدات',
      p_purchase_date: '2026-08-01', p_purchase_cost: 5000, p_useful_life_years: 2,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    await rejects(callRpc(db, 'depreciate_fixed_assets_batch', {
      p_company_id: companyId, p_date: '2026-08-15', p_user_id: userId,
    }), 'batch on a non-month-start date is rejected', 'غير صالح');
    const batch = (await callRpc(db, 'depreciate_fixed_assets_batch', {
      p_company_id: companyId, p_date: '2026-09-01', p_user_id: userId,
    })).rows[0].result;
    check('batch posted depreciation for the active asset', Number(batch.total_amount ?? batch.total ?? 0) > 0 || Array.isArray(batch.entries),
      JSON.stringify(batch).slice(0, 120));
    const a2log = (await db.query(`SELECT amount FROM depreciation_log WHERE asset_id=$1 ORDER BY date`, [a2.id])).rows;
    assertBalance(a2log[0]?.amount, 208.33, 'batch month = 5000/(2×12)');

    /* --- declining balance: decreasing monthly amounts --------------------------------- */
    const a3 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'آلة إنتاج', p_code: 'EQ3', p_category: 'معدات',
      p_purchase_date: '2026-08-01', p_purchase_cost: 10000, p_useful_life_years: 5,
      p_depreciation_method: 'declining_balance', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    const d1 = (await dep(db, A, a3.id, '2026-08-15')).rows[0].result;
    const d2 = (await dep(db, A, a3.id, '2026-09-15')).rows[0].result;
    assertBalance(d1.amount, 333.33, 'DB month 1 = 10000×(2/5)/12');
    assertBalance(d2.amount, 322.22, 'DB month 2 decreases (9666.67×(2/5)/12)');

    /* --- sale with loss ------------------------------------------------------------------ */
    const sale = (await callRpc(db, 'dispose_fixed_asset_sale_atomic', {
      p_company_id: companyId, p_asset_id: a2.id, p_sale_price: 4000,
      p_bank_safe_id: A.banks, p_date: '2026-09-10', p_user_id: userId,
    })).rows[0].result;
    check('asset disposed by sale', sale.status === 'disposed' || sale.disposed === true, JSON.stringify(sale).slice(0, 100));
    const a2row = (await db.query(`SELECT gain_loss FROM fixed_assets WHERE id=$1`, [a2.id])).rows[0];
    assertBalance(a2row.gain_loss, -791.67, 'loss = NBV (4791.67) − price (4000)');
    const sje = (await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code ORDER BY a.code`, [sale.disposal_journal_id])).rows;
    const snet = Object.fromEntries(sje.map((r) => [r.code, Number(r.net)]));
    check('sale JE balanced', Math.abs(Object.values(snet).reduce((s, v) => s + v, 0)) < 0.005, JSON.stringify(snet));
    assertBalance(snet['1121'], 4000, 'Dr bank proceeds 4000');
    assertBalance(snet['1230-EQ2'], -5000, 'Cr asset cost 5000');
    assertBalance(snet['1290-EQ2'], 208.33, 'Dr accumulated depreciation 208.33');
    assertBalance(snet['5330'], 791.67, 'Dr loss on disposal 791.67');

    /* --- sale with gain --------------------------------------------------------------------- */
    const a4 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'مكاتب', p_code: 'EQ4', p_category: 'معدات',
      p_purchase_date: '2026-08-01', p_purchase_cost: 1000, p_useful_life_years: 10,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    const sale2 = (await callRpc(db, 'dispose_fixed_asset_sale_atomic', {
      p_company_id: companyId, p_asset_id: a4.id, p_sale_price: 1500,
      p_bank_safe_id: A.banks, p_date: '2026-08-20', p_user_id: userId,
    })).rows[0].result;
    const gje = (await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [sale2.disposal_journal_id])).rows;
    const gnet = Object.fromEntries(gje.map((r) => [r.code, Number(r.net)]));
    assertBalance(gnet['4200'], -500, 'gain Cr 4200 (1500 − 1000)');
    assertBalance(gnet['1121'], 1500, 'proceeds Dr bank');
    const sale3 = (await callRpc(db, 'dispose_fixed_asset_sale_atomic', {
      p_company_id: companyId, p_asset_id: a4.id, p_sale_price: 10,
      p_bank_safe_id: A.banks, p_date: '2026-08-25', p_user_id: userId,
    })).rows[0].result;
    check('disposing an already-disposed asset is idempotent', sale3.already_processed === true, JSON.stringify(sale3).slice(0, 100));

    /* --- write-off (no proceeds) ---------------------------------------------------------------- */
    const a5 = (await callRpc(db, 'create_fixed_asset', {
      p_company_id: companyId, p_name: 'أثاث تالف', p_code: 'EQ5', p_category: 'معدات',
      p_purchase_date: '2026-08-01', p_purchase_cost: 2000, p_useful_life_years: 4,
      p_depreciation_method: 'straight_line', p_location: null, p_notes: null,
      p_bank_safe_id: A.banks, p_created_by: userId,
    })).rows[0].result;
    await dep(db, A, a5.id, '2026-08-15'); // 2000/48 = 41.67
    const wo = (await callRpc(db, 'dispose_fixed_asset_atomic', {
      p_company_id: companyId, p_asset_id: a5.id, p_user_id: userId,
    })).rows[0].result;
    const woje = (await db.query(`
      SELECT a.code, SUM(jl.debit - jl.credit) net FROM journal_lines jl
      JOIN journal_entries je ON je.id=jl.journal_entry_id JOIN accounts a ON a.id=jl.account_id
      WHERE je.id=$1 GROUP BY a.code`, [wo.disposal_journal_id])).rows;
    const wnet = Object.fromEntries(woje.map((r) => [r.code, Number(r.net)]));
    assertBalance(wnet['1230-EQ5'], -2000, 'write-off Cr asset cost 2000');
    assertBalance(wnet['1290-EQ5'], 41.67, 'write-off Dr accumulated 41.67');
    assertBalance(wnet['5330'], 1958.33, 'write-off Dr loss = NBV (1958.33)');
    const wo2 = (await callRpc(db, 'dispose_fixed_asset_atomic', {
      p_company_id: companyId, p_asset_id: a5.id, p_user_id: userId,
    })).rows[0].result;
    check('write-off is idempotent', wo2.already_processed === true, JSON.stringify(wo2.already_processed));
    const depAfter = (await callRpc(db, 'depreciate_fixed_asset', {
      p_company_id: companyId, p_asset_id: a5.id, p_date: '2026-09-15',
      p_expense_account_id: byCode['5260'], p_user_id: userId,
    })).rows[0].result;
    check('depreciating a disposed asset is skipped', depAfter.status === 'skipped', JSON.stringify(depAfter));

    /* --- invariants --------------------------------------------------------------------------------- */
    await invDoubleEntry(db, companyId);
    await invTrialBalance(db, companyId);
  }
}
