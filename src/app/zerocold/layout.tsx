'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldAlert, LayoutDashboard, Building2, Users, Database, Activity, LogOut, Loader2
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/zerocold', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/zerocold/companies', label: 'الشركات', icon: Building2 },
  { href: '/zerocold/users', label: 'المستخدمين', icon: Users },
  { href: '/zerocold/database', label: 'قاعدة البيانات', icon: Database },
  { href: '/zerocold/logs', label: 'سجل الأحداث', icon: Activity },
];

export default function ZerocoldLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const isAuthPage =
        pathname.startsWith('/zerocold/login') ||
        pathname.startsWith('/zerocold/verify-telegram') ||
        pathname.startsWith('/zerocold/verify-master');

      try {
        const res = await fetch('/api/admin/session');
        if (res.ok) {
          const body = await res.json();
          if (body.success) {
            setAuthenticated(true);
          } else if (!isAuthPage) {
            router.replace('/zerocold/login');
          }
        } else if (!isAuthPage) {
          router.replace('/zerocold/login');
        }
      } catch {
        if (!isAuthPage) router.replace('/zerocold/login');
      } finally {
        setChecking(false);
      }
    };

    checkAuth();
  }, [pathname, router]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/zerocold/login');
  };

  const isAuthPage =
    pathname.startsWith('/zerocold/login') ||
    pathname.startsWith('/zerocold/verify-telegram') ||
    pathname.startsWith('/zerocold/verify-master');

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 size={32} className="text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/90 backdrop-blur-md border-b border-[#1f1725]">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
          <Link href="/zerocold" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center">
              <ShieldAlert className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-amber-50">لوحة المطور</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === '/zerocold'
                ? pathname === '/zerocold'
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-amber-600/15 text-amber-400 border border-amber-700/30'
                      : 'text-amber-400/50 hover:text-amber-300 hover:bg-[#12101a]'
                  }`}
                >
                  <item.icon size={14} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400/60 hover:text-red-400 hover:bg-red-950/20 transition-all"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">تسجيل الخروج</span>
          </button>
        </div>

        <nav className="md:hidden flex items-center gap-1 px-4 pb-2 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/zerocold'
              ? pathname === '/zerocold'
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.65rem] font-medium transition-all ${
                  isActive
                    ? 'bg-amber-600/15 text-amber-400 border border-amber-700/30'
                    : 'text-amber-400/50 hover:text-amber-300 hover:bg-[#12101a]'
                }`}
              >
                <item.icon size={12} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 page-enter">
        {children}
      </main>
    </div>
  );
}
