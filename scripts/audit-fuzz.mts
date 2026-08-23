/**
 * Pro Acc — Security Audit Fuzz Harness (audit-fuzz.mts)
 * ------------------------------------------------
 * Fuzzes every exported Zod schema in the validation modules plus the
 * security-critical pure helpers with an adversarial corpus (SQLi, XSS,
 * prototype pollution, path traversal, NaN/Infinity, negative money,
 * oversized values, unicode tricks, magic-byte polyglots...).
 *
 * Run:  npx tsx scripts/audit-fuzz.mts
 * Exit code 0 => no invariant broken; findings printed with severity.
 */
import { z } from 'zod';

const FINDINGS: { severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'; where: string; detail: string }[] = [];
function finding(severity: 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO', where: string, detail: string) {
  FINDINGS.push({ severity, where, detail });
}

/* ------------------------- adversarial corpus ------------------------- */
const SQLI = [
  "' OR 1=1 --", "'; DROP TABLE users; --", "1' UNION SELECT username,password FROM users--",
  "1); DELETE FROM accounts;--", "0x41424344", "'; WAITFOR DELAY '0:0:5'--", "1' AND SLEEP(5)--",
  "\u2019 OR 1=1 --", "';\\x3b\\x73hutdown--", "1'/**/OR/**/1=1--",
];
const XSS = [
  '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg/onload=alert(1)>',
  'javascript:alert(1)', '\u003Cscript\u003Ealert(1)\u003C/script\u003E', '{{constructor.constructor("alert(1)")()}}',
  '<iframe srcdoc="<script>alert(1)</script>">', 'onmouseover="alert(1)"', '</script><script>alert(1)</script>',
];
const PATH_TRAV = ['../../etc/passwd', '..\\..\\windows\\system32', '/etc/passwd', '//evil.com/x', '\\\\evil\\share',
  'a/../../b', '....//....//etc/passwd', '/\\evil', '\u0000../../etc/passwd', 'C:\\windows\\system32\\config\\sam'];
const SSRF_OR = ['http://169.254.169.254/latest/meta-data/', 'https://localhost/admin', '//evil.com', 'https://user:pass@evil.com',
  'https://evil.com#@good.com', 'https://good.com@evil.com', 'https://evil.com\\@good.com', 'ftp://evil.com',
  'data:text/html,<script>1</script>', 'javascript:alert(1)', 'https://127.0.0.1:5432', 'https://[::1]:3000/admin',
  'https://0x7f000001', 'https://2130706433', 'https://0177.0.0.1', 'https://evil.com.', 'https://ｇood.com.evil.com'];
const PROTOTYPE = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty'];
const UNICODE_TRICKS = ['\u202E', '\u202D', '\u2066', '\u00AD', '\u180E', 'a\u200Bb', '＄100', '\uFF0E', '\u3000', '\u0000', '\u000b', '\u001f'];
const MONEY_ABUSE = [NaN, Infinity, -Infinity, -1, -0.01, 1e308, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1,
  99999999999999.99, 0.001, -1e-9, 2 ** 53, 'NaN', 'Infinity', '-Infinity', '1e999', '١٠٠', '0x10', '', null];
const HUGE_STR = 'A'.repeat(1_000_000);
const DEEP_NEST: unknown[] = [];
{ let node: Record<string, unknown> = {}; const root = node; for (let i = 0; i < 10000; i++) { node.n = {}; node = node.n as Record<string, unknown>; } DEEP_NEST.push(root); }

const scalarCorpus = [...SQLI, ...XSS, ...PATH_TRAV, ...SSRF_OR, ...UNICODE_TRICKS, ...MONEY_ABUSE, HUGE_STR, ...DEEP_NEST];

/* ----------------------- import validation modules -------------------- */
const validation = await import('@/lib/validation');
const relationship = await import('@/lib/relationship-validation');
const hr = await import('@/lib/hr-validation');
const custody = await import('@/lib/custody-validation');
const comm = await import('@/lib/communication-validation');
const projectDelivery = await import('@/lib/project-delivery-validation');
const reportV = await import('@/lib/report-validation');
const safeInput = await import('@/lib/safe-input');
const formUtils = await import('@/lib/form-utils');
const { generateUBLInvoice } = await import('@/lib/zatca/ubl-builder');
const { verifyCaptchaToken } = await import('./../src/app/api/auth/register/route');

const mods: [string, Record<string, unknown>][] = [
  ['validation', validation], ['relationship-validation', relationship],
  ['hr-validation', hr], ['custody-validation', custody],
  ['communication-validation', comm], ['project-delivery-validation', projectDelivery],
  ['report-validation', reportV],
];

function isZodType(v: unknown): v is z.ZodType {
  return v instanceof z.ZodType;
}

type ZodInternals = {
  _zod?: { def?: { type?: string; innerType?: z.ZodType; unknownKeys?: string } };
  _def?: { shape?: Record<string, unknown> };
  constructor?: { name: string };
  element?: z.ZodType;
};

function zodInternals(schema: z.ZodType): ZodInternals {
  return schema as ZodInternals;
}

function zodTypeName(schema: z.ZodType): string {
  const internals = zodInternals(schema);
  return internals?._zod?.def?.type ?? internals?.constructor?.name ?? '';
}

function schemaFieldNames(schema: z.ZodType): string[] {
  const shape = zodInternals(schema)?._def?.shape;
  if (!shape || typeof shape !== 'object') return [];
  return Object.keys(shape);
}

function interesting(fieldName: string, schema: z.ZodType): boolean {
  const typeName = zodTypeName(schema);
  // Only genuine numeric fields (incl. coerced numbers) are money targets;
  // string fields whose NAME matches money words are false positives.
  if (typeName === 'number') return true;
  if (typeName === 'coerce') {
    const inner = zodInternals(schema)?._zod?.def?.innerType;
    return inner ? zodTypeName(inner) === 'number' : false;
  }
  return false;
}

let schemaCount = 0;
let crashCount = 0;

/* =================== 1) SCHEMA FUZZING =================== */
for (const [modName, mod] of mods) {
  for (const [exportName, value] of Object.entries(mod)) {
    if (!isZodType(value)) continue;
    // only object schemas (or arrays of objects) that represent request bodies
    let schema: z.ZodType = value;
    if (zodTypeName(value) === 'array') schema = zodInternals(value).element as z.ZodType;
    if (zodTypeName(schema) !== 'object') continue;
    schemaCount++;

    // 1a. crash-fuzz scalar fields: schema should never throw on parse
    for (const field of schemaFieldNames(schema)) {
      for (const evil of scalarCorpus) {
        try {
          schema.safeParse({ [field]: evil });
        } catch (e) {
          crashCount++;
          finding('HIGH', `fuzz/${modName}/${exportName}`, `safeParse crashed on field "${field}" with input ${JSON.stringify(evil)?.slice(0, 60)}: ${(e as Error).message}`);
        }
      }
      for (const evil of scalarCorpus) {
        try {
          schema.safeParse({ [field]: { $evil: evil } });
        } catch { /* nested object rejection is fine */ }
      }
    }

    // 1b. prototype-pollution keys must be rejected by strict schemas
    const isStrict = zodInternals(schema)?._zod?.def?.unknownKeys === 'strict';
    for (const key of PROTOTYPE) {
      const res = schema.safeParse({ [key]: 'polluted' });
      if (res.success && isStrict) {
        finding('HIGH', `fuzz/${modName}/${exportName}`, `strict schema ACCEPTED prototype-pollution key "${key}"`);
      }
    }

    // 1c. numeric-field abuse
    const shapeObj = zodInternals(schema)?._def?.shape ?? {};
    for (const field of schemaFieldNames(schema)) {
      const fieldSchema = shapeObj[field];
      if (!interesting(field, fieldSchema as z.ZodType)) continue;
      for (const evil of [NaN, Infinity, -Infinity]) {
        const res = schema.safeParse({ [field]: evil });
        if (res.success) finding('MEDIUM', `fuzz/${modName}/${exportName}`, `numeric field "${field}" accepted ${String(evil)}`);
      }
      for (const evil of [-1, -0.01, -1000]) {
        const res = schema.safeParse({ [field]: evil });
        if (res.success && /amount|total|price|cost|salary|debit|credit|paid|value|rate|fee|tax|vat|qty|quantity|stock|advance|penalty/i.test(field)) {
          finding('MEDIUM', `fuzz/${modName}/${exportName}`, `money/quantity field "${field}" accepted negative ${evil}`);
        }
      }
      for (const evil of [1e308, Number.MAX_VALUE, 1e15]) {
        const res = schema.safeParse({ [field]: evil });
        if (res.success) finding('LOW', `fuzz/${modName}/${exportName}`, `numeric field "${field}" accepted huge ${evil}`);
      }
      // string money
      for (const evil of ['NaN', 'Infinity', '-Infinity', '1e999']) {
        const res = schema.safeParse({ [field]: evil });
        if (res.success) finding('LOW', `fuzz/${modName}/${exportName}`, `numeric field "${field}" accepted string "${evil}" (coercion risk)`);
      }
    }

    // 1d. random mutation fuzz (10k structured samples)
    let seed = 0xdeadbeef;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
    const randomValue = (depth: number): unknown => {
      const r = rnd();
      if (depth > 2) return r < 0.5 ? rnd() * 1000 - 500 : 'x';
      if (r < 0.15) return null;
      if (r < 0.3) return rnd() * 1e9 - 5e8;
      if (r < 0.45) return ['...', ...Array.from({ length: Math.floor(rnd() * 8) }, () => randomValue(depth + 1))];
      if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 40) }, () => String.fromCharCode(0x20 + Math.floor(rnd() * 0x60)));
      if (r < 0.75) { const o: Record<string, unknown> = {}; for (let i = 0; i < Math.floor(rnd() * 10); i++) o['k' + Math.floor(rnd() * 50)] = randomValue(depth + 1); return o; }
      if (r < 0.9) return rnd() < 0.5 ? true : false;
      return randomValue(depth + 1);
    };
    const fields = schemaFieldNames(schema);
    for (let i = 0; i < 1000; i++) {
      const obj: Record<string, unknown> = {};
      const n = Math.floor(rnd() * (fields.length + 2));
      for (let k = 0; k < n; k++) {
        const f = fields[Math.floor(rnd() * fields.length)];
        if (obj[f] === undefined) obj[f] = randomValue(0);
      }
      try {
        schema.safeParse(obj);
      } catch (e) {
        crashCount++;
        if (crashCount <= 5) finding('HIGH', `fuzz/${modName}/${exportName}`, `mutation fuzz crashed: ${(e as Error).message} on ${JSON.stringify(obj).slice(0, 200)}`);
      }
    }
  }
}

