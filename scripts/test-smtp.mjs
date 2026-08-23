#!/usr/bin/env node
/**
 * SMTP diagnostic + test sender.
 *
 * Verifies that the email environment variables are set and actually sends a
 * test message through nodemailer so you can confirm delivery end-to-end.
 *
 * Usage:
 *   node scripts/test-smtp.mjs                  # checks env + reads .env.local
 *   SEND=1 node scripts/test-smtp.mjs recipient@example.com   # actually send
 *
 * Env read from .env.local / .env (repo root), falling back to process env.
 * nodemailer is a dependency (package.json); run `npm install` first.
 */
import { createTransport } from 'nodemailer';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Minimal .env parser (no dotenv dependency needed).
function loadEnvFile(file) {
  try {
    const raw = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const idx = t.indexOf('=');
      if (idx <= 0) continue;
      const key = t.slice(0, idx).trim();
      let val = t.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* file not found — rely on process env */ }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const fields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];
const missing = fields.filter((f) => !process.env[f]);

console.log('========== SMTP CONFIG CHECK ==========');
for (const f of fields) {
  const v = process.env[f];
  if (!v) { console.log(`  ✗ ${f} = (missing)`); continue; }
  const shown = f === 'SMTP_PASS' ? '********' : v;
  console.log(`  ✓ ${f} = ${shown}`);
}

if (missing.length > 0) {
  console.log('\n❌ SMTP is NOT fully configured.');
  console.log('   Missing:', missing.join(', '));
  console.log('\n   Add these to your hosting env / .env.local:');
  console.log('     SMTP_HOST=<your smtp host>');
  console.log('     SMTP_PORT=587            (or 465 for SSL, or 25)');
  console.log('     SMTP_USER=<smtp username>');
  console.log('     SMTP_PASS=<smtp password/app-password>');
  console.log('     FROM_EMAIL=noreply@yourdomain.com');
  process.exit(1);
}

const port = parseInt(process.env.SMTP_PORT, 10);
const secure = port === 465;
console.log(`\n  SMTP_PORT=${port}  →  secure=${secure ? 'TLS (465)' : 'STARTTLS/plain (587/25)'}`);

const transporter = createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
});

console.log('\n========== VERIFYING CONNECTION/AUTH ==========');
try {
  await transporter.verify();
  console.log('  ✓ SMTP server reachable & credentials accepted');
} catch (err) {
  console.error('  ✗ SMTP verification FAILED:', err && err.message ? err.message : err);
  process.exit(1);
}

const sendTo = process.argv[2];
if (process.env.SEND === '1' && sendTo) {
  console.log(`\n========== SENDING TEST EMAIL to ${sendTo} ==========`);
  try {
    const info = await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: sendTo,
      subject: 'اختبار إعدادات البريد - Pro Acc',
      html: '<p dir="rtl">هذه رسالة اختبار للتأكد من أن SMTP يعمل بشكل صحيح.</p>',
    });
    console.log('  ✓ Email sent. MessageId:', info.messageId);
    if (info.rejected && info.rejected.length) {
      console.error('  ✗ Rejected recipients:', info.rejected);
      process.exit(1);
    }
  } catch (err) {
    console.error('  ✗ SEND FAILED:', err && err.message ? err.message : err);
    process.exit(1);
  }
} else {
  console.log('\n  (To actually send a test email, run:)');
  console.log('    SEND=1 node scripts/test-smtp.mjs you@example.com');
}

console.log('\n✅ SMTP configured and working.');
