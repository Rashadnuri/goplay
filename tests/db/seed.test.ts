import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANK } from '../../src/content/bank.ts';
import { createDb } from './harness.ts';

describe('supabase/seed.sql', () => {
  it('applies on top of the migrations and yields working content', async () => {
    const db = await createDb();
    await db.pg.exec(readFileSync(join(import.meta.dirname, '../../supabase/seed.sql'), 'utf8'));
    const l = await db.anon(`select track, count(*)::int n from public.lessons group by track order by track`);
    expect(l).toEqual([{ track: 'basics', n: 10 }, { track: 'openings', n: 5 }]);
    const p = await db.anon(`select difficulty, count(*)::int n from public.puzzles group by difficulty order by difficulty`);
    expect(p.length).toBe(3);
    expect(await db.anon(`select count(*)::int n from public.puzzles`)).toEqual([{ n: BANK.length }]);
    const u = await db.user('seeded');
    const set = await db.as(u, `select * from public.get_daily_set()`);
    expect(set.length).toBe(3);
    expect(JSON.stringify(set)).not.toMatch(/"points"/);
  });
});
