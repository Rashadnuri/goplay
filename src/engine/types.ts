/** Core types for the GO PLAY rules engine. Pure TypeScript — no DOM, no Supabase. */

export const EMPTY = 0 as const;
export const BLACK = 1 as const;
export const WHITE = 2 as const;
export type Color = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Color;

export type BoardSize = 9 | 13 | 19;
export const BOARD_SIZES: readonly BoardSize[] = [9, 13, 19];

export type RuleSet = 'japanese' | 'chinese';
/** simple = classic ko only; superko = positional superko (no repeat of any earlier board). */
export type KoRule = 'simple' | 'superko';

export interface GameConfig {
  size: BoardSize;
  komi: number;
  rules: RuleSet;
  handicap: number; // 0 or 2..9
  ko: KoRule;
}

/** A point is encoded as y * size + x. PASS is -1. */
export const PASS = -1;

export type Move = { type: 'play'; p: number } | { type: 'pass' };

export interface MoveRecord {
  /** 1-based move number (handicap stones are not moves). */
  number: number;
  color: Color;
  /** point index, or PASS */
  p: number;
  /** points of stones captured by this move */
  captured: number[];
}

export type IllegalReason =
  | 'game_over'
  | 'not_playing'
  | 'out_of_bounds'
  | 'occupied'
  | 'suicide'
  | 'ko'
  | 'superko';

export type MoveResult =
  | { ok: true; record: MoveRecord }
  | { ok: false; reason: IllegalReason };

export type GamePhase = 'playing' | 'scoring' | 'finished';

export type EndReason = 'score' | 'resign' | 'timeout' | 'agreement' | 'draw' | 'abandoned';

export interface ScoreResult {
  black: number;
  white: number; // includes komi
  blackTerritory: number;
  whiteTerritory: number;
  blackStones: number; // alive stones on board (area scoring)
  whiteStones: number;
  blackPrisoners: number; // captured + dead (territory scoring)
  whitePrisoners: number;
  komi: number;
  rules: RuleSet;
  /** points that are neutral (dame / seki) */
  neutral: number[];
  /** per point: owner of territory 1/2 or 0 */
  territory: Uint8Array;
  winner: Color | null; // null = jigo (draw)
  margin: number;
}

export interface GameResult {
  winner: Color | null;
  reason: EndReason;
  score?: ScoreResult;
  /** human readable like "B+3.5", "W+R", "W+T", "0" */
  text: string;
}

export const other = (c: Color): Color => (c === BLACK ? WHITE : BLACK);

export const defaultKomi = (rules: RuleSet, handicap: number): number =>
  handicap >= 2 ? 0.5 : rules === 'chinese' ? 7.5 : 6.5;

export function makeConfig(partial: Partial<GameConfig> & { size: BoardSize }): GameConfig {
  const rules = partial.rules ?? 'japanese';
  const handicap = partial.handicap ?? 0;
  return {
    size: partial.size,
    rules,
    handicap,
    komi: partial.komi ?? defaultKomi(rules, handicap),
    ko: partial.ko ?? (rules === 'chinese' ? 'superko' : 'simple'),
  };
}

export const pointToXY = (p: number, size: number) => ({ x: p % size, y: Math.floor(p / size) });
export const xyToPoint = (x: number, y: number, size: number) => y * size + x;
