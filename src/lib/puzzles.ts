import { useCallback, useEffect, useState } from 'react';
import { BANK, BANK_BY_ID, dailyPick, type BankPuzzle } from '../content/bank.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { AppError, backendReady, rpc, supabase } from './supabase.ts';

const LOCAL_SOLVED = 'goplay.puzzles';
const LOCAL_DAYS = 'goplay.dailyDays';
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

const readSet = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]'); } catch { return []; } };
const addTo = (k: string, v: string) => { try { const s = new Set(readSet(k)); s.add(v); localStorage.setItem(k, JSON.stringify([...s])); } catch { /* ignore */ } };

/** Pure streak maths (guests); the server computes the same for members. */
export function streakFromDays(days: string[], today: string): { current: number; best: number; days: number } {
  const set = [...new Set(days)].sort();
  const toN = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86_400_000);
  let best = 0, run = 0, prev = -Infinity, lastRun = 0, lastDay = -Infinity;
  for (const d of set) { const n = toN(d); run = n === prev + 1 ? run + 1 : 1; prev = n; best = Math.max(best, run); lastRun = run; lastDay = n; }
  const t = toN(today);
  return { current: lastDay >= t - 1 ? lastRun : 0, best, days: set.length };
}

export interface Streak { current: number; best: number; days: number; solved_today?: boolean }
export interface DailyItem { difficulty: 1 | 2 | 3; puzzle: BankPuzzle; solved: boolean }

function fromRow(r: { puzzle_id: string; difficulty: number; kind: string; shape: string | null; puzzle: { size?: 9; rows: string[]; toPlay: 1 | 2 } }): BankPuzzle {
  return BANK_BY_ID[r.puzzle_id] ?? { id: r.puzzle_id, difficulty: r.difficulty as 1 | 2 | 3, kind: r.kind as BankPuzzle['kind'], shape: r.shape ?? undefined, size: 9, rows: r.puzzle.rows, toPlay: r.puzzle.toPlay, points: [], verify: { kind: 'capture' } };
}

/** Today's three puzzles. Members get the server's set (admin-scheduled or rotation); guests get the identical rotation locally. */
export function useDailySet() {
  const { user } = useAuth();
  const [items, setItems] = useState<DailyItem[]>(() => ([1, 2, 3] as const).map((d) => ({ difficulty: d, puzzle: dailyPick(utcDay(), d), solved: readSet(LOCAL_SOLVED).includes(dailyPick(utcDay(), d).id) })));
  const [streak, setStreak] = useState<Streak>(() => ({ ...streakFromDays(readSet(LOCAL_DAYS), utcDay()) }));
  const [loading, setLoading] = useState(backendReady);

  const refresh = useCallback(async () => {
    if (!backendReady) return;
    try {
      const rows = await rpc<{ puzzle_id: string; difficulty: number; kind: string; shape: string | null; puzzle: any; solved: boolean }[]>('get_daily_set');
      if (rows.length) setItems(rows.map((r) => ({ difficulty: r.difficulty as 1 | 2 | 3, puzzle: fromRow(r), solved: r.solved })));
      if (user) setStreak(await rpc<Streak>('get_daily_streak'));
    } catch { /* keep the local rotation */ } finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { items, streak, loading, refresh };
}

export type SolveResult = { correct: boolean; firstSolve: boolean };

/** Members: validated by the database (answers never leave the server). Guests: validated locally and stored on the device. */
export async function solvePuzzle(p: BankPuzzle, point: number, signedIn: boolean): Promise<SolveResult> {
  if (backendReady && signedIn) {
    try {
      const r = await rpc<{ correct: boolean; first_solve: boolean }>('solve_puzzle', { p_puzzle: p.id, p_point: point });
      return { correct: r.correct, firstSolve: r.first_solve };
    } catch (e) { if (!(e instanceof AppError && e.code === 'puzzle_not_found')) throw e; }   // bank not seeded server-side → local
  }
  const correct = p.points.includes(point);
  if (correct) {
    const before = readSet(LOCAL_SOLVED).includes(p.id);
    addTo(LOCAL_SOLVED, p.id);
    if (dailyPick(utcDay(), p.difficulty).id === p.id) addTo(LOCAL_DAYS, utcDay());
    return { correct, firstSolve: !before };
  }
  return { correct: false, firstSolve: false };
}

export async function revealPuzzle(p: BankPuzzle, signedIn: boolean): Promise<number[]> {
  if (backendReady && signedIn) { try { return await rpc<number[]>('reveal_puzzle', { p_puzzle: p.id }); } catch (e) { if (!(e instanceof AppError && e.code === 'puzzle_not_found')) throw e; } }
  return p.points;
}

export function usePuzzleProgress() {
  const { user } = useAuth();
  const [solved, setSolved] = useState<Set<string>>(() => new Set(readSet(LOCAL_SOLVED)));
  const reload = useCallback(async () => {
    const local = new Set(readSet(LOCAL_SOLVED));
    if (supabase && user) {
      const { data } = await supabase.from('puzzle_solves').select('puzzle_id').eq('user_id', user.id);
      (data ?? []).forEach((r: { puzzle_id: string }) => local.add(r.puzzle_id));
    }
    setSolved(local);
  }, [user]);
  useEffect(() => { void reload(); }, [reload]);
  return { solved, reload, total: BANK.length };
}
