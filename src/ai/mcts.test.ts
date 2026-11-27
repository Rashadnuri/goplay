import { describe, expect, it } from 'vitest';
import { GoGame, makeConfig } from '../engine/index.ts';
import { Mcts, mcMove, type McPosition } from './mcts.ts';

const pos = (moves: number[], size: 9 | 13 = 9): McPosition => ({ size, komi: 7, rules: 'chinese', handicap: 0, moves });

describe('built-in MCTS engine', () => {
  it('only ever proposes legal moves', () => {
    const g = new GoGame(makeConfig({ size: 9, komi: 7, rules: 'chinese' }));
    for (let i = 0; i < 30 && g.phase === 'playing'; i++) {
      const m = mcMove(pos(g.history.map((h) => h.p)), 'beginner', i + 1);
      if (m.move.type === 'play') { expect(g.play(m.move.p).ok, `move ${i}`).toBe(true); } else g.pass();
    }
  });
  it('is deterministic for a seed', () => {
    const a = mcMove(pos([40, 41]), 'easy', 7), b = mcMove(pos([40, 41]), 'easy', 7);
    expect(a).toEqual(b);
  });
  it('analysis returns sane numbers', () => {
    const r = new Mcts(pos([])).run({ maxPlayouts: 100, maxMs: 2000, wantOwnership: true });
    expect(r.winrate).toBeGreaterThanOrEqual(0); expect(r.winrate).toBeLessThanOrEqual(1);
    expect(r.ownership).toHaveLength(81);
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});
