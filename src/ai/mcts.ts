/**
 * GO PLAY built-in AI: Monte-Carlo tree search with heuristic random playouts.
 * Free (runs in the browser, no server) — and honest: this is NOT KataGo. It plays beginner-to-club level on 9×9/13×13
 * and is weak on 19×19. Pure TypeScript so it can run in a Web Worker and in Node tests.
 */
import { GoGame, makeConfig, type BoardSize, type RuleSet } from '../engine/index.ts';

export interface McPosition { size: BoardSize; komi: number; rules: RuleSet; handicap: number; moves: number[] }
export interface McCandidate { p: number; visits: number; winrate: number; scoreLead: number }
export interface McResult {
  toPlay: 1 | 2;
  /** Black's win probability (estimate) */
  winrate: number;
  /** expected Black−White area margin (estimate) */
  scoreLead: number;
  candidates: McCandidate[];
  /** per point +1 Black … −1 White (estimate) */
  ownership: number[];
  playouts: number;
}
export interface McOptions { maxPlayouts: number; maxMs?: number; seed?: number; wantOwnership?: boolean }

export function makeRng(seed: number) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const PASS = -1;

class Sim {
  readonly n: number;
  readonly N: number;
  board: Int8Array;
  ko = -1;
  nbr: Int32Array;     // 4 neighbours per point, -1 = off board
  diag: Int32Array;    // 4 diagonals per point, -1 = off board
  private stamp: Int32Array;
  private stampId = 0;
  private stack: Int32Array;
  private grp: Int32Array;
  grpLen = 0;

  constructor(n: number, board?: Int8Array, shared?: { nbr: Int32Array; diag: Int32Array }) {
    this.n = n; this.N = n * n;
    this.board = board ? board.slice() : new Int8Array(this.N);
    this.stamp = new Int32Array(this.N); this.stack = new Int32Array(this.N); this.grp = new Int32Array(this.N);
    if (shared) { this.nbr = shared.nbr; this.diag = shared.diag; return; }
    this.nbr = new Int32Array(this.N * 4); this.diag = new Int32Array(this.N * 4);
    for (let p = 0; p < this.N; p++) {
      const x = p % n, y = (p - x) / n;
      this.nbr[p * 4] = y > 0 ? p - n : -1; this.nbr[p * 4 + 1] = x > 0 ? p - 1 : -1; this.nbr[p * 4 + 2] = x < n - 1 ? p + 1 : -1; this.nbr[p * 4 + 3] = y < n - 1 ? p + n : -1;
      this.diag[p * 4] = x > 0 && y > 0 ? p - n - 1 : -1; this.diag[p * 4 + 1] = x < n - 1 && y > 0 ? p - n + 1 : -1;
      this.diag[p * 4 + 2] = x > 0 && y < n - 1 ? p + n - 1 : -1; this.diag[p * 4 + 3] = x < n - 1 && y < n - 1 ? p + n + 1 : -1;
    }
  }
  clone(): Sim { const s = new Sim(this.n, this.board, { nbr: this.nbr, diag: this.diag }); s.ko = this.ko; return s; }
  copyFrom(o: Sim) { this.board.set(o.board); this.ko = o.ko; }

  /** flood the group at p; fills this.grp / grpLen; returns number of distinct liberties */
  groupLibs(p: number): number {
    const color = this.board[p]; const id = ++this.stampId; let libs = 0; let top = 0; this.grpLen = 0;
    this.stack[top++] = p; this.stamp[p] = id;
    // liberties are marked with the NEGATIVE id so a point counts once
    while (top) {
      const q = this.stack[--top]; this.grp[this.grpLen++] = q;
      for (let k = 0; k < 4; k++) {
        const r = this.nbr[q * 4 + k]; if (r < 0) continue;
        const v = this.board[r];
        if (v === 0) { if (this.stamp[r] !== -id) { this.stamp[r] = -id; libs++; } }
        else if (v === color && this.stamp[r] !== id) { this.stamp[r] = id; this.stack[top++] = r; }
      }
    }
    return libs;
  }
  /** first liberty of the group last flooded (assumes it has one) */
  private lastLiberty(): number {
    for (let i = 0; i < this.grpLen; i++) { const q = this.grp[i]; for (let k = 0; k < 4; k++) { const r = this.nbr[q * 4 + k]; if (r >= 0 && this.board[r] === 0) return r; } }
    return -1;
  }
  singleLiberty(p: number): number { return this.groupLibs(p) === 1 ? this.lastLiberty() : -1; }

