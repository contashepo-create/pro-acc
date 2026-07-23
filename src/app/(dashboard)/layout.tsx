'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { AnnouncementBar } from '@/components/AnnouncementBar';
import { AdBanner } from '@/components/AdBanner';
import { AdPopup } from '@/components/AdPopup';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { useAuthStore } from '@/store/auth-store';
import { useSidebarStore } from '@/store/sidebar-store';
import { Loader2 } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();
  const { isCollapsed, mobileOpen, setMobileOpen } = useSidebarStore(); // FIXED: Read isCollapsed

  // Check authentication status
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-accent mx-auto mb-4" />
          <p className="text-text-muted">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  // Don't render dashboard content until authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-bg-primary flex">
      {/* Sidebar — FIXED: Width is determined dynamically by isCollapsed */}
      <aside className="hidden lg:flex flex-col h-screen bg-sidebar-bg border-l border-border transition-all duration-300 shrink-0"
        style={{ width: isCollapsed ? '70px' : '260px' }}
      >
        <Sidebar />
      </aside>
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto pt-14 bg-bg-primary">
          <div className="p-4 md:p-6">
            <AnnouncementBar />
            <AdBanner />
            <SubscriptionBanner />
            <PageContainer>{children}</PageContainer>
          </div>
        </main>
      </div>
      <AdPopup />
      
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          {/* Drawer Panel */}
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-sidebar-bg border-l border-border z-10 animate-[slide-in-right_0.25s_ease-out]">
            <Sidebar />
          </div>
        </div>
      )}
    </div>
  );
}