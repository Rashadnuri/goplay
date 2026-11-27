import { EMPTY, floodGroup, other, type Color, type GoGame } from '../engine/index.ts';
import type { DictKey } from '../i18n/az.ts';

/** `fact` = derived from the rules engine on the real position (exact). `heuristic` = a rule of thumb. `estimate` = relies on the AI's evaluation. */
export type Confidence = 'fact' | 'heuristic' | 'estimate';
export interface Concept { key: DictKey; confidence: Confidence; params?: Record<string, number> }

const atariGroupsOf = (g: GoGame, color: Color) => {
  const out: { stones: number[]; libs: number[] }[] = [];
  const seen = new Set<number>();
  for (let p = 0; p < g.board.length; p++) {
    if (g.board[p] !== color || seen.has(p)) continue;
    const grp = floodGroup(g.board, g.size, p);
    grp.stones.forEach((s) => seen.add(s));
    if (grp.liberties.length === 1) out.push({ stones: grp.stones, libs: grp.liberties });
  }
  return out;
};

/**
 * Explains a mistake using only things that can be checked on the board.
 * `before` is the position before the move; `played`/`best` are point indexes (−1 = pass).
 */
export function conceptsFor(before: GoGame, played: number, best: number | undefined, moveNumber: number): Concept[] {
  const me = before.toPlay;
  const out: Concept[] = [];
  const size = before.size;
  const mineAtari = atariGroupsOf(before, me);
  let after: GoGame | null = null;
  let playedCaptures = 0;
  if (played >= 0) { const t = before.clone(); const r = t.play(played); if (r.ok) { after = t; playedCaptures = r.record.captured.length; } }

  // 1. own group was in atari and the move did not rescue it
  if (mineAtari.length && after) {
    const stillIn = mineAtari.some((g) => after!.board[g.stones[0]] === me && floodGroup(after!.board, size, g.stones[0]).liberties.length <= 1);
    if (stillIn) out.push({ key: 'concept.ignoredAtari', confidence: 'fact' });
  }
  // 2. self-atari: the played stone's group has one liberty left (and nothing was captured)
  if (after && playedCaptures === 0 && floodGroup(after.board, size, played).liberties.length === 1) out.push({ key: 'concept.selfAtari', confidence: 'fact' });
  // 3. a capture was available with the AI's move
  if (best !== undefined && best >= 0 && playedCaptures === 0) {
    const t = before.clone(); const r = t.play(best);
    if (r.ok && r.record.captured.length > 0) out.push({ key: 'concept.missedCapture', confidence: 'fact', params: { n: r.record.captured.length } });
    else if (r.ok) {
      // 4. the AI's move rescues a group in atari
      const saved = mineAtari.some((g) => t.board[g.stones[0]] === me && floodGroup(t.board, size, g.stones[0]).liberties.length >= 2);
      if (saved && !out.some((c) => c.key === 'concept.ignoredAtari')) out.push({ key: 'concept.missedSave', confidence: 'fact' });
      // 5. the AI's move threatens an enemy group (atari)
      const before1 = atariGroupsOf(before, other(me)).length;
      if (atariGroupsOf(t, other(me)).length > before1) out.push({ key: 'concept.missedAtari', confidence: 'fact' });
    }
  }
  // 6. first-line move early in the game
  if (played >= 0 && moveNumber <= (size === 9 ? 16 : 40)) {
    const x = played % size, y = Math.floor(played / size);
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) out.push({ key: 'concept.edgeEarly', confidence: 'heuristic' });
  }
  if (!out.length) out.push({ key: 'concept.strongerMove', confidence: 'estimate' });
  return out.slice(0, 2);
}

export interface MoveEvent { key: DictKey; params: Record<string, number | string> }
/** Factual one-line description of a move (used for spectators and replays; nothing speculative). */
export function describeMove(color: Color, p: number, captured: number, label: string): MoveEvent {
  if (p < 0) return { key: 'event.pass', params: { who: color } };
  if (captured > 0) return { key: 'event.capture', params: { who: color, n: captured, pt: label } };
  return { key: 'event.play', params: { who: color, pt: label } };
}
export { EMPTY };