  /** returns captured stone count, or −1 if illegal (occupied / ko / suicide). Board is untouched on failure. */
  play(p: number, color: number): number {
    if (this.board[p] !== 0 || p === this.ko) return -1;
    this.board[p] = color; const opp = 3 - color; let captured = 0; let lastCap = -1;
    for (let k = 0; k < 4; k++) {
      const q = this.nbr[p * 4 + k];
      if (q >= 0 && this.board[q] === opp && this.groupLibs(q) === 0) { for (let i = 0; i < this.grpLen; i++) { this.board[this.grp[i]] = 0; lastCap = this.grp[i]; } captured += this.grpLen; }
    }
    const libs = this.groupLibs(p);
    if (libs === 0) { this.board[p] = 0; return -1; }
    this.ko = captured === 1 && this.grpLen === 1 && libs === 1 ? lastCap : -1;
    return captured;
  }
  isOwnEye(p: number, color: number): boolean {
    let bad = 0;
    for (let k = 0; k < 4; k++) { const q = this.nbr[p * 4 + k]; if (q >= 0 && this.board[q] !== color) return false; }
    for (let k = 0; k < 4; k++) { const q = this.diag[p * 4 + k]; if (q < 0 || this.board[q] === 3 - color) bad++; }
    return bad < 2;
  }
  /** Chinese area score margin (Black − White − komi); optional ownership accumulation */
  score(komi: number, own?: Float32Array): number {
    let b = 0, w = 0; const id = ++this.stampId;
    for (let p = 0; p < this.N; p++) {
      const v = this.board[p];
      if (v === 1) { b++; if (own) own[p] += 1; } else if (v === 2) { w++; if (own) own[p] -= 1; }
      else if (this.stamp[p] !== id) {
        let top = 0, size = 0, tb = false, tw = false; this.stack[top++] = p; this.stamp[p] = id; this.grpLen = 0;
        while (top) {
          const q = this.stack[--top]; size++; this.grp[this.grpLen++] = q;
          for (let k = 0; k < 4; k++) { const r = this.nbr[q * 4 + k]; if (r < 0) continue; const u = this.board[r]; if (u === 0) { if (this.stamp[r] !== id) { this.stamp[r] = id; this.stack[top++] = r; } } else if (u === 1) tb = true; else tw = true; }
        }
        if (tb && !tw) { b += size; if (own) for (let i = 0; i < this.grpLen; i++) own[this.grp[i]] += 1; }
        else if (tw && !tb) { w += size; if (own) for (let i = 0; i < this.grpLen; i++) own[this.grp[i]] -= 1; }
      }
    }
    return b - w - komi;
  }
}

class Node {
  children: Node[] = [];
  untried: number[] | null = null;
  visits = 0; wins = 0; marginSum = 0;
  constructor(public move: number, public parent: Node | null, public mover: number) {}
}

export class Mcts {
  private rng: () => number;
  private root: Sim;
  private toPlay: 1 | 2;
  private lastWasPass: boolean;
  private work: Sim;
  constructor(private pos: McPosition, seed = 1) {
    this.rng = makeRng(seed);
    const g = GoGame.fromMoves(makeConfig({ size: pos.size, komi: pos.komi, rules: pos.rules, handicap: pos.handicap }), pos.moves);
    this.root = new Sim(pos.size, Int8Array.from(g.board));
    this.root.ko = g.koPoint;
    this.toPlay = g.toPlay;
    this.lastWasPass = pos.moves.length > 0 && pos.moves[pos.moves.length - 1] === PASS;
    this.work = this.root.clone();
  }

  private shuffledEmpties(s: Sim, color: number): number[] {
    const out: number[] = [];
    for (let p = 0; p < s.N; p++) if (s.board[p] === 0 && !s.isOwnEye(p, color)) out.push(p);
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  }

