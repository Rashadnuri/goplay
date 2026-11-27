/**
 * Differential fuzzing: the production engine vs. a deliberately naive, independently written reference
 * (2-D arrays, recursion, whole-board string history). Any disagreement on legality, captures, board state or score fails.
 */
import { describe, expect, it } from 'vitest';
import { BLACK, GoGame, PASS, WHITE, makeConfig, type BoardSize, type Color } from './index.ts';

class Ref {
  b: number[][]; n: number; hist: string[]; caps = [0, 0, 0]; passes = 0; turn: Color = BLACK; superko: boolean;
  constructor(n: number, superko: boolean) { this.n = n; this.superko = superko; this.b = Array.from({ length: n }, () => Array(n).fill(0)); this.hist = [this.key(this.b)]; }
  key(b: number[][]) { return b.map((r) => r.join('')).join('/'); }
  nbrs(x: number, y: number) { return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [x + dx, y + dy]).filter(([a, c]) => a >= 0 && c >= 0 && a < this.n && c < this.n); }
  group(b: number[][], x: number, y: number) {
    const col = b[y][x]; const seen = new Set<string>([`${x},${y}`]); const st = [[x, y]]; const libs = new Set<string>(); const stones: number[][] = [];
    while (st.length) { const [cx, cy] = st.pop()!; stones.push([cx, cy]); for (const [nx, ny] of this.nbrs(cx, cy)) { if (b[ny][nx] === 0) libs.add(`${nx},${ny}`); else if (b[ny][nx] === col && !seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); st.push([nx, ny]); } } }
    return { stones, libs: libs.size };
  }
  try(x: number, y: number, c: Color) {
    if (this.b[y][x] !== 0) return null;
    const nb = this.b.map((r) => [...r]); nb[y][x] = c; let cap = 0;
    for (const [nx, ny] of this.nbrs(x, y)) if (nb[ny][nx] === 3 - c) { const g = this.group(nb, nx, ny); if (g.libs === 0) for (const [sx, sy] of g.stones) { if (nb[sy][sx] !== 0) { nb[sy][sx] = 0; cap++; } } }
    if (this.group(nb, x, y).libs === 0) return null;                      // suicide
    const k = this.key(nb);
    if (this.superko) { if (this.hist.includes(k)) return null; }
    else if (this.hist.length >= 2 && this.hist[this.hist.length - 2] === k && this.lastWasPlay) return null;   // basic ko: immediate repetition
    return { nb, cap };
  }
  lastWasPlay = false;
  legal(c: Color) { const out: number[] = []; for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) if (this.try(x, y, c)) out.push(y * this.n + x); return out; }
  play(p: number) { const x = p % this.n, y = Math.floor(p / this.n); const r = this.try(x, y, this.turn)!; this.b = r.nb; this.caps[this.turn] += r.cap; this.hist.push(this.key(this.b)); this.passes = 0; this.lastWasPlay = true; this.turn = (3 - this.turn) as Color; }
  pass() { this.hist.push(this.key(this.b)); this.passes++; this.lastWasPlay = false; this.turn = (3 - this.turn) as Color; }
  flat() { return this.b.flat(); }
  /** area scoring with no dead stones */
  area(komi: number) {
    const seen = new Set<string>(); let bs = 0, ws = 0, bt = 0, wt = 0;
    for (let y = 0; y < this.n; y++) for (let x = 0; x < this.n; x++) {
      if (this.b[y][x] === 1) bs++; else if (this.b[y][x] === 2) ws++;
      else if (!seen.has(`${x},${y}`)) {
        const st = [[x, y]]; seen.add(`${x},${y}`); let size = 0, tb = false, tw = false;
        while (st.length) { const [cx, cy] = st.pop()!; size++; for (const [nx, ny] of this.nbrs(cx, cy)) { const v = this.b[ny][nx]; if (v === 0) { if (!seen.has(`${nx},${ny}`)) { seen.add(`${nx},${ny}`); st.push([nx, ny]); } } else if (v === 1) tb = true; else tw = true; } }
        if (tb && !tw) bt += size; else if (tw && !tb) wt += size;
      }
    }
    return { black: bs + bt, white: ws + wt + komi, bt, wt, bs, ws };
  }
}

