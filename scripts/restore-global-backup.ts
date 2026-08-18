/**
 * Restore a global developer backup (.dump custom-format file created by
 * scripts/global-backup.ts) — SAFELY.
 *
 * Default behaviour is non-destructive:
 *   npx tsx scripts/restore-global-backup.ts <file.dump>
 *     → validates the file and lists its contents (pg_restore --list).
 *
 *   npx tsx scripts/restore-global-backup.ts <file.dump> --target postgresql://...
 *     → restores into the GIVEN database. The target must be a different
 *       database than the one in DATABASE_URL unless --force is passed,
 *       because pg_restore would otherwise overwrite live tables.
 *
 *   --force  explicitly allow restoring into the database named by
 *            DATABASE_URL (dangerous: overwrites live data).
 *
 * The recommended procedure is: restore into a FRESH database, verify the
 * row counts and the trial-balance invariant (SUM(debit)=SUM(credit)), then
 * cut over (see docs/BACKUP_RESTORE_POLICY.md §4).
 */
import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { open } from 'fs/promises';

const run = promisify(execFile);

function parseArgs(argv: string[]) {
  const args = { file: '', target: '', listOnly: false, force: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) { args.target = argv[++i]; continue; }
    if (arg === '--list') { args.listOnly = true; continue; }
    if (arg === '--force') { args.force = true; continue; }
    if (arg === '--verbose') { args.verbose = true; continue; }
    if (!arg.startsWith('--')) args.file = arg;
  }
  return args;
}

function dbIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}/${parsed.pathname.replace(/^\//, '')}`;
  } catch {
    return url;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.log('Usage: npx tsx scripts/restore-global-backup.ts <file.dump> [--list] [--target <url>] [--force]');
    process.exit(1);
  }

  // Validate the custom-format magic header before trusting the file.
  const handle = await open(args.file, 'r');
  const head = Buffer.alloc(5);
  await handle.read(head, 0, 5, 0);
  await handle.close();
  if (head.toString('latin1') !== 'PGDMP') {
    console.error('✗ الملف ليس نسخة pg_dump بصيغة custom (.dump) — ارفض المعالجة');
    process.exit(1);
  }
  console.log('✓ صيغة الملف سليمة (PGDMP)');

  const listArgs = ['--list', args.file];
  if (args.verbose) console.log('pg_restore', listArgs.join(' '));
  const { stdout: listOut } = await run('pg_restore', listArgs, { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  const lines = listOut.trim().split('\n').filter(Boolean);
  console.log(`✓ الملف يحتوي على ${lines.length} عنصراً`);
  if (args.listOnly || !args.target) {
    console.log('محتويات الملف (معاينة بدون أي كتابة):');
    console.log(lines.slice(0, 40).join('\n'));
    if (lines.length > 40) console.log(`… و ${lines.length - 40} عنصراً آخر`);
    if (!args.target) {
      console.log('\nللاسترجاع الفعلي أضف: --target postgresql://... إلى قاعدة بيانات منفصلة');
      console.log('استرجاع على نفس قاعدة البيانات الحية يتطلب --force صراحةً (غير مستحسن).');
    }
    return;
  }

  const source = process.env.DATABASE_URL || '';
  if (source && !args.force && dbIdentity(source) === dbIdentity(args.target)) {
    console.error('✗ الهدف هو نفس قاعدة البيانات الحية (DATABASE_URL).');
    console.error('  الاسترجاع عليها يكتب فوق البيانات الحية — استخدم قاعدة بيانات جديدة،');
    console.error('  أو مرر --force إذا كنت تعرف ما تفعل بالضبط.');
    process.exit(1);
  }

  console.log(`⏳ جاري الاسترجاع إلى ${args.target}`);
  const restoreArgs = ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', args.target, args.file];
  if (args.verbose) console.log('pg_restore', restoreArgs.join(' '));
  await run('pg_restore', restoreArgs, { timeout: 60 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  console.log('✓ تم الاسترجاع.');
  console.log('\nتحقق إلزامي بعد الاسترجاع (على قاعدة البيانات الهدف):');
  console.log(`  SELECT COUNT(*) FROM companies;  -- يقارن بعدد الشركات وقت النسخة`);
  console.log(`  SELECT SUM(debit)-SUM(credit) FROM journal_lines;  -- يجب أن يساوي 0`);
  console.log(`  SELECT COUNT(*) FROM global_backup_journal;  -- سجل النسخ`);
}

main().catch((cause) => {
  console.error('Restore failed:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
