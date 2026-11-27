import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { az, type DictKey } from './az.ts';
import { en } from './en.ts';
import { ru } from './ru.ts';
import type { Lang, Localized } from '../lib/types.ts';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'az', label: 'Azərbaycanca' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
];

const dicts: Record<Lang, Record<DictKey, string>> = { az, en, ru };
const STORAGE = 'goplay.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'az' || saved === 'en' || saved === 'ru') return saved;
  } catch { /* storage unavailable */ }
  return 'az'; // Azerbaijani is the product default
}

export function translate(lang: Lang, key: DictKey, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.az[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
  /** pick the active language from a {az,en,ru} content object */
  loc: (o: Localized | undefined | null) => string;
  fmtDate: (d: string | Date) => string;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE, l); } catch { /* ignore */ }
  }, []);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      loc: (o) => (o ? o[lang] || o.az || o.en || '' : ''),
      fmtDate: (d) => new Date(d).toLocaleDateString(lang === 'az' ? 'az-AZ' : lang === 'ru' ? 'ru-RU' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
export type { DictKey };