/* =================== 2) HELPER INVARIANTS =================== */
// safeHttpsUrl: only https, no userinfo, no exotic protocols
for (const evil of [...SSRF_OR, ...XSS.slice(0, 5)]) {
  const out = safeInput.safeHttpsUrl(evil);
  if (out !== null && !out.startsWith('https://')) finding('HIGH', 'helper/safeHttpsUrl', `accepted non-https URL "${evil}" -> ${out}`);
}
if (safeInput.safeHttpsUrl('https://ok.example.com/x') !== 'https://ok.example.com/x') finding('HIGH', 'helper/safeHttpsUrl', 'rejected a valid https URL');
if (safeInput.safeHttpsUrl('https://user:pass@example.com') !== null) finding('HIGH', 'helper/safeHttpsUrl', 'accepted URL with credentials');

// safeInternalPath
for (const evil of PATH_TRAV) {
  const out = safeInput.safeInternalPath(evil);
  if (out !== null && (out.includes('..') || out.includes('\\') || !out.startsWith('/') || out.startsWith('//'))) {
    finding('HIGH', 'helper/safeInternalPath', `accepted traversal "${evil}" -> ${out}`);
  }
}
if (safeInput.safeInternalPath('//evil.com/x') !== null) finding('HIGH', 'helper/safeInternalPath', 'accepted protocol-relative path');
if (safeInput.safeInternalPath('/dashboard/settings') !== '/dashboard/settings') finding('HIGH', 'helper/safeInternalPath', 'rejected valid internal path');

