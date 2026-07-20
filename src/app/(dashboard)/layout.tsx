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
import { Loader2 } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, checkSession } = useAuthStore();

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
      <aside className="hidden lg:flex flex-col h-screen bg-sidebar-bg border-l border-border transition-all duration-300"
        style={{ width: '260px' }}
      >
        <Sidebar />
      </aside>
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
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
      <div className="lg:hidden fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/50" onClick={() => {}} />
        <div className="absolute right-0 top-0 bottom-0 w-64 bg-sidebar-bg border-l border-border">
          <Sidebar />
        </div>
      </div>
    </div>
  );
}