import { createHmac } from 'crypto';
import {
  initPayment, getPaymentStatus, refundPayment, verifyWebhookSignature,
  mapPaymentStatus, formatHalalas,
} from '@/lib/payments/moyasar';

const payment = { id: 'pay_1', status: 'captured', amount: 1250, currency: 'SAR', description: 'Invoice', source: { type: 'card', company: 'visa', name: 'A', number: '1111' }, invoice_url: 'https://pay.test/1', created_at: '2026-08-20' };

beforeEach(() => {
  process.env.MOYASAR_SECRET_KEY = 'sk_test';
  process.env.MOYASAR_WEBHOOK_SECRET = 'webhook-secret';
  jest.restoreAllMocks();
});

describe('Moyasar payment gateway functions', () => {
  test('initializes payment in halalas with invoice/customer metadata', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(payment), { status: 200 })) as unknown as typeof fetch;
    await expect(initPayment({ amount: 12.505, description: 'Invoice', callbackUrl: 'https://app.test/callback', invoiceId: 'i1', customerName: 'Ali', customerEmail: 'a@test.com' }))
      .resolves.toEqual({ paymentId: 'pay_1', paymentUrl: 'https://pay.test/1' });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ amount: 1251, currency: 'SAR', callback_url: 'https://app.test/callback', metadata: { invoice_id: 'i1', customer_name: 'Ali', customer_email: 'a@test.com' } });
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test:').toString('base64')}`);
  });

  test('falls back to payment API URL and reports init failures', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...payment, invoice_url: undefined }), { status: 200 })) as unknown as typeof fetch;
    await expect(initPayment({ amount: 1, description: 'x', callbackUrl: 'https://a', invoiceId: 'i', customerName: 'n', customerEmail: 'e' }))
      .resolves.toMatchObject({ paymentUrl: 'https://api.moyasar.com/v1/payments/pay_1' });
    global.fetch = jest.fn(async () => new Response('bad card', { status: 422 })) as unknown as typeof fetch;
    await expect(initPayment({ amount: 1, description: 'x', callbackUrl: 'https://a', invoiceId: 'i', customerName: 'n', customerEmail: 'e' }))
      .rejects.toThrow('bad card');
  });

  test('gets payment status and rejects failed lookups', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(payment), { status: 200 })) as unknown as typeof fetch;
    await expect(getPaymentStatus('pay_1')).resolves.toMatchObject({ status: 'captured' });
    expect(global.fetch).toHaveBeenCalledWith('https://api.moyasar.com/v1/payments/pay_1', expect.any(Object));
    global.fetch = jest.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(getPaymentStatus('missing')).rejects.toThrow('missing');
  });

  test('refunds full/partial amounts and exposes gateway failures', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ...payment, status: 'refunded' }), { status: 200 })) as unknown as typeof fetch;
    await refundPayment('pay_1', 5.25);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ amount: 525 });
    await refundPayment('pay_1');
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({});
    global.fetch = jest.fn(async () => new Response('not captured', { status: 409 })) as unknown as typeof fetch;
    await expect(refundPayment('pay_1')).rejects.toThrow('not captured');
  });

  test('requires configured keys and verifies webhook HMAC in constant time', async () => {
    delete process.env.MOYASAR_SECRET_KEY;
    await expect(getPaymentStatus('p')).rejects.toThrow('MOYASAR_SECRET_KEY');
    const signature = createHmac('sha256', 'webhook-secret').update('{"id":1}').digest('hex');
    expect(verifyWebhookSignature('{"id":1}', signature)).toBe(true);
    expect(verifyWebhookSignature('{"id":2}', signature)).toBe(false);
    expect(verifyWebhookSignature('x', 'bad')).toBe(false);
    delete process.env.MOYASAR_WEBHOOK_SECRET;
    expect(verifyWebhookSignature('x', signature)).toBe(false);
  });

  test('maps every gateway status and formats halalas', () => {
    expect(['initiated', 'authorized', 'captured', 'refunded', 'rejected', 'failed', 'other'].map(mapPaymentStatus))
      .toEqual(['pending', 'authorized', 'paid', 'refunded', 'failed', 'failed', 'unknown']);
    expect(formatHalalas(1234)).toBe('12.34');
  });
});
