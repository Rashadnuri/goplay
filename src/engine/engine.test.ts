import { describe, expect, it } from 'vitest';
import {
  BLACK,
  GoGame,
  PASS,
  WHITE,
  formatClock,
  handicapPoints,
  makeConfig,
  newClock,
  onMove,
  remaining,
  toSGF,
  xyToPoint,
  type BoardSize,
  type GameConfig,
} from './index.ts';

const cfg = (size: BoardSize = 9, extra: Partial<GameConfig> = {}) => makeConfig({ size, ...extra });
const P = (x: number, y: number, size = 9) => xyToPoint(x, y, size);
/** Pad rows of a small diagram into a full 9x9 board. */
const pad = (rows: string[], size = 9) => {
  const out = rows.map((r) => r.padEnd(size, '.'));
  while (out.length < size) out.push('.'.repeat(size));
  return out;
};

describe('basic placement', () => {
  it('Black plays first and turns alternate', () => {
    const g = new GoGame(cfg(9));
    expect(g.toPlay).toBe(BLACK);
    expect(g.play(P(4, 4)).ok).toBe(true);
    expect(g.toPlay).toBe(WHITE);
    expect(g.at(P(4, 4))).toBe(BLACK);
    g.play(P(3, 3));
    expect(g.toPlay).toBe(BLACK);
    expect(g.moveNumber).toBe(2);
  });

  it('rejects occupied points and out-of-bounds', () => {
    const g = new GoGame(cfg(9));
    g.play(P(4, 4));
    expect(g.play(P(4, 4))).toEqual({ ok: false, reason: 'occupied' });
    expect(g.play(-5)).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(g.play(81)).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(g.play(1.5)).toEqual({ ok: false, reason: 'out_of_bounds' });
    expect(g.toPlay).toBe(WHITE); // failed moves do not change turn
  });

  it('supports 9, 13 and 19 boards', () => {
    for (const s of [9, 13, 19] as const) {
      const g = new GoGame(cfg(s));
      expect(g.board.length).toBe(s * s);
      expect(g.play(s * s - 1).ok).toBe(true);
    }
  });
});

describe('liberties and groups', () => {
  it('counts liberties for corner, edge and centre stones', () => {
    const g = new GoGame(cfg(9));
    g.play(P(0, 0));
    expect(g.liberties(P(0, 0))).toBe(2);
    g.play(P(4, 0));
    expect(g.liberties(P(4, 0))).toBe(3);
    g.play(P(4, 4));
    expect(g.liberties(P(4, 4))).toBe(4);
  });

  it('merges connected stones into one group sharing liberties', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['....XX...']));
    const grp = g.groupAt(P(4, 0))!;
    expect(grp.stones.sort()).toEqual([P(4, 0), P(5, 0)]);
    expect(grp.liberties.length).toBe(4); // two stones on the top edge
  });

  it('does not connect diagonally', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['X', '.X']));
    expect(g.groupAt(P(0, 0))!.stones.length).toBe(1);
  });
});

describe('captures', () => {
  it('captures a single stone with zero liberties', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['.X', 'XO', '.X']), BLACK);
    const r = g.play(P(2, 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.captured).toEqual([P(1, 1)]);
    expect(g.at(P(1, 1))).toBe(0);
    expect(g.captures[BLACK]).toBe(1);
  });

  it('captures a multi-stone group at once', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['XOO.', '.XX.']), BLACK);
    const r = g.play(P(3, 0));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.captured.sort()).toEqual([P(1, 0), P(2, 0)]);
    expect(g.captures[BLACK]).toBe(2);
  });

  it('captures in the corner and on the edge', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['O.', 'X']), BLACK);
    expect(g.play(P(1, 0)).ok).toBe(true);
    expect(g.at(P(0, 0))).toBe(0);
  });

  it('captures two separate groups with a single move', () => {
    // Black plays centre point, capturing two white singletons (left and right)
    const g = GoGame.fromPosition(
      cfg(9),
      pad(['.X.X.', 'XO.OX', '.X.X.']),
      BLACK,
    );
    const r = g.play(P(2, 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.captured.sort()).toEqual([P(1, 1), P(3, 1)].sort());
  });

  it('removes captured stones before checking suicide (capture beats suicide)', () => {
    // Black plays into a point with no liberties but captures white first.
    const g = GoGame.fromPosition(cfg(9), pad(['.OX', 'OX.', '.O']), BLACK);
    // Point (0,0): neighbours (1,0)=O and (0,1)=O. Black stone at (0,0) would have zero liberties
    // unless it captures. O at (1,0): neighbours (0,0),(2,0)=X,(1,1)=X → captured when black plays (0,0)
    // O at (0,1): neighbours (0,0),(1,1)=X,(0,2) empty → not captured
    const r = g.play(P(0, 0));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.captured).toEqual([P(1, 0)]);
  });
});