  /** one heuristic random playout from `s`; returns final margin (Black perspective) */
  private playout(s: Sim, toMove: number, lastMove: number, passesIn: number, own?: Float32Array): number {
    let color = toMove, passes = passesIn, last = lastMove;
    const limit = s.N * 3;
    for (let ply = 0; ply < limit && passes < 2; ply++) {
      let played = false;
      // heuristic: capture an enemy group in atari / rescue our own, next to the last move
      if (last >= 0 && this.rng() < 0.85) {
        for (let k = 0; k < 4 && !played; k++) {
          const q = s.nbr[last * 4 + k]; if (q < 0 || s.board[q] === 0) continue;
          const lib = s.singleLiberty(q);
          if (lib < 0) continue;
          const stoneColor = s.board[q];
          if (stoneColor === 3 - color) { if (s.play(lib, color) >= 0) { played = true; last = lib; } }
          else if (stoneColor === color && !s.isOwnEye(lib, color)) {
            const c = s.play(lib, color);
            if (c >= 0) { if (s.groupLibs(lib) >= 2) { played = true; last = lib; } else { /* self-atari extension: still played, accept */ played = true; last = lib; } }
          }
        }
      }
      if (!played && last >= 0 && this.rng() < 0.4) {
        // local response: play next to the last move (keeps playouts realistic: fights are local)
        const off = Math.floor(this.rng() * 8);
        for (let i = 0; i < 8 && !played; i++) {
          const k = (off + i) & 7;
          const q = k < 4 ? s.nbr[last * 4 + k] : s.diag[last * 4 + (k - 4)];
          if (q < 0 || s.board[q] !== 0 || s.isOwnEye(q, color)) continue;
          if (s.play(q, color) >= 0) { played = true; last = q; }
        }
      }
      if (!played) {
        // random non-eye legal move
        const start = Math.floor(this.rng() * s.N);
        for (let i = 0; i < s.N; i++) {
          const p = (start + i) % s.N;
          if (s.board[p] !== 0 || s.isOwnEye(p, color)) continue;
          if (s.play(p, color) >= 0) { played = true; last = p; break; }
        }
      }
      if (played) passes = 0; else { passes++; s.ko = -1; last = -1; }
      color = 3 - color;
    }
    return s.score(this.pos.komi, own);
  }

  run(opts: McOptions): McResult {
    const root = new Node(-2, null, 3 - this.toPlay);   // `mover` of the root = the side that just moved
    const N = this.root.N;
    const own = new Float32Array(N);
    let blackWins = 0, marginSum = 0, done = 0;
    const t0 = Date.now();
    const maxMs = opts.maxMs ?? Infinity;

    while (done < opts.maxPlayouts && (done % 32 !== 0 || Date.now() - t0 < maxMs)) {
      const s = this.work; s.copyFrom(this.root);
      let node = root; let color: number = this.toPlay; let passes = this.lastWasPass ? 1 : 0; let last = -1;
      // selection / expansion
      for (;;) {
        if (node.untried === null) node.untried = this.shuffledEmpties(s, color);
        if (node.untried.length > 0) {
          let child: Node | null = null;
          while (node.untried.length > 0 && !child) {
            const p = node.untried.pop()!;
            if (s.play(p, color) >= 0) { child = new Node(p, node, color); last = p; passes = 0; }
          }
          if (child) { node.children.push(child); node = child; color = 3 - color; break; }
        }
        if (node.children.length === 0) {
          // no moves left: pass
          const child = new Node(PASS, node, color); node.children.push(child); node = child; color = 3 - color; passes++; s.ko = -1; last = -1;
          if (passes >= 2) break;
          continue;
        }
        // UCT
        let best: Node | null = null, bestV = -Infinity; const lnN = Math.log(node.visits + 1);
        for (const c of node.children) {
          const v = c.visits === 0 ? 1e9 : c.wins / c.visits + 0.6 * Math.sqrt(lnN / c.visits);
          if (v > bestV) { bestV = v; best = c; }
        }
        node = best!;
        if (node.move === PASS) { passes++; s.ko = -1; last = -1; } else { s.play(node.move, color); passes = 0; last = node.move; }
        color = 3 - color;
        if (passes >= 2) break;
      }
      const margin = this.playout(s, color, last, passes, opts.wantOwnership === false ? undefined : own);
      const blackWon = margin > 0;
      if (blackWon) blackWins++;
      marginSum += margin; done++;
      for (let n: Node | null = node; n; n = n.parent) {
        n.visits++; n.marginSum += margin;
        if ((n.mover === 1) === blackWon) n.wins++;   // `wins` is from the perspective of the side that made n.move
      }
    }

    const candidates = [...root.children].sort((a, b) => b.visits - a.visits).slice(0, 10).map((c) => ({
      p: c.move,
      visits: c.visits,
      winrate: c.visits ? (c.mover === 1 ? c.wins / c.visits : 1 - c.wins / c.visits) : 0.5,
      scoreLead: c.visits ? c.marginSum / c.visits : 0,
    }));
    return {
      toPlay: this.toPlay,
      winrate: done ? blackWins / done : 0.5,
      scoreLead: done ? marginSum / done : 0,
      candidates,
      ownership: Array.from(own, (v) => (done ? v / done : 0)),
      playouts: done,
    };
  }
}

