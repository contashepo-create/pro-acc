/**
 * CSV export helpers hardened against spreadsheet formula injection.
 *
 * Spreadsheet apps (Excel, LibreOffice, Google Sheets) execute cell values
 * starting with = + - @ (and tab/CR variants) as formulas. Any user-entered
 * string that ends up in a CSV must be neutralized with a leading apostrophe
 * (OWASP guidance) so exported data can never run code on the opener's
 * machine.
 */

const FORMULA_PREFIX_RE = /^[\s\u0009\u000a\u000d]*[=+\-@]/;

/** Quote, escape and neutralize one CSV cell. */
export function toCsvCell(value: unknown): string {
  let cell = value === null || value === undefined ? '' : String(value);
  // Defuse formula injection before quoting.
  if (FORMULA_PREFIX_RE.test(cell)) {
    cell = "'" + cell;
  }
  if (/[",\r\n]/.test(cell)) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

/** Serialize an array of objects into CSV text with a header row. */
export function recordsToCsv(records: Record<string, unknown>[]): string {
  if (!records.length) return '';
  const headers = Object.keys(records[0]);
  const lines = [headers.map(toCsvCell).join(',')];
  for (const row of records) {
    lines.push(headers.map((h) => toCsvCell(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
