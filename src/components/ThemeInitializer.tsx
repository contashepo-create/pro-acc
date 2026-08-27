'use client';

import { useEffect } from 'react';
import { initTheme } from '@/store/theme-store';

export function ThemeInitializer() {
  useEffect(() => {
    initTheme();
  }, []);
  return null;
}
