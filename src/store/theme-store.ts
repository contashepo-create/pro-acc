import { create } from 'zustand';
import { type Theme, themes, DEFAULT_THEME_ID, sectionAccents } from '@/lib/themes';

interface ThemeState {
  themeId: string;
  isDark: boolean;
  sectionAccent: string;

  setTheme: (id: string) => void;
  toggleMode: () => void;
  setDark: (dark: boolean) => void;
  setSectionAccent: (page: string) => void;
  getCurrentTheme: () => Theme;
}

const THEME_ID_KEY = 'accweb_theme_id';
const THEME_DARK_KEY = 'accweb_theme_dark';

function getStored<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  try { return JSON.parse(stored) as T; }
  catch { return fallback; }
}

function applyClasses(themeId: string, isDark: boolean) {
  if (typeof window === 'undefined') return;
  const root = document.documentElement;
  themes.forEach((t) => root.classList.remove(`theme-${t.id}`));
  root.classList.add(`theme-${themeId}`);
  root.classList.toggle('light', !isDark);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeId: getStored(THEME_ID_KEY, DEFAULT_THEME_ID),
  isDark: getStored(THEME_DARK_KEY, true),
  sectionAccent: '#D4893B',

  setTheme: (id) => {
    localStorage.setItem(THEME_ID_KEY, JSON.stringify(id));
    const { isDark } = get();
    applyClasses(id, isDark);
    set({ themeId: id });
  },

  toggleMode: () => {
    const next = !get().isDark;
    localStorage.setItem(THEME_DARK_KEY, JSON.stringify(next));
    applyClasses(get().themeId, next);
    set({ isDark: next });
  },

  setDark: (dark) => {
    localStorage.setItem(THEME_DARK_KEY, JSON.stringify(dark));
    applyClasses(get().themeId, dark);
    set({ isDark: dark });
  },

  setSectionAccent: (page) => {
    const accent = sectionAccents[page] || '#D4893B';
    set({ sectionAccent: accent });
  },

  getCurrentTheme: () => {
    const { themeId } = get();
    return themes.find((t) => t.id === themeId) || themes[0];
  },
}));

export function initTheme() {
  if (typeof window === 'undefined') return;
  const themeId = getStored(THEME_ID_KEY, DEFAULT_THEME_ID);
  const isDark = getStored(THEME_DARK_KEY, true);
  applyClasses(themeId, isDark);
}
