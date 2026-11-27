import { describe, expect, it } from 'vitest';
import { GoGame, makeConfig, BLACK } from '../engine/index.ts';
import { LESSONS } from './lessons.ts';
import type { Exercise } from '../lib/types.ts';

const build = (e: Exercise) => GoGame.fromPosition(makeConfig({ size: e.size }), e.rows, e.toPlay ?? BLACK);

function checkExercise(e: Exercise, where: string) {
  expect(e.rows.length, where).toBe(e.size);
  e.rows.forEach((r) => expect(r.length, where).toBe(e.size));
  const g = build(e);
  const goal = e.goal;
  if (goal.type === 'point') {
    expect(goal.points.length, where).toBeGreaterThan(0);
    for (const p of goal.points) expect(g.isLegal(p), `${where}: point ${p} must be legal`).toBe(true);
  }
  if (goal.type === 'capture') {
    const min = goal.min ?? 1;
    const solutions = g.legalMoves().filter((p) => { const r = g.checkMove(p); return r.ok && r.record.captured.length >= min; });
    expect(solutions.length, `${where}: needs at least one capturing move`).toBeGreaterThan(0);
  }
  if (goal.type === 'place') {
    for (const p of goal.points) expect(g.at(p), `${where}: place point must be empty`).toBe(0);
  }
  if (goal.type === 'quiz') {
    expect(goal.correct).toBeGreaterThanOrEqual(0);
    expect(goal.correct).toBeLessThan(goal.options.length);
  }
}

const hasAll = (o: Record<string, string>) => ['az', 'en', 'ru'].every((l) => typeof o[l] === 'string' && o[l].trim().length > 0);

describe('bundled learning content', () => {
  it('covers the required curriculum', () => {
    const slugs = LESSONS.map((l) => l.slug);
    for (const s of ['intro', 'board-stones', 'liberties', 'capturing', 'groups', 'life-death', 'ko', 'territory', 'opening', 'tactics']) expect(slugs).toContain(s);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every lesson, step and exercise is available in az, en and ru', () => {
    for (const l of LESSONS) {
      expect(hasAll(l.title as any), l.slug).toBe(true);
      expect(hasAll(l.summary as any), l.slug).toBe(true);
      l.steps.forEach((s, i) => {
        expect(hasAll(s.text as any), `${l.slug}#${i}`).toBe(true);
        const ex = s.exercise;
        if (ex?.hint) expect(hasAll(ex.hint as any)).toBe(true);
        if (ex?.success) expect(hasAll(ex.success as any)).toBe(true);
        if (ex?.goal.type === 'quiz') {
          expect(hasAll(ex.goal.question as any)).toBe(true);
          ex.goal.options.forEach((o) => expect(hasAll(o as any)).toBe(true));
        }
      });
    }
  });

  it('every exercise is solvable with the real rules engine', () => {
    for (const l of LESSONS) l.steps.forEach((s, i) => s.exercise && checkExercise(s.exercise, `${l.slug}#${i}`));
  });

  it('non-solution moves are really not solutions (point goals are selective)', () => {
    for (const l of LESSONS) for (const s of l.steps) {
      const g = s.exercise?.goal;
      if (g?.type === 'point' && g.points.length < 5) expect(g.points.length).toBeLessThan(build(s.exercise!).legalMoves().length);
    }
  });

  it('opening library: points are geometry-exact on 19×19 (4-4 / 3-3 / 3-4 / sanrensei / tengen / handicap)', () => {
    const at = (slug: string, step: number) => LESSONS.find((l) => l.slug === slug)!.steps[step].exercise!.goal as any;
    const Q = (x: number, y: number) => y * 19 + x;
    expect(at('open-corner-points', 0).points).toEqual([Q(15, 3)]);   // top-right: 4th line from top and from right
    expect(at('open-corner-points', 1).points).toEqual([Q(16, 2)]);   // 3rd line both ways
    expect(at('open-corner-points', 2).points.sort()).toEqual([Q(16, 3), Q(15, 2)].sort());
    expect(at('open-sanrensei', 0).points).toEqual([Q(3, 3), Q(3, 9), Q(3, 15)]);   // three star points on the left side
    expect(at('open-tengen', 0).points).toEqual([Q(9, 9)]);
    // the handicap lesson uses exactly the engine's 4-stone handicap points
    const hp = new GoGame(makeConfig({ size: 19, handicap: 4 }));
    const stones = [...hp.board.keys()].filter((p2) => hp.board[p2] === BLACK).sort((x, y) => x - y);
    expect(at('open-handicap', 0).points.slice().sort((x: number, y: number) => x - y)).toEqual(stones);
    // every star point used is a real star point of the 19×19 board
    for (const g of ['open-sanrensei', 'open-handicap']) for (const p2 of at(g, 0).points) expect([3, 9, 15]).toContain(p2 % 19), expect([3, 9, 15]).toContain(Math.floor(p2 / 19));
  });
});
