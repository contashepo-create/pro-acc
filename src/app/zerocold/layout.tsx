'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldAlert, LayoutDashboard, Building2, Users, Database, Activity, LogOut, Loader2,
  MessageSquare, MessageSquareWarning, Megaphone, Settings, CreditCard, Key,
  Package, Headphones, Menu, ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/zerocold', label: 'لوحة التحكم', icon: LayoutDashboard, exact: true },
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
  { href: '/zerocold/visitors', label: 'الزوار', icon: Activity },
];

function SidebarContent({ collapsed, pathname, onNavigate, onCollapseToggle }: {
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
  onCollapseToggle: () => void;
}) {
  const isActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  return (
    <div className="flex flex-col h-full bg-sidebar-bg text-text-primary">
      {/* Brand */}
      <div className="flex items-center h-14 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-base font-bold text-text-primary whitespace-nowrap">
              لوحة <span className="text-amber-400">المطور</span>
            </span>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 h-10 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-amber-600/15 text-amber-400 border border-amber-700/30'
                  : 'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="shrink-0" />
              {!collapsed && <span className="flex-1 text-right font-medium whitespace-nowrap">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle (desktop only) */}
      <div className="hidden lg:flex items-center justify-center h-12 border-t border-border shrink-0 bg-sidebar-bg">
        <button
          onClick={() => onCollapseToggle()}
          className="w-9 h-9 rounded-xl hover:bg-sidebar-hover flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
          title={collapsed ? 'توسيع القائمة' : 'طي القائمة'}
        >
          {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>
    </div>
  );
}

export default function ZerocoldLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const isAuthPage =
        pathname.startsWith('/zerocold/login') ||
        pathname.startsWith('/zerocold/verify-telegram') ||
        pathname.startsWith('/zerocold/verify-master');

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

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.replace('/zerocold/login');
  };

  const isAuthPage =
    pathname.startsWith('/zerocold/login') ||
    pathname.startsWith('/zerocold/verify-telegram') ||
    pathname.startsWith('/zerocold/verify-master');

  if (isAuthPage) {
    return <div className="zerocold-shell">{children}</div>;
  }

  if (checking) {
    return (
      <div className="min-h-screen zerocold-shell bg-bg-primary flex items-center justify-center">
        <Loader2 size={32} className="text-text-secondary animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <div className="zerocold-shell min-h-screen bg-bg-primary flex overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col h-screen bg-sidebar-bg border-l border-border transition-all duration-300 shrink-0"
        style={{ width: collapsed ? '70px' : '250px' }}
      >
        <SidebarContent
          collapsed={collapsed}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
          onCollapseToggle={() => setCollapsed((c) => !c)}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-sidebar-bg border-l border-border z-10">
            <SidebarContent
              collapsed={false}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              onCollapseToggle={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <header className="sticky top-0 z-40 h-14 flex items-center justify-between border-b border-border bg-header-bg backdrop-blur-md"
          style={{ boxShadow: '0 1px 0 var(--color-border)' }}
        >
          <div className="flex items-center gap-3 px-4">
            <button
              className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-sidebar-hover transition-colors"
              onClick={() => setMobileOpen(true)}
              aria-label="القائمة"
            >
              <Menu size={20} />
            </button>
            <Link href="/zerocold" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center lg:hidden">
                <ShieldAlert className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-text-primary">لوحة تحكم المطور</span>
            </Link>
          </div>

          <div className="flex items-center gap-1 px-3">
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400/70 hover:text-red-400 hover:bg-red-950/20 transition-all"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">تسجيل الخروج</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}
