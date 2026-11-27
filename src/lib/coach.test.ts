import { describe, expect, it } from 'vitest';
import { BLACK, GoGame, makeConfig } from '../engine/index.ts';
import { coachTips } from './coach.ts';

const pad = (r: string[]) => [...r, ...Array(9 - r.length).fill('.........')].map((x) => x.padEnd(9, '.'));
describe('coach', () => {
  it('greets an empty board', () => expect(coachTips(new GoGame(makeConfig({ size: 9 })), BLACK)[0].key).toBe('coach.first'));
  it('warns about own atari and flags the opponent atari', () => {
    const g = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['XO', 'O']), BLACK); // black corner stone in atari? libs: none... use real atari
    const a = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['.O', 'XO', '.O']), BLACK); // black (0,1): libs (0,0),(0,2) → 2
    expect(coachTips(a, BLACK).some((t) => t.key === 'coach.atariMine')).toBe(false);
    const b = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['XO', '.O']), BLACK); // black (0,0): lib (0,1) only
    expect(coachTips(b, BLACK).some((t) => t.key === 'coach.atariMine')).toBe(true);
    expect(coachTips(b, 2).some((t) => t.key === 'coach.atariTheirs')).toBe(true);
    expect(g).toBeTruthy();
  });
  it('reports captures', () => {
    const g = GoGame.fromPosition(makeConfig({ size: 9 }), pad(['.X', 'XO', '.X']), BLACK);
    g.play(2 + 9);
    expect(coachTips(g, BLACK).find((t) => t.key === 'coach.captured')?.params?.n).toBe(1);
  });
});
