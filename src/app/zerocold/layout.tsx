'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldAlert, LayoutDashboard, Building2, Users, Database, Activity, LogOut, Loader2,
  MessageSquare, MessageSquareWarning, Megaphone, Settings, CreditCard, Key,
  Package, Headphones,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/zerocold', label: 'لوحة التحكم', icon: LayoutDashboard },
  { href: '/zerocold/companies', label: 'الشركات', icon: Building2 },
  { href: '/zerocold/users', label: 'المستخدمين', icon: Users },
  { href: '/zerocold/plans', label: 'الباقات', icon: CreditCard },
  { href: '/zerocold/subscriptions', label: 'الاشتراكات', icon: Package },
  { href: '/zerocold/addon-requests', label: 'طلبات الإضافات', icon: Package },
  { href: '/zerocold/codes', label: 'أكواد التفعيل', icon: Key },
  { href: '/zerocold/support', label: 'تذاكر الدعم', icon: Headphones },
  { href: '/zerocold/app-settings', label: 'إعدادات التطبيق', icon: Settings },
  { href: '/zerocold/messages', label: 'الرسائل', icon: MessageSquare },
  { href: '/zerocold/complaints', label: 'الشكاوي', icon: MessageSquareWarning },
  { href: '/zerocold/advertisements', label: 'الإعلانات', icon: Megaphone },
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

      // Skip the session probe on auth pages entirely: it always 401s
      // before login and just spams the browser console with
      // "Failed to load resource: 401" noise.
      if (isAuthPage) {
        setChecking(false);
        return;
      }

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
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <Loader2 size={32} className="text-text-secondary animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <header className="sticky top-0 z-40 bg-bg-primary/90 backdrop-blur-md border-b border-[#1f1725]">
        <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
          <Link href="/zerocold" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center">
              <ShieldAlert className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-text-primary">لوحة المطور</span>
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
                      : 'text-text-muted hover:text-amber-300 hover:bg-bg-card'
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
                    : 'text-text-muted hover:text-amber-300 hover:bg-bg-card'
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
