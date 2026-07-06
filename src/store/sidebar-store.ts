import { create } from 'zustand';

interface SidebarState {
  isCollapsed: boolean;
  activeItem: string;
  toggle: () => void;
  setActive: (item: string) => void;
}

const COLLAPSED_KEY = 'accweb_sidebar_collapsed';

function getStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(COLLAPSED_KEY);
  return stored === 'true';
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  isCollapsed: getStoredCollapsed(),
  activeItem: '',

  toggle: () => {
    const next = !get().isCollapsed;
    localStorage.setItem(COLLAPSED_KEY, String(next));
    set({ isCollapsed: next });
  },

  setActive: (item) => set({ activeItem: item }),
}));
