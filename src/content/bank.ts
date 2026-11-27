import type { Verify } from '../engine/puzzles.ts';
import { GENERATED } from './bank.generated.ts';

export interface BankPuzzle {
  id: string;
  difficulty: 1 | 2 | 3;
  kind: 'capture' | 'atari' | 'doubleAtari' | 'escape' | 'connect' | 'lifeDeath';
  shape?: string;
  size: 9;
  rows: string[];
  toPlay: 1 | 2;
  /** every accepted first move (derived by the engine) */
  points: number[];
  verify: Verify;
}
export const BANK: BankPuzzle[] = [...GENERATED].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
export const BANK_BY_ID = Object.fromEntries(BANK.map((p) => [p.id, p]));
export const byDifficulty = (d: 1 | 2 | 3) => BANK.filter((p) => p.difficulty === d);

/** Deterministic daily pick used when no admin-scheduled puzzle exists (matches the SQL rotation). */
export function dailyPick(day: string, d: 1 | 2 | 3): BankPuzzle {
  const list = byDifficulty(d);
  const n = Math.floor(Date.parse(day + 'T00:00:00Z') / 86_400_000);
  return list[n % list.length];
}
