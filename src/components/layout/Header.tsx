'use client';

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Search, Bell, Moon, Sun, User, LogOut, Menu, 
  Settings, HelpCircle, ChevronDown 
} from 'lucide-react';
import { useThemeStore } from '@/store/theme-store';
import { useAuthStore } from '@/store/auth-store';
import { useSidebarStore } from '@/store/sidebar-store';
import { toast } from '@/components/ui/Toast';

interface HeaderProps {
  title?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export default function Header({ title = '', breadcrumbs }: HeaderProps = {}) {
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  
  const { isDark, toggleMode } = useThemeStore();
  const { user, company, logout } = useAuthStore(); // FIXED: Read company from auth store
  const { isCollapsed, setMobileOpen } = useSidebarStore(); // FIXED: Read isCollapsed

  // Fetch notification count
  useEffect(() => {
    const fetchNotificationCount = async () => {
      try {
        const res = await fetch('/api/notifications?unread_only=true');
        const data = await res.json();
        if (data.success) {
          setNotificationCount(data.data?.length || 0);
        }
      } catch (error) {
        console.error('Failed to fetch notification count:', error);
      }
    };

    fetchNotificationCount();
    const interval = setInterval(fetchNotificationCount, 60000);
    return () => clearInterval(interval);
  }, []);

  // Update time and date
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }));
      setDate(now.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('تم تسجيل الخروج بنجاح');
      router.push('/login');
    } catch (error) {
      toast.error('فشل تسجيل الخروج');
    }
  };

  const handleSearch = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const searchTerm = (e.currentTarget.elements.namedItem('search') as HTMLInputElement).value;
    if (searchTerm.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchTerm.trim())}`);
      setSearchOpen(false);
    }
  };

  return (
    /* FIXED: The header's right position is linked dynamically to the sidebar width using CSS classes */
    <header 
      className={`fixed top-0 left-0 z-40 bg-bg-card/95 backdrop-blur-md border-b border-border h-14 flex items-center justify-between transition-all duration-300 ${isCollapsed ? 'lg:right-[70px]' : 'lg:right-[260px]'} right-0`}
    >
      <div className="w-full px-4 lg:px-6 flex items-center justify-between h-full">
        {/* Mobile: Hamburger + Title */}
        <div className="lg:hidden flex items-center gap-3">
          <button 
            className="btn btn-ghost btn-icon" 
            aria-label="القائمة"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Desktop: Company name + Brand Logo (rendered beautifully inside header on the far right) */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            {company?.logo_url ? (
              <img src={company.logo_url} alt={company.name} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-base font-bold shrink-0 shadow-sm">
                {(company?.name || 'ب')[0]}
              </div>
            )}
            <span className="text-sm font-bold text-text-primary whitespace-nowrap hidden sm:inline">
              {company?.name || 'برو أكاوننت'}
            </span>
          </div>
          
          <div className="h-4 w-px bg-border/60 mx-1" />

          {/* Clock + Date */}
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <span dir="ltr" className="font-semibold">{time}</span>
            <span className="opacity-50">|</span>
            <span>{date}</span>
          </div>
        </div>

        {/* Desktop: Page title & Breadcrumbs */}
        <div className="hidden lg:flex items-center gap-2">
          <h2 className="text-sm font-bold text-text-primary">{title}</h2>
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
        <div className="flex items-center gap-1 h-full">
          <form onSubmit={handleSearch} className="relative">
            <button
              type="button"
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
                  name="search"
                  placeholder="بحث..."
                  className="input-base w-56 sm:w-72 shadow-lg animate-[fade-in_0.15s_ease-out]"
                  autoFocus
                  onBlur={() => setTimeout(() => setSearchOpen(false), 300)}
                />
              </div>
            )}
          </form>

          <button
            onClick={() => router.push('/notifications')}
            className="btn btn-ghost btn-icon relative"
            title="الإشعارات"
          >
            <Bell size={17} />
            {notificationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-danger text-[9px] font-bold text-white flex items-center justify-center">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </button>

          <button
            onClick={toggleMode}
            className="btn btn-ghost btn-icon animate-all duration-300"
            title={isDark ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {isDark ? <Sun size={17} className="text-amber-500 hover:scale-110" /> : <Moon size={17} className="text-slate-400 hover:scale-110" />}
          </button>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="btn btn-ghost flex items-center gap-2 px-3 h-10"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <span className="hidden sm:inline text-sm font-medium text-text-primary">
                {user?.name?.split(' ')[0] || 'مستخدم'}
              </span>
              <ChevronDown size={14} className={`transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-bg-card border border-border rounded-lg shadow-xl z-50 animate-[fade-in_0.15s_ease-out]">
                <div className="p-3 border-b border-border">
                  <p className="text-sm font-medium text-text-primary">{user?.name || 'مستخدم'}</p>
                  <p className="text-xs text-text-muted">{user?.email || ''}</p>
                </div>
                <div className="p-1">
                  {user?.email?.toLowerCase() === 'conta.moha@gmail.com' && (
                    <button
                      onClick={() => {
                        router.push('/zerocold');
                        setUserMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors text-right font-bold border-b border-border/40"
                    >
                      <span>🛠️</span>
                      لوحة المطور (Zerocold)
                    </button>
                  )}
                  
                  <button
                    onClick={() => {
                      router.push('/profile');
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover rounded-lg transition-colors text-right"
                  >
                    <User size={14} />
                    الملف الشخصي
                  </button>
                  <button
                    onClick={() => {
                      router.push('/settings');
                      setUserMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover rounded-lg transition-colors text-right"
                  >
                    <Settings size={14} />
                    الإعدادات
                  </button>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      window.open('https://help.proacc.com', '_blank');
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover rounded-lg transition-colors text-right"
                  >
                    <HelpCircle size={14} />
                    المساعدة
                  </button>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-lg transition-colors text-right"
                  >
                    <LogOut size={14} />
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}