import type { BoardSize } from './types.ts';

/** Standard handicap stone points (origin top-left) for 2..9 stones. */
export function handicapPoints(size: BoardSize, stones: number): number[] {
  if (stones < 2) return [];
  const n = Math.min(stones, 9);
  const e = size === 9 ? 2 : 3;
  const far = size - 1 - e;
  const mid = (size - 1) / 2;
  const pt = (x: number, y: number) => y * size + x;
  const tr = pt(far, e);
  const bl = pt(e, far);
  const br = pt(far, far);
  const tl = pt(e, e);
  const l = pt(e, mid);
  const r = pt(far, mid);
  const t = pt(mid, e);
  const b = pt(mid, far);
  const c = pt(mid, mid);
  const table: Record<number, number[]> = {
    2: [tr, bl],
    3: [tr, bl, br],
    4: [tr, bl, br, tl],
    5: [tr, bl, br, tl, c],
    6: [tr, bl, br, tl, l, r],
    7: [tr, bl, br, tl, l, r, c],
    8: [tr, bl, br, tl, l, r, t, b],
    9: [tr, bl, br, tl, l, r, t, b, c],
  };
  return table[n];
}

export const MAX_HANDICAP = 9;
