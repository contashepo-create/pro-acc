const MISSING_COL = /deleted_at|is_header|42703|Could not find/i;
const CHUNK = 200;
const PAGE = 1000;

export async function loadReportAccounts(supabase: any, companyId: string) {
  const load = async (full: boolean) => {
    const out: any[] = [];
    for (let from = 0; ; from += PAGE) {
      const select = full ? 'id, code, name, type, is_header, is_active' : 'id, code, name, type, is_active';
      const res = await supabase.from('accounts').select(select).eq('company_id', companyId)
        .order('code').range(from, from + PAGE - 1);
      if (res.error) return { data: out, error: res.error };
      out.push(...(res.data || []));
      if ((res.data || []).length < PAGE) return { data: out, error: null };
    }
  };
  let res = await load(true);
  if (res.error && MISSING_COL.test(res.error.message || '')) res = await load(false);
  if (res.error) throw res.error;
  return res.data.filter((account: any) => account.is_active !== false) as Array<{
    id: string; code: string; name: string; type: string; is_header?: boolean;
  }>;
}

export async function loadReportJournalEntries(
  supabase: any,
  companyId: string,
  opts: { from?: string | null; to?: string | null } = {},
) {
  const load = async (withDeleted: boolean) => {
    const out: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase.from('journal_entries').select('id, date, number, description, reference_type, reference_id').eq('company_id', companyId)
        .order('date').order('id').range(offset, offset + PAGE - 1);
      if (withDeleted) query = query.is('deleted_at', null);
      if (opts.to) query = query.lte('date', opts.to);
      if (opts.from) query = query.gte('date', opts.from);
      const res = await query;
      if (res.error) return { data: out, error: res.error };
      out.push(...(res.data || []));
      if ((res.data || []).length < PAGE) return { data: out, error: null };
    }
  };
  let res = await load(true);
  if (res.error && MISSING_COL.test(res.error.message || '')) res = await load(false);
  if (res.error) throw res.error;
  return res.data as Array<{ id: string; date: string; number?: number; description?: string; reference_type?: string; reference_id?: string }>;
}

export async function loadReportJournalLines(
  supabase: any,
  companyId: string,
  journalEntryIds: string[],
) {
  const out: any[] = [];
  for (let i = 0; i < journalEntryIds.length; i += CHUNK) {
    const chunk = journalEntryIds.slice(i, i + CHUNK);
    for (let offset = 0; ; offset += PAGE) {
      const res = await supabase.from('journal_lines')
        .select('journal_entry_id, account_id, account_code, account_name, debit, credit, description')
        .in('journal_entry_id', chunk).eq('company_id', companyId)
        .order('id').range(offset, offset + PAGE - 1);
      if (res.error) throw res.error;
      out.push(...(res.data || []));
      if ((res.data || []).length < PAGE) break;
    }
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
