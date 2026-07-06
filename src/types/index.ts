export interface Company {
  id: string;
  name: string;
  commercial_registration?: string;
  tax_number?: string;
  phone?: string;
  email?: string;
  address?: string;
  currency_symbol: string;
  created_at: string;
  is_active: boolean;
}

export interface User {
  id: string;
  company_id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_login?: string;
}

export enum UserRole {
  ADMIN = 'admin',
  ACCOUNTANT = 'accountant',
  MANAGER = 'manager',
  SUPERVISOR = 'supervisor',
}

export interface Account {
  id: string;
  company_id: string;
  code: string;
  name: string;
  name_en?: string;
  type: AccountType;
  parent_id?: string;
  is_active: boolean;
  children?: Account[];
}

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export interface JournalEntry {
  id: string;
  company_id: string;
  number: number;
  date: string;
  type: 'general' | 'opening_balance' | 'accrual';
  description: string;
  reference_type?: string;
  reference_id?: string;
  project_id?: string;
  created_by: string;
  created_at: string;
  reversal_of?: string;
  lines: JournalLine[];
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description?: string;
  project_id?: string;
  contact_id?: string;
}

export interface Contact {
  id: string;
  company_id: string;
  name: string;
  type: 'client' | 'supplier' | 'subcontractor' | 'both';
  phone?: string;
  email?: string;
  address?: string;
  tax_number?: string;
  commercial_registration?: string;
  account_id?: string;
  credit_limit?: number;
  is_active: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  company_id: string;
  number: number;
  date: string;
  due_date: string;
  contact_id: string;
  project_id?: string;
  subtotal: number;
  tax_amount: number;
  tax_rate: number;
  total: number;
  paid_amount: number;
  status: 'unpaid' | 'partial' | 'paid' | 'cancelled';
  journal_entry_id?: string;
  notes?: string;
  created_at: string;
  items: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Project {
  id: string;
  company_id: string;
  name: string;
  client_id?: string;
  contract_value: number;
  start_date: string;
  end_date?: string;
  status: 'active' | 'completed' | 'cancelled';
  tax_enabled: boolean;
  tax_rate: number;
  created_at: string;
}

export interface VoucherReceipt {
  id: string;
  company_id: string;
  number: number;
  date: string;
  receipt_type: 'client' | 'supplier_refund' | 'general' | 'supplier_advance_return';
  contact_id?: string;
  amount: number;
  bank_safe_id: string;
  reference_type?: string;
  reference_id?: string;
  reason: string;
  journal_entry_id?: string;
  created_by: string;
  created_at: string;
}

export interface VoucherDisbursement {
  id: string;
  company_id: string;
  number: number;
  date: string;
  disbursement_type: 'supplier' | 'client_refund' | 'employee_advance' | 'other' | 'supplier_advance' | 'subcontractor';
  contact_id?: string;
  employee_id?: string;
  amount: number;
  bank_safe_id: string;
  reason: string;
  journal_entry_id?: string;
  created_by: string;
  created_at: string;
}

export interface CashTransaction {
  id: string;
  company_id: string;
  date: string;
  type: 'revenue' | 'expense';
  amount: number;
  account_id: string;
  bank_safe_id?: string;
  contact_id?: string;
  project_id?: string;
  category_id?: string;
  reason: string;
  journal_entry_id?: string;
  created_by: string;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  company_id: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  warehouse_id: string;
  category?: string;
  is_active: boolean;
}

export interface Warehouse {
  id: string;
  company_id: string;
  name: string;
  location?: string;
  is_active: boolean;
}

export interface FixedAsset {
  id: string;
  company_id: string;
  name: string;
  code: string;
  category: string;
  purchase_date: string;
  purchase_cost: number;
  useful_life_years: number;
  depreciation_rate: number;
  depreciation_method: 'straight_line' | 'declining_balance';
  accumulated_depreciation: number;
  net_book_value: number;
  status: 'active' | 'disposed' | 'fully_depreciated';
  location?: string;
  notes?: string;
}

export interface Employee {
  id: string;
  company_id: string;
  name: string;
  phone?: string;
  email?: string;
  salary: number;
  department?: string;
  position?: string;
  hire_date: string;
  is_active: boolean;
}

export interface Payroll {
  id: string;
  company_id: string;
  employee_id: string;
  date: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  advance_deduction: number;
  net_pay: number;
  journal_entry_id?: string;
}

export interface FiscalYear {
  id: string;
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
  closed_at?: string;
}

export interface Setting {
  key: string;
  value: string;
  company_id: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  master_password_hash: string;
  telegram_chat_id: string;
  created_at: string;
  last_login?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardSummary {
  total_revenue: number;
  total_expenses: number;
  net_profit: number;
  accounts_receivable: number;
  accounts_payable: number;
  cash_balance: number;
  active_projects: number;
  overdue_invoices: number;
}
