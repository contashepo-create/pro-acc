/** Separate backup HMAC key; a user-session key must never be a production fallback. */
export function getBackupSecret(): string {
  const dedicated = (process.env.BACKUP_SECRET || '').trim();
  if (dedicated.length >= 32) return dedicated;

  // Preserve local/test compatibility while refusing the dangerous production
  // fallback. Deployments must provision a distinct backup integrity key.
  if (process.env.NODE_ENV !== 'production') {
    const tokenSecret = (process.env.TOKEN_SECRET || '').trim();
    if (tokenSecret.length >= 32) return tokenSecret;
  }
  throw new Error('BACKUP_SECRET must be set to a random value of at least 32 characters');
}
