import { handicapPoints } from './handicap.ts';
import { scoreBoard } from './scoring.ts';
import {
  BLACK,
  WHITE,
  EMPTY,
  PASS,
  other,
  type Cell,
  type Color,
  type GameConfig,
  type GamePhase,
  type GameResult,
  type IllegalReason,
  type Move,
  type MoveRecord,
  type MoveResult,
  type ScoreResult,
} from './types.ts';

interface Snapshot {
  board: Uint8Array;
  toPlay: Color;
  captures: [number, number, number];
  koPoint: number;
  passes: number;
  addedKey: string | null;
}

type Sim =
  | { ok: false; reason: IllegalReason }
  | { ok: true; board: Uint8Array; captured: number[]; koPoint: number; key: string };

/**
 * Deterministic Go game. All rule decisions live here:
 *  - captures, liberties, suicide prevention
 *  - simple ko or positional superko
 *  - passes, two consecutive passes → scoring phase
 *  - resignation, territory/area scoring, undo, handicap
 */
export class GoGame {
  config: GameConfig;
  readonly size: number;
  board: Uint8Array;
  toPlay: Color;
  /** captures[BLACK] = number of white stones captured by Black (Black's prisoners) */
  captures: [number, number, number] = [0, 0, 0];
  history: MoveRecord[] = [];
  koPoint = -1;
  passes = 0;
  phase: GamePhase = 'playing';
  result: GameResult | null = null;

  private snapshots: Snapshot[] = [];
  private positions = new Set<string>();

  constructor(config: GameConfig) {
    this.config = { ...config };
    this.size = config.size;
    this.board = new Uint8Array(config.size * config.size);
    const hp = handicapPoints(config.size, config.handicap);
    for (const p of hp) this.board[p] = BLACK;
    this.toPlay = hp.length > 0 ? WHITE : BLACK;
    this.positions.add(boardKey(this.board));
  }

  /** Rebuild a game by replaying moves (PASS = -1). Throws if a move is illegal. */
  static fromMoves(config: GameConfig, moves: readonly number[]): GoGame {
    const g = new GoGame(config);
    for (const p of moves) {
      const r = p === PASS ? g.pass() : g.play(p);
      if (!r.ok) throw new Error(`Illegal move ${p} at #${g.history.length + 1}: ${r.reason}`);
    }
    return g;
  }

  /**
   * Build a game from an arbitrary board (learning exercises, tests, analysis).
   * `rows` are strings of '.', 'X' (black), 'O' (white); `toPlay` moves next.
   */
  static fromPosition(config: GameConfig, rows: readonly string[], toPlay: Color = BLACK): GoGame {
    const g = new GoGame({ ...config, handicap: 0 });
    g.config = { ...config };
    if (rows.length !== config.size) throw new Error('rows must match board size');
    rows.forEach((row, y) => {
      const r = row.replace(/\s+/g, '');
      if (r.length !== config.size) throw new Error(`row ${y} must have ${config.size} points`);
      for (let x = 0; x < config.size; x++) g.board[y * config.size + x] = r[x] === 'X' ? BLACK : r[x] === 'O' ? WHITE : EMPTY;
    });
    g.toPlay = toPlay;
    g.positions = new Set([boardKey(g.board)]);
    return g;
  }

  clone(): GoGame {
    const g = new GoGame({ ...this.config, handicap: 0 });
    g.config = { ...this.config };
    g.board = this.board.slice();
    g.toPlay = this.toPlay;
    g.captures = [...this.captures] as [number, number, number];
    g.history = this.history.map((m) => ({ ...m, captured: [...m.captured] }));
    g.koPoint = this.koPoint;
    g.passes = this.passes;
    g.phase = this.phase;
    g.result = this.result;
    g.snapshots = this.snapshots.map((s) => ({
      ...s,
      board: s.board.slice(),
      captures: [...s.captures] as [number, number, number],
    }));
    g.positions = new Set(this.positions);
    return g;
  }

  get moveNumber(): number {
    return this.history.length;
  }

  get lastMove(): MoveRecord | undefined {
    return this.history[this.history.length - 1];
  }

  at(p: number): Cell {
    return this.board[p] as Cell;
  }

  /** Connected group containing p and its liberty points. */
  groupAt(p: number): { color: Color; stones: number[]; liberties: number[] } | null {
    if (this.board[p] === EMPTY) return null;
    return floodGroup(this.board, this.size, p);
  }

  liberties(p: number): number {
    const g = this.groupAt(p);
    return g ? g.liberties.length : 0;
  }

  /** Checks legality without mutating the game. */
  checkMove(p: number, color: Color = this.toPlay): MoveResult {
    const sim = this.simulate(p, color);
    if (!sim.ok) return sim;
    return { ok: true, record: { number: this.history.length + 1, color, p, captured: sim.captured } };
  }

  isLegal(p: number, color: Color = this.toPlay): boolean {
    return this.checkMove(p, color).ok;
  }

  legalMoves(color: Color = this.toPlay): number[] {
    const out: number[] = [];
    for (let p = 0; p < this.board.length; p++) if (this.board[p] === EMPTY && this.isLegal(p, color)) out.push(p);
    return out;
  }

  play(p: number): MoveResult {
    const color = this.toPlay;
    const sim = this.simulate(p, color);
    if (!sim.ok) return sim;

    this.pushSnapshot(sim.key);
    this.board = sim.board;
    this.captures[color] += sim.captured.length;
    this.koPoint = sim.koPoint;
    this.passes = 0;
    this.positions.add(sim.key);
    const record: MoveRecord = { number: this.history.length + 1, color, p, captured: sim.captured };
    this.history.push(record);
    this.toPlay = other(color);
    return { ok: true, record };
  }

