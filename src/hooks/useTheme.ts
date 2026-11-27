import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'goplay.theme';

export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b101c' : '#f4eee0');
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem(KEY) as ThemePref) || 'dark'; } catch { return 'system'; }
  });
  useEffect(() => applyTheme(pref), [pref]);
  const set = useCallback((p: ThemePref) => {
    setPref(p);
    try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  }, []);
  return { pref, set };
}
