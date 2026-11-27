/**
 * Puzzle verification. Every puzzle's accepted moves are *derived* from the rules engine, never hand-typed:
 *  - tactical kinds (capture, atari, double atari, escape, connect) are checked with exact predicates
 *  - life & death is decided by an exhaustive game-tree search inside a closed region (proof, not opinion)
 */
import { floodGroup, neighborsOf } from './game.ts';
import { BLACK, EMPTY, WHITE, other, type Color } from './types.ts';
import { GoGame } from './game.ts';

export type Verify =
  | { kind: 'capture'; min?: number }
  | { kind: 'atari' }
  | { kind: 'doubleAtari' }
  | { kind: 'escape'; target: number }
  | { kind: 'connect'; a: number; b: number }
  | { kind: 'lifeDeath'; target: number; region: number[]; role: 'live' | 'kill' };

export const PUZZLE_KINDS = ['capture', 'atari', 'doubleAtari', 'escape', 'connect', 'lifeDeath'] as const;
export type PuzzleKind = (typeof PUZZLE_KINDS)[number];

const libsOf = (g: GoGame, p: number) => floodGroup(g.board, g.size, p).liberties.length;

/** All first moves for the side to move that satisfy the puzzle goal. */
export function solutions(game: GoGame, v: Verify): number[] {
  if (v.kind === 'lifeDeath') return lifeDeathSolutions(game, v);
  const me = game.toPlay;
  const out: number[] = [];
  for (const p of game.legalMoves(me)) {
    const trial = game.clone();
    const r = trial.play(p);
    if (!r.ok) continue;
    const enemyAtari = new Set<number>();
    let ownLibs = libsOf(trial, p);
    for (let q = 0; q < trial.board.length; q++) {
      if (trial.board[q] === other(me)) {
        const g = floodGroup(trial.board, trial.size, q);
        if (g.liberties.length === 1) enemyAtari.add(Math.min(...g.stones));
      }
    }
    switch (v.kind) {
      case 'capture':
        if (r.record.captured.length >= (v.min ?? 1)) out.push(p);
        break;
      case 'atari': {
        const before = atariGroups(game, other(me));
        const fresh = [...enemyAtari].filter((s) => !before.has(s));
        if (r.record.captured.length === 0 && fresh.length >= 1 && ownLibs >= 2) out.push(p);
        break;
      }
      case 'doubleAtari': {
        const before = atariGroups(game, other(me));
        const fresh = [...enemyAtari].filter((s) => !before.has(s));
        if (r.record.captured.length === 0 && fresh.length >= 2 && ownLibs >= 2) out.push(p);
        break;
      }
      case 'escape':
        if (trial.board[v.target] === me && libsOf(trial, v.target) >= 3) out.push(p);
        break;
      case 'connect': {
        if (trial.board[v.a] !== me || trial.board[v.b] !== me) break;
        const g = floodGroup(trial.board, trial.size, v.a);
        if (g.stones.includes(v.b) && !floodGroup(game.board, game.size, v.a).stones.includes(v.b)) out.push(p);
        break;
      }
    }
    ownLibs = 0;
  }
  return out;
}
const atariGroups = (g: GoGame, color: Color) => {
  const s = new Set<number>();
  for (let q = 0; q < g.board.length; q++) if (g.board[q] === color) {
    const grp = floodGroup(g.board, g.size, q);
    if (grp.liberties.length === 1) s.add(Math.min(...grp.stones));
  }
  return s;
};

// ───────────────────────── life & death solver ─────────────────────────
interface Sim { board: Uint8Array; ko: number }

function place(size: number, s: Sim, p: number, color: Color): Sim | null {
  if (s.board[p] !== EMPTY || p === s.ko) return null;
  const b = s.board.slice();
  b[p] = color;
  const opp = other(color);
  let captured: number[] = [];
  const seen = new Set<number>();
  for (const n of neighborsOf(p, size)) {
    if (b[n] !== opp || seen.has(n)) continue;
    const g = floodGroup(b, size, n);
    g.stones.forEach((x) => seen.add(x));
    if (g.liberties.length === 0) for (const x of g.stones) { b[x] = EMPTY; captured.push(x); }
  }
  const own = floodGroup(b, size, p);
  if (own.liberties.length === 0) return null;
  const ko = captured.length === 1 && own.stones.length === 1 && own.liberties.length === 1 ? captured[0] : -1;
  return { board: b, ko };
}