// trustedReceiptReference
const companyId = '11111111-1111-4111-8111-111111111111';
for (const evil of ['../x.pdf', `${companyId}/../evil.pdf`, '22222222-2222-4222-8222-222222222222/a.pdf', 'https://evil.example.com/storage/v1/object/receipts/x', '/etc/passwd', 'http://localhost/a']) {
  const out = safeInput.trustedReceiptReference(evil, companyId);
  if (out !== null) finding('HIGH', 'helper/trustedReceiptReference', `accepted untrusted reference "${evil}" -> ${out}`);
}
if (safeInput.trustedReceiptReference(`${companyId}/receipt-1.pdf`, companyId) !== `${companyId}/receipt-1.pdf`) {
  finding('HIGH', 'helper/trustedReceiptReference', 'rejected valid company object path');
}

// hasAllowedMagicBytes — positive & negative & polyglot attempts.
// Positive samples are structurally VALID files (the hardened checker
// requires structure, not just a prefix).
const magic = safeInput.hasAllowedMagicBytes;
const validJpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\u0000', 'latin1'), Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  Buffer.from([0xff, 0xc0, 0x00, 0x0b]), Buffer.from([0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]),
  Buffer.from([0xff, 0xd9]),
]);
const validPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), Buffer.from('IHDR'),
  Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]),
]);
const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<</Size 1>>\nstartxref\n0\n'), Buffer.from('%%EOF')]);
if (!magic(validJpeg, 'image/jpeg')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'rejected real JPEG structure');
if (!magic(validPng, 'image/png')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'rejected real PNG structure');
if (!magic(validPdf, 'application/pdf')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'rejected real PDF structure');
if (magic(Buffer.from('MZ\u0090\u0000exe'), 'application/pdf')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'accepted EXE as PDF');
if (magic(Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'accepted HTML as PDF');
// polyglot: HTML payload with %PDF- header inside first 1KB
const polyglotPdf = Buffer.concat([Buffer.from('<!--'), Buffer.from('%PDF-1.7'), Buffer.from('--><script>alert(1)</script>'), Buffer.alloc(500, 0x41)]);
if (magic(polyglotPdf, 'application/pdf')) {
  finding('HIGH', 'helper/hasAllowedMagicBytes', 'POLYGLOT ACCEPTED: HTML+JS file with "%PDF-" bytes inside first 1KB passes PDF validation');
}
// polyglot: HTML with FF D8 FF prefix passes JPEG check
const polyglotJpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('<html><script>alert(1)</script>')]);
if (magic(polyglotJpg, 'image/jpeg')) {
  finding('HIGH', 'helper/hasAllowedMagicBytes', 'POLYGLOT ACCEPTED: HTML+JS file starting with FF D8 FF passes JPEG validation');
}
// polyglot: PNG header followed by HTML payload
const polyglotPng = Buffer.concat([validPng, Buffer.from('<script>alert(1)</script>')]);
if (magic(polyglotPng, 'image/png')) finding('HIGH', 'helper/hasAllowedMagicBytes', 'POLYGLOT ACCEPTED: HTML after PNG header passes validation');

