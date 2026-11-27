import { BLACK, EMPTY, floodGroup, type Color, type GoGame } from '../engine/index.ts';
import type { DictKey } from '../i18n/az.ts';

export interface Tip { key: DictKey; params?: Record<string, number>; tone: 'info' | 'warn' | 'good' }

/** Beginner coaching derived from the real position (no guessing): what just happened and what to watch out for. */
export function coachTips(game: GoGame, me: Color | null): Tip[] {
  const tips: Tip[] = [];
  const last = game.lastMove;
  if (game.phase === 'scoring') return [{ key: 'coach.scoring', tone: 'info' }];
  if (game.phase === 'finished') return [];
  if (game.moveNumber === 0) tips.push({ key: 'coach.first', tone: 'info' });
  if (last && last.p === -1) tips.push({ key: 'coach.passed', tone: 'info' });
  if (last && last.captured.length > 0) tips.push({ key: 'coach.captured', params: { n: last.captured.length }, tone: 'good' });
  if (game.koPoint >= 0) tips.push({ key: 'coach.ko', tone: 'warn' });
  // groups in atari (exactly one liberty)
  const seen = new Set<number>();
  let mineAtari = 0, theirsAtari = 0;
  for (let p = 0; p < game.board.length; p++) {
    if (game.board[p] === EMPTY || seen.has(p)) continue;
    const g = floodGroup(game.board, game.size, p);
    g.stones.forEach((s) => seen.add(s));
    if (g.liberties.length === 1) {
      const mineColor = me ?? game.toPlay;
      if (g.color === mineColor) mineAtari++; else theirsAtari++;
    }
  }
  if (mineAtari) tips.push({ key: 'coach.atariMine', tone: 'warn' });
  if (theirsAtari) tips.push({ key: 'coach.atariTheirs', tone: 'good' });
  if (!tips.length) tips.push({ key: game.moveNumber < 8 ? 'coach.opening' : 'coach.middle', tone: 'info' });
  return tips.slice(0, 3);
}
export { BLACK };
