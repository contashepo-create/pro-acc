process.env.PORTAL_SECRET = 'test-portal-secret-that-is-at-least-32-characters-long';

import { createHmac } from 'crypto';
import { createPortalToken, verifyPortalToken } from '@/lib/portal-auth';

describe('portal magic-link tokens', () => {
  const contact = { contactId: 'contact-1', companyId: 'company-1', email: 'Client@Example.com' };

  test('creates a short-lived token and normalizes its email claim', () => {
    const token = createPortalToken(contact);
    expect(verifyPortalToken(token)).toMatchObject({
      contactId: 'contact-1', companyId: 'company-1', email: 'client@example.com',
    });
  });

  test('rejects modified signatures and malformed/missing claims', () => {
    const token = createPortalToken(contact);
    expect(verifyPortalToken(`${token}x`)).toBeNull();
    expect(verifyPortalToken('not-a-token')).toBeNull();

    const payload = Buffer.from(JSON.stringify({ contactId: 'c', companyId: 'co', email: 'a@b.com' })).toString('base64url');
    const signature = createHmac('sha256', process.env.PORTAL_SECRET!).update(payload).digest('base64url');
    expect(verifyPortalToken(`${payload}.${signature}`)).toBeNull();
  });

  test('rejects expired and overlong-lifetime capabilities even when correctly signed', () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [
      { ...contact, email: contact.email.toLowerCase(), iat: now - 1000, exp: now - 1 },
      { ...contact, email: contact.email.toLowerCase(), iat: now, exp: now + 24 * 60 * 60 },
    ]) {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signature = createHmac('sha256', process.env.PORTAL_SECRET!).update(payload).digest('base64url');
      expect(verifyPortalToken(`${payload}.${signature}`)).toBeNull();
    }
  });
});
