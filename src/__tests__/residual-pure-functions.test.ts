import { isHeaderAccount, isCashOrBankCode, resolvePaymentAccountId, listCashBankAccountIds } from '@/lib/account-resolve';
import { getCountryConfig, getCountriesList, COUNTRIES } from '@/lib/countries';
import { safeInternalPath, safeHttpsUrl } from '@/lib/safe-input';
import { telegramConfigSchema, pushSubscriptionSchema, pushQueueSchema, complaintPatchSchema, adminComplaintPatchSchema, adminSupportPatchSchema } from '@/lib/communication-validation';
import {
  crmCreateSchema, crmUpdateSchema, contractCreateSchema, contractUpdateSchema, contractDocumentSchema,
  tenderCreateSchema, tenderUpdateSchema, tenderCostItemSchema, bondCreateSchema,
  bondUpdateSchema, ganttCreateSchema, ganttUpdateSchema, taskDependencyCreateSchema,
} from '@/lib/relationship-validation';
import { getQRCodeString, generateZatcaQRData, validateInvoiceForZatca, generateInvoiceHash } from '@/lib/zatca';
import { disbursementVoucherCreateSchema, contactCreateSchema, dateRangeSchema } from '@/lib/validation';
import { projectExpenseCreateSchema } from '@/lib/project-delivery-validation';
import { custodyExpenseSchema } from '@/lib/custody-validation';

function dbFor(data: Record<string, any[]>) {
  return {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (data[table] || []).filter((row) => filters.every(([col, val]) => row[col] === val));
      const api: any = {
        select: () => api,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return api; },
        order: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then: (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      };
      return api;
    },
  };
}

const UUID1 = '90000000-0000-4000-8000-000000000001';
const UUID2 = '90000000-0000-4000-8000-000000000002';

describe('remaining account and country helper functions', () => {
  test('recognizes headers and every supported cash/bank code shape', () => {
    expect(isHeaderAccount({ is_header: true })).toBe(true);
    expect(isHeaderAccount({ children: [{}] })).toBe(true);
    expect(isHeaderAccount({ code: '1000' })).toBe(true);
    expect(isHeaderAccount({ code: '1111', children: [] })).toBe(false);
    expect(isHeaderAccount({})).toBe(false);
    for (const code of ['1110', '1120', '1110-0001', '1120-1', '0001-1110', '0001-1120', '11100001', '11200001']) expect(isCashOrBankCode(code)).toBe(true);
    for (const code of [null, undefined, '', '1111', '1110001']) expect(isCashOrBankCode(code)).toBe(false);
  });

  test('resolves preferred, active safe, account fallback and missing payment accounts', async () => {
    let db = dbFor({ banks_safes: [{ id: 'b1', company_id: 'c1', account_id: 'preferred', is_active: true, type: 'bank' }] });
    await expect(resolvePaymentAccountId(db, 'c1', 'b1')).resolves.toBe('preferred');

    db = dbFor({ banks_safes: [
      { company_id: 'c1', account_id: 'bank', is_active: true, type: 'bank' },
      { company_id: 'c1', account_id: 'safe', is_active: true, type: 'safe' },
      { company_id: 'c1', account_id: null, is_active: true, type: 'safe' },
    ] });
    await expect(resolvePaymentAccountId(db, 'c1')).resolves.toBe('safe');

    db = dbFor({ banks_safes: [{ id: 'b1', company_id: 'c1', account_id: null, is_active: true, type: 'safe' }, { company_id: 'c1', account_id: 'only-bank', is_active: true, type: 'bank' }] });
    await expect(resolvePaymentAccountId(db, 'c1', 'missing')).resolves.toBe('only-bank');
    db = dbFor({ accounts: [{ id: 'cash-parent', company_id: 'c1', code: '1110' }] });
    await expect(resolvePaymentAccountId(db, 'c1')).resolves.toBe('cash-parent');
    db = dbFor({ accounts: [{ id: 'bank-parent', company_id: 'c1', code: '1120' }] });
    await expect(resolvePaymentAccountId(db, 'c1')).resolves.toBe('bank-parent');
    await expect(resolvePaymentAccountId(dbFor({}), 'c1')).resolves.toBeNull();
  });

  test('lists unique cash/bank accounts from chart and registered safes', async () => {
    const db = dbFor({
      accounts: [{ id: 'a1', company_id: 'c1', code: '1110-01' }, { id: 'x', company_id: 'c1', code: '5101' }],
      banks_safes: [{ company_id: 'c1', account_id: 'a1' }, { company_id: 'c1', account_id: 'a2' }, { company_id: 'c1', account_id: null }],
    });
    await expect(listCashBankAccountIds(db, 'c1')).resolves.toEqual(['a1', 'a2']);
  });

  test('returns country configuration/list and safe fallback', () => {
    expect(getCountryConfig('EG').currencyCode).toBe('EGP');
    expect(getCountryConfig('XX')).toBe(COUNTRIES[0]);
    expect(getCountriesList()).toHaveLength(COUNTRIES.length);
    expect(getCountriesList()[0]).toEqual({ value: 'SA', label: 'السعودية' });
  });
});