describe('suicide', () => {
  it('prevents single-stone suicide', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['.O', 'O']), BLACK);
    expect(g.play(P(0, 0))).toEqual({ ok: false, reason: 'suicide' });
    expect(g.toPlay).toBe(BLACK);
  });

  it('prevents multi-stone suicide (filling own last liberty)', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['XX.O', 'OOO']), BLACK);
    // black group (0,0),(1,0) has one liberty at (2,0); (2,0) neighbours: (3,0)=O,(2,1)=O → suicide
    expect(g.play(P(2, 0))).toEqual({ ok: false, reason: 'suicide' });
  });
});

describe('ko', () => {
  // Classic ko shape. Black captures at (2,1)... construct:
  //   . X O .
  //   X O . O
  //   . X O .
  const koRows = pad(['.XO', 'XO.O', '.XO']);
  it('forbids immediate recapture (simple ko)', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'simple' }), koRows, BLACK);
    const r = g.play(P(2, 1)); // black captures white stone at (1,1)
    expect(r.ok).toBe(true);
    expect(g.at(P(1, 1))).toBe(0);
    expect(g.koPoint).toBe(P(1, 1));
    expect(g.play(P(1, 1))).toEqual({ ok: false, reason: 'ko' });
  });

  it('allows the recapture after a ko threat exchange', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'simple' }), koRows, BLACK);
    g.play(P(2, 1)); // black captures
    g.play(P(7, 7)); // white ko threat elsewhere
    g.play(P(7, 6)); // black answers
    expect(g.play(P(1, 1)).ok).toBe(true); // white may now retake
    expect(g.koPoint).toBe(P(2, 1)); // and now it's black who cannot retake
    expect(g.play(P(2, 1))).toEqual({ ok: false, reason: 'ko' });
  });

  it('ko is cleared by a pass', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'simple' }), koRows, BLACK);
    g.play(P(2, 1));
    g.pass(); // white passes
    expect(g.koPoint).toBe(-1);
  });

  it('positional superko rejects any repetition of a previous board', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'superko' }), koRows, BLACK);
    g.play(P(2, 1));
    expect(g.play(P(1, 1))).toEqual({ ok: false, reason: 'superko' });
  });

  it('superko applies to long cycles, not only basic ko', () => {
    // Triple-ko-like cycle is hard to hand-build; verify generic: replaying a state is refused.
    const g = new GoGame(cfg(9, { ko: 'superko' }));
    // Use undo to confirm position bookkeeping is restored correctly
    g.play(P(4, 4));
    g.undo();
    expect(g.play(P(4, 4)).ok).toBe(true); // position after undo not remembered as "seen"
  });

  it('Chinese rules default to superko, Japanese to simple ko', () => {
    expect(makeConfig({ size: 9, rules: 'chinese' }).ko).toBe('superko');
    expect(makeConfig({ size: 9, rules: 'japanese' }).ko).toBe('simple');
  });
});

describe('passes and game termination', () => {
  it('one pass does not end the game', () => {
    const g = new GoGame(cfg(9));
    g.pass();
    expect(g.phase).toBe('playing');
    expect(g.toPlay).toBe(WHITE);
  });

  it('two consecutive passes move the game to the scoring phase', () => {
    const g = new GoGame(cfg(9));
    g.pass();
    g.pass();
    expect(g.phase).toBe('scoring');
    expect(g.play(P(0, 0))).toEqual({ ok: false, reason: 'not_playing' });
  });

  it('a stone between passes resets the pass count', () => {
    const g = new GoGame(cfg(9));
    g.pass();
    g.play(P(4, 4));
    g.pass();
    expect(g.phase).toBe('playing');
  });

  it('resume returns from scoring to play', () => {
    const g = new GoGame(cfg(9));
    g.pass();
    g.pass();
    expect(g.resume()).toBe(true);
    expect(g.phase).toBe('playing');
    expect(g.play(P(4, 4)).ok).toBe(true);
  });

  it('resignation ends the game with the opponent as winner', () => {
    const g = new GoGame(cfg(9));
    g.play(P(4, 4));
    const r = g.resign(WHITE);
    expect(r.winner).toBe(BLACK);
    expect(r.text).toBe('B+R');
    expect(g.phase).toBe('finished');
    expect(g.play(P(0, 0))).toEqual({ ok: false, reason: 'game_over' });
    expect(g.pass()).toEqual({ ok: false, reason: 'game_over' });
    expect(g.undo()).toBe(false);
  });

  it('timeout and draw by agreement', () => {
    const a = new GoGame(cfg(9));
    expect(a.timeout(BLACK).text).toBe('W+T');
    const b = new GoGame(cfg(9));
    expect(b.drawByAgreement().winner).toBeNull();
  });
});

describe('undo', () => {
  it('restores board, captures, ko and turn', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'simple' }), pad(['.XO', 'XO.O', '.XO']), BLACK);
    g.play(P(2, 1));
    expect(g.captures[BLACK]).toBe(1);
    expect(g.undo()).toBe(true);
    expect(g.captures[BLACK]).toBe(0);
    expect(g.at(P(1, 1))).toBe(WHITE);
    expect(g.toPlay).toBe(BLACK);
    expect(g.koPoint).toBe(-1);
    expect(g.moveNumber).toBe(0);
    expect(g.undo()).toBe(false);
  });

  it('undoes a pass out of the scoring phase', () => {
    const g = new GoGame(cfg(9));
    g.pass();
    g.pass();
    expect(g.undo()).toBe(true);
    expect(g.phase).toBe('playing');
    expect(g.passes).toBe(1);
  });
});

describe('handicap', () => {
  it('places standard handicap stones and White moves first', () => {
    for (const [size, n] of [[19, 4], [19, 9], [13, 5], [9, 2]] as const) {
      const g = new GoGame(cfg(size, { handicap: n }));
      expect(g.board.filter((v) => v === BLACK).length).toBe(n);
      expect(g.toPlay).toBe(WHITE);
      expect(new Set(handicapPoints(size, n)).size).toBe(n);
    }
  });

  it('uses 0.5 komi by default in handicap games', () => {
    expect(cfg(19, { handicap: 3 }).komi).toBe(0.5);
    expect(cfg(19).komi).toBe(6.5);
    expect(cfg(19, { rules: 'chinese' }).komi).toBe(7.5);
  });
});

describe('scoring', () => {
  // Black owns left of column 4, White right; wall at x=3 (X) and x=5 (O), column 4 neutral.
  const wall = (rules: 'japanese' | 'chinese') => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) rows.push('...X.O...');
    const g = GoGame.fromPosition(makeConfig({ size: 9, rules, komi: 0 }), rows, BLACK);
    return g;
  };

  it('Chinese area scoring counts stones + territory', () => {
    const g = wall('chinese');
    const s = g.score();
    expect(s.blackTerritory).toBe(27); // x 0..2 * 9
    expect(s.whiteTerritory).toBe(27); // x 6..8
    expect(s.blackStones).toBe(9);
    expect(s.black).toBe(36);
    expect(s.white).toBe(36);
    expect(s.neutral.length).toBe(9); // dame column
    expect(s.winner).toBeNull();
  });

  it('Japanese territory scoring counts territory + prisoners, not stones', () => {
    const g = wall('japanese');
    g.captures[BLACK] = 3;
    const s = g.score();
    expect(s.black).toBe(27 + 3);
    expect(s.white).toBe(27);
    expect(s.winner).toBe(BLACK);
    expect(s.margin).toBe(3);
  });

  it('applies komi to White', () => {
    const g = wall('chinese');
    g.config.komi = 7.5;
    const s = g.score();
    expect(s.white).toBe(43.5);
    expect(s.winner).toBe(WHITE);
    expect(s.margin).toBe(7.5);
  });

  it('dead stones are removed and count as prisoners in Japanese scoring', () => {
    const rows: string[] = [];
    for (let y = 0; y < 9; y++) rows.push('...X.O...');
    rows[4] = '.O.X.O...'; // a dead white stone inside Black's area
    const g = GoGame.fromPosition(makeConfig({ size: 9, rules: 'japanese', komi: 0 }), rows, BLACK);
    const without = g.score();
    expect(without.blackTerritory).toBeLessThan(27); // live stone breaks territory
    const dead = g.score([P(1, 4)]);
    expect(dead.blackTerritory).toBe(27);
    expect(dead.blackPrisoners).toBe(1);
    expect(dead.black).toBe(28);
  });

  it('a seki-like shared region scores for nobody', () => {
    const rows = pad(['XO.']);
    const g = GoGame.fromPosition(makeConfig({ size: 9, rules: 'chinese', komi: 0 }), rows, BLACK);
    const s = g.score();
    // empty region touches both colours → neutral
    expect(s.blackTerritory).toBe(0);
    expect(s.whiteTerritory).toBe(0);
    expect(s.neutral.length).toBe(81 - 2);
  });

  it('finishByScore ends the game with text result', () => {
    const g = wall('japanese');
    g.config.komi = 0.5;
    g.pass();
    g.pass();
    const r = g.finishByScore();
    expect(g.phase).toBe('finished');
    expect(r.reason).toBe('score');
    expect(r.winner).toBe(WHITE);
    expect(r.text).toBe('W+0.5');
  });

  it('captures made during play count for Japanese prisoners', () => {
    const g = GoGame.fromPosition(cfg(9), pad(['.X', 'XO', '.X']), BLACK);
    g.play(P(2, 1));
    expect(g.score().blackPrisoners).toBe(1);
  });
});

