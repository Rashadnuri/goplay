import { useCallback, useReducer, useRef } from 'react';
import { GoGame, type GameConfig } from '../engine/index.ts';

/** Holds a mutable engine instance and re-renders after each mutation. */
export function useGoGame(initial: () => GoGame) {
  const ref = useRef<GoGame | null>(null);
  if (ref.current === null) ref.current = initial();
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const mutate = useCallback(<T,>(fn: (g: GoGame) => T): T => {
    const out = fn(ref.current!);
    bump();
    return out;
  }, []);
  const replace = useCallback((g: GoGame) => {
    ref.current = g;
    bump();
  }, []);
  return { game: ref.current!, version, mutate, replace };
}

export function loadSaved(key: string): { config: GameConfig; moves: number[]; extra?: Record<string, unknown> } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j?.config || !Array.isArray(j.moves)) return null;
    GoGame.fromMoves(j.config, j.moves); // validate: discard corrupt saves
    return j;
  } catch {
    return null;
  }
}
export function save(key: string, game: GoGame, extra?: Record<string, unknown>) {
  try {
    if (game.phase === 'finished') localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ config: game.config, moves: game.history.map((m) => m.p), extra }));
  } catch { /* storage full/unavailable */ }
}
