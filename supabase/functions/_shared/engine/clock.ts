import { BLACK, WHITE, type Color } from './types.ts';

/** Fischer-style clock: `initialMs` main time, `incrementMs` added after each move. */
export interface ClockConfig {
  initialMs: number;
  incrementMs: number;
}

export interface ClockState {
  blackMs: number;
  whiteMs: number;
  /** epoch ms when the running side's clock started; null if no clock is running */
  runningSince: number | null;
  running: Color | null;
}

export const newClock = (c: ClockConfig): ClockState => ({
  blackMs: c.initialMs,
  whiteMs: c.initialMs,
  runningSince: null,
  running: null,
});

export function remaining(state: ClockState, color: Color, now: number): number {
  const base = color === BLACK ? state.blackMs : state.whiteMs;
  if (state.running === color && state.runningSince !== null) return Math.max(0, base - (now - state.runningSince));
  return base;
}

/**
 * Called when `mover` completes a move at `now`.
 * Returns the updated clock (the opponent's clock starts) or `timedOut` if the mover ran out of time.
 * The very first move of a game is free (no clock is running yet).
 */
export function onMove(
  state: ClockState,
  cfg: ClockConfig,
  mover: Color,
  now: number,
): { state: ClockState; timedOut: boolean } {
  const left = remaining(state, mover, now);
  const wasRunning = state.running === mover;
  if (cfg.initialMs > 0 && wasRunning && left <= 0) {
    return {
      timedOut: true,
      state: { ...state, blackMs: mover === BLACK ? 0 : state.blackMs, whiteMs: mover === WHITE ? 0 : state.whiteMs },
    };
  }
  const next = left + (wasRunning ? cfg.incrementMs : 0);
  const opp: Color = mover === BLACK ? WHITE : BLACK;
  return {
    timedOut: false,
    state: {
      blackMs: mover === BLACK ? next : state.blackMs,
      whiteMs: mover === WHITE ? next : state.whiteMs,
      running: opp,
      runningSince: now,
    },
  };
}

export const formatClock = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};
