process.env.PORTAL_SECRET = 'test-portal-secret-that-is-at-least-32-characters-long';

import { createHmac } from 'crypto';
import { createPortalToken, verifyPortalToken } from '@/lib/portal-auth';

describe('portal magic-link tokens', () => {
  const contact = {
    contactId: '10000000-0000-4000-8000-000000000001',
    companyId: '20000000-0000-4000-8000-000000000001',
    email: 'Client@Example.com',
  };

  test('creates a short-lived token and normalizes its email claim', () => {
    const token = createPortalToken(contact);
    expect(verifyPortalToken(token)).toMatchObject({
      contactId: contact.contactId, companyId: contact.companyId, email: 'client@example.com',
    });
  });

  test('rejects incomplete create context and missing secrets', () => {
    expect(() => createPortalToken({ ...contact, contactId: 'bad' })).toThrow('incomplete');
    expect(() => createPortalToken({ ...contact, companyId: 'bad' })).toThrow('incomplete');
    expect(() => createPortalToken({ ...contact, email: '' })).toThrow('incomplete');
    const saved = process.env.PORTAL_SECRET; delete process.env.PORTAL_SECRET;
    expect(() => createPortalToken(contact)).toThrow('PORTAL_SECRET');
    process.env.PORTAL_SECRET = saved;
  });

  test('rejects modified signatures and malformed/missing claims', () => {
    const token = createPortalToken(contact);
    expect(verifyPortalToken(`${token}x`)).toBeNull();
    expect(verifyPortalToken('not-a-token')).toBeNull();

    const payload = Buffer.from(JSON.stringify({ contactId: 'c', companyId: 'co', email: 'a@b.com' })).toString('base64url');
    const signature = createHmac('sha256', process.env.PORTAL_SECRET!).update(payload).digest('base64url');
    expect(verifyPortalToken(`${payload}.${signature}`)).toBeNull();
    expect(verifyPortalToken('')).toBeNull();
    expect(verifyPortalToken('x'.repeat(4097))).toBeNull();
    expect(verifyPortalToken('.')).toBeNull();
    expect(verifyPortalToken('a.b.c')).toBeNull();
  });

  test('rejects expired and overlong-lifetime capabilities even when correctly signed', () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [
      { ...contact, email: contact.email.toLowerCase(), iat: now - 1000, exp: now - 1 },
      { ...contact, email: contact.email.toLowerCase(), iat: now, exp: now + 24 * 60 * 60 },
      { ...contact, email: contact.email.toLowerCase(), iat: now + 61, exp: now + 120 },
      null, [], { ...contact, iat: 'bad', exp: now + 1 }, { ...contact, iat: now, exp: 1.5 },
    ]) {
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const signature = createHmac('sha256', process.env.PORTAL_SECRET!).update(payload).digest('base64url');
      expect(verifyPortalToken(`${payload}.${signature}`)).toBeNull();
    }
  });
});
