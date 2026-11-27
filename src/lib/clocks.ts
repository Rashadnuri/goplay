import { TIME_PRESETS } from './online.ts';
import type { ClockPreset } from '../hooks/usePrefs.ts';

export interface ClockOption { id: string; initial: number; increment: number; custom: boolean }
export const fmtClock = (initial: number, inc: number) => (initial ? `${initial >= 60 ? Math.round((initial / 60) * 10) / 10 : initial + 's'}${initial >= 60 ? ' min' : ''} + ${inc}s` : '∞');

/** Built-in presets followed by the player's saved custom clocks. */
export function clockOptions(saved: ClockPreset[]): ClockOption[] {
  return [
    ...TIME_PRESETS.map((p) => ({ id: p.id, initial: p.initial, increment: p.increment, custom: false })),
    ...saved.map((c, i) => ({ id: `c${i}`, initial: c.initial, increment: c.increment, custom: true })),
  ];
}
