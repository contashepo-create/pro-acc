import { create } from 'zustand';
import { User, Company } from '@/types';

export interface SubscriptionState {
  status: 'active' | 'trial' | 'expired' | 'trial_expired' | 'cancelled' | 'missing';
  is_expired: boolean;
  message: string | null;
  end_date: string | null;
  days_remaining: number;
}

interface AuthState {
  user: User | null;
  company: Company | null;
  subscription: SubscriptionState | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<{ success: boolean; message?: string; subscription?: SubscriptionState }>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
  setCompany: (company: Company | null) => void;
  setSubscription: (sub: SubscriptionState | null) => void;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  company: null,
  subscription: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        return { success: false, message: body.message || 'البريد الإلكتروني أو كلمة المرور غير صحيحة' };
      }

      const { user, company, subscription } = body.data;

      set({
        user,
        company,
        subscription: subscription || null,
        isAuthenticated: true,
        isLoading: false,
      });

      return { success: true, subscription: subscription || null };
    } catch {
      return { success: false, message: 'حدث خطأ في الاتصال بالخادم' };
    }
  },

  logout: async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    set({ user: null, company: null, subscription: null, isAuthenticated: false });
  },

  setUser: (user) => set({ user }),

  setCompany: (company) => set({ company }),

  setSubscription: (subscription) => set({ subscription }),

  checkSession: async () => {
    try {
      // Also fetch subscription status in parallel to stay in sync.
      const [meRes, subRes] = await Promise.all([
        fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }),
        fetch('/api/auth/subscription-status', { credentials: 'same-origin', cache: 'no-store' }),
      ]);

      if (!meRes.ok) {
        set({ user: null, company: null, subscription: null, isAuthenticated: false, isLoading: false });
        return;
      }

      const body = await meRes.json();

      if (!body.success) {
        set({ user: null, company: null, subscription: null, isAuthenticated: false, isLoading: false });
        return;
      }

      let sub: SubscriptionState | null = null;
      try {
        if (subRes.ok) {
          const sb = await subRes.json();
          if (sb?.success?.data) {
            const d = sb.success?.data || sb.data;
            sub = d ? {
              status: d.status,
              is_expired: !!d.is_expired,
              message: d.reason ? null : null,
              end_date: d.end_date,
              days_remaining: d.days_remaining,
            } : null;
          } else if (sb?.data) {
            sub = {
              status: sb.data.status,
              is_expired: !!sb.data.is_expired,
              message: null,
              end_date: sb.data.end_date,
              days_remaining: sb.data.days_remaining,
            };
          }
        }
      } catch {}

      set({
        user: body.data.user,
        company: body.data.company,
        subscription: sub,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({ user: null, company: null, subscription: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
