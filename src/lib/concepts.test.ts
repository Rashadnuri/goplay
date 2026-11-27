import { describe, expect, it } from 'vitest';
import { BLACK, GoGame, makeConfig } from '../engine/index.ts';
import { conceptsFor, describeMove } from './concepts.ts';

const pad = (rows: string[]) => [...rows, ...Array(9 - rows.length).fill('.........')].map((r) => r.padEnd(9, '.'));
const P = (x: number, y: number) => y * 9 + x;
const pos = (rows: string[]) => GoGame.fromPosition(makeConfig({ size: 9 }), pad(rows), BLACK);

describe('mistake concepts (derived from the position, not guessed)', () => {
  it('missed capture: the AI move captures, the played move does not', () => {
    const g = pos(['.XO', 'XO.O', '.XO']);   // classic shape: Black captures at (2,1)
    const c = conceptsFor(g, P(8, 8), P(2, 1), 30);
    expect(c.map((x) => x.key)).toContain('concept.missedCapture');
    expect(c.find((x) => x.key === 'concept.missedCapture')).toMatchObject({ confidence: 'fact', params: { n: 1 } });
  });
  it('self-atari: a move that leaves its own stone with a single liberty', () => {
    const g = pos(['.O']);   // Black plays the corner next to a White stone: liberties = {(0,1)}
    const c = conceptsFor(g, P(0, 0), P(4, 4), 40).map((x) => x.key);
    expect(c).toContain('concept.selfAtari');
    // …and a healthy move is not flagged
    expect(conceptsFor(g, P(4, 4), P(4, 4), 40).map((x) => x.key)).not.toContain('concept.selfAtari');
  });
  it('ignored atari: own group in atari and the move elsewhere does not save it', () => {
    const g = pos(['', '', '', '....O', '...OXO']);   // black (4,4) in atari
    const c = conceptsFor(g, P(0, 0), P(4, 5), 20).map((x) => x.key);
    expect(c).toContain('concept.ignoredAtari');
    expect(c.length).toBeLessThanOrEqual(2);
  });
  it('edge-early is flagged as a heuristic, never as a fact', () => {
    const g = pos(['']);
    const c = conceptsFor(g, P(0, 4), P(4, 4), 5);
    const e = c.find((x) => x.key === 'concept.edgeEarly');
    expect(e?.confidence).toBe('heuristic');
  });
  it('falls back to an explicitly labelled AI estimate when nothing factual applies', () => {
    const c = conceptsFor(pos(['']), P(4, 4), P(2, 2), 60);
    expect(c).toEqual([{ key: 'concept.strongerMove', confidence: 'estimate' }]);
  });
  it('describeMove reports passes, captures and plain moves', () => {
    expect(describeMove(1, -1, 0, '').key).toBe('event.pass');
    expect(describeMove(2, 40, 3, 'E5')).toMatchObject({ key: 'event.capture', params: { n: 3 } });
    expect(describeMove(1, 40, 0, 'E5').key).toBe('event.play');
  });
});
