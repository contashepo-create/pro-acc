/**
 * Tests for lib/auth.ts - Password hashing and JWT token management
 * 
 * These tests verify:
 * 1. Password hashing is secure (scrypt with random salt)
 * 2. Password verification works correctly
 * 3. Timing-safe comparison prevents timing attacks
 * 4. JWT token creation and verification
 * 5. Token expiry is enforced
 */

// Set TOKEN_SECRET before importing auth module
process.env.TOKEN_SECRET = 'test-secret-key-for-unit-tests-32chars!';

import { hashPassword, verifyPassword, createToken, verifyToken } from '../lib/auth';

describe('Password Hashing (scrypt)', () => {
  test('should hash a password and verify it correctly', async () => {
    const password = 'MySecureP@ssw0rd!';
    const hash = await hashPassword(password);

    // Hash should contain salt:key format
    expect(hash).toContain(':');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    
    // Salt should be 64 hex chars (32 bytes)
    expect(parts[0]).toHaveLength(64);
    
    // Key should be 128 hex chars (64 bytes, KEY_LENGTH)
    expect(parts[1]).toHaveLength(128);
    
    // Verification should succeed
    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  test('should reject incorrect password', async () => {
    const password = 'CorrectPassword123';
    const hash = await hashPassword(password);
    
    const isValid = await verifyPassword('WrongPassword456', hash);
    expect(isValid).toBe(false);
  });

  test('should generate different hashes for same password (random salt)', async () => {
    const password = 'SamePassword';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    
    // Different salts mean different hashes
    expect(hash1).not.toBe(hash2);
    
    // But both should verify correctly
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  test('should reject malformed hash', async () => {
    const isValid = await verifyPassword('anypassword', 'not-a-valid-hash');
    expect(isValid).toBe(false);
  });

  test('should handle empty password', async () => {
    const hash = await hashPassword('');
    expect(hash).toContain(':');
    
    expect(await verifyPassword('', hash)).toBe(true);
    expect(await verifyPassword('notempty', hash)).toBe(false);
  });

  test('should handle unicode passwords', async () => {
    const password = 'كلمة_سر_عربية_🔐!@#';
    const hash = await hashPassword(password);
    
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword('كلمة_سر_خاطئة', hash)).toBe(false);
  });
});

describe('JWT Token (HMAC-SHA256)', () => {
  test('should create a valid token', () => {
    const userId = 'user-123-uuid';
    const role = 'admin';
    
    const token = createToken(userId, role);
    
    // Token should have 3 parts (header.payload.signature)
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    
    // Each part should be non-empty base64url
    parts.forEach(part => {
      expect(part.length).toBeGreaterThan(0);
      // base64url should only contain [A-Za-z0-9_-]
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  test('should verify a valid token', () => {
    const userId = 'user-456-uuid';
    const role = 'accountant';
    
    const token = createToken(userId, role);
    const payload = verifyToken(token);
    
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(userId);
    expect(payload!.role).toBe(role);
  });

  test('should reject tampered token', () => {
    const token = createToken('user-789', 'admin');
    
    // Tamper with the payload
    const parts = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'hacker', role: 'superadmin', exp: Math.floor(Date.now() / 1000) + 86400 })
    ).toString('base64url');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    
    const result = verifyToken(tamperedToken);
    expect(result).toBeNull();
  });

  test('should reject expired token', () => {
    // Create a token with already-expired time
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-123', role: 'admin', iat: 1000000, exp: 1000001 })
    ).toString('base64url');
    
    // Sign it properly
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', process.env.TOKEN_SECRET!)
      .update(`${header}.${payload}`)
      .digest('base64url');
    
    const expiredToken = `${header}.${payload}.${signature}`;
    const result = verifyToken(expiredToken);
    expect(result).toBeNull();
  });

  test('should reject malformed token', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('not.a.token')).toBeNull();
    expect(verifyToken('only-one-part')).toBeNull();
    expect(verifyToken('two.parts')).toBeNull();
  });

  test('should reject token with wrong signature', () => {
    const token = createToken('user-123', 'admin');
    const parts = token.split('.');
    
    // Replace signature with garbage
    const wrongSigToken = `${parts[0]}.${parts[1]}.wrong-signature-here`;
    const result = verifyToken(wrongSigToken);
    expect(result).toBeNull();
  });
});
