import type { GoGame } from './game.ts';
import { neighborsOf } from './game.ts';
import { BLACK, WHITE, EMPTY, type Color, type ScoreResult } from './types.ts';

/**
 * Scores a position.
 *  - chinese  (area):      stones + territory (+ komi for White)
 *  - japanese (territory): territory + prisoners (captured + dead stones) (+ komi for White)
 * `dead` lists points of stones agreed dead; they are removed before counting.
 * Regions touching both colours (seki / dame) score for nobody.
 */
export function scoreBoard(game: GoGame, dead: Iterable<number> = []): ScoreResult {
  const size = game.size;
  const b = game.board.slice();
  const deadSet = new Set<number>();
  for (const p of dead) if (p >= 0 && p < b.length && b[p] !== EMPTY) deadSet.add(p);
  let deadBlack = 0;
  let deadWhite = 0;
  for (const p of deadSet) {
    if (b[p] === BLACK) deadBlack++;
    else deadWhite++;
    b[p] = EMPTY;
  }

  const territory = new Uint8Array(b.length);
  const neutral: number[] = [];
  const seen = new Uint8Array(b.length);
  let blackTerritory = 0;
  let whiteTerritory = 0;
  let blackStones = 0;
  let whiteStones = 0;

  for (let p = 0; p < b.length; p++) {
    if (b[p] === BLACK) blackStones++;
    else if (b[p] === WHITE) whiteStones++;
  }

  for (let start = 0; start < b.length; start++) {
    if (b[start] !== EMPTY || seen[start]) continue;
    const region: number[] = [];
    let touchB = false;
    let touchW = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      region.push(p);
      for (const n of neighborsOf(p, size)) {
        const v = b[n];
        if (v === EMPTY) {
          if (!seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        } else if (v === BLACK) touchB = true;
        else touchW = true;
      }
    }
    if (touchB && !touchW) {
      blackTerritory += region.length;
      for (const p of region) territory[p] = BLACK;
    } else if (touchW && !touchB) {
      whiteTerritory += region.length;
      for (const p of region) territory[p] = WHITE;
    } else {
      neutral.push(...region);
    }
  }

  const komi = game.config.komi;
  const rules = game.config.rules;
  const blackPrisoners = game.captures[BLACK] + deadWhite;
  const whitePrisoners = game.captures[WHITE] + deadBlack;

  let black: number;
  let white: number;
  if (rules === 'chinese') {
    black = blackStones + blackTerritory;
    white = whiteStones + whiteTerritory + komi;
  } else {
    black = blackTerritory + blackPrisoners;
    white = whiteTerritory + whitePrisoners + komi;
  }
  const diff = black - white;
  const winner: Color | null = diff > 0 ? BLACK : diff < 0 ? WHITE : null;
  return {
    black,
    white,
    blackTerritory,
    whiteTerritory,
    blackStones,
    whiteStones,
    blackPrisoners,
    whitePrisoners,
    komi,
    rules,
    neutral,
    territory,
    winner,
    margin: Math.abs(diff),
  };
}
