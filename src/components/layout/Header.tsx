'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Sun, Moon, Search, Bell, ChevronDown, LogOut, Settings,
  Clock, Calendar, Menu, ShieldAlert, User, LayoutDashboard,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { time, date } = useClock();

  // إغلاق القائمة عند النقر خارجها - تشمل الزر والقائمة المنسدلة معاً
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const isInsideContainer = containerRef.current && containerRef.current.contains(target);
      const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(target);
      
      if (!isInsideContainer && !isInsideDropdown) {
        setUserMenuOpen(false);
      }
    }

    if (userMenuOpen) {
      // تأخير بسيط لتجنب الإغلاق الفوري عند فتح القائمة
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 10);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [userMenuOpen]);

  // إغلاق البحث عند فتح القائمة والعكس
  useEffect(() => {
    if (userMenuOpen) setSearchOpen(false);
  }, [userMenuOpen]);

  useEffect(() => {
    if (searchOpen) setUserMenuOpen(false);
  }, [searchOpen]);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'مس';

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    logout();
    router.push('/login');
  };

  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  const updateDropdownPosition = useCallback(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        left: Math.max(10, rect.right - 270),
      });
    }
  }, []);

  useEffect(() => {
    if (userMenuOpen) {
      updateDropdownPosition();
      window.addEventListener('resize', updateDropdownPosition);
      window.addEventListener('scroll', updateDropdownPosition, true);
      return () => {
        window.removeEventListener('resize', updateDropdownPosition);
        window.removeEventListener('scroll', updateDropdownPosition, true);
      };
    }
  }, [userMenuOpen, updateDropdownPosition]);

  const ROLE_LABELS: Record<string, string> = {
    admin: 'مدير النظام',
    manager: 'مدير',
    accountant: 'محاسب',
    supervisor: 'مراقب',
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
              className="btn btn-ghost btn-icon relative z-10"
              title="بحث"
            >
              <Search size={17} />
            </button>
            {searchOpen && (
              <div className="absolute left-0 top-full mt-2 z-20">
                <input
                  type="text"
                  placeholder="بحث..."
                  className="input-base w-56 sm:w-72 shadow-lg animate-[fade-in_0.15s_ease-out]"
                  autoFocus
                  onBlur={() => setTimeout(() => setSearchOpen(false), 300)}
                />
              </div>
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

            {/* زر المستخدم والقائمة المنسدلة */}
            <div className="relative" ref={containerRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                id="user-menu-button"
              >
                <div className="w-7 h-7 rounded-full bg-[var(--section-accent,var(--color-accent))] flex items-center justify-center text-text-inverse text-xs font-bold">
                  {initials}
                </div>
                <div className="hidden lg:block text-right leading-tight">
                  <div className="text-sm font-medium text-text-primary">
                    {user?.name || 'المستخدم'}
                  </div>
                </div>
                <ChevronDown size={14} className={`text-text-muted hidden lg:block transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* القائمة المنسدلة - تُرسم في body لتجنب مشاكل الز-index */}
      {userMenuOpen && typeof window !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-72 rounded-xl shadow-2xl overflow-hidden animate-[fade-in_0.15s_ease-out]"
          style={{
            top: `${dropdownPos.top}px`,
            left: `${dropdownPos.left}px`,
            backgroundColor: 'var(--color-bg-card, #fff)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.25), 0 0 0 1px var(--color-border, #e5e7eb)',
            border: '1px solid var(--color-border, #e5e7eb)',
            zIndex: 999999,
          }}
        >
          {/* معلومات المستخدم */}
          <div className="px-4 py-3 bg-gradient-to-l from-accent/5 to-transparent border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--section-accent,var(--color-accent))] flex items-center justify-center text-white text-sm font-bold">
                {initials}
              </div>
              <div>
                <div className="text-sm font-semibold text-text-primary">{user?.name || 'المستخدم'}</div>
                <div className="text-xs text-text-muted">{user?.email || ''}</div>
                <div className="text-[11px] text-accent mt-0.5 font-medium">
                  {ROLE_LABELS[user?.role || ''] || user?.role || 'مستخدم'}
                </div>
              </div>
            </div>
          </div>

          {/* الخيارات */}
          <div className="py-1">
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/dashboard'); }}
              className="w-full text-right px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary flex items-center gap-3 transition-colors"
            >
              <LayoutDashboard size={16} className="text-text-muted" />
              لوحة التحكم
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/settings'); }}
              className="w-full text-right px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary flex items-center gap-3 transition-colors"
            >
              <Settings size={16} className="text-text-muted" />
              الإعدادات
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/permissions'); }}
              className="w-full text-right px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary flex items-center gap-3 transition-colors"
            >
              <ShieldAlert size={16} className="text-text-muted" />
              الصلاحيات
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); router.push('/profile'); }}
              className="w-full text-right px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary flex items-center gap-3 transition-colors"
            >
              <User size={16} className="text-text-muted" />
              الملف الشخصي
            </button>

            {/* لوحة المطور - فقط للبريد المحدد */}
            {user?.email?.toLowerCase() === 'conta.moha@gmail.com' && (
              <>
                <div className="border-t border-border my-1" />
                <button
                  onClick={() => { setUserMenuOpen(false); window.open('/zerocold/login', '_blank'); }}
                  className="w-full text-right px-4 py-2.5 text-sm text-accent hover:bg-accent/10 flex items-center gap-3 transition-colors"
                >
                  <ShieldAlert size={16} />
                  لوحة المطور
                </button>
              </>
            )}
          </div>

          {/* تسجيل الخروج */}
          <div className="border-t border-border">
            <button
              onClick={() => { setUserMenuOpen(false); handleLogout(); }}
              className="w-full text-right px-4 py-2.5 text-sm text-danger hover:bg-danger/10 flex items-center gap-3 transition-colors"
            >
              <LogOut size={16} />
              تسجيل الخروج
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
