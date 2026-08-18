/**
 * Pure retention logic for the developer's global database backups.
 *
 * Kept free of I/O so the policy ("only the last N copies exist") is
 * unit-testable: given the journal rows, decide which artifacts to prune
 * (from storage, from the Telegram chat, and from the journal itself).
 */
export interface BackupJournalEntry {
  id: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  storagePath: string | null;
  telegramMessageId: string | null;
}

export interface RetentionPlan {
  keep: BackupJournalEntry[];
  prune: BackupJournalEntry[];
}

/**
 * Entries are assumed sorted oldest-first (created_at ASC). With `retain`
 * copies kept, everything before the newest `retain` entries is pruned.
 * An empty or degenerate input yields an empty prune list.
 */
export function planRetention(
  entries: BackupJournalEntry[],
  retain: number,
): RetentionPlan {
  const safeRetain = Math.max(1, Math.floor(retain));
  if (entries.length <= safeRetain) {
    return { keep: [...entries], prune: [] };
  }
  const pruneCount = entries.length - safeRetain;
  return {
    keep: entries.slice(pruneCount),
    prune: entries.slice(0, pruneCount),
  };
}

/** The filename pattern for a dump: backup-YYYYMMDD-HHMMSS.dump */
export function backupFilename(date: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `backup-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.dump`;
}
