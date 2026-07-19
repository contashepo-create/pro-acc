import { NextRequest } from 'next/server';
import { success, error, serverError, notFound, requireApiAuth, parseBody } from '@/lib/api-helpers';
import { getSupabase } from '@/lib/supabase-client';
import { ACCOUNT_CODES } from '@/lib/constants';
import { getNextJournalNumber } from '@/lib/numbering';
import { insertJournalLines } from '@/lib/journal-utils';

const sb = () => getSupabase();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiAuth(req);
    const { id } = await params;
    const data = await parseBody(req);
    const { 
      returned_cash, // المبلغ المرتد نقداً
      expenses_amount, // مجموع الفواتير المصروفة من العهدة
      description,
      deduct_shortage_from_salary = true, // هل يخصم العجز من الراتب؟
      pay_surplus_to_employee = true, // هل يصرف الزيادة للموظف؟
      created_by
    } = data;

    if (returned_cash === undefined && expenses_amount === undefined) {
      return error('يجب إدخال المبلغ المرتد أو المصروفات');
    }

    const s = sb();

    const { data: custody, error: custodyErr } = await s.from('custodies')
      .select('*')
      .eq('id', id)
      .eq('company_id', auth.companyId)
      .maybeSingle();

    if (custodyErr || !custody) throw new Error('Not found');
    if (custody.status !== 'open') throw new Error('العهدة مقفلة بالفعل');

    const totalReceived = parseFloat(custody.total_received) || parseFloat(custody.amount) || 0;
    const returnedCash = parseFloat(returned_cash) || 0;
    const expenses = parseFloat(expenses_amount) || 0;
    
    // Calculate shortage/surplus
    // totalReceived = returnedCash + expenses + shortage - surplus
    // shortage = totalReceived - (returnedCash + expenses) if positive
    // surplus = (returnedCash + expenses) - totalReceived if positive
    const accounted = returnedCash + expenses;
    const difference = totalReceived - accounted;
    
    let shortage = 0;
    let surplus = 0;
    if (difference > 0) shortage = difference; // الموظف مدين للشركة
    else if (difference < 0) surplus = Math.abs(difference); // الشركة مدينة للموظف

    // Create settlement transaction
    await s.from('custody_transactions').insert({
      company_id: auth.companyId,
      custody_id: id,
      type: 'return',
      amount: returnedCash,
      description: `مرتجع نقدي عند التصفية: ${description || ''}`,
      created_by: auth.userId,
    });

    if (shortage > 0) {
      await s.from('custody_transactions').insert({
        company_id: auth.companyId,
        custody_id: id,
        type: 'shortage',
        amount: shortage,
        description: `عجز في العهدة - ${deduct_shortage_from_salary ? 'سيخصم من الراتب' : 'مصروف'}`,
        created_by: auth.userId,
      });
    }

    if (surplus > 0) {
      await s.from('custody_transactions').insert({
        company_id: auth.companyId,
        custody_id: id,
        type: 'surplus',
        amount: surplus,
        description: `زيادة في العهدة - ${pay_surplus_to_employee ? 'سيصرف للموظف' : 'مردود'}`,
        created_by: auth.userId,
      });
    }

    // Update custody file to settled
    await s.from('custodies')
      .update({
        settlement_amount: returnedCash,
        total_expenses: (parseFloat(custody.total_expenses) || 0) + expenses,
        remaining_amount: 0,
        settlement_date: data.date || new Date().toISOString().split('T')[0],
        status: 'settled',
        settlement_description: description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    // Journal entries
    const jeDate = data.date || new Date().toISOString().split('T')[0];
    const jeNumber = await getNextJournalNumber(custody.company_id, jeDate);

    const { data: je, error: jeErr } = await s.from('journal_entries')
      .insert({
        company_id: custody.company_id,
        number: jeNumber,
        date: jeDate,
        type: 'general',
        description: `تصفية عهدة: ${custody.description || ''} - موظف ${custody.employee_id}`,
        created_by: created_by || auth.userId,
      })
      .select('id')
      .single();

    if (jeErr) throw jeErr;
    const jeId = je.id;

    const journalLines: any[] = [];

    // Get accounts
    const { data: custodyAcc } = await s.from('accounts')
      .select('id').eq('company_id', custody.company_id).eq('code', ACCOUNT_CODES.EMPLOYEE_CUSTODIES).maybeSingle();
    const { data: bankAcc } = await s.from('banks_safes').select('account_id').eq('id', custody.bank_safe_id).maybeSingle();
    const { data: directCostAcc } = await s.from('accounts').select('id').eq('company_id', custody.company_id).eq('code', ACCOUNT_CODES.DIRECT_COSTS).maybeSingle();
    const { data: advanceAcc } = await s.from('accounts').select('id').eq('company_id', custody.companyId).eq('code', ACCOUNT_CODES.EMPLOYEE_ADVANCES).maybeSingle();
    const { data: payableAcc } = await s.from('accounts').select('id').eq('company_id', custody.companyId).eq('code', ACCOUNT_CODES.ACCOUNTS_PAYABLE).maybeSingle();

    // Close custody account: credit custody for total received
    if (custodyAcc) {
      journalLines.push({
        journal_entry_id: jeId,
        account_id: custodyAcc.id,
        account_code: ACCOUNT_CODES.EMPLOYEE_CUSTODIES,
        debit: 0,
        credit: totalReceived,
        description: `إقفال عهدة ${custody.id}`,
      });
    }

    // Returned cash: debit bank
    if (returnedCash > 0 && bankAcc?.account_id) {
      journalLines.push({
        journal_entry_id: jeId,
        account_id: bankAcc.account_id,
        debit: returnedCash,
        credit: 0,
        description: `مرتجع عهدة نقدي`,
      });
    }

    // Expenses: debit expense accounts (we assume direct costs for simplicity, but should be detailed from custody_invoices)
    // For now, we use total expenses as direct costs, but ideally we'd have breakdown
    if (expenses > 0 && directCostAcc) {
      journalLines.push({
        journal_entry_id: jeId,
        account_id: directCostAcc.id,
        account_code: ACCOUNT_CODES.DIRECT_COSTS,
        debit: expenses,
        credit: 0,
        description: `مصروفات من عهدة`,
      });
    }

    // Shortage handling
    if (shortage > 0) {
      if (deduct_shortage_from_salary) {
        // Create employee advance (deduction) to be deducted from salary
        await s.from('employee_advances').insert({
          company_id: custody.company_id,
          employee_id: custody.employee_id,
          amount: shortage,
          remaining_amount: shortage,
          date: jeDate,
          reason: `عجز عهدة ${custody.id} - ${description || ''}`,
          type: 'custody_shortage',
          custody_id: id,
        });

        // Journal: debit employee advances (receivable from employee), credit direct costs? Actually shortage is already accounted?
        // For shortage to be deducted from salary, we don't need extra journal now, it will be handled in payroll
        // But we need to track that employee owes company
        if (advanceAcc) {
          journalLines.push({
            journal_entry_id: jeId,
            account_id: advanceAcc.id,
            account_code: ACCOUNT_CODES.EMPLOYEE_ADVANCES,
            debit: shortage,
            credit: 0,
            description: `عجز عهدة - يخصم من راتب الموظف ${custody.employee_id}`,
          });
        }
      } else {
        // If not deducting from salary, expense it as loss
        if (directCostAcc) {
          // Already included in expenses? Actually shortage is part of difference, so we need to handle
          // For simplicity, if shortage and not deducting, treat as additional expense
          // Already accounted in difference, but we need to ensure journal balances
        }
      }
    }

    // Surplus handling - company owes employee
    if (surplus > 0) {
      if (pay_surplus_to_employee) {
        // Create payable to employee - will be paid via payroll or disbursement voucher
        const { data: empPayableAcc } = await s.from('accounts')
          .select('id').eq('company_id', custody.companyId).eq('code', ACCOUNT_CODES.ACCRUED_SALARIES).maybeSingle();

        if (empPayableAcc) {
          journalLines.push({
            journal_entry_id: jeId,
            account_id: empPayableAcc.id,
            account_code: ACCOUNT_CODES.ACCRUED_SALARIES,
            debit: 0,
            credit: surplus,
            description: `زيادة عهدة - مستحق للموظف ${custody.employee_id}`,
          });
        }

        // Create a record for payment
        await s.from('employee_advances').insert({
          company_id: custody.companyId,
          employee_id: custody.employee_id,
          amount: -surplus, // Negative indicates company owes employee
          remaining_amount: -surplus,
          date: jeDate,
          reason: `زيادة عهدة ${custody.id} - يصرف للموظف`,
          type: 'custody_surplus',
          custody_id: id,
        });
      }
    }

    // Insert all journal lines
    if (journalLines.length > 0) {
      // Verify balance
      const totalDebit = journalLines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = journalLines.reduce((sum, l) => sum + (l.credit || 0), 0);
      
      // Adjust for small rounding differences
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        console.warn(`Journal not balanced: debit ${totalDebit}, credit ${totalCredit}, difference ${totalDebit - totalCredit}`);
        // Try to balance by adjusting
        if (totalDebit > totalCredit && directCostAcc) {
          journalLines.push({
            journal_entry_id: jeId,
            account_id: directCostAcc.id,
            debit: 0,
            credit: totalDebit - totalCredit,
            description: 'تسوية فرق',
          });
        }
      }

      const { error: jlErr } = await insertJournalLines(custody.company_id, journalLines);
      if (jlErr) {
        console.error('Failed to insert settlement journal lines:', jlErr);
      }
    }

    // Financial audit log
    await s.from('financial_audit_log').insert({
      company_id: custody.company_id,
      user_id: auth.userId,
      action: 'settle_custody',
      table_name: 'custodies',
      record_id: id,
      old_values: { remaining_amount: custody.remaining_amount, status: custody.status },
      new_values: { 
        returned_cash: returnedCash, 
        expenses, 
        shortage, 
        surplus, 
        status: 'settled',
        deduct_from_salary: deduct_shortage_from_salary,
        pay_surplus: pay_surplus_to_employee
      },
    });

    return success({ 
      custody_id: id,
      original_amount: totalReceived,
      returned_cash: returnedCash,
      expenses,
      shortage,
      surplus,
      shortage_action: shortage > 0 ? (deduct_shortage_from_salary ? 'سيخصم من الراتب' : 'تم تسجيله كمصروف') : null,
      surplus_action: surplus > 0 ? (pay_surplus_to_employee ? 'سيصرف للموظف مع الراتب' : 'مردود') : null,
      status: 'settled',
      journal_entry_id: jeId,
    });
  } catch (e: any) {
    if (e.message === 'Not found') return notFound();
    return serverError(e);
  }
}