function lcg(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

function playOne(size: BoardSize, superko: boolean, seed: number, maxMoves: number) {
  const rnd = lcg(seed);
  const cfg = makeConfig({ size, rules: superko ? 'chinese' : 'japanese', komi: 6.5 });
  const g = new GoGame(cfg); const r = new Ref(size, superko);
  let moves = 0;
  while (moves < maxMoves && g.phase === 'playing') {
    const color = g.toPlay;
    expect(color, `seed ${seed} move ${moves}: side to move`).toBe(r.turn);
    const eng = g.legalMoves().sort((a, b) => a - b);
    const ref = r.legal(color).sort((a, b) => a - b);
    expect(eng, `seed ${seed} move ${moves}: legal move sets differ`).toEqual(ref);
    // illegal points must be rejected with the right reason class
    for (let p = 0; p < size * size; p++) if (!ref.includes(p)) expect(g.checkMove(p).ok).toBe(false);
    if (ref.length === 0 || rnd() < 0.04) { g.pass(); r.pass(); }
    else { const p = ref[Math.floor(rnd() * ref.length)]; const res = g.play(p); expect(res.ok).toBe(true); r.play(p); }
    expect(Array.from(g.board), `seed ${seed} move ${moves}: boards differ`).toEqual(r.flat());
    expect(g.captures[BLACK], `seed ${seed}: black captures`).toBe(r.caps[BLACK]);
    expect(g.captures[WHITE], `seed ${seed}: white captures`).toBe(r.caps[WHITE]);
    moves++;
    if (r.passes >= 2) { expect(g.phase).toBe('scoring'); break; }
  }
  // scoring agreement (Chinese area, no dead stones)
  const s = new GoGame({ ...cfg, rules: 'chinese' });
  s.board = g.board.slice();
  const sc = s.score();
  const ra = r.area(6.5);
  expect([sc.black, sc.white, sc.blackTerritory, sc.whiteTerritory, sc.blackStones, sc.whiteStones], `seed ${seed}: area score`).toEqual([ra.black, ra.white, ra.bt, ra.wt, ra.bs, ra.ws]);
  // replay + undo invariants
  const replay = GoGame.fromMoves(cfg, g.history.map((m) => m.p));
  expect(Array.from(replay.board)).toEqual(Array.from(g.board));
  const copy = g.clone();
  while (copy.undo()) { /* walk back to the start */ }
  expect(Array.from(copy.board)).toEqual(Array.from(new GoGame(cfg).board));
  expect(copy.captures[BLACK] + copy.captures[WHITE]).toBe(0);
  return moves;
}

describe('engine vs independent reference (differential fuzz)', () => {
  it('9×9, positional superko: 60 random games agree move-for-move', () => {
    let total = 0;
    for (let seed = 1; seed <= 60; seed++) total += playOne(9, true, seed * 7919, 220);
    expect(total).toBeGreaterThan(3000);
  });
  it('9×9, basic ko: 60 random games agree move-for-move', () => {
    for (let seed = 1; seed <= 60; seed++) playOne(9, false, seed * 104729, 220);
  });
  it('13×13: 8 random games agree (captures, ko, scoring)', () => {
    for (let seed = 1; seed <= 8; seed++) playOne(13, seed % 2 === 0, seed * 15485863, 260);
  });
  it('19×19: 2 random games agree', () => {
    for (let seed = 1; seed <= 2; seed++) playOne(19, true, seed * 32452843, 200);
  });
  it('PASS is never accepted as a board point and out-of-range input is rejected', () => {
    const g = new GoGame(makeConfig({ size: 9 }));
    for (const bad of [PASS, 81, 1e9, NaN, -0.5]) expect(g.play(bad as number).ok).toBe(false);
    expect(g.moveNumber).toBe(0);
  });
});
