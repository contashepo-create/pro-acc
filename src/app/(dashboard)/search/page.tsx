'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, FileText, Users, BookOpen, Package, Building2 } from 'lucide-react';

interface SearchRow {
  section: 'فواتير' | 'جهات اتصال' | 'حسابات' | 'أصناف' | 'عملاء';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

function searchIn(values: Array<string | number | null | undefined>, q: string): boolean {
  return values.some((v) => String(v ?? '').toLowerCase().includes(q));
}

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get('q') || '').trim().toLowerCase();
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!q) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [invoicesRes, contactsRes, accountsRes, inventoryRes, clientsRes] = await Promise.all([
          fetch('/api/invoices?pageSize=100'),
          fetch('/api/contacts?pageSize=100'),
          fetch('/api/accounts'),
          fetch('/api/inventory?pageSize=100'),
          fetch('/api/clients?pageSize=100'),
        ]);
        const [invoices, contacts, accounts, inventory, clients] = await Promise.all([
          invoicesRes.json(), contactsRes.json(), accountsRes.json(), inventoryRes.json(), clientsRes.json(),
        ]);
        if (cancelled) return;
        const rows: SearchRow[] = [];
        for (const inv of invoices?.data?.invoices || []) {
          if (searchIn([inv.number, inv.client_name, inv.status], q)) {
            rows.push({
              section: 'فواتير', id: inv.id, title: `فاتورة رقم ${inv.number}`,
              subtitle: `${inv.client_name || ''} — ${inv.total ?? ''}`, href: `/invoices/${inv.id}/view`,
            });
          }
        }
        for (const c of contacts?.data?.contacts || []) {
          if (searchIn([c.name, c.email, c.phone], q)) {
            rows.push({
              section: 'جهات اتصال', id: c.id, title: c.name,
              subtitle: [c.email, c.phone].filter(Boolean).join(' — '), href: '/contacts',
            });
          }
        }
        for (const a of accounts?.data?.accounts || []) {
          if (searchIn([a.name, a.code, a.name_en], q)) {
            rows.push({
              section: 'حسابات', id: a.id, title: `${a.code} — ${a.name}`,
              subtitle: a.type || '', href: '/accounts',
            });
          }
        }
        for (const item of inventory?.data?.items || []) {
          if (searchIn([item.name, item.sku, item.barcode], q)) {
            rows.push({
              section: 'أصناف', id: item.id, title: item.name,
              subtitle: [item.sku, item.barcode].filter(Boolean).join(' — '), href: '/inventory',
            });
          }
        }
        for (const cl of clients?.data?.clients || []) {
          if (searchIn([cl.name, cl.email, cl.phone], q)) {
            rows.push({
              section: 'عملاء', id: cl.id, title: cl.name,
              subtitle: [cl.email, cl.phone].filter(Boolean).join(' — '), href: `/clients/${cl.id}/statement`,
            });
          }
        }
        setResults(rows.slice(0, 60));
      } catch {
        if (!cancelled) setError('تعذر تنفيذ البحث، حاول مرة أخرى');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [q]);

  const sectionIcon = (section: SearchRow['section']) => {
    switch (section) {
      case 'فواتير': return <FileText size={16} />;
      case 'جهات اتصال': return <Users size={16} />;
      case 'حسابات': return <BookOpen size={16} />;
      case 'أصناف': return <Package size={16} />;
      case 'عملاء': return <Building2 size={16} />;
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8" dir="rtl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement;
          if (input.value.trim()) router.push(`/search?q=${encodeURIComponent(input.value.trim())}`);
        }}
        className="flex gap-2 mb-6"
      >
        <input
          name="q"
          defaultValue={params.get('q') || ''}
          placeholder="ابحث عن فاتورة، عميل، حساب، صنف…"
          className="flex-1 px-4 py-3 border border-border rounded-xl bg-bg-card focus:outline-none focus:ring-2 focus:ring-accent"
          dir="auto"
        />
        <button type="submit" className="px-5 py-3 rounded-xl bg-accent text-white flex items-center gap-2 hover:opacity-90">
          <Search size={16} /> بحث
        </button>
      </form>

      {loading && <p className="text-text-muted text-sm">جارٍ البحث…</p>}
      {error && <p className="text-danger text-sm">{error}</p>}

      {!loading && q && results.length === 0 && (
        <p className="text-text-muted text-sm">لا توجد نتائج مطابقة لـ «{params.get('q')}»</p>
      )}

      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((row) => (
            <li key={`${row.section}-${row.id}`}>
              <a
                href={row.href}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-card border border-border hover:border-accent transition-colors"
              >
                <span className="text-text-muted">{sectionIcon(row.section)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-sm truncate">{row.title}</span>
                  {row.subtitle && <span className="block text-xs text-text-muted truncate">{row.subtitle}</span>}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-secondary text-text-secondary shrink-0">{row.section}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="p-8 text-text-muted text-sm">جارٍ التحميل…</p>}>
      <SearchContent />
    </Suspense>
  );
}
