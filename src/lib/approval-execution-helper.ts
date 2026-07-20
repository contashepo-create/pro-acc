import { getSupabase } from '@/lib/supabase-client';

const sb = () => getSupabase();

/**
 * تنفيذ العملية بعد الموافقة (للإصدارات الجديدة)
 */
async function executeApprovedTransaction(
  companyId: string,
  transactionType: string,
  transactionId: string
): Promise<void> {
  const s = sb();

  switch (transactionType) {
    case 'journal_entry':
      await s.from('journal_entries')
        .update({ status: 'posted', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'voucher_disbursement':
    case 'voucher_receipt':
      const voucherTable = transactionType === 'voucher_disbursement' ? 'voucher_disbursements' : 'voucher_receipts';
      await s.from(voucherTable)
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'cash_transaction':
      await s.from('cash_transactions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'purchase_invoice':
      await s.from('purchase_invoices')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'payroll':
      await s.from('salary_sheets')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'fixed_assets':
      await s.from('fixed_assets')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'inventory_transaction':
      await s.from('inventory_transactions')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'project_expense':
      await s.from('project_expenses')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'employee_advance':
      await s.from('employee_advances')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'subcontractor_payment':
      await s.from('subcontractor_payments')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'client_payment':
      await s.from('invoice_payments')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    case 'payment_disbursement':
      await s.from('payment_disbursements')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', transactionId)
        .eq('company_id', companyId);
      break;

    default:
      console.warn(`Unknown transaction type for execution: ${transactionType}`);
  }
}

/**
 * تحديث حالة العملية (دالة مساعدة)
 */
async function updateTransactionStatus(
  companyId: string,
  transactionType: string,
  transactionId: string,
  status: string
): Promise<void> {
  const s = sb();

  const tableMap: Record<string, string> = {
    'journal_entry': 'journal_entries',
    'voucher_disbursement': 'voucher_disbursements',
    'voucher_receipt': 'voucher_receipts',
    'cash_transaction': 'cash_transactions',
    'purchase_invoice': 'purchase_invoices',
    'payroll': 'salary_sheets',
    'fixed_assets': 'fixed_assets',
    'inventory_transaction': 'inventory_transactions',
    'project_expense': 'project_expenses',
    'employee_advance': 'employee_advances',
    'subcontractor_payment': 'subcontractor_payments',
    'client_payment': 'invoice_payments',
    'payment_disbursement': 'payment_disbursements',
  };

  const tableName = tableMap[transactionType];
  if (tableName) {
    await s.from(tableName)
      .update({ status })
      .eq('id', transactionId)
      .eq('company_id', companyId);
  }
}