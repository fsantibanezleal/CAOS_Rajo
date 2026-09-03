// Global UI state: theme and language, persisted. English is the default (no navigator auto-detect):
// only an explicit saved choice wins, per the workspace i18n rule.
import i18n from 'i18next';
import { create } from 'zustand';

export type Theme = 'dark' | 'light';
export type Lang = 'en' | 'es';

interface UIState {
  theme: Theme;
  lang: Lang;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setLang: (l: Lang) => void;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('rajo.theme');
    if (saved === 'light' || saved === 'dark') return saved;
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('rajo.lang');
    if (saved === 'en' || saved === 'es') return saved;
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'es' || q === 'en') return q;
  } catch {
    /* storage unavailable */
  }
  return 'en';
}

export const useUI = create<UIState>((set, get) => ({
  theme: initialTheme(),
  lang: initialLang(),
  setTheme: (theme) => {
    try {
      localStorage.setItem('rajo.theme', theme);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  setLang: (lang) => {
    try {
      localStorage.setItem('rajo.lang', lang);
    } catch {
      /* ignore */
    }
    document.documentElement.setAttribute('lang', lang);
    void i18n.changeLanguage(lang);
    set({ lang });
  },
}));