export interface LifeDeathOptions { maxNodes?: number }

/**
 * Exhaustive search. The defender owns the stone at `target`; moves are restricted to `region` (plus pass).
 * Attacker wins iff the target group is captured. Two consecutive passes => the group survives (alive or seki).
 * Positions with ko are rejected (results would depend on ko threats) via the `hasKo` flag in the result.
 */
export function lifeDeathSearch(game: GoGame, target: number, region: number[], toPlay: Color, opts: LifeDeathOptions = {}) {
  const size = game.size;
  const D = game.board[target] as Color;
  const A = other(D);
  const memo = new Map<string, boolean>();
  let nodes = 0;
  let hasKo = false;
  const limit = opts.maxNodes ?? 2_000_000;

  const attackerWins = (s: Sim, turn: Color, passes: number, depth: number): boolean => {
    if (s.board[target] !== D) return true;
    if (depth > 60) return false;
    if (++nodes > limit) throw new Error('life/death search too large');
    const key = `${Array.from(s.board).join('')}|${turn}|${passes}|${s.ko}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let res: boolean;
    const moves: (Sim | 'pass')[] = [];
    for (const p of region) {
      const n = place(size, s, p, turn);
      if (n) { if (n.ko >= 0) hasKo = true; moves.push(n); }
    }
    const passNext = (): boolean => (passes >= 1 ? false : attackerWins({ board: s.board, ko: -1 }, other(turn), passes + 1, depth + 1));
    if (turn === A) {
      res = moves.some((n) => attackerWins(n as Sim, D, 0, depth + 1)) || passNext();
    } else {
      // defender survives if any move (or ending by pass) leaves the attacker without a win
      res = !((passes >= 1) || moves.some((n) => !attackerWins(n as Sim, A, 0, depth + 1)) || !passNext());
    }
    memo.set(key, res);
    return res;
  };

  const start: Sim = { board: game.board.slice(), ko: -1 };
  const winning: number[] = [];
  for (const p of region) {
    const n = place(size, start, p, toPlay);
    if (!n) continue;
    const aw = attackerWins(n, other(toPlay), 0, 1);
    if (toPlay === A ? aw : !aw) winning.push(p);
  }
  const attackerFirst = attackerWins({ ...start }, A, 0, 0);
  const defenderFirst = attackerWins({ ...start }, D, 0, 0);
  return { winning, hasKo, nodes, killsIfAttackerFirst: attackerFirst, deadEvenIfDefenderFirst: defenderFirst };
}

function lifeDeathSolutions(game: GoGame, v: Extract<Verify, { kind: 'lifeDeath' }>): number[] {
  const r = lifeDeathSearch(game, v.target, v.region, game.toPlay);
  if (r.hasKo) throw new Error('ko positions are not supported in life/death puzzles');
  return r.winning;
}

// ───────────────────────── enclosure builder ─────────────────────────
/** Builds a closed eye-space problem: X (Black) ring around `eye` cells, O (White) wall outside the ring. */
export function enclosure(size: number, eye: [number, number][]) {
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size;
  const E = new Set(eye.map(([x, y]) => y * size + x));
  const X = new Set<number>();
  for (const [x, y] of eye) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const nx = x + dx, ny = y + dy;
    if (inb(nx, ny) && !E.has(ny * size + nx)) X.add(ny * size + nx);
  }
  const O = new Set<number>();
  for (const p of X) for (const n of neighborsOf(p, size)) if (!E.has(n) && !X.has(n)) O.add(n);
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let r = '';
    for (let x = 0; x < size; x++) { const p = y * size + x; r += X.has(p) ? 'X' : O.has(p) ? 'O' : '.'; }
    rows.push(r);
  }
  return { rows, region: [...E], target: [...X][0] };
}
export { BLACK, WHITE };
