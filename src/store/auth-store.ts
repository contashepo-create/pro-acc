import { create } from 'zustand';
import { User, Company } from '@/types';

interface AuthState {
  user: User | null;
  company: Company | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setCompany: (company: Company | null) => void;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  company: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        return { success: false, message: body.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
      }

      const { user, company } = body.data;

      set({ user, company, isAuthenticated: true });

      return { success: true };
    } catch {
      return { success: false, message: 'حدث خطأ في الاتصال بالخادم' };
    }
  },

  logout: async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    set({ user: null, company: null, isAuthenticated: false });
  },

  setUser: (user) => set({ user }),

  setCompany: (company) => set({ company }),

  checkSession: async () => {
    try {
      const res = await fetch('/api/auth/me');

      if (!res.ok) {
        set({ user: null, company: null, isAuthenticated: false, isLoading: false });
        return;
      }

      const body = await res.json();

      if (!body.success) {
        set({ user: null, company: null, isAuthenticated: false, isLoading: false });
        return;
      }

      set({
        user: body.data.user,
        company: body.data.company,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({ user: null, company: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
