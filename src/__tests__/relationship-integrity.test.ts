import fs from 'node:fs';
import path from 'node:path';
import {
  bondCreateSchema, contractCreateSchema, crmCreateSchema, ganttCreateSchema,
  reminderActionSchema, tenderCreateSchema,
} from '@/lib/relationship-validation';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const id = '10000000-0000-4000-8000-000000000001';

describe('CRM, contract, tender and delivery input boundaries', () => {
  it('rejects caller-controlled tenant and actor fields in every create contract', () => {
    expect(crmCreateSchema.safeParse({ name: 'Lead', type: 'lead', company_id: id }).success).toBe(false);
    expect(contractCreateSchema.safeParse({
      title: 'Contract', start_date: '2026-01-01', end_date: '2026-12-31', value: 10, created_by: id,
    }).success).toBe(false);
    expect(tenderCreateSchema.safeParse({ title: 'Tender', client_name: 'Client', company_id: id }).success).toBe(false);
    expect(bondCreateSchema.safeParse({
      title: 'Bond', type: 'bid_bond', amount: 10, issue_date: '2026-01-01', expiry_date: '2026-02-01', user_id: id,
    }).success).toBe(false);
    expect(ganttCreateSchema.safeParse({
      project_id: id, name: 'Task', start_date: '2026-01-01', end_date: '2026-01-02', company_id: id,
    }).success).toBe(false);
  });

  it('rejects invalid date, money and reminder operations', () => {
    expect(contractCreateSchema.safeParse({
      title: 'Contract', start_date: '2026-02-02', end_date: '2026-02-01', value: 10,
    }).success).toBe(false);
    expect(bondCreateSchema.safeParse({
      title: 'Bond', type: 'bid_bond', amount: -1, issue_date: '2026-01-01', expiry_date: '2026-02-01',
    }).success).toBe(false);
    expect(reminderActionSchema.safeParse({ action: 'custom', to: 'attacker@example.test' }).success).toBe(false);
    expect(reminderActionSchema.safeParse({ action: 'send_single', invoice_id: id, company_id: id }).success).toBe(false);
  });
});

describe('relationship lifecycle routes and database guards', () => {
  it('keeps every audited mutation route behind PostgreSQL RPCs', () => {
    const files = [
      'src/app/api/crm/route.ts', 'src/app/api/crm/[id]/route.ts',
      'src/app/api/contracts/route.ts', 'src/app/api/contracts/[id]/route.ts',
      'src/app/api/tenders/route.ts', 'src/app/api/tenders/[id]/route.ts',
      'src/app/api/bonds/route.ts', 'src/app/api/bonds/[id]/route.ts',
      'src/app/api/gantt/route.ts', 'src/app/api/reminders/route.ts',
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/\.from\([^)]*\)[\s\S]*?\.(insert|update|upsert|delete)\(/);
    }
  });

  it('reserves external reminders before sending and finalizes them afterwards', () => {
    const messaging = read('src/lib/messaging/index.ts');
    expect(messaging).toContain("begin_invoice_reminder_attempt_atomic");
    expect(messaging).toContain("finish_invoice_reminder_attempt_atomic");
    expect(messaging.indexOf('begin_invoice_reminder_attempt_atomic'))
      .toBeLessThan(messaging.indexOf("template: 'invoice_overdue_ar'", messaging.indexOf('sendInvoiceReminder')));
  });

  it('guards direct service-role writes and validates every tenant-linked parent', () => {
    const migration = read('src/migrations/060-relationship-contract-tender-guards.sql');
    expect(migration).toContain('guard_relationship_writes');
    expect(migration).toContain("ARRAY['crm_contacts','crm_followups','contracts','contract_documents','tenders','tender_cost_items','bonds','project_tasks','reminder_log']");
    expect(migration).toContain("current_setting('app.business_data_reset',TRUE)=v_company::TEXT");
    expect(migration).toContain('invalid contract document tenant link');
    expect(migration).toContain('invalid tender cost tenant link');
    expect(migration).toContain('invalid reminder tenant link');
  });
});