describe('remaining security path validators', () => {
  test('accepts only safe same-app paths', () => {
    expect(safeInternalPath('/invoices/1')).toBe('/invoices/1');
    for (const value of [null, '', 'https://evil.test', '//evil.test', '/bad\\path', '/bad\npath', 'x'.repeat(513), 1]) {
      expect(safeInternalPath(value)).toBeNull();
    }
  });

  test('accepts credential-free HTTPS URLs within the length bound', () => {
    expect(safeHttpsUrl('https://example.com/a')).toBe('https://example.com/a');
    for (const value of ['', 'http://example.com', 'https://u:p@example.com', 'not-url', 'x'.repeat(30)]) {
      expect(safeHttpsUrl(value, 20)).toBeNull();
    }
  });
});

describe('remaining communication schema refinements', () => {
  test('requires Telegram chat only when integration is enabled and validates precision', () => {
    const base = { chat_id: '', is_enabled: false, notify_invoices: false, notify_cash_transactions: false, notify_user_logins: false, approvals_enabled: false, approval_threshold: 0 };
    expect(telegramConfigSchema.safeParse(base).success).toBe(true);
    expect(telegramConfigSchema.safeParse({ ...base, is_enabled: true }).success).toBe(false);
    expect(telegramConfigSchema.safeParse({ ...base, is_enabled: true, chat_id: '-123', approval_threshold: 1.23 }).success).toBe(true);
    expect(telegramConfigSchema.safeParse({ ...base, approval_threshold: 1.234 }).success).toBe(false);
  });

  test('allows HTTPS push subscriptions, one push target and nonempty update patches', () => {
    expect(pushSubscriptionSchema.safeParse({ subscription: { endpoint: 'https://push.test/id', keys: { p256dh: 'p', auth: 'a' } } }).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ subscription: { endpoint: 'http://push.test/id', keys: { p256dh: 'p', auth: 'a' } } }).success).toBe(false);
    const push = { title: 'T', message: 'M', target_user_id: UUID1, target_role: 'admin' };
    expect(pushQueueSchema.safeParse(push).success).toBe(false);
    expect(pushQueueSchema.safeParse({ ...push, target_role: undefined, url: '/safe' }).success).toBe(true);
    expect(complaintPatchSchema.safeParse({}).success).toBe(false);
    expect(complaintPatchSchema.safeParse({ status: 'closed' }).success).toBe(true);
    expect(adminComplaintPatchSchema.safeParse({ id: UUID1 }).success).toBe(false);
    expect(adminComplaintPatchSchema.safeParse({ id: UUID1, adminReply: '' }).success).toBe(true);
    expect(adminSupportPatchSchema.safeParse({ id: UUID1 }).success).toBe(false);
    expect(adminSupportPatchSchema.safeParse({ id: UUID1, status: 'resolved' }).success).toBe(true);
  });
});

