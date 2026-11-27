import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer, supabaseAuthenticator } from '../src/server.ts';
import { EngineUnavailableError, type Analysis, type GoEngineAdapter } from '../src/types.ts';

const analysis: Analysis = { toPlay: 1, winrate: 0.5, scoreLead: 0, candidates: [{ p: 40, visits: 10, winrate: 0.5, scoreLead: 0, prior: 0.3, pv: [40] }] };
const slowAdapter = (ms: number): GoEngineAdapter => ({
  health: async () => ({ ok: true, engine: 'katago', detail: 'test' }),
  analyze: () => new Promise((r) => setTimeout(() => r(analysis), ms)),
  analyzeTurns: async () => [analysis],
  close: async () => {},
});
const start = async (deps: Partial<Parameters<typeof createServer>[0]> = {}) => {
  const server = createServer({ adapter: slowAdapter(0), authenticate: async (t) => (t === 'good' ? 'u1' : null), allowedOrigins: [], maxVisitsCap: 50, rateLimitPerMinute: 1000, maxConcurrent: 4, log: () => {}, ...deps });
  await new Promise<void>((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};
const post = (base: string, path: string, body: string, headers: Record<string, string> = { authorization: 'Bearer good' }) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
const game = JSON.stringify({ size: 9, komi: 6.5, rules: 'japanese', handicap: 0, moves: [] });

describe('ai-service HTTP edge cases', () => {
  let s: { server: Server; base: string };
  beforeAll(async () => { s = await start(); });
  afterAll(() => s.server.close());

  it('rejects invalid JSON, oversized payloads and unknown routes with precise codes', async () => {
    expect(await (await post(s.base, '/v1/move', '{nope')).json()).toEqual({ error: 'invalid_json' });
    const big = await post(s.base, '/v1/move', JSON.stringify({ size: 9, moves: [], pad: 'x'.repeat(250_000) })).catch(() => null);
    if (big) expect(big.status).toBe(413);
    expect((await fetch(s.base + '/nope', { method: 'POST', headers: { authorization: 'Bearer good' } })).status).toBe(404);
    expect((await fetch(s.base + '/v1/move')).status).toBe(404);   // GET is not allowed
    expect((await fetch(s.base + '/v1/move', { method: 'OPTIONS' })).status).toBe(204);
  });

  it('validates every game field before the engine is touched', async () => {
    for (const [body, code] of [
      [{ size: 9, moves: new Array(1001).fill(-1) }, 'invalid_moves'],
      [{ size: 9, moves: [1.5] }, 'invalid_moves'],
      [{ size: 9, moves: [-5] }, 'illegal_move_sequence'],
      [{ size: 9, moves: [0, 0] }, 'illegal_move_sequence'],
      [{ size: 9, moves: [], handicap: 10 }, 'invalid_handicap'],
      [{ size: 19, moves: [], handicap: 3 }, null],
    ] as const) {
      const r = await post(s.base, '/v1/analyze', JSON.stringify(body));
      if (code) expect((await r.json()).error, JSON.stringify(body).slice(0, 40)).toBe(code); else expect(r.status).toBe(200);
    }
  });

  it('caps visits to the configured maximum and falls back to a default difficulty', async () => {
    const calls: number[] = [];
    const t = await start({ adapter: { ...slowAdapter(0), analyze: async (_p, o) => { calls.push(o.maxVisits); return analysis; } } });
    await post(t.base, '/v1/analyze', JSON.stringify({ ...JSON.parse(game), visits: 999999 }));
    await post(t.base, '/v1/move', JSON.stringify({ ...JSON.parse(game), difficulty: 'godlike' }));
    expect(calls[0]).toBe(50);
    expect(calls[1]).toBeLessThanOrEqual(50);
    t.server.close();
  });

  it('turns an engine crash into 503 engine_unavailable and anything else into 500 (no stack leaks)', async () => {
    const t1 = await start({ adapter: { ...slowAdapter(0), analyze: async () => { throw new EngineUnavailableError('KataGo exited (code 1)'); } } });
    const r1 = await post(t1.base, '/v1/analyze', game);
    expect(r1.status).toBe(503);
    expect((await r1.json()).error).toBe('engine_unavailable');
    t1.server.close();
    const t2 = await start({ adapter: { ...slowAdapter(0), analyze: async () => { throw new Error('secret internal path /srv/x'); } } });
    const r2 = await post(t2.base, '/v1/analyze', game);
    expect(r2.status).toBe(500);
    expect(JSON.stringify(await r2.json())).not.toMatch(/secret|srv/);
    t2.server.close();
  });

  it('sheds load: requests beyond maxConcurrent get 503 busy instead of queueing forever', async () => {
    const t = await start({ adapter: slowAdapter(300), maxConcurrent: 2 });
    const rs = await Promise.all([1, 2, 3, 4].map(() => post(t.base, '/v1/analyze', game)));
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200).length).toBe(2);
    expect(codes.filter((c) => c === 503).length).toBe(2);
    t.server.close();
  });

  it('anonymous mode is off by default and IP-rate-limited when on', async () => {
    expect((await post(s.base, '/v1/analyze', game, {})).status).toBe(401);
    const t = await start({ allowAnonymous: true, rateLimitPerMinute: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await post(t.base, '/v1/analyze', game, {})).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect((await post(t.base, '/v1/analyze', game, { authorization: 'Bearer forged' })).status).toBe(401);   // bad token is never downgraded to anonymous
    t.server.close();
  });
});

describe('supabaseAuthenticator', () => {
  it('accepts valid tokens, caches them, and rejects invalid ones and network failures', async () => {
    const f = vi.fn(async (_u: string, init: any) => (init.headers.Authorization === 'Bearer ok' ? new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }) : new Response('{}', { status: 401 })));
    vi.stubGlobal('fetch', f);
    const auth = supabaseAuthenticator('https://x.supabase.co', 'anon');
    expect(await auth('ok')).toBe('user-1');
    expect(await auth('ok')).toBe('user-1');
    expect(f).toHaveBeenCalledTimes(1);   // second call served from cache
    expect(await auth('bad')).toBeNull();
    expect(f.mock.calls[0][0]).toBe('https://x.supabase.co/auth/v1/user');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await auth('another')).toBeNull();   // fail closed
    vi.unstubAllGlobals();
  });
});
