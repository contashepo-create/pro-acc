'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
  ChevronDown,
} from 'lucide-react';
import { useSidebarStore } from '@/store/sidebar-store';
import { useAuthStore } from '@/store/auth-store'; // FIXED: Imported auth store to filter menu based on user role

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
      { id: 'credit-notes', label: 'إشعارات دائنة' },
      { id: 'cash', label: 'النقدية' },
      { id: 'bank-reconciliation', label: 'تسوية البنوك' },
    ],
  },
  {
    label: 'المشاريع',
    icon: HardHat,
    items: [
      { id: 'projects', label: 'المشاريع' },
      { id: 'project-expenses', label: 'مصروفات المشاريع' },
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

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { setActive } = useSidebarStore();
  const { user } = useAuthStore(); // FIXED: Retrieve user role
  
  const role = user?.role || 'supervisor';

  // FIXED: تصفية وتجهيز القائمة الجانبية لإخفاء أقسام الإدارة الحساسة (الصلاحيات، الباقات، الإعدادات، السنوات المالية، المستخدمين) عن غير المدير
  const filteredNavGroups = navGroups.map(group => {
    let items = group.items;
    if (role !== 'admin') {
      items = items.filter(item => !['permissions', 'settings', 'subscription', 'fiscal', 'users'].includes(item.id));
    }
    return { ...group, items };
  }).filter(group => group.items.length > 0);

  const isActive = (id: string) => {
    const cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const cleanId = id.startsWith('/') ? id.slice(1) : id;
    if (cleanId === '') return cleanPath === 'dashboard';
    return cleanPath === cleanId || cleanPath.startsWith(cleanId + '/');
  };

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    filteredNavGroups.forEach((g) => {
      initial[g.label] = g.items.some((i) => isActive(i.id));
    });
    return initial;
  });

  useEffect(() => {
    filteredNavGroups.forEach((g) => {
      if (g.items.some((i) => isActive(i.id))) {
        setExpandedGroups((prev) => ({ ...prev, [g.label]: true }));
      }
    });
  }, [pathname]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const handleNav = (id: string) => {
    setActive(id);
    const targetPath = id === '' ? '/dashboard' : (id.startsWith('/') ? id : `/${id}`);
    router.push(targetPath);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar-bg text-text-primary">
      <div className="flex items-center h-16 px-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <span className="text-text-inverse font-bold text-sm">ب</span>
          </div>
          <span className="text-lg font-bold text-text-primary whitespace-nowrap">
            برو <span className="text-accent">أكاوننت</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {filteredNavGroups.map((group) => {
          const Icon = group.icon;
          const isExpanded = expandedGroups[group.label];
          const hasActiveChild = group.items.some((i) => isActive(i.id));

          return (
            <div key={group.label}>
              {group.items.length === 1 ? (
                <button
                  onClick={() => handleNav(group.items[0].id)}
                  className={`sidebar-item w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-colors ${
                    hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Icon size={20} className="shrink-0" />
                  <span className="flex-1 text-right text-sm font-medium">{group.label}</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={`sidebar-item w-full flex items-center gap-3 px-3 h-10 rounded-lg transition-colors ${
                      hasActiveChild ? 'active text-accent' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <Icon size={20} className="shrink-0" />
                    <span className="flex-1 text-right text-sm font-medium">{group.label}</span>
                    <ChevronDown
                      size={16}
                      className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
                    />
                  </button>
                  {isExpanded && (
                    <div className="mr-8 mt-0.5 space-y-0.5">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleNav(item.id)}
                          className={`sidebar-item w-full text-right px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            isActive(item.id)
                              ? 'active text-accent font-semibold'
                              : 'text-text-secondary hover:text-text-primary'
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
        })}
      </nav>
    </div>
  );
}