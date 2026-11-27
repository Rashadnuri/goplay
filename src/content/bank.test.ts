import { describe, expect, it } from 'vitest';
import { BLACK, GoGame, makeConfig } from '../engine/index.ts';
import { solutions } from '../engine/puzzles.ts';
import { BANK, byDifficulty, dailyPick } from './bank.ts';

describe('puzzle bank', () => {
  it('has puzzles at every difficulty', () => { for (const d of [1, 2, 3] as const) expect(byDifficulty(d).length).toBeGreaterThanOrEqual(5); });
  it('ids are unique', () => expect(new Set(BANK.map((p) => p.id)).size).toBe(BANK.length));
  it('every stored answer set equals what the engine independently derives', () => {
    for (const p of BANK) {
      const g = GoGame.fromPosition(makeConfig({ size: p.size }), p.rows, p.toPlay);
      expect(solutions(g, p.verify).sort((a, b) => a - b), p.id).toEqual([...p.points].sort((a, b) => a - b));
    }
  });
  it('answers are legal, selective (not every move works) and rows are well-formed', () => {
    for (const p of BANK) {
      expect(p.rows.length).toBe(9); p.rows.forEach((r) => expect(r.length).toBe(9));
      const g = GoGame.fromPosition(makeConfig({ size: p.size }), p.rows, p.toPlay);
      for (const m of p.points) expect(g.isLegal(m), `${p.id}@${m}`).toBe(true);
      if (p.kind !== 'lifeDeath') expect(p.points.length).toBeLessThan(g.legalMoves().length / 3);
    }
  });
  it('life & death puzzles: the vital point is unique-ish and the defender really needs it', () => {
    for (const p of BANK.filter((x) => x.kind === 'lifeDeath')) {
      const g = GoGame.fromPosition(makeConfig({ size: 9 }), p.rows, p.toPlay);
      const region = (p.verify as any).region as number[];
      expect(p.points.every((m) => region.includes(m))).toBe(true);
      expect(p.points.length).toBeLessThan(region.length); // some region moves lose
      expect(g.board[(p.verify as any).target]).toBe(BLACK);
    }
  });
  it('every puzzle kind and shape used by the bank has translations (UI would otherwise show raw keys)', async () => {
    const { az } = await import('../i18n/az.ts');
    for (const p of BANK) {
      expect(`puzzle.kind.${p.kind}` in az).toBe(true);
      expect(`puzzle.hint.${p.kind}` in az).toBe(true);
      if (p.shape) expect(`puzzle.shape.${p.shape}` in az, p.shape).toBe(true);
      const key = p.kind === 'lifeDeath' ? `puzzle.explain.ld_${p.toPlay === 1 ? 'live' : 'kill'}` : `puzzle.explain.${p.kind}`;
      expect(key in az, key).toBe(true);
    }
  });
  it('daily rotation is deterministic and stays within the difficulty', () => {
    for (const d of [1, 2, 3] as const) { expect(dailyPick('2026-03-01', d)).toBe(dailyPick('2026-03-01', d)); expect(dailyPick('2026-03-01', d).difficulty).toBe(d); }
    const ids = new Set(Array.from({ length: 14 }, (_, i) => dailyPick(new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10), 1).id));
    expect(ids.size).toBeGreaterThan(1);
  });
});
