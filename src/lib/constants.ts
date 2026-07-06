export const ACCOUNT_CODES = {
  CASH: '1110',
  BANKS: '1120',
  ACCOUNTS_RECEIVABLE: '1130',
  ACCRUED_REVENUE: '1135',
  PREPAID_EXPENSES: '1140',
  ALLOWANCE_DOUBTFUL: '1141',
  EMPLOYEE_CUSTODIES: '1150',
  EMPLOYEE_ADVANCES: '1160',
  INVENTORY: '1170',
  VAT_PURCHASES: '1180',
  PREPAID_SUPPLIERS: '1190',
  SUBCONTRACTOR_ADVANCES: '1191',
  FIXED_ASSETS_START: '1200',
  FIXED_ASSETS_END: '1220',
  ACCUM_DEPRECIATION: '1230',
  ACCOUNTS_PAYABLE: '2110',
  VAT_SALES: '2120',
  LOANS: '2130',
  ACCRUED_SALARIES: '2140',
  ACCRUED_EXPENSES: '2145',
  SUBCONTRACTOR_PAYABLES: '2150',
  RETENTIONS: '2160',
  DAILY_WORKERS: '2170',
  ADVANCES_FROM_CUSTOMERS: '2180',
  EMPLOYEE_BENEFITS: '2190',
  CAPITAL: '3100',
  RETAINED_EARNINGS: '3200',
  CONTRACT_REVENUE: '4100',
  OTHER_REVENUE: '4200',
  DISCOUNT_RECEIVED: '4250',
  INTEREST_INCOME: '4300',
  DIRECT_COSTS: '5100',
  MATERIALS: '5110',
  SALARIES_EXPENSE: '5210',
  DEPRECIATION: '5260',
  BAD_DEBT: '5330',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export enum UserRole {
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
  MANAGER = 'manager',
  SUPERVISOR = 'supervisor',
}

export enum JournalEntryType {
  GENERAL = 'general',
  OPENING_BALANCE = 'opening_balance',
  ACCRUAL = 'accrual',
}

export enum VoucherType {
  CLIENT_RECEIPT = 'client',
  SUPPLIER_RECEIPT = 'supplier_refund',
  GENERAL_RECEIPT = 'general',
  SUPPLIER_PAYMENT = 'supplier',
  CLIENT_REFUND = 'client_refund',
  EMPLOYEE_ADVANCE = 'employee_advance',
  OTHER = 'other',
}

export enum PeriodStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export const ACCOUNT_RANGES: Record<string, { start: string; end: string; label: string }> = {
  ASSETS: { start: '1000', end: '1999', label: 'الأصول' },
  LIABILITIES: { start: '2000', end: '2999', label: 'الخصوم' },
  EQUITY: { start: '3000', end: '3999', label: 'حقوق الملكية' },
  REVENUE: { start: '4000', end: '4999', label: 'الإيرادات' },
  EXPENSES: { start: '5000', end: '5999', label: 'المصروفات' },
};

export const VAT_RATE = 0.15;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
