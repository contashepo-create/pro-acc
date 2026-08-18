/**
 * The retention policy behind the developer's global backups: after every
 * run, exactly the newest N copies may exist — older ones are pruned from
 * storage, from the Telegram chat, and from the journal.
 */
import { planRetention, backupFilename, type BackupJournalEntry } from '@/lib/backup-retention';

function entry(id: number, minutesAgo: number): BackupJournalEntry {
  return {
    id,
    filename: `backup-${id}.dump`,
    sizeBytes: 1024,
    sha256: `sha-${id}`,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    storagePath: `global-db-backups/backup-${id}.dump`,
    telegramMessageId: String(100 + id),
  };
}

describe('planRetention', () => {
  test('keeps everything when there are fewer copies than the retention target', () => {
    const entries = [entry(1, 10), entry(2, 5)];
    const plan = planRetention(entries, 5);
    expect(plan.prune).toEqual([]);
    expect(plan.keep).toHaveLength(2);
  });

  test('prunes the OLDEST copies so exactly the newest N remain', () => {
    const entries = [entry(1, 60), entry(2, 50), entry(3, 40), entry(4, 30), entry(5, 20), entry(6, 10)];
    const plan = planRetention(entries, 5);
    expect(plan.prune.map((e) => e.id)).toEqual([1]);
    expect(plan.keep.map((e) => e.id)).toEqual([2, 3, 4, 5, 6]);
  });

  test('prunes multiple old copies when many extras exist', () => {
    const entries = [entry(1, 9), entry(2, 8), entry(3, 7), entry(4, 6), entry(5, 5), entry(6, 4), entry(7, 3), entry(8, 2), entry(9, 1)];
    const plan = planRetention(entries, 5);
    expect(plan.prune.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(plan.keep.map((e) => e.id)).toEqual([5, 6, 7, 8, 9]);
  });

  test('never prunes the newest copy even with a degenerate retain value', () => {
    const entries = [entry(1, 5), entry(2, 1)];
    expect(planRetention(entries, 0).keep.map((e) => e.id)).toEqual([2]);
    expect(planRetention(entries, -3).keep.map((e) => e.id)).toEqual([2]);
  });

  test('handles empty input', () => {
    expect(planRetention([], 5)).toEqual({ keep: [], prune: [] });
  });
});

describe('backupFilename', () => {
  test('produces a UTC sortable filename', () => {
    const name = backupFilename(new Date('2026-08-18T14:05:09Z'));
    expect(name).toBe('backup-20260818-140509.dump');
  });
});
