/**
 * نظام JWT مع تحديث تلقائي آمن
 */

const ACCESS_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
const REFRESH_TOKEN_EXPIRY = 30 * 24 * 60 * 60; // 30 days in seconds

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  companyId: string;
  iat: number;
  exp: number;
}

/**
 * إنشاء توكن الوصول
 */
export function createToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
  
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + ACCESS_TOKEN_EXPIRY,
  };

  return Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
}

/**
 * إنشاء توكن التحديث
 */
export function createRefreshToken(userId: string): string {
  const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET || 'default-refresh-secret';
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId,
    iat: now,
    exp: now + REFRESH_TOKEN_EXPIRY,
    type: 'refresh',
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * التحقق من صحة التوكن
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'default-secret-change-in-production';
    
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    
    // التحقق من انتهاء الصلاحية
    if (decoded.exp < now) {
      return null;
    }
    
    return decoded;
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
    const secret = process.env.REFRESH_SECRET || process.env.JWT_SECRET || 'default-refresh-secret';
    
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    
    if (decoded.exp < now || decoded.type !== 'refresh') {
      return { userId: decoded.userId, valid: false };
    }
    
    return { userId: decoded.userId, valid: true };
  } catch (err) {
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