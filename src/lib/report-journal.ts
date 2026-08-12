const MISSING_COL = /deleted_at|is_header|42703|Could not find/i;
const CHUNK = 200;

export async function loadReportAccounts(supabase: any, companyId: string) {
  const selectFull = 'id, code, name, type, is_header, is_active';
  let res = await supabase.from('accounts').select(selectFull).eq('company_id', companyId).order('code');
  if (res.error && MISSING_COL.test(res.error.message || '')) {
    res = await supabase.from('accounts').select('id, code, name, type, is_active').eq('company_id', companyId).order('code');
  }
  const rows = (res.data || []).filter((a: any) => a.is_active !== false);
  return rows as Array<{ id: string; code: string; name: string; type: string; is_header?: boolean }>;
}

export async function loadReportJournalEntries(
  supabase: any,
  companyId: string,
  opts: { from?: string | null; to?: string | null } = {},
) {
  const build = (withDeleted: boolean) => {
    let q = supabase.from('journal_entries').select('id, date').eq('company_id', companyId);
    if (withDeleted) q = q.is('deleted_at', null);
    if (opts.to) q = q.lte('date', opts.to);
    if (opts.from) q = q.gte('date', opts.from);
    return q;
  };

  let res = await build(true);
  if (res.error && MISSING_COL.test(res.error.message || '')) {
    res = await build(false);
  }
  return (res.data || []) as Array<{ id: string; date: string }>;
}

export async function loadReportJournalLines(
  supabase: any,
  companyId: string,
  journalEntryIds: string[],
) {
  const out: any[] = [];
  for (let i = 0; i < journalEntryIds.length; i += CHUNK) {
    const chunk = journalEntryIds.slice(i, i + CHUNK);
    let res = await supabase
      .from('journal_lines')
      .select('journal_entry_id, account_id, account_code, debit, credit')
      .in('journal_entry_id', chunk)
      .eq('company_id', companyId);
    if (res.error || !(res.data || []).length) {
      const retry = await supabase
        .from('journal_lines')
        .select('journal_entry_id, account_id, account_code, debit, credit')
        .in('journal_entry_id', chunk);
      // Keep company-scoped rows when the column exists; otherwise take all for these JEs.
      res = {
        data: (retry.data || []).filter((l: any) => !l.company_id || l.company_id === companyId),
        error: retry.error,
      };
    }
    out.push(...(res.data || []));
  }
  return out;
}

export function resolveLineAccountId(
  line: { account_id?: string | null; account_code?: string | null },
  byId: Set<string>,
  byCode: Map<string, string>,
): string | null {
  if (line.account_id && byId.has(line.account_id)) return line.account_id;
  if (line.account_code && byCode.has(line.account_code)) return byCode.get(line.account_code)!;
  return line.account_id || null;
}
