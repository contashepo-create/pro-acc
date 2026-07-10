'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ToastContainer } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/auth-store';

const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const checkSession = useAuthStore((s) => s.checkSession);
  const pathname = usePathname();

  useEffect(() => {
    // Only check session on protected routes, not on public pages
    const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
    if (!isPublic) {
      checkSession();
    }
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ToastContainer />
    </QueryClientProvider>
  );
}
