/**
 * Migration 113 — unified credit/debit note numbering (PGlite, full schema).
 *
 * Regression: credit_notes.number is UNIQUE(company_id, number) and serves BOTH
 * note types, but the two sequence functions seeded from independent sources
 * (credit: all notes, debit: debit notes only). Consequences in production:
 *   - credit #1 then debit → 23505 duplicate key (debit re-seeded from 0 → #1)
 *   - debit #1 then credit #2 then debit → 23505 (debit counter drifted to #2)
 * Any company issuing both note types in a year was deterministically affected.
 * Fix: one shared counter (credit_note_sequences) with a self-healing floor at
 * the actual table max. These tests reproduce both orderings end-to-end.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createSchemaContext, type SchemaContext } from './helpers/pglite-schema';

let ctx: SchemaContext;
let contactId: string;
let invoiceId: string;

function makeNoteItems(): string {
  return JSON.stringify([{ description: 'صنف ملاحظة', quantity: 1, unit_price: 100 }]);
}

async function createNote(type: 'credit' | 'debit') {
  const fn = type === 'credit' ? 'create_credit_note_atomic' : 'create_debit_note_atomic';
  const res = await ctx.query(
    `SELECT ${fn}(
       $1::UUID, $2::UUID, NULL::UUID, $3::UUID, '2026-01-20'::DATE,
       'سبب تجريبي'::TEXT, $4::JSONB, 0.15::NUMERIC, $5::UUID,
       0::NUMERIC, NULL::UUID
     ) AS r`,
    [ctx.companyId, invoiceId, contactId, makeNoteItems(), ctx.userId],
  );
  return res.rows[0].r as Record<string, unknown>;
}

async function noteNumbers() {
  const res = await ctx.query(
    `SELECT number, note_type, status FROM credit_notes WHERE company_id=$1 ORDER BY number`,
    [ctx.companyId],
  );
  return res.rows as Array<{ number: number; note_type: string; status: string }>;
}

beforeAll(async () => {
  ctx = await createSchemaContext();

  const contact = await ctx.query(
    `INSERT INTO contacts(company_id, name, type, is_active)
     VALUES($1, 'عميل 113', 'client', TRUE) RETURNING id`,
    [ctx.companyId],
  );
  contactId = String(contact.rows[0].id);

  const inv = await ctx.query(
    `SELECT create_sales_invoice_atomic(
       $1::UUID, $2::UUID, NULL::UUID, '2026-01-15'::DATE, '2026-02-15'::DATE,
       '[{"description":"خدمة","quantity":10,"unitPrice":100}]'::JSONB,
       0.15::NUMERIC, TRUE, ''::TEXT, 0::NUMERIC, NULL::UUID, $3::UUID
     ) AS r`,
    [ctx.companyId, contactId, ctx.userId],
  );
  invoiceId = String((inv.rows[0].r as Record<string, unknown>).id);
}, 180_000); // migrations can take a while under PGlite

afterAll(async () => {
  await ctx?.close();
});

describe('ميجريشن 113 — ترقيم موحد للإشعارات (سلوكي)', () => {
  test('الدائن أول: دائن ثم مدينة ثم دائن ثم مدينة — أرقام متسلسلة بلا اصطدام', async () => {
    // This exact order threw 23505 before migration 113 (debit re-seeded from 0).
    const n1 = await createNote('credit');
    const n2 = await createNote('debit');
    const n3 = await createNote('credit');
    const n4 = await createNote('debit');

    expect([n1, n2, n3, n4].map((n) => n.status)).toEqual(['approved', 'approved', 'approved', 'approved']);
    expect([Number(n1.number), Number(n2.number), Number(n3.number), Number(n4.number)]).toEqual([1, 2, 3, 4]);

    const rows = await noteNumbers();
    const numbers = rows.map((r) => r.number);
    expect(new Set(numbers).size).toBe(4); // unique under the shared constraint
  });

  test('التناوب المتواصل: مدينة ثم دائن ثم مدينة — بلا اصطدام (تسلسل 5-6-7)', async () => {
    // Before 113 the debit counter lagged behind the shared column max, so a
    // debit following credits re-derived a number that was already taken.
    const n5 = await createNote('debit');
    const n6 = await createNote('credit');
    const n7 = await createNote('debit');
    expect([Number(n5.number), Number(n6.number), Number(n7.number)]).toEqual([5, 6, 7]);
  });

  test('عدّاد ذاتي الشفاء: بيانات تاريخية برقم أعلى لا تُنتج رقمًا مكررًا', async () => {
    // Simulate legacy data (notes created under the old divergent counters):
    // an out-of-band note with number 99 exists while the counter lags behind.
    await ctx.query(
      `INSERT INTO credit_notes(company_id, invoice_id, contact_id, number, note_type, status,
        reason, subtotal, vat_amount, total, date, created_by)
       VALUES($1, $2, $3, 99, 'debit', 'approved', 'بيانات مورثة', 100, 15, 115, '2026-01-01', $4)`,
      [ctx.companyId, invoiceId, contactId, ctx.userId],
    );

    const next = await createNote('credit');
    expect(Number(next.number)).toBeGreaterThanOrEqual(100);
  });

  test('فحص نصي: التسلسلان يشاركان العداد نفسه بقاع GREATEST', () => {
    const text = fs.readFileSync(
      path.join(process.cwd(), 'src', 'migrations', '113-unified-note-numbering.sql'),
      'utf8',
    );
    expect(text).toContain('FUNCTION public.next_credit_note_number');
    expect(text).toContain('FUNCTION public.next_debit_note_number');
    expect(text).toContain('GREATEST(credit_note_sequences.last_number,');
    expect(text).toContain('RETURN next_credit_note_number(p_company_id, p_year);');
  });
});
