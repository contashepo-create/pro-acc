/**
 * Local verifier for the CI secret-scan (gitleaks).
 *
 * Loads the REAL .gitleaks.toml (via python3 tomllib), reproduces its four
 * project-specific rules + rule-level/global allowlists, and scans the added
 * lines of every commit in origin/main...HEAD — the same commits the CI scan
 * sees on push/pull_request events. Pass --mode=tree to sweep every commit's
 * full tree instead (stricter than CI).
 *
 * Usage: npx tsx scripts/verify-secret-scan.ts [--mode=tree]
 */
import { execSync } from 'node:child_process';

function run(cmd: string): string {
  return execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 28 }).toString();
}
function run1(cmd: string): string {
  try { return run(cmd); } catch { return ''; }
}

interface Rule { id: string; regex: string; keywords?: string[] }
interface GitleaksConfig {
  rules: Array<{ id: string; regex: string; keywords?: string[]; allowlists?: Array<{ regexes?: string[] }> }>;
  allowlist?: { regexes?: string[]; paths?: string[] };
}

const cfg: GitleaksConfig = JSON.parse(run(
  `python3 -c "import tomllib,json;print(json.dumps(tomllib.load(open('.gitleaks.toml','rb'))))"`,
));

const rules: Rule[] = cfg.rules.filter((r) => r.regex);
const toRegExp = (s: string) => s.startsWith('(?i)')
  ? new RegExp(s.slice(4), 'i')
  : new RegExp(s);
const globalAllow = (cfg.allowlist?.regexes ?? []).map(toRegExp);
const globalPaths = (cfg.allowlist?.paths ?? []).map(toRegExp);
const ruleAllow = (regexes: string[]) => regexes.map(toRegExp);

// Mode: CI scans the commits' added lines (diff origin/main...HEAD).
const mode = process.argv.includes('--mode=tree') ? 'tree' : 'diff';

interface Target { commit: string; file: string; line: string }
const targets: Target[] = [];

if (mode === 'diff') {
  const base = run('git merge-base origin/main HEAD').trim();
  const revs = run(`git rev-list ${base}..HEAD`).trim().split('\n').filter(Boolean);
  for (const commit of revs) {
    const patch = run1(`git show ${commit} --unified=0 --no-color --format=`);
    let file = '';
    for (const raw of patch.split('\n')) {
      if (raw.startsWith('+++ b/')) file = raw.slice(6);
      else if (raw.startsWith('+') && !raw.startsWith('+++')) {
        targets.push({ commit, file, line: raw.slice(1) });
      }
    }
  }
} else {
  const revs = run('git rev-list --all').trim().split('\n').filter(Boolean);
  for (const commit of revs) {
    const out = run1(`git grep -I -n -P '' ${commit} -- . || true`);
    for (const row of out.split('\n')) {
      const m = row.match(/^[0-9a-f]+:(.+?):(\d+):(.*)$/);
      if (m) targets.push({ commit, file: m[1], line: m[3] });
    }
  }
}

let findings = 0;
for (const t of targets) {
  if (!t.line.trim()) continue;
  if (globalPaths.some((re) => re.test(t.file))) continue;
  for (const rule of rules) {
    const keywordOk = !rule.keywords
      || rule.keywords.some((k) => t.line.toLowerCase().includes(k.toLowerCase()));
    if (!keywordOk) continue;
    const re = toRegExp(rule.regex);
    if (!re.test(t.line)) continue;
    const ruleLists = (rule.allowlists ?? []).flatMap((a) => ruleAllow(a.regexes ?? []));
    const allowed = globalAllow.some((r) => r.test(t.line)) || ruleLists.some((r) => r.test(t.line));
    if (!allowed) {
      findings++;
      console.log(`🚨 [${rule.id}] ${t.commit.slice(0, 7)} ${t.file}: ${t.line.trim().slice(0, 160)}`);
    }
  }
}

console.log(`--- verify-secret-scan (mode=${mode}, config=.gitleaks.toml) ---`);
console.log(`rules: ${rules.length} | commits: ${new Set(targets.map((t) => t.commit)).size} | added lines: ${targets.length} | findings: ${findings}`);
process.exit(findings > 0 ? 1 : 0);
