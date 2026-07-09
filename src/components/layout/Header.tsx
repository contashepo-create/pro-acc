'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sun, Moon, Search, Bell, ChevronDown, LogOut, User, Settings,
  Clock, Calendar, Menu, ShieldAlert,
} from 'lucide-react';
import { useThemeStore } from '@/store/theme-store';
import { useAuthStore } from '@/store/auth-store';
import { useSidebarStore } from '@/store/sidebar-store';

interface HeaderProps {
  title: string;
  breadcrumbs?: { label: string; href?: string }[];
}

function useClock() {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      setTime(`${h}:${m}`);

      const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      setDate(`${days[now.getDay()]}، ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`);
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return { time, date };
}

export function Header({ title, breadcrumbs }: HeaderProps) {
  const router = useRouter();
  const { isDark, toggleMode } = useThemeStore();
  const { user, logout } = useAuthStore();
  const { setMobileOpen, mobileOpen } = useSidebarStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const { time, date } = useClock();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'مس';

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    logout();
    router.push('/login');
  };

  return (
    <>
      <div className="section-bar shrink-0" />

      <header className="glass-header h-14 shrink-0 px-2 sm:px-4 md:px-6">
        <div className="flex items-center justify-between h-full gap-1 sm:gap-2">

          {/* Mobile: Hamburger + Page title */}
          <div className="flex items-center gap-2 lg:hidden ml-auto">
            <h2 className="text-sm sm:text-base font-bold text-text-primary truncate max-w-[140px] sm:max-w-[200px]">
              {title}
            </h2>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="btn btn-ghost btn-icon"
              title="القائمة"
            >
              <Menu size={20} />
            </button>
          </div>

          {/* Desktop: Clock + Date */}
          <div className="hidden sm:flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Clock size={14} />
              <span className="font-mono text-sm font-semibold text-text-secondary tabular-nums tracking-wider" dir="ltr">
                {time}
              </span>
            </div>
            <div className="hidden md:flex items-center gap-1.5 text-text-muted border-r border-border pr-3">
              <Calendar size={14} />
              <span className="text-xs text-text-secondary">{date}</span>
            </div>
          </div>

          {/* Desktop: Page title */}
          <div className="hidden lg:flex items-center gap-2">
            <h2 className="text-base font-bold text-text-primary">{title}</h2>
            {breadcrumbs && breadcrumbs.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-text-muted mr-2 pr-2 border-r border-border">
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span>/</span>}
                    {crumb.href ? (
                      <a href={crumb.href} className="hover:text-accent transition-colors">{crumb.label}</a>
                    ) : (
                      <span className="text-text-secondary">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions + User */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="btn btn-ghost btn-icon relative"
              title="بحث"
            >
              <Search size={17} />
            </button>
            {searchOpen && (
              <input
                type="text"
                placeholder="بحث..."
                className="input-base w-28 sm:w-36 md:w-48 animate-[fade-in_0.15s_ease-out]"
                autoFocus
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
              />
            )}

            <button
              onClick={() => router.push('/notifications')}
              className="btn btn-ghost btn-icon relative"
              title="الإشعارات"
            >
              <Bell size={17} />
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-danger text-[9px] font-bold text-white flex items-center justify-center">
                3
              </span>
            </button>

            <div className="w-px h-6 bg-border mx-1" />

            <button
              onClick={toggleMode}
              className="btn btn-ghost btn-icon"
              title={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-bg-hover transition-colors"
              >
                <div className="w-7 h-7 rounded-full bg-[var(--section-accent,var(--color-accent))] flex items-center justify-center text-text-inverse text-xs font-bold">
                  {initials}
                </div>
                <div className="hidden lg:block text-right leading-tight">
                  <div className="text-sm font-medium text-text-primary">
                    {user?.name || 'المستخدم'}
                  </div>
                </div>
                <ChevronDown size={14} className="text-text-muted hidden lg:block" />
              </button>

              {userMenuOpen && (
                <div className="absolute left-0 top-full mt-2 w-56 bg-bg-card border border-border rounded-xl shadow-dropdown py-1 z-[100] animate-[fade-in_0.15s_ease-out]" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                  <div className="px-4 py-3 border-b border-border">
                    <div className="text-sm font-medium text-text-primary">{user?.name || 'المستخدم'}</div>
                    <div className="text-xs text-text-muted">{user?.email || ''}</div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {user?.role === 'admin' ? 'مدير النظام' : 'محاسب'}
                    </div>
                  </div>
                  <button
                    onClick={() => { setUserMenuOpen(false); router.push('/settings'); }}
                    className="w-full text-right px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary flex items-center gap-3 transition-colors"
                  >
                    <Settings size={16} />
                    الإعدادات
                  </button>
                  {user?.email === 'conta.moha@gmail.com' && (
                    <button
                      onClick={() => { setUserMenuOpen(false); window.open('/zerocold/login', '_blank'); }}
                      className="w-full text-right px-4 py-2.5 text-sm text-accent hover:bg-accent/10 flex items-center gap-3 transition-colors"
                    >
                      <ShieldAlert size={16} />
                      لوحة المطور
                    </button>
                  )}
                  <div className="border-t border-border mt-1 pt-1">
                    <button
                      onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                      className="w-full text-right px-4 py-2.5 text-sm text-danger hover:bg-danger-light/20 flex items-center gap-3 transition-colors"
                    >
                      <LogOut size={16} />
                      تسجيل الخروج
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
