import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './useAuth.tsx';
import { supabase } from '../lib/supabase.ts';

export type BoardTheme = 'kaya' | 'walnut' | 'cherry' | 'bamboo' | 'ebony';
export type StoneStyle = 'glossy' | 'slate' | 'flat';
export const BOARD_THEMES: BoardTheme[] = ['kaya', 'walnut', 'cherry', 'bamboo', 'ebony'];
export const STONE_STYLES: StoneStyle[] = ['glossy', 'slate', 'flat'];
export interface ClockPreset { initial: number; increment: number }

/** Per-user preferences. Stored on the device and — when signed in — synced to profiles.prefs. Never sensitive. */
export interface Prefs {
  coords: boolean;
  /** 'auto' = confirm moves on touch devices only */
  confirmMoves: 'auto' | 'on' | 'off';
  boardTheme: BoardTheme;
  stoneStyle: StoneStyle;
  sound: { on: boolean; volume: number };
  /** custom game clocks (seconds) */
  clocks: ClockPreset[];
}
const KEY = 'goplay.prefs';
const defaults: Prefs = { coords: false, confirmMoves: 'auto', boardTheme: 'kaya', stoneStyle: 'glossy', sound: { on: true, volume: 0.6 }, clocks: [] };
let cache: Prefs | null = null;
const listeners = new Set<() => void>();

/** Defensive merge: unknown/invalid values from storage or the server fall back to defaults. */
export function sanitize(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const s = r.sound && typeof r.sound === 'object' ? r.sound : {};
  const clocks = Array.isArray(r.clocks) ? r.clocks.filter((c: any) => Number.isInteger(c?.initial) && Number.isInteger(c?.increment) && c.initial >= 0 && c.initial <= 7200 && c.increment >= 0 && c.increment <= 120).slice(0, 6) : [];
  return {
    coords: typeof r.coords === 'boolean' ? r.coords : defaults.coords,
    confirmMoves: ['auto', 'on', 'off'].includes(r.confirmMoves) ? r.confirmMoves : defaults.confirmMoves,
    boardTheme: BOARD_THEMES.includes(r.boardTheme) ? r.boardTheme : defaults.boardTheme,
    stoneStyle: STONE_STYLES.includes(r.stoneStyle) ? r.stoneStyle : defaults.stoneStyle,
    sound: { on: typeof s.on === 'boolean' ? s.on : defaults.sound.on, volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : defaults.sound.volume },
    clocks,
  };
}
function read(): Prefs {
  if (cache) return cache;
  try { cache = sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { cache = { ...defaults }; }
  return cache!;
}
const emit = () => listeners.forEach((l) => l());
function write(p: Prefs) { cache = p; try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } emit(); }

export function usePrefs() {
  const prefs = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read);
  const set = useCallback((patch: Partial<Prefs>) => write(sanitize({ ...read(), ...patch })), []);
  const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const confirm = prefs.confirmMoves === 'on' || (prefs.confirmMoves === 'auto' && isTouch);
  return { prefs, set, confirm };
}

/** Applies theme attributes to <html> and syncs preferences with the signed-in profile. Mounted once. */
export function PrefsEffects() {
  const { prefs } = usePrefs();
  const { user, profile } = useAuth();
  useEffect(() => {
    document.documentElement.dataset.board = prefs.boardTheme;
    document.documentElement.dataset.stones = prefs.stoneStyle;
  }, [prefs.boardTheme, prefs.stoneStyle]);

  // pull once per login …
  useEffect(() => {
    if (profile && profile.prefs && Object.keys(profile.prefs).length) { const remote = sanitize(profile.prefs); lastPushed = JSON.stringify(remote); write(remote); }
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // … and push (debounced) when the user changes something
  useEffect(() => {
    if (!supabase || !user || !profile) return;
    const json = JSON.stringify(prefs);
    if (json === lastPushed) return;
    const t = setTimeout(async () => { lastPushed = json; await supabase!.from('profiles').update({ prefs }).eq('id', user.id); }, 800);
    return () => clearTimeout(t);
  }, [prefs, user, profile]);
  return null;
}
let lastPushed = '';