  pass(): MoveResult {
    if (this.phase === 'finished') return { ok: false, reason: 'game_over' };
    if (this.phase !== 'playing') return { ok: false, reason: 'not_playing' };
    const color = this.toPlay;
    this.pushSnapshot(null);
    this.koPoint = -1;
    this.passes += 1;
    const record: MoveRecord = { number: this.history.length + 1, color, p: PASS, captured: [] };
    this.history.push(record);
    this.toPlay = other(color);
    if (this.passes >= 2) this.phase = 'scoring';
    return { ok: true, record };
  }

  apply(move: Move): MoveResult {
    return move.type === 'pass' ? this.pass() : this.play(move.p);
  }

  /** Undo the last move. Works while playing or scoring; not once finished. */
  undo(): boolean {
    if (this.phase === 'finished') return false;
    const snap = this.snapshots.pop();
    if (!snap) return false;
    this.history.pop();
    this.board = snap.board;
    this.toPlay = snap.toPlay;
    this.captures = snap.captures;
    this.koPoint = snap.koPoint;
    this.passes = snap.passes;
    this.phase = 'playing';
    if (snap.addedKey) this.positions.delete(snap.addedKey);
    return true;
  }

  /** After two passes, players who disagree about dead stones can resume play. */
  resume(): boolean {
    if (this.phase !== 'scoring') return false;
    this.phase = 'playing';
    this.passes = 0;
    return true;
  }

  resign(color: Color): GameResult {
    const winner = other(color);
    return this.finishWith({ winner, reason: 'resign', text: `${winner === BLACK ? 'B' : 'W'}+R` });
  }

  /** `color` ran out of time. */
  timeout(color: Color): GameResult {
    const winner = other(color);
    return this.finishWith({ winner, reason: 'timeout', text: `${winner === BLACK ? 'B' : 'W'}+T` });
  }

  /** Draw by mutual agreement (no score). */
  drawByAgreement(): GameResult {
    return this.finishWith({ winner: null, reason: 'draw', text: '0' });
  }

  /** Compute the score for the current board with the given dead-stone points removed. */
  score(dead: Iterable<number> = []): ScoreResult {
    return scoreBoard(this, dead);
  }

  /** Finish the game by counting. Only valid in the scoring phase (after two passes). */
  finishByScore(dead: Iterable<number> = []): GameResult {
    const score = this.score(dead);
    const text = score.winner === null ? '0' : `${score.winner === BLACK ? 'B' : 'W'}+${score.margin}`;
    return this.finishWith({ winner: score.winner, reason: 'score', score, text });
  }

  private finishWith(r: GameResult): GameResult {
    this.phase = 'finished';
    this.result = r;
    return r;
  }

  private pushSnapshot(addedKey: string | null) {
    this.snapshots.push({
      board: this.board.slice(),
      toPlay: this.toPlay,
      captures: [...this.captures] as [number, number, number],
      koPoint: this.koPoint,
      passes: this.passes,
      addedKey,
    });
  }

  private simulate(p: number, color: Color): Sim {
    if (this.phase === 'finished') return { ok: false, reason: 'game_over' };
    if (this.phase !== 'playing') return { ok: false, reason: 'not_playing' };
    if (!Number.isInteger(p) || p < 0 || p >= this.board.length) return { ok: false, reason: 'out_of_bounds' };
    if (this.board[p] !== EMPTY) return { ok: false, reason: 'occupied' };
    if (this.config.ko === 'simple' && p === this.koPoint && color === this.toPlay) return { ok: false, reason: 'ko' };

    const size = this.size;
    const b = this.board.slice();
    b[p] = color;
    const opp = other(color);
    const captured: number[] = [];
    const seen = new Set<number>();
    for (const n of neighborsOf(p, size)) {
      if (b[n] !== opp || seen.has(n)) continue;
      const g = floodGroup(b, size, n);
      for (const s of g.stones) seen.add(s);
      if (g.liberties.length === 0) {
        for (const s of g.stones) {
          b[s] = EMPTY;
          captured.push(s);
        }
      }
    }
    const own = floodGroup(b, size, p);
    if (own.liberties.length === 0) return { ok: false, reason: 'suicide' };

    const key = boardKey(b);
    if (this.config.ko === 'superko' && this.positions.has(key)) return { ok: false, reason: 'superko' };

    let koPoint = -1;
    if (captured.length === 1 && own.stones.length === 1 && own.liberties.length === 1) koPoint = captured[0];
    return { ok: true, board: b, captured, koPoint, key };
  }
}

export function neighborsOf(p: number, size: number): number[] {
  const x = p % size;
  const y = (p - x) / size;
  const out: number[] = [];
  if (y > 0) out.push(p - size);
  if (x > 0) out.push(p - 1);
  if (x < size - 1) out.push(p + 1);
  if (y < size - 1) out.push(p + size);
  return out;
}

export function floodGroup(board: Uint8Array, size: number, start: number) {
  const color = board[start] as Color;
  const stones: number[] = [];
  const libSet = new Set<number>();
  const visited = new Set<number>([start]);
  const stack = [start];
  while (stack.length) {
    const p = stack.pop()!;
    stones.push(p);
    for (const n of neighborsOf(p, size)) {
      const v = board[n];
      if (v === EMPTY) libSet.add(n);
      else if (v === color && !visited.has(n)) {
        visited.add(n);
        stack.push(n);
      }
    }
  }
  return { color, stones, liberties: [...libSet] };
}

export function boardKey(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i];
  return s;
}

export { WHITE, BLACK };