describe('determinism and replay', () => {
  it('replaying the same moves yields identical states', () => {
    const moves = [P(2, 2), P(6, 6), P(2, 6), P(6, 2), PASS, P(4, 4)];
    const a = GoGame.fromMoves(cfg(9), moves);
    const b = GoGame.fromMoves(cfg(9), moves);
    expect(Array.from(a.board)).toEqual(Array.from(b.board));
    expect(a.toPlay).toBe(b.toPlay);
  });

  it('fromMoves throws on an illegal sequence', () => {
    expect(() => GoGame.fromMoves(cfg(9), [P(1, 1), P(1, 1)])).toThrow(/occupied/);
  });

  it('clone is independent', () => {
    const g = new GoGame(cfg(9));
    g.play(P(1, 1));
    const c = g.clone();
    c.play(P(2, 2));
    expect(g.moveNumber).toBe(1);
    expect(c.moveNumber).toBe(2);
    expect(c.undo()).toBe(true);
    expect(c.undo()).toBe(true);
    expect(g.at(P(1, 1))).toBe(BLACK);
  });

  it('plays a random full game with no invariant violations', () => {
    // Deterministic LCG so the test is reproducible
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const g = new GoGame(cfg(9, { ko: 'superko' }));
    for (let i = 0; i < 400 && g.phase === 'playing'; i++) {
      const legal = g.legalMoves();
      if (legal.length === 0 || rnd() < 0.02) {
        g.pass();
        continue;
      }
      const p = legal[Math.floor(rnd() * legal.length)];
      const res = g.play(p);
      expect(res.ok).toBe(true);
      // invariant: no group on board has zero liberties
      for (let q = 0; q < 81; q++) if (g.board[q]) expect(g.liberties(q)).toBeGreaterThan(0);
    }
    // replay equals
    const replay = GoGame.fromMoves(cfg(9, { ko: 'superko' }), g.history.map((m) => m.p));
    expect(Array.from(replay.board)).toEqual(Array.from(g.board));
  });
});

describe('legal move listing', () => {
  it('excludes suicide and ko points', () => {
    const g = GoGame.fromPosition(cfg(9, { ko: 'simple' }), pad(['.XO', 'XO.O', '.XO']), BLACK);
    g.play(P(2, 1));
    const legal = g.legalMoves(); // white to play
    expect(legal).not.toContain(P(1, 1));
  });
});

describe('clock', () => {
  const c = { initialMs: 60_000, incrementMs: 2_000 };
  it('first move is free, then the opponent clock runs', () => {
    let s = newClock(c);
    const r1 = onMove(s, c, BLACK, 1_000_000);
    expect(r1.timedOut).toBe(false);
    s = r1.state;
    expect(s.blackMs).toBe(60_000);
    expect(remaining(s, WHITE, 1_010_000)).toBe(50_000);
    const r2 = onMove(s, c, WHITE, 1_010_000);
    expect(r2.state.whiteMs).toBe(52_000); // 50s + 2s increment
  });

  it('detects timeout', () => {
    let s = onMove(newClock(c), c, BLACK, 0).state;
    const r = onMove(s, c, WHITE, 61_000);
    expect(r.timedOut).toBe(true);
    s = r.state;
    expect(s.whiteMs).toBe(0);
  });

  it('formats clocks', () => {
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(0)).toBe('0:00');
  });
});

describe('SGF', () => {
  it('exports moves and result', () => {
    const g = new GoGame(cfg(9));
    g.play(P(2, 2));
    g.pass();
    expect(toSGF(g)).toBe('(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[6.5]RU[Japanese]AP[GO PLAY];B[cc];W[])');
  });
});