describe('remaining relationship schema callbacks', () => {
  test('exercises CRM preprocessors, money precision and nonempty updates', () => {
    const crm = { name: 'Lead', type: 'lead', email: '', assigned_to: '', estimated_value: '10.25' };
    expect(crmCreateSchema.safeParse(crm).success).toBe(true);
    expect(crmCreateSchema.safeParse({ ...crm, estimated_value: '10.251' }).success).toBe(false);
    expect(crmUpdateSchema.safeParse({}).success).toBe(false);
  });

  test('validates contract date order and safe document names', () => {
    const contract = { title: 'C', start_date: '2026-01-01', end_date: '2026-12-31', value: 1 };
    expect(contractCreateSchema.safeParse(contract).success).toBe(true);
    expect(contractCreateSchema.safeParse({ ...contract, start_date: '2026-02-30' }).success).toBe(false);
    expect(contractCreateSchema.safeParse({ ...contract, end_date: '2025-12-31' }).success).toBe(false);
    expect(contractUpdateSchema.safeParse({}).success).toBe(false);
    expect(contractUpdateSchema.safeParse({ title: 'Updated' }).success).toBe(true);
    expect(contractUpdateSchema.safeParse({ project_id: UUID1 }).success).toBe(true);
    expect(contractDocumentSchema.safeParse({ filename: 'invoice.pdf', content_type: 'application/pdf', file_data: 'x' }).success).toBe(true);
    expect(contractDocumentSchema.safeParse({ filename: '../bad.pdf', content_type: 'application/pdf', file_data: 'x' }).success).toBe(false);
  });

  test('validates tender dates, updates and positive cost items', () => {
    const tender = { title: 'T', client_name: 'Client', submission_deadline: '2026-01-01', opening_date: '2026-01-02', contact_id: '' };
    expect(tenderCreateSchema.safeParse(tender).success).toBe(true);
    expect(tenderCreateSchema.safeParse({ ...tender, opening_date: '2025-12-31' }).success).toBe(false);
    expect(tenderUpdateSchema.safeParse({}).success).toBe(false);
    expect(tenderCostItemSchema.safeParse({ category: 'materials', amount: 1 }).success).toBe(true);
    expect(tenderCostItemSchema.safeParse({ category: 'materials', amount: 0 }).success).toBe(false);
  });

  test('validates bond dates, positive amounts and nonempty updates', () => {
    const bond = { title: 'B', type: 'bid_bond', amount: 100, issue_date: '2026-01-01', expiry_date: '2026-12-31', bank_safe_id: '', project_id: '', tender_id: '', contact_id: '' };
    expect(bondCreateSchema.safeParse(bond).success).toBe(true);
    expect(bondCreateSchema.safeParse({ ...bond, expiry_date: '2025-01-01' }).success).toBe(false);
    expect(bondUpdateSchema.safeParse({}).success).toBe(false);
  });

  test('validates Gantt ranges, hours, nonempty updates and self-dependencies', () => {
    const task = { project_id: UUID1, name: 'Task', start_date: '2026-01-01', end_date: '2026-01-02', parent_task_id: '', assigned_to: '', estimated_hours: '1.25' };
    expect(ganttCreateSchema.safeParse(task).success).toBe(true);
    expect(ganttCreateSchema.safeParse({ ...task, end_date: '2025-01-01' }).success).toBe(false);
    expect(ganttCreateSchema.safeParse({ ...task, estimated_hours: '1.251' }).success).toBe(false);
    expect(ganttUpdateSchema.safeParse({}).success).toBe(false);
    expect(taskDependencyCreateSchema.safeParse({ successor_task_id: UUID1, predecessor_task_id: UUID1 }).success).toBe(false);
    expect(taskDependencyCreateSchema.safeParse({ successor_task_id: UUID1, predecessor_task_id: UUID2, lag_days: -2 }).success).toBe(true);
  });
});

describe('remaining shared validation callbacks', () => {
  test('executes voucher duplicate, birth-date, date-range and project-tax refinements', () => {
    const voucher = {
      date: '2026-08-20', disbursement_type: 'other', amount: 100,
      bank_safe_id: UUID1, reason: 'pay', invoice_items: [
        { invoice_id: UUID1, amount: 10 }, { invoice_id: UUID1, amount: 20 },
      ],
    };
    expect(disbursementVoucherCreateSchema.safeParse(voucher).success).toBe(false);
    expect(contactCreateSchema.safeParse({ name: 'A', type: 'client', date_of_birth: '2026-02-30' }).success).toBe(false);
    expect(contactCreateSchema.safeParse({ name: 'A', type: 'client', date_of_birth: '' }).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(projectExpenseCreateSchema.safeParse({ project_id: UUID1, expense_type: 'materials', description: 'x', amount: 10, date: '2026-08-20', tax_rate: 0.1234 }).success).toBe(true);
    expect(projectExpenseCreateSchema.safeParse({ project_id: UUID1, expense_type: 'materials', description: 'x', amount: 10, date: '2026-08-20', tax_rate: 0.12345 }).success).toBe(false);
    expect(custodyExpenseSchema.safeParse({ amount: 1, description: 'x', invoice_id: UUID1, purchase_invoice_id: UUID2 }).success).toBe(false);
    expect(custodyExpenseSchema.safeParse({ amount: 1, description: 'x', invoice_id: UUID1 }).success).toBe(true);
  });
});

describe('ZATCA barrel exports', () => {
  test('executes QR, validation and invoice hash through index exports', () => {
    const input = { sellerName: 'Seller', vatNumber: '123456789012345', timestamp: '2026-08-20T10:00:00Z', invoiceTotal: 115, vatTotal: 15 };
    expect(generateZatcaQRData(input)).toBeTruthy();
    expect(getQRCodeString(input)).toBeTruthy();
    expect(validateInvoiceForZatca(input).valid).toBe(true);
    expect(generateInvoiceHash('<Invoice/>')).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