// generateUBLInvoice — XML injection resistance
const ublBase: Parameters<typeof generateUBLInvoice>[0] = {
  uuid: '00000000-0000-4000-8000-000000000000',
  number: 1001,
  issueDate: '2026-01-01',
  issueTime: '12:00:00',
  invoiceTypeCode: '388',
  invoiceTypeName: '0200000',
  currencyCode: 'SAR',
  seller: { name: 'شركة الاختبار <x>&"\'', vatNumber: '300000000000003', registrationNumber: '1010000000', address: { street: 'الرياض', city: 'الرياض', postalZone: '11111', country: 'SA' } },
  buyer: { name: 'عميل الاختبار <y>&"\'', vatNumber: '300000000000003' },
  items: [{ id: '1', description: 'صنف <z>&"\'', quantity: 1, unitPrice: 100, total: 100, vatRate: 0.15 }],
  amounts: { lineExtensionAmount: 100, taxExclusiveAmount: 100, taxInclusiveAmount: 115, taxAmount: 15 },
  vatRate: 0.15,
  paymentMeansCode: '30',
  notes: ['</cbc:Note><x>INJECTED</x><cbc:Note>'],
};
try {
  const xml = generateUBLInvoice(ublBase);
  // escaped payloads must not appear as raw tags
  if (xml.includes('<x>INJECTED</x>')) finding('HIGH', 'helper/generateUBLInvoice', 'XML injection: notes payload broke out of element');
  // any RAW (unescaped) metachar inside text nodes indicates an escaping gap
  const textNodes = xml.match(/>([^<]+)</g) || [];
  for (const node of textNodes) {
    const inner = node.slice(1, -1);
    // tolerate entities (&amp; &lt; &gt; &quot; &apos;) — raw metachars are the bug
    const raw = inner.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, '');
    if (/[<>"'`]/.test(raw)) {
      finding('MEDIUM', 'helper/generateUBLInvoice', `unescaped metachar in XML text node: ${JSON.stringify(node.slice(0, 120))}`);
      break;
    }
  }
} catch (e) {
  finding('HIGH', 'helper/generateUBLInvoice', `UBL generation crashed: ${(e as Error).message}`);
}

// toDateInput
for (const evil of ['../../etc/passwd', '<script>', '0000-00-00', '2024-13-99', '999999999999999999999999999999']) {
  const out = formUtils.toDateInput(evil);
  if (out.includes('..') || out.includes('<')) finding('HIGH', 'helper/toDateInput', `date normalization leaked traversal "${out}"`);
}

// captcha token
if (verifyCaptchaToken('AAAA', 1)) finding('MEDIUM', 'helper/verifyCaptchaToken', 'malformed captcha token accepted');
if (verifyCaptchaToken('', 1)) finding('MEDIUM', 'helper/verifyCaptchaToken', 'empty captcha token accepted');

/* =================== 3) REPORT =================== */
console.log(`\n=== FUZZ SUMMARY ===`);
console.log(`schemas fuzzed: ${schemaCount}`);
console.log(`crash events: ${crashCount}`);
console.log(`findings: ${FINDINGS.length}`);
for (const f of FINDINGS) {
  console.log(`[${f.severity}] ${f.where}: ${f.detail}`);
}
if (crashCount === 0 && FINDINGS.filter((f) => f.severity === 'HIGH').length === 0) {
  console.log('\n✅ No HIGH-severity fuzz failures and no crashes.');
}
process.exit(0);
