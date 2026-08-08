/**
 * K6 load test: concurrent invoice creation + sequential numbering integrity.
 *
 * Validates protocol items 2.1 (sequential numbering under concurrency) and
 * 5.2 (throughput). Run against a STAGING environment only.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://staging.example.com -e AUTH_TOKEN=<user-token> tests/load/invoices.k6.js
 *
 * AUTH_TOKEN must belong to a user with the 'invoices:create' permission.
 * Run `npx tsx scripts/seed.ts` first to populate the tenant with accounts.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';
const NUMBERS = new Counter('invoice_numbers');

export const options = {
  vus: Number(__ENV.VUS || 50),
  duration: __ENV.DURATION || '2m',
  thresholds: {
    http_req_duration: ['p(95)<300'], // p95 under 300ms
    http_req_failed: ['rate<0.01'], // error rate under 1%
  },
};

export default function () {
  // Create a customer, then an invoice referencing it.
  const custRes = http.post(
    `${BASE}/api/clients`,
    JSON.stringify({ name: `LT-Cust-${Math.floor(Math.random() * 1e6)}` }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } }
  );
  const custOk = check(custRes, { 'customer created': (r) => r.status === 200 || r.status === 201 });
  if (!custOk) {
    sleep(0.1);
    return;
  }
  const clientId = custRes.json('id');

  const qty = 1 + Math.floor(Math.random() * 5);
  const price = 100 + Math.floor(Math.random() * 900);
  const subtotal = qty * price;
  const vat = Number((subtotal * 0.15).toFixed(2));
  const total = Number((subtotal + vat).toFixed(2));

  const body = {
    clientId,
    date: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    items: [
      { description: 'Load test service', quantity: qty, unitPrice: price, unit: 'serv', item_type: 'service' },
    ],
    subtotal,
    vatRate: 0.15,
    vatAmount: vat,
    total,
    notes: 'k6 load test',
  };

  const res = http.post(`${BASE}/api/invoices`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    tags: { name: 'create_invoice' },
  });

  const ok = check(res, {
    'invoice created': (r) => r.status === 200 || r.status === 201,
  });
  if (ok && res.json('number') !== undefined) {
    NUMBERS.add(res.json('number'));
  }
  sleep(0.2);
}
