import { describe, expect, it } from 'vitest';
import { BLACK, GoGame, WHITE, makeConfig } from './index.ts';
import { enclosure, lifeDeathSearch, solutions } from './puzzles.ts';

const shape = (eye: [number, number][], toPlay: 1 | 2) => {
  const { rows, region, target } = enclosure(9, eye);
  return { g: GoGame.fromPosition(makeConfig({ size: 9 }), rows, toPlay), region, target };
};
const P = (x: number, y: number) => y * 9 + x;

describe('life & death solver (exhaustive search) agrees with established Go theory', () => {
  it('straight three: the middle point is the only way to live or to kill', () => {
    const live = shape([[1, 0], [2, 0], [3, 0]], BLACK);
    expect(lifeDeathSearch(live.g, live.target, live.region, BLACK).winning).toEqual([P(2, 0)]);
    const kill = shape([[1, 0], [2, 0], [3, 0]], WHITE);
    expect(lifeDeathSearch(kill.g, kill.target, kill.region, WHITE).winning).toEqual([P(2, 0)]);
  });
  it('two-space eye is dead even with the defender to move; square four is dead', () => {
    for (const eye of [[[1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]]] as [number, number][][]) {
      const s = shape(eye, BLACK);
      expect(lifeDeathSearch(s.g, s.target, s.region, BLACK).winning).toEqual([]);
    }
  });
  it('straight four is alive even if the attacker moves first', () => {
    const s = shape([[1, 0], [2, 0], [3, 0], [4, 0]], WHITE);
    expect(lifeDeathSearch(s.g, s.target, s.region, WHITE).winning).toEqual([]);
  });
  it('bent three: vital point is the corner; T-four and cross-five: the centre', () => {
    const b = shape([[0, 0], [1, 0], [0, 1]], BLACK); expect(lifeDeathSearch(b.g, b.target, b.region, BLACK).winning).toEqual([P(0, 0)]);
    const t = shape([[1, 0], [2, 0], [3, 0], [2, 1]], BLACK); expect(lifeDeathSearch(t.g, t.target, t.region, BLACK).winning).toEqual([P(2, 0)]);
    const c = shape([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], BLACK); expect(lifeDeathSearch(c.g, c.target, c.region, BLACK).winning).toEqual([P(1, 1)]);
  });
  it('flags positions that contain a ko so they are never used as puzzles', () => {
    const s = shape([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], BLACK); // bulky five fight involves ko
    expect(lifeDeathSearch(s.g, s.target, s.region, BLACK).hasKo).toBe(true);
    expect(() => solutions(s.g, { kind: 'lifeDeath', target: s.target, region: s.region, role: 'live' })).toThrow(/ko/);
  });
});

describe('tactical predicates', () => {
  const pad = (rows: string[]) => [...rows, ...Array(9 - rows.length).fill('.........')].map((r) => r.padEnd(9, '.'));
  it('capture finds only capturing moves', () => {
    const g = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['....X', '...XOX']), BLACK);
    expect(solutions(g, { kind: 'capture' })).toEqual([P(4, 2)]);
  });
  it('double atari requires two NEW atari groups and a safe stone', () => {
    const g = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['', '', '..X.X', '.XO.OX']), BLACK);
    expect(solutions(g, { kind: 'doubleAtari' })).toEqual([P(3, 3)]);
  });
  it('escape needs 3+ liberties for the rescued group, connect merges two groups', () => {
    const e = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['', '', '', '....O', '...OXO']), BLACK);
    expect(solutions(e, { kind: 'escape', target: P(4, 4) })).toEqual([P(4, 5)]);
    const c = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['', '', '', '....O', '...X.X', '....O']), BLACK);
    expect(solutions(c, { kind: 'connect', a: P(3, 4), b: P(5, 4) })).toEqual([P(4, 4)]);
  });
});
