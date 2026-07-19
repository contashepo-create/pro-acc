/**
 * نظام آمن للمصادقة باستخدام JWT حقيقي
 * يحل مشاكل الأمان الحالية
 */

import { createHmac } from 'crypto';

// التحقق من وجود الأسرار المطلوبة
function validateSecrets() {
  const jwtSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.REFRESH_SECRET || process.env.JWT_SECRET;
  
  if (!jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required and must be set with a strong secret');
  }
  
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters for security');
  }
  
  if (jwtSecret === 'default-secret-change-in-production' || 
      jwtSecret === 'change-me-in-production') {
    throw new Error('JWT_SECRET is using a default value. Please set a strong secret in production');
  }
  
  if (!refreshSecret) {
    throw new Error('REFRESH_SECRET environment variable is required');
  }
}

// التحقق من الأسرار عند تحميل الملف
validateSecrets();

const ACCESS_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days
const JWT_ALGORITHM = 'HS256';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  companyId: string;
  iat: number;
  exp: number;
}

/**
 * دالة مساعدة لتشفير HMAC-SHA256
 */
function hmacSha256(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * إنشاء JWT آمن باستخدام HMAC-SHA256
 */
export function createToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET!;
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + ACCESS_TOKEN_EXPIRY,
  };

  const header = {
    alg: JWT_ALGORITHM,
    typ: 'JWT',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(tokenPayload)).toString('base64url');
  const signature = hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
  const encodedSignature = Buffer.from(signature).toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * إنشاء توكن التحديث
 */
export function createRefreshToken(userId: string): string {
  const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET!;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId,
    iat: now,
    exp: now + REFRESH_TOKEN_EXPIRY,
    type: 'refresh',
  };

  const header = {
    alg: JWT_ALGORITHM,
    typ: 'JWT',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
  const encodedSignature = Buffer.from(signature).toString('base64url');

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * التحقق من صحة JWT باستخدام HMAC-SHA256
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const secret = process.env.JWT_SECRET!;
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      return null; // Invalid JWT format
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    // التحقق من التوقيع
    const expectedSignature = hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
    if (expectedSignature !== Buffer.from(encodedSignature, 'base64url').toString()) {
      return null; // Invalid signature
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    
    // التحقق من انتهاء الصلاحية
    if (payload.exp < now) {
      return null; // Token expired
    }
    
    // التحقق من نوع التوكن (ليس refresh token)
    if (payload.type === 'refresh') {
      return null; // Refresh token cannot be used as access token
    }
    
    return payload;
  } catch (err) {
    console.error('Token verification failed:', err);
    return null;
  }
}

/**
 * التحقق من توكن التحديث
 */
export function verifyRefreshToken(token: string): { userId: string; valid: boolean } {
  try {
    const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET!;
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      return { userId: '', valid: false };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    // التحقق من التوقيع
    const expectedSignature = hmacSha256(`${encodedHeader}.${encodedPayload}`, secret);
    if (expectedSignature !== Buffer.from(encodedSignature, 'base64url').toString()) {
      return { userId: '', valid: false };
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp < now || payload.type !== 'refresh') {
      return { userId: payload.userId, valid: false };
    }
    
    return { userId: payload.userId, valid: true };
  } catch (err) {
    console.error('Refresh token verification failed:', err);
    return { userId: '', valid: false };
  }
}

/**
 * إنشاء توكنات الوصول والتحديث
 */
export function createTokenPair(payload: Omit<TokenPayload, 'iat' | 'exp'>) {
  return {
    accessToken: createToken(payload),
    refreshToken: createRefreshToken(payload.userId),
    expiresIn: ACCESS_TOKEN_EXPIRY,
  };
}

/**
 * التحقق من التوكن وتجديده تلقائياً إذا كان قارباً على الانتهاء
 */
export function verifyAndMaybeRefreshToken(token: string): { valid: boolean; payload: TokenPayload | null; needsRefresh: boolean } {
  const payload = verifyToken(token);
  
  if (!payload) {
    return { valid: false, payload: null, needsRefresh: false };
  }
  
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = payload.exp - now;
  
  // تجديد التوكين إذا تبقى أقل من يوم واحد
  const needsRefresh = timeUntilExpiry < (24 * 60 * 60);
  
  return { valid: true, payload, needsRefresh };
}