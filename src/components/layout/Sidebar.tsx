'use client';

import { useState } from 'react';
import {
  LayoutDashboard,
  Calculator,
  HardHat,
  ShoppingCart,
  Users,
  UsersRound,
  Building2,
  BarChart3,
  Settings,
  Shield,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { useSidebarStore } from '@/store/sidebar-store';

interface NavGroup {
  label: string;
  icon: React.ElementType;
  items: { id: string; label: string }[];
}

const navGroups: NavGroup[] = [
  {
    label: 'الرئيسية',
    icon: LayoutDashboard,
    items: [{ id: '', label: 'لوحة التحكم' }],
  },
  {
    label: 'المحاسبة',
    icon: Calculator,
    items: [
      { id: 'accounts', label: 'الحسابات' },
      { id: 'journal', label: 'القيود' },
      { id: 'invoices', label: 'الفواتير' },
      { id: 'vouchers/receipt', label: 'سندات قبض' },
      { id: 'vouchers/disbursement', label: 'سندات صرف' },
      { id: 'cash', label: 'النقدية' },
      { id: 'bank-reconciliation', label: 'تسوية البنوك' },
    ],
  },
  {
    label: 'المشاريع',
    icon: HardHat,
    items: [
      { id: 'projects', label: 'المشاريع' },
      { id: 'boq', label: 'بنود الكميات' },
      { id: 'progress-billing', label: 'الفواتير المرحلية' },
      { id: 'quotations', label: 'عروض الأسعار' },
    ],
  },
  {
    label: 'المشتريات',
    icon: ShoppingCart,
    items: [
      { id: 'purchases/orders', label: 'أوامر الشراء' },
      { id: 'purchases/invoices', label: 'فواتير المشتريات' },
      { id: 'inventory', label: 'المخزون' },
    ],
  },
  {
    label: 'المقاولون',
    icon: Users,
    items: [{ id: 'subcontractors', label: 'مقاولو الباطن' }],
  },
  {
    label: 'العملاء والموردون',
    icon: Users,
    items: [
      { id: 'clients', label: 'العملاء' },
      { id: 'contacts', label: 'جهات الاتصال' },
    ],
  },
  {
    label: 'الموارد البشرية',
    icon: UsersRound,
    items: [
      { id: 'employees', label: 'الموظفين' },
      { id: 'payroll', label: 'الرواتب' },
      { id: 'users', label: 'المستخدمين' },
      { id: 'salary-sheets', label: 'كشوف المرتبات' },
      { id: 'daily-workers', label: 'العمال اليوميون' },
      { id: 'custodies', label: 'العهد' },
    ],
  },
  {
    label: 'الأصول',
    icon: Building2,
    items: [
      { id: 'fixed-assets', label: 'الأصول الثابتة' },
      { id: 'banks', label: 'البنوك' },
      { id: 'currencies', label: 'العملات' },
    ],
  },
  {
    label: 'التقارير',
    icon: BarChart3,
    items: [{ id: 'reports', label: 'التقارير' }],
  },
  {
    label: 'النظام',
    icon: Settings,
    items: [
      { id: 'settings', label: 'الإعدادات' },
      { id: 'permissions', label: 'الصلاحيات' },
      { id: 'subscription', label: 'الباقات والاشتراك' },
      { id: 'messages', label: 'الرسائل' },
      { id: 'complaints', label: 'الشكاوي والاقتراحات' },
      { id: 'fiscal', label: 'السنوات المالية' },
      { id: 'notifications', label: 'الإشعارات' },
    ],
  },
];

interface SidebarProps {
  onNavigate: (pageId: string) => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { isCollapsed, toggle, activeItem, setActive, mobileOpen, setMobileOpen } = useSidebarStore();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navGroups.forEach((g) => {
      initial[g.label] = g.items.some((i) => i.id === activeItem);
    });
    return initial;
  });

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const handleNav = (id: string) => {
    setActive(id);
    onNavigate(id);
    setMobileOpen(false);
  };

  const isActive = (id: string) => activeItem === id;

  const sidebarContent = (
    <>
      <div className="flex items-center h-16 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <span className="text-text-inverse font-bold text-sm">ب</span>
          </div>
          {!isCollapsed && (
            <span className="text-lg font-bold text-text-primary whitespace-nowrap">
              برو <span className="text-accent">أكاوننت</span>
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navGroups.map((group) => {
          const Icon = group.icon;
          const isExpanded = expandedGroups[group.label];
          const hasActiveChild = group.items.some((i) => isActive(i.id));

          if (isCollapsed) {
            return (
              <div key={group.label} className="relative group">
                {group.items.length === 1 ? (
                  <button
                    onClick={() => handleNav(group.items[0].id)}
                    className={`sidebar-item w-full flex items-center justify-center h-10 rounded-lg transition-colors ${
                      hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <Icon size={20} />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className={`sidebar-item w-full flex items-center justify-center h-10 rounded-lg transition-colors ${
                        hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Icon size={20} />
                    </button>
                    {isExpanded && (
                      <div className="absolute right-full mr-2 top-0 bg-bg-elevated border border-border rounded-lg shadow-dropdown py-1 min-w-[180px] z-50">
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => handleNav(item.id)}
                            className={`w-full text-right px-4 py-2 text-sm transition-colors ${
                              isActive(item.id)
                                ? 'text-accent bg-sidebar-active'
                                : 'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          }

          return (
            <div key={group.label}>
              <button
                onClick={() => group.items.length > 1 ? toggleGroup(group.label) : handleNav(group.items[0].id)}
                className={`sidebar-item w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-colors ${
                  hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Icon size={20} className="shrink-0" />
                <span className="flex-1 text-right text-sm font-medium">{group.label}</span>
                {group.items.length > 1 && (
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                  />
                )}
              </button>
              {group.items.length > 1 && isExpanded && (
                <div className="mr-8 mt-0.5 space-y-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleNav(item.id)}
                      className={`sidebar-item w-full text-right px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        isActive(item.id)
                          ? 'active text-accent'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-lg text-text-muted hover:text-text-primary hover:bg-sidebar-hover transition-colors"
        >
          {isCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          {!isCollapsed && <span className="text-sm">تصغير</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed top-0 right-0 h-full z-50 transition-transform duration-300 lg:hidden ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <aside
          className="flex flex-col h-full bg-sidebar-bg border-l border-border"
          style={{ width: isCollapsed ? '64px' : '260px' }}
        >
          <div className="flex items-center justify-between h-16 px-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
                <span className="text-text-inverse font-bold text-sm">ب</span>
              </div>
              {!isCollapsed && (
                <span className="text-lg font-bold text-text-primary whitespace-nowrap">
                  برو <span className="text-accent">أكاوننت</span>
                </span>
              )}
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="btn btn-ghost btn-icon"
            >
              <X size={20} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
            {navGroups.map((group) => {
              const Icon = group.icon;
              const isExpanded = expandedGroups[group.label];
              const hasActiveChild = group.items.some((i) => isActive(i.id));

              return (
                <div key={group.label}>
                  <button
                    onClick={() => group.items.length > 1 ? toggleGroup(group.label) : handleNav(group.items[0].id)}
                    className={`sidebar-item w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-colors ${
                      hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <Icon size={20} className="shrink-0" />
                    <span className="flex-1 text-right text-sm font-medium">{group.label}</span>
                    {group.items.length > 1 && (
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                      />
                    )}
                  </button>
                  {group.items.length > 1 && isExpanded && (
                    <div className="mr-8 mt-0.5 space-y-0.5">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleNav(item.id)}
                          className={`sidebar-item w-full text-right px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            isActive(item.id)
                              ? 'active text-accent'
                              : 'text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col h-screen bg-sidebar-bg border-l border-border transition-all duration-300"
        style={{ width: isCollapsed ? '64px' : '260px' }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
