import { beforeEach, describe, expect, it } from 'vitest';
import { BANK } from '../content/bank.ts';
import { sanitize } from '../hooks/usePrefs.ts';
import { aiAnalyze, aiConfigured, aiHealth, aiMove, aiReview } from './ai.ts';
import { clockOptions, fmtClock } from './clocks.ts';
import { COUNTRY_CODES, countryName, flag } from './countries.ts';
import { loadGame, sendAction } from './online.ts';
import { revealPuzzle, solvePuzzle, streakFromDays, utcDay } from './puzzles.ts';
import { AppError, errorCode, rpc } from './supabase.ts';

// minimal browser storage for node
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
beforeEach(() => store.clear());

describe('streakFromDays', () => {
  const T = '2026-03-10';
  it('counts consecutive UTC days ending today or yesterday', () => {
    expect(streakFromDays(['2026-03-08', '2026-03-09', '2026-03-10'], T)).toEqual({ current: 3, best: 3, days: 3 });
    expect(streakFromDays(['2026-03-08', '2026-03-09'], T)).toEqual({ current: 2, best: 2, days: 2 });   // today not yet solved: still alive
  });
  it('a gap of a full day resets the current streak but keeps the best', () => {
    expect(streakFromDays(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-08'], T)).toEqual({ current: 0, best: 4, days: 5 });
    expect(streakFromDays(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-09'], T)).toEqual({ current: 1, best: 4, days: 5 });
  });
  it('is order-independent, de-duplicates and handles empty input and month boundaries', () => {
    expect(streakFromDays([], T)).toEqual({ current: 0, best: 0, days: 0 });
    expect(streakFromDays(['2026-03-10', '2026-03-10', '2026-03-09'], T).days).toBe(2);
    expect(streakFromDays(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01')).toEqual({ current: 3, best: 3, days: 3 });
  });
});

describe('errorCode', () => {
  it('extracts database error codes, detects network failures, falls back safely', () => {
    expect(errorCode(new Error('err:rate_limited'))).toBe('rate_limited');
    expect(errorCode({ message: 'ERROR: err:room_full (P0001)' })).toBe('room_full');
    expect(errorCode(new AppError('puzzle_not_found'))).toBe('puzzle_not_found');
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('network');
    expect(errorCode(Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }))).toBe('network');
    expect(errorCode(Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' }))).toBe('network');
    expect(errorCode(Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError' }))).toBe('unknown');
    expect(errorCode(new Error('JWT expired'))).toBe('auth_required');
    expect(errorCode(null)).toBe('unknown');
    expect(errorCode('???')).toBe('unknown');
  });
  it('rpc/sendAction/loadGame fail with backend_not_configured when no Supabase is configured', async () => {
    await expect(rpc('x')).rejects.toMatchObject({ code: 'backend_not_configured' });
    await expect(sendAction('id', { type: 'pass' })).rejects.toMatchObject({ code: 'backend_not_configured' });
    await expect(loadGame('id')).rejects.toMatchObject({ code: 'backend_not_configured' });
  });
});

describe('preferences sanitising (storage and server data are untrusted)', () => {
  it('falls back to defaults for garbage and clamps ranges', () => {
    const d = sanitize(null);
    expect(d).toMatchObject({ coords: false, confirmMoves: 'auto', boardTheme: 'kaya', stoneStyle: 'glossy' });
    expect(sanitize({ boardTheme: 'rainbow', stoneStyle: 7, confirmMoves: 'maybe', coords: 'yes' })).toEqual(d);
    expect(sanitize({ sound: { on: false, volume: 9 } }).sound).toEqual({ on: false, volume: 1 });
    expect(sanitize({ sound: { volume: -3 } }).sound.volume).toBe(0);
  });
  it('keeps only valid clock presets, max six', () => {
    const clocks = [{ initial: 60, increment: 1 }, { initial: -5, increment: 0 }, { initial: 99999, increment: 0 }, { initial: 1.5, increment: 0 }, { initial: 0, increment: 500 }, ...Array(10).fill({ initial: 300, increment: 3 })];
    const out = sanitize({ clocks }).clocks;
    expect(out.length).toBe(6);
    expect(out[0]).toEqual({ initial: 60, increment: 1 });
    expect(out.every((c) => c.initial >= 0 && c.initial <= 7200 && c.increment >= 0 && c.increment <= 120)).toBe(true);
  });
  it('round-trips a valid object unchanged', () => {
    const p = { coords: true, confirmMoves: 'on', boardTheme: 'ebony', stoneStyle: 'flat', sound: { on: true, volume: 0.25 }, clocks: [{ initial: 300, increment: 3 }] };
    expect(sanitize(p)).toEqual(p);
  });
});

describe('clocks and countries', () => {
  it('formats custom clocks', () => {
    expect(fmtClock(600, 5)).toBe('10 min + 5s');
    expect(fmtClock(90, 0)).toBe('1.5 min + 0s');
    expect(fmtClock(30, 2)).toBe('30s + 2s');
    expect(fmtClock(0, 0)).toBe('∞');
  });
  it('lists built-in presets then saved ones', () => {
    const o = clockOptions([{ initial: 120, increment: 1 }]);
    expect(o.map((x) => x.id)).toEqual(['blitz', 'rapid', 'classic', 'untimed', 'c0']);
    expect(o[4]).toMatchObject({ custom: true, initial: 120 });
  });
  it('flags and names are valid for every listed country', () => {
    for (const c of COUNTRY_CODES) { expect(flag(c)).toHaveLength(4); expect(countryName(c, 'en').length).toBeGreaterThan(1); }
    expect(flag(null)).toBe('');
    expect(flag('xx1')).toBe('');
    expect(countryName('AZ', 'en')).toBe('Azerbaijan');
  });
});

describe('guest puzzle solving (device-local, answers checked in the browser)', () => {
  const cap = BANK.find((p) => p.id === 'cap-1')!;
  it('rejects wrong moves and records nothing', async () => {
    const wrong = [...Array(81).keys()].find((p) => !cap.points.includes(p))!;
    expect(await solvePuzzle(cap, wrong, false)).toEqual({ correct: false, firstSolve: false });
    expect(store.get('goplay.puzzles')).toBeUndefined();
  });
  it('accepts every engine-derived answer once, reports first solve, never double counts', async () => {
    const r1 = await solvePuzzle(cap, cap.points[0], false);
    expect(r1).toEqual({ correct: true, firstSolve: true });
    expect((await solvePuzzle(cap, cap.points[0], false)).firstSolve).toBe(false);
    expect(JSON.parse(store.get('goplay.puzzles')!)).toEqual(['cap-1']);
  });
  it('solving the day\'s puzzle extends the local daily streak; other puzzles do not', async () => {
    const { dailyPick } = await import('../content/bank.ts');
    const today = dailyPick(utcDay(), 1);
    const other = BANK.find((p) => p.difficulty === 1 && p.id !== today.id)!;
    await solvePuzzle(other, other.points[0], false);
    expect(store.get('goplay.dailyDays')).toBeUndefined();
    await solvePuzzle(today, today.points[0], false);
    expect(JSON.parse(store.get('goplay.dailyDays')!)).toEqual([utcDay()]);
  });
  it('reveal returns the answer without recording a solve', async () => {
    expect(await revealPuzzle(cap, false)).toEqual(cap.points);
    expect(store.get('goplay.puzzles')).toBeUndefined();
  });
});

describe('AI client without a configured service', () => {
  it('reports not configured and refuses to invent results', async () => {
    expect(aiConfigured).toBe(false);
    expect(await aiHealth()).toEqual({ ok: false, reason: 'not_configured' });
    const pos = { size: 9 as const, komi: 6.5, rules: 'japanese' as const, handicap: 0, moves: [] };
    for (const f of [() => aiMove(pos, 'expert'), () => aiAnalyze(pos), () => aiReview(pos)]) await expect(f()).rejects.toMatchObject({ code: 'ai_not_configured' });
  });
});
