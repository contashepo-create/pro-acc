/** Security-oriented validation shared by messaging, uploads and payment proof. */

export function safeInternalPath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 512) return null;
  const path = value.trim();
  // Only same-application absolute paths. Protocol-relative and escaped paths
  // can navigate away from the tenant UI and are rejected.
  if (!path.startsWith('/') || path.startsWith('//') || /[\u0000-\u001f\\]/.test(path)) return null;
  return path;
}

export function safeHttpsUrl(value: unknown, maxLength = 2048): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Payment proofs must refer to our receipt storage, not an arbitrary attacker
 * URL. A storage object path returned by the upload endpoint is preferred;
 * legacy HTTPS Supabase Storage URLs are accepted only on the configured host.
 */
export function trustedReceiptReference(value: unknown, companyId: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  const ref = value.trim();
  if (ref.startsWith(`${companyId}/`) && !ref.includes('..') && !/[\u0000-\u001f\\]/.test(ref)) {
    return ref;
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!base) return null;
  try {
    const parsed = new URL(ref);
    const configured = new URL(base);
    if (parsed.protocol !== 'https:' || parsed.host !== configured.host) return null;
    if (!parsed.pathname.includes('/storage/v1/object/')) return null;
    if (!decodeURIComponent(parsed.pathname).includes(`/${companyId}/`)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Detect payloads that indicate the file is really a web page or an
 * executable wearing an image/PDF header. Scanned in a bounded ASCII window so
 * a genuine binary file cannot trigger it accidentally.
 */
const WEB_OR_EXE_SIGNATURES: readonly RegExp[] = [
  /<\s*script[\s/>]/i,
  /<\s*html[\s>]/i,
  /<!doctype\s+html/i,
  /<\s*iframe[\s/>]/i,
  /<\s*svg[\s/>][\s\S]{0,200}onload\s*=/i,
  /onerror\s*=/i,
  /javascript\s*:/i,
  /<\?php/i,
];

function looksLikeWebOrExecutable(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // MZ (PE/EXE)
  if (buffer.length >= 4) {
    const head = buffer.subarray(0, 4).toString('latin1');
    if (head === '7z\u00bc\u00af' || head === 'PK\u0003\u0004' || head === 'Rar!') return true;
  }
  // Only the leading 1KB is inspected: binary image/PDF content lives later.
  const window = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  return WEB_OR_EXE_SIGNATURES.some((re) => re.test(window));
}

/**
 * Strict JPEG structure check: SOI (FF D8), then at least one syntactically
 * valid marker chain containing a Start-Of-Frame segment within the first
 * 4KB. HTML payloads that merely begin with FF D8 FF (classic polyglots) have
 * no valid marker structure and are rejected.
 */
function isPlausibleJpeg(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let pos = 2;
  let sawSof = false;
  const limit = Math.min(buffer.length, 4096);
  while (pos + 4 <= limit) {
    if (buffer[pos] !== 0xff) return sawSof; // entropy-coded data reached → structure consumed
    const marker = buffer[pos + 1];
    // 0xFF, 0x00 (stuffed) and standalone markers D0–D7 carry no length.
    if (marker === 0xff || marker === 0x00) { pos += 1; continue; }
    if (marker === 0xd9) return sawSof; // EOI before scan window end
    if (marker === 0x01) return false; // TEM is never valid in a standalone file
    if (marker >= 0xd0 && marker <= 0xd7) { pos += 2; continue; }
    // SOF markers: C0–CF excluding C4 (DHT), C8 (JPG) and CC (DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      sawSof = true;
    }
    const len = buffer.readUInt16BE(pos + 2);
    if (len < 2) return false; // corrupt length
    pos += 2 + len;
  }
  return sawSof;
}

/**
 * Uploaded-file content verification (defense against "poisoned" files).
 *
 * The MIME type is caller-controlled, so this checks the actual byte
 * signature AND structural plausibility, and rejects files whose leading
 * bytes expose web/executable payloads — a polyglot can no longer smuggle an
 * HTML/JS payload inside an allowed extension:
 *  - JPEG: FF D8 + valid marker chain incl. a SOF segment in the first 4KB.
 *  - PNG: exact 8-byte signature + IHDR chunk at offset 12.
 *  - PDF: "%PDF-" header at offset 0 (up to 4 leading bytes tolerated) plus
 *    "%%EOF" trailer in the last 1KB.
 */
export function hasAllowedMagicBytes(buffer: Buffer, mime: string): boolean {
  if (!buffer || buffer.length === 0) return false;
  if (looksLikeWebOrExecutable(buffer)) return false;

  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return isPlausibleJpeg(buffer);
  }
  if (mime === 'image/png') {
    if (buffer.length < 16) return false;
    const signatureOk = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!signatureOk) return false;
    // bytes 12..15 must be the ASCII "IHDR" chunk type
    return buffer.subarray(12, 16).toString('latin1') === 'IHDR';
  }
  if (mime === 'application/pdf') {
    // Header must appear essentially at the start of the file, not anywhere
    // inside the first 1KB (that was the polyglot window).
    const head = buffer.subarray(0, Math.min(buffer.length, 8)).toString('latin1');
    if (!head.includes('%PDF-')) return false;
    const headerOffset = head.indexOf('%PDF-');
    if (headerOffset > 4) return false;
    // Trailer: a real PDF ends with the EOF marker.
    const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
    return tail.includes('%%EOF');
  }
  return false;
}
