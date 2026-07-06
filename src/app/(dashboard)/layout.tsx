'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import { useSidebarStore } from '@/store/sidebar-store';

const pageTitles: Record<string, string> = {
  '': 'لوحة التحكم',
  dashboard: 'لوحة التحكم',
  accounts: 'دليل الحسابات',
  journal: 'القيود المحاسبية',
  invoices: 'الفواتير',
  'vouchers/receipt': 'سندات القبض',
  'vouchers/disbursement': 'سندات الصرف',
  cash: 'النقدية',
  'bank-reconciliation': 'تسوية البنوك',
  projects: 'المشاريع',
  boq: 'بنود الكميات',
  'progress-billing': 'الفواتير المرحلية',
  quotations: 'عروض الأسعار',
  'purchases/orders': 'أوامر الشراء',
  'purchases/invoices': 'فواتير المشتريات',
  inventory: 'المخزون',
  subcontractors: 'مقاولو الباطن',
  employees: 'الموظفين',
  payroll: 'الرواتب',
  'salary-sheets': 'كشوف المرتبات',
  'daily-workers': 'العمال اليوميون',
  custodies: 'العهد',
  'fixed-assets': 'الأصول الثابتة',
  banks: 'البنوك',
  currencies: 'العملات',
  reports: 'التقارير',
  notifications: 'الإشعارات',
  contacts: 'جهات الاتصال',
  clients: 'العملاء',
  fiscal: 'السنوات المالية',
  settings: 'الإعدادات',
  subscription: 'الباقات والاشتراك',
  messages: 'الرسائل',
  complaints: 'الشكاوي والاقتراحات',
};

function getPageTitle(page: string): string {
  return page ? (pageTitles[page] || page) : pageTitles[''];
}

const sectionAccentMap: Record<string, string> = {
  '': '#D4893B',
  dashboard: '#D4893B',
  accounts: '#D4893B',
  journal: '#D4893B',
  invoices: '#D4893B',
  'vouchers/receipt': '#D4893B',
  'vouchers/disbursement': '#D4893B',
  cash: '#D4893B',
  'bank-reconciliation': '#D4893B',
  banks: '#4A7BD4',
  currencies: '#4A7BD4',
  'fixed-assets': '#4A7BD4',
  projects: '#3D9B5A',
  boq: '#3D9B5A',
  'progress-billing': '#3D9B5A',
  quotations: '#3D9B5A',
  'purchases/orders': '#2A9D8F',
  'purchases/invoices': '#2A9D8F',
  inventory: '#2A9D8F',
  subcontractors: '#8B5CF6',
  employees: '#D45A7A',
  payroll: '#D45A7A',
  'salary-sheets': '#D45A7A',
  'daily-workers': '#D45A7A',
  custodies: '#D45A7A',
  reports: '#D4A84B',
  settings: '#7A6E7E',
  contacts: '#7A6E7E',
  clients: '#7A6E7E',
  fiscal: '#7A6E7E',
  notifications: '#7A6E7E',
  subscription: '#8B5CF6',
  messages: '#3B82F6',
  complaints: '#F59E0B',
};

function getSectionAccent(page: string): string {
  return sectionAccentMap[page] || sectionAccentMap[''];
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { setActive } = useSidebarStore();

  const page = pathname.replace(/^\//, '');
  const sectionAccent = getSectionAccent(page);

  useEffect(() => {
    setActive(page);
  }, [page, setActive]);

  const handleNavigate = (page: string) => {
    router.push(page ? `/${page}` : '/');
  };

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ '--section-accent': sectionAccent } as React.CSSProperties}
    >
      <Sidebar onNavigate={handleNavigate} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header title={getPageTitle(page)} />
        <main className="flex-1 overflow-auto">
          <PageContainer>
            <AnnouncementBar />
            {children}
          </PageContainer>
        </main>
      </div>
    </div>
  );
}
