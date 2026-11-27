import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { KataGoAdapter, UnconfiguredAdapter } from '../src/katago.ts';
import { PROFILES, chooseMove, reviewGame } from '../src/play.ts';
import { createServer } from '../src/server.ts';
import { fromGtp, toGtp } from '../src/coords.ts';
import type { Analysis } from '../src/types.ts';

const FAKE = join(import.meta.dirname, 'fake-katago.mjs');
const cand = (p: number, visits: number, winrate: number, prior = 0.2) => ({ p, visits, winrate, scoreLead: 0, prior, pv: [p] });
const an = (toPlay: 1 | 2, winrate: number, candidates: any[]): Analysis => ({ toPlay, winrate, scoreLead: 0, candidates });

describe('GTP coordinates', () => {
  it('round-trips and skips the letter I', () => {
    expect(toGtp(0, 19)).toBe('A19');
    expect(toGtp(18, 19)).toBe('T19');
    expect(toGtp(19 * 18 + 8, 19)).toBe('J1'); // column 9 → J
    expect(toGtp(-1, 9)).toBe('pass');
    for (const size of [9, 13, 19]) for (let p = 0; p < size * size; p++) expect(fromGtp(toGtp(p, size), size)).toBe(p);
    expect(() => fromGtp('Z9', 9)).toThrow();
  });
});

describe('move selection by difficulty (real analysis in, move out)', () => {
  const a = an(1, 0.5, [cand(10, 100, 0.55, 0.6), cand(20, 50, 0.5, 0.2), cand(30, 20, 0.35, 0.1), cand(40, 5, 0.1, 0.02)]);

  it('Expert always plays the most-visited move', () => {
    for (let i = 0; i < 20; i++) expect(chooseMove(a, 'expert', Math.random).p).toBe(10);
  });

  it('weaker levels make mistakes more often than stronger ones', () => {
    const rate = (d: 'beginner' | 'easy' | 'intermediate' | 'advanced') => {
      let seed = 7;
      const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
      let nonBest = 0;
      for (let i = 0; i < 2000; i++) if (chooseMove(a, d, rng).p !== 10) nonBest++;
      return nonBest / 2000;
    };
    const [b, e, i, ad] = [rate('beginner'), rate('easy'), rate('intermediate'), rate('advanced')];
    expect(b).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(i);
    expect(i).toBeGreaterThan(ad);
    expect(b).toBeGreaterThan(0.3);
  });

  it('never plays a candidate outside the allowed winrate loss', () => {
    let seed = 3;
    const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 500; i++) expect(chooseMove(a, 'advanced', rng).p).not.toBe(40);
  });

  it('is deterministic for a given RNG', () => {
    expect(chooseMove(a, 'easy', () => 0.42).p).toBe(chooseMove(a, 'easy', () => 0.42).p);
  });

  it('resigns when hopeless (strong levels) and passes when KataGo only offers pass', () => {
    const lost = an(1, 0.01, [cand(10, 100, 0.01)]);
    expect(chooseMove(lost, 'expert').resign).toBe(true);
    expect(chooseMove(lost, 'beginner').resign).toBe(false);
    expect(chooseMove(an(2, 0.99, [cand(10, 100, 0.99)]), 'expert').resign).toBe(true); // White to move; Black at 99%
    expect(chooseMove(an(1, 0.5, [cand(-1, 100, 0.5)]), 'expert').p).toBe(-1);
    expect(chooseMove(an(1, 0.5, []), 'expert').p).toBe(-1);
  });

  it('profiles get strictly stronger', () => {
    const v = (['beginner', 'easy', 'intermediate', 'advanced', 'expert'] as const).map((d) => PROFILES[d].maxVisits);
    expect([...v].sort((x, y) => x - y)).toEqual(v);
  });
});

describe('post-game review', () => {
  it('classifies moves by the winrate the mover gave away', () => {
    // Black plays move 1 (0.50→0.52 good), White move 2 (0.52→0.60: White loses 0.08 = mistake), Black move 3 (0.60→0.40: blunder 0.2)
    const turns = [an(1, 0.5, [cand(1, 1, 0.5)]), an(2, 0.52, [cand(2, 1, 0.5)]), an(1, 0.6, [cand(3, 1, 0.6)]), an(2, 0.4, [])];
    const r = reviewGame(turns, [1, 2, 3]);
    expect(r.map((m) => m.kind)).toEqual(['good', 'mistake', 'blunder']);
    expect(r[2].loss).toBeCloseTo(0.2);
    expect(r[1].color).toBe(2);
    expect(r[0].best).toBe(1);
  });
});

