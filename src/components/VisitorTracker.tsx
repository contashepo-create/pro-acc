'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const ignored = ['/api/', '/_next/', '/zerocold'];
    if (ignored.some((p) => pathname.startsWith(p))) return;

    const timer = setTimeout(() => {
      fetch('/api/visitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathname }),
      }).catch(() => {});
    }, 1000);

    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