export type McDifficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert';
/** Search budget per level. Weaker levels also sample among candidates instead of always taking the best. */
export const MC_LEVELS: Record<McDifficulty, { playouts: number; ms: number; temperature: number; resignBelow: number }> = {
  beginner: { playouts: 40, ms: 400, temperature: 2.2, resignBelow: 0 },
  easy: { playouts: 200, ms: 800, temperature: 1.0, resignBelow: 0 },
  intermediate: { playouts: 800, ms: 1500, temperature: 0.4, resignBelow: 0.03 },
  advanced: { playouts: 3000, ms: 3500, temperature: 0.1, resignBelow: 0.04 },
  expert: { playouts: 12000, ms: 6000, temperature: 0, resignBelow: 0.05 },
};

export interface McMove { move: { type: 'play'; p: number } | { type: 'pass' }; resign: boolean; winrate: number; scoreLead: number }

export function mcMove(pos: McPosition, level: McDifficulty, seed = Date.now() >>> 0): McMove {
  const cfg = MC_LEVELS[level];
  const mc = new Mcts(pos, seed);
  const res = mc.run({ maxPlayouts: cfg.playouts * (pos.size === 19 ? 1 : 1), maxMs: cfg.ms, seed, wantOwnership: false });
  const rng = makeRng(seed ^ 0x5bd1e995);
  const mine = (wr: number) => (res.toPlay === 1 ? wr : 1 - wr);
  let cands = res.candidates;
  const lastWasPass = pos.moves.length > 0 && pos.moves[pos.moves.length - 1] === PASS;
  if (cands.length === 0) return { move: { type: 'pass' }, resign: false, winrate: res.winrate, scoreLead: res.scoreLead };
  const best = cands[0];
  // never resign early; resign only when the search is confident the position is lost
  if (cfg.resignBelow > 0 && pos.moves.length > pos.size * 2 && mine(res.winrate) < cfg.resignBelow) return { move: best.p === PASS ? { type: 'pass' } : { type: 'play', p: best.p }, resign: true, winrate: res.winrate, scoreLead: res.scoreLead };
  // the opponent passed and we are not losing → pass and end the game (the area estimate counts dead stones, so be conservative)
  if (lastWasPass && mine(res.winrate) >= 0.55) return { move: { type: 'pass' }, resign: false, winrate: res.winrate, scoreLead: res.scoreLead };
  let pick = best;
  if (cfg.temperature > 0) {
    const bestW = mine(best.winrate);
    cands = cands.filter((c) => c.visits >= 2 && bestW - mine(c.winrate) <= 0.3);
    const weights = cands.map((c) => Math.pow(c.visits, 1 / cfg.temperature));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    pick = cands[0] ?? best;
    for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) { pick = cands[i]; break; } }
  }
  return { move: pick.p === PASS ? { type: 'pass' } : { type: 'play', p: pick.p }, resign: false, winrate: res.winrate, scoreLead: res.scoreLead };
}
