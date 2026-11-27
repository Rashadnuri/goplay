/** End-to-end test of the real Edge Function (supabase/functions/game-action/index.ts) against real Postgres. */
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './harness.ts';
import { bridge } from './fake-supabase.ts';
import { newRankedGame, P } from './helpers.ts';

let db: Db;
let handler: (req: Request) => Promise<Response>;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  bridge.db = db;
  (globalThis as any).Deno = {
    env: { get: (k: string) => ({ SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'svc', ALLOWED_ORIGIN: 'https://goplay.test' } as Record<string, string>)[k] },
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
  };
  await import('../../supabase/functions/game-action/index.ts');
  for (const n of ['ann', 'ben', 'cat', 'dan']) u[n] = await db.user(n);
});

const call = async (uid: string | null, gameId: string, action: unknown) => {
  const res = await handler(
    new Request('http://fn/game-action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer tok:${uid}` } : {}) },
      body: JSON.stringify({ game_id: gameId, action }),
    }),
  );
  return { status: res.status, body: await res.json().catch(() => null) };
};
const resign = (uid: string, gid: string) => db.as(uid, `select public.resign_game($1)`, [gid]);

describe('game-action Edge Function', () => {
  it('handles CORS preflight and rejects non-POST', async () => {
    const pre = await handler(new Request('http://fn', { method: 'OPTIONS' }));
    expect(pre.status).toBe(200);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://goplay.test');
    expect((await handler(new Request('http://fn', { method: 'GET' }))).status).toBe(405);
  });

  it('requires a valid token and well-formed input (400/401, never 500)', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    expect((await call(null, g.gameId, { type: 'pass' })).status).toBe(401);
    expect((await handler(new Request('http://fn', { method: 'POST', headers: { authorization: 'Bearer garbage' }, body: '{}' }))).status).toBe(401);
    expect((await handler(new Request('http://fn', { method: 'POST', headers: { authorization: `Bearer tok:${g.black}` }, body: 'not json' }))).status).toBe(400);
    expect((await call(g.black, 'not-a-uuid', { type: 'pass' })).body).toEqual({ error: 'invalid_game_id' });
    const bad = [null, 'move', { type: 'move' }, { type: 'move', p: 1.5 }, { type: 'move', p: '4' }, { type: 'teleport' }, { type: 'mark_dead', dead: 'x' }, { type: 'mark_dead', dead: Array(400).fill(1) }, { type: 'respond_undo' }, { type: 'move', p: 1, expected_move_count: 'x' }];
    for (const b of bad) {
      const r = await call(g.black, g.gameId, b);
      expect([r.status, r.body?.error], JSON.stringify(b)).toEqual([400, 'invalid_action']);
    }
    expect((await call(g.black, '00000000-0000-0000-0000-000000000000', { type: 'pass' })).status).toBe(404);
    await resign(g.black, g.gameId);
  });

  it('plays a whole game over HTTP: legal moves 200, illegal 409 with the rule name, result computed by the server', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    expect((await call(g.white, g.gameId, { type: 'move', p: 10 })).body).toEqual({ error: 'not_your_turn' });
    const ok = await call(g.black, g.gameId, { type: 'move', p: P(4, 4) });
    expect([ok.status, ok.body.ok]).toEqual([200, true]);
    expect((await call(g.white, g.gameId, { type: 'move', p: P(4, 4) })).body).toEqual({ error: 'illegal_occupied' });
    expect((await call(g.white, g.gameId, { type: 'move', p: 9999 })).body).toEqual({ error: 'illegal_out_of_bounds' });
    expect((await call(u.cat, g.gameId, { type: 'move', p: 3 })).body).toEqual({ error: 'forbidden' });
    const seq: [string, number][] = [[g.white, P(0, 0)], [g.black, P(8, 8)], [g.white, P(0, 8)], [g.black, P(8, 0)]];
    for (const [who, p] of seq) expect((await call(who, g.gameId, { type: 'move', p })).status).toBe(200);
    expect((await call(g.white, g.gameId, { type: 'pass' })).status).toBe(200);
    expect((await call(g.black, g.gameId, { type: 'pass' })).status).toBe(200);
    expect((await db.svc(`select status from public.games where id=$1`, [g.gameId]))[0].status).toBe('scoring');
    expect((await call(g.black, g.gameId, { type: 'move', p: 5 })).body).toEqual({ error: 'not_playing' });
    expect((await call(g.black, g.gameId, { type: 'accept_score' })).status).toBe(200);
    expect((await call(g.white, g.gameId, { type: 'accept_score' })).status).toBe(200);
    const row = (await db.svc(`select status, end_reason, result_text from public.games where id=$1`, [g.gameId]))[0];
    expect(row).toMatchObject({ status: 'finished', end_reason: 'score' });
    expect(row.result_text).toMatch(/^(B|W)\+/);
    expect((await call(g.black, g.gameId, { type: 'pass' })).body).toEqual({ error: 'game_over' });
  });

  it('SIMULTANEOUS requests: both race for the same turn → exactly one move is stored', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    const [a, b] = await Promise.all([call(g.black, g.gameId, { type: 'move', p: P(2, 2) }), call(g.black, g.gameId, { type: 'move', p: P(6, 6) })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.error, b.body.error].filter(Boolean)).toEqual(['not_your_turn']);
    expect((await db.svc(`select count(*)::int c from public.game_moves where game_id=$1`, [g.gameId]))[0].c).toBe(1);
    const [c, d] = await Promise.all([call(g.white, g.gameId, { type: 'move', p: P(1, 1) }), call(g.white, g.gameId, { type: 'move', p: P(1, 1) })]);
    expect([c.status, d.status].sort()).toEqual([200, 409]);
    expect((await db.svc(`select count(*)::int c from public.game_moves where game_id=$1`, [g.gameId]))[0].c).toBe(2);
    await resign(g.black, g.gameId);
  });

  it('undo request / accept and resume work end to end', async () => {
    const g = await newRankedGame(db, u.cat, u.dan);
    await call(g.black, g.gameId, { type: 'move', p: 20 });
    await call(g.white, g.gameId, { type: 'move', p: 30 });
    expect((await call(g.white, g.gameId, { type: 'request_undo' })).status).toBe(200);
    expect((await call(g.white, g.gameId, { type: 'respond_undo', accept: true })).body).toEqual({ error: 'no_offer' });
    expect((await call(g.black, g.gameId, { type: 'respond_undo', accept: true })).status).toBe(200);
    expect((await db.svc(`select move_count, to_play from public.games where id=$1`, [g.gameId]))[0]).toEqual({ move_count: 1, to_play: 2 });
    await call(g.white, g.gameId, { type: 'pass' });
    await call(g.black, g.gameId, { type: 'pass' });
    expect((await call(g.white, g.gameId, { type: 'resume' })).status).toBe(200);
    expect((await db.svc(`select status, move_count from public.games where id=$1`, [g.gameId]))[0]).toEqual({ status: 'active', move_count: 1 });
    await resign(g.black, g.gameId);
  });

  it('bans (403) and rate limits (429) are enforced before any game logic runs', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    await db.svc(`update public.profiles set banned_until = now() + interval '1 day' where id=$1`, [g.white]);
    expect((await call(g.white, g.gameId, { type: 'pass' })).body).toEqual({ error: 'banned' });
    await db.svc(`update public.profiles set banned_until = null where id=$1`, [g.white]);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await call(g.black, g.gameId, { type: 'move', p: 9999 })).status;
    expect(last).toBe(429);
    await db.svc(`truncate public.rate_limits`);
    await resign(g.black, g.gameId);
  });
});