describe('KataGo adapter against a protocol-level fake process', () => {
  const adapter = new KataGoAdapter({ binary: FAKE, model: 'm', config: 'c', queryTimeoutMs: 1500 });
  afterAll(() => adapter.close());
  const pos = { size: 9 as const, komi: 6.5, rules: 'japanese' as const, handicap: 0, moves: [0, 1] };

  it('reports health from the engine version query', async () => {
    expect(await adapter.health()).toMatchObject({ ok: true, version: 'fake-1.0' });
  });

  it('sends GTP-coordinate moves and parses candidates', async () => {
    const a = await adapter.analyze(pos, { maxVisits: 10, ownership: true });
    expect(a.toPlay).toBe(1);
    expect(a.candidates.length).toBe(5);
    expect(a.candidates.every((c) => c.p >= 0 && c.p !== 0 && c.p !== 1)).toBe(true); // played points are excluded
    expect(a.ownership?.length).toBe(81);
  });

  it('handicap games start with White to move and send handicap stones', async () => {
    const a = await adapter.analyze({ ...pos, handicap: 2, moves: [] }, { maxVisits: 5 });
    expect(a.toPlay).toBe(2);
  });

  it('analyses every turn of a game in one query', async () => {
    const t = await adapter.analyzeTurns({ ...pos, moves: [0, 1, 2, 3] }, { maxVisits: 5 });
    expect(t.length).toBe(5);
    expect(t[4].winrate).toBeCloseTo(0.54);
  });

  it('surfaces engine errors and timeouts', async () => {
    await expect(adapter.analyze({ ...pos, size: 99 as any }, { maxVisits: 1 })).rejects.toThrow(/unsupported board size/);
    await expect(adapter.analyze(pos, { maxVisits: 12345 })).rejects.toThrow(/timed out/);
  });

  it('reports unavailable (instead of faking) when the binary does not exist', async () => {
    const bad = new KataGoAdapter({ binary: '/nonexistent/katago', model: 'm', config: 'c' });
    const h = await bad.health();
    expect(h.ok).toBe(false);
    expect(h.detail).toMatch(/ENOENT|cannot start/);
    await expect(bad.analyze(pos, { maxVisits: 1 })).rejects.toThrow();
  });
});

describe('HTTP API', () => {
  let server: Server, base: string;
  const adapter = new KataGoAdapter({ binary: FAKE, model: 'm', config: 'c' });
  const tokens: Record<string, string> = { 'tok-a': 'user-a', 'tok-b': 'user-b', 'tok-c': 'user-c', 'tok-d': 'user-d' };
  beforeAll(async () => {
    server = createServer({
      adapter,
      authenticate: async (t) => tokens[t] ?? null,
      allowedOrigins: ['https://goplay.example'],
      maxVisitsCap: 50,
      rateLimitPerMinute: 5,
      maxConcurrent: 2,
      log: () => {},
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await adapter.close();
    server.close();
  });
  const post = (path: string, body: unknown, token = 'tok-a', origin?: string) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
  const game = { size: 9, komi: 6.5, rules: 'japanese', handicap: 0, moves: [40] };

  it('requires authentication', async () => {
    expect((await post('/v1/move', game, 'nope')).status).toBe(401);
    expect((await fetch(base + '/v1/move', { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('returns an engine-chosen legal move for each difficulty', async () => {
    for (const difficulty of ['beginner', 'easy', 'intermediate', 'advanced', 'expert']) {
      const r = await post('/v1/move', { ...game, difficulty }, 'tok-b');
      expect(r.status).toBe(200);
      const j = await r.json();
      expect(j.difficulty).toBe(difficulty);
      expect(['play', 'pass']).toContain(j.move.type);
      if (j.move.type === 'play') expect(j.move.p).not.toBe(40);
    }
  });

  it('analysis returns winrate, suggestions and ownership', async () => {
    const r = await post('/v1/analyze', game, 'tok-a');
    const j = await r.json();
    expect(j.candidates.length).toBeLessThanOrEqual(5);
    expect(j.ownership.length).toBe(81);
    expect(typeof j.winrate).toBe('number');
  });

  it('rejects illegal sequences and invalid input before touching the engine', async () => {
    expect(await (await post('/v1/move', { ...game, moves: [5, 5] }, 'tok-a')).json()).toEqual({ error: 'illegal_move_sequence' });
    expect(await (await post('/v1/move', { ...game, size: 7 }, 'tok-a')).json()).toEqual({ error: 'invalid_size' });
    expect(await (await post('/v1/move', { ...game, moves: 'x' }, 'tok-a')).json()).toEqual({ error: 'invalid_moves' });
    expect(await (await post('/v1/move', { ...game, handicap: 1 }, 'tok-a')).json()).toEqual({ error: 'invalid_handicap' });
  });

  it('review returns per-turn series and classified moves', async () => {
    const j = await (await post('/v1/review', { ...game, moves: [0, 1, 2, 3, 4] }, 'tok-c')).json();
    expect(j.winrates.length).toBe(6);
    expect(j.moves.length).toBe(5);
    expect(j.summary).toHaveProperty('blunders');
  });

  it('CORS only for allowed origins; health is public', async () => {
    const ok = await post('/v1/analyze', game, 'tok-d', 'https://goplay.example');
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://goplay.example');
    const bad = await post('/v1/analyze', game, 'tok-d', 'https://evil.example');
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(base + '/health')).status).toBe(200);
  });

  it('rate limits per user', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await post('/v1/analyze', game, 'tok-a')).status);
    expect(codes).toContain(429);
  });
});

describe('unconfigured engine', () => {
  it('returns 503 engine_unavailable — never a made-up move', async () => {
    const server = createServer({
      adapter: new UnconfiguredAdapter('KataGo is not installed'),
      authenticate: async () => 'u',
      allowedOrigins: [], maxVisitsCap: 10, rateLimitPerMinute: 100, maxConcurrent: 2, log: () => {},
    });
    await new Promise<void>((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const h = await fetch(base + '/health');
    expect(h.status).toBe(503);
    expect((await h.json()).status).toBe('unavailable');
    const r = await fetch(base + '/v1/move', { method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify({ size: 9, moves: [] }) });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe('engine_unavailable');
    server.close();
  });
});
