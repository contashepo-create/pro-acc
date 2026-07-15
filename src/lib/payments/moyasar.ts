/**
 * Moyasar Payment Gateway Integration
 * https://moyasar.com/docs/api/
 * 
 * Moyasar is the leading Saudi payment gateway, approved by SAMA (Saudi Central Bank).
 * Supports: Mada, Visa, MasterCard, Apple Pay, STCPay
 * 
 * Environment variables needed:
 * - MOYASAR_SECRET_KEY: Secret API key from Moyasar dashboard
 * - MOYASAR_PUBLISHABLE_KEY: Publishable key for frontend
 * - MOYASAR_WEBHOOK_SECRET: For verifying webhook callbacks
 */

const MOYASAR_API = 'https://api.moyasar.com/v1';

interface PaymentInitRequest {
  amount: number;        // Amount in halalas (1 SAR = 100 halalas)
  description: string;
  callbackUrl: string;
  invoiceId: string;
  customerName: string;
  customerEmail: string;
}

interface MoyasarPayment {
  id: string;
  status: 'initiated' | 'authorized' | 'captured' | 'refunded' | 'rejected' | 'failed';
  amount: number;
  currency: string;
  description: string;
  source: {
    type: string;
    company: string;
    name: string;
    number: string;
    message?: string;
  };
  metadata?: Record<string, string>;
  invoice_url?: string;
  created_at: string;
}

function getMoyasarHeaders(): Record<string, string> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) throw new Error('MOYASAR_SECRET_KEY is not configured');
  
  return {
    'Authorization': `Basic ${Buffer.from(key + ':').toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Initialize a payment — returns a Moyasar payment form URL
 * The customer is redirected to this URL to complete payment
 */
export async function initPayment(req: PaymentInitRequest): Promise<{
  paymentId: string;
  paymentUrl: string;
}> {
  const body = {
    amount: Math.round(req.amount * 100), // Convert to halalas
    currency: 'SAR',
    description: req.description,
    callback_url: req.callbackUrl,
    source: { type: 'card' },
    metadata: {
      invoice_id: req.invoiceId,
      customer_name: req.customerName,
      customer_email: req.customerEmail,
    },
  };

  const response = await fetch(`${MOYASAR_API}/payments`, {
    method: 'POST',
    headers: getMoyasarHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Moyasar payment init failed: ${error}`);
  }

  const payment: MoyasarPayment = await response.json();

  return {
    paymentId: payment.id,
    paymentUrl: payment.invoice_url || `${MOYASAR_API}/payments/${payment.id}`,
  };
}

/**
 * Get payment status from Moyasar
 */
export async function getPaymentStatus(paymentId: string): Promise<MoyasarPayment> {
  const response = await fetch(`${MOYASAR_API}/payments/${paymentId}`, {
    headers: getMoyasarHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to get payment status: ${paymentId}`);
  }

  return response.json();
}

/**
 * Refund a captured payment (full or partial)
 */
export async function refundPayment(paymentId: string, amount?: number): Promise<MoyasarPayment> {
  const body: Record<string, unknown> = {};
  if (amount) {
    body.amount = Math.round(amount * 100); // halalas
  }

  const response = await fetch(`${MOYASAR_API}/payments/${paymentId}/refund`, {
    method: 'PUT',
    headers: getMoyasarHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Refund failed: ${error}`);
  }

  return response.json();
}

/**
 * Verify webhook signature from Moyasar
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET;
  if (!secret) return false;

  const crypto = require('crypto');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return expected === signature;
}

/**
 * Map Moyasar status to our internal status
 */
export function mapPaymentStatus(moyasarStatus: string): string {
  switch (moyasarStatus) {
    case 'initiated': return 'pending';
    case 'authorized': return 'authorized';
    case 'captured': return 'paid';
    case 'refunded': return 'refunded';
    case 'rejected':
    case 'failed': return 'failed';
    default: return 'unknown';
  }
}

/**
 * Format amount for display
 */
export function formatHalalas(halalas: number): string {
  return (halalas / 100).toFixed(2);
}
