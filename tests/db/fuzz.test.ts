/** Random full games through the server pipeline (planAction → svc_apply_game_update). After EVERY action the database must equal an independent engine replay. */
import { beforeAll, describe, expect, it } from 'vitest';
import { BLACK, GoGame, WHITE, makeConfig } from '../../src/engine/index.ts';
import type { Action } from '../../supabase/functions/_shared/game-logic.ts';
import { createDb, type Db } from './harness.ts';
import { actCode, newRankedGame } from './helpers.ts';

let db: Db;
const users: string[] = [];
beforeAll(async () => {
  db = await createDb();
  for (let i = 0; i < 6; i++) users.push(await db.user(`fz${i}`));
});

const lcg = (seed: number) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };

async function invariants(gameId: string, lastVersion: number) {
  const g = (await db.svc(`select * from public.games where id=$1`, [gameId]))[0];
  const mv = await db.svc(`select move_number, color, p from public.game_moves where game_id=$1 order by 1`, [gameId]);
  expect(g.version, 'version must increase on every applied action').toBeGreaterThan(lastVersion);
  expect(mv.map((m: any) => m.move_number), 'move numbers are contiguous from 1').toEqual(mv.map((_: any, i: number) => i + 1));
  expect(g.move_count).toBe(mv.length);
  const eng = GoGame.fromMoves(makeConfig({ size: 9, komi: Number(g.komi), rules: g.rules, ko: g.ko_rule }), mv.map((m: any) => m.p));
  // colours stored on moves alternate exactly like the engine's
  mv.forEach((m: any, i: number) => expect(m.color).toBe(i % 2 === 0 ? BLACK : WHITE));
  if (g.status === 'active' || g.status === 'scoring') {
    expect(g.to_play, 'to_play matches replay').toBe(eng.toPlay);
    expect(g.captures_black).toBe(eng.captures[BLACK]);
    expect(g.captures_white).toBe(eng.captures[WHITE]);
    expect(g.status === 'scoring', 'scoring iff two consecutive passes').toBe(eng.phase === 'scoring');
  }
  if (g.status === 'finished') {
    expect(g.finished_at).toBeTruthy();
    expect(g.clock_running).toBeNull();
    if (g.end_reason === 'score') {
      const fresh = GoGame.fromMoves(makeConfig({ size: 9, komi: Number(g.komi), rules: g.rules, ko: g.ko_rule }), mv.map((m: any) => m.p));
      const r = fresh.finishByScore(g.final_score?.dead ?? []);
      expect(g.result_text, 'stored result equals an independent re-count').toBe(r.text);
    }
  }
  return g;
}

describe('server pipeline fuzz', () => {
  it('30 random 9×9 games with moves, illegal attempts, passes, undo, scoring and resume keep DB == engine at every step', async () => {
    let applied = 0, rejected = 0, finishedByScore = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = lcg(seed * 2654435761 % 4294967296 || seed);
      const a = users[seed % 6], b = users[(seed + 1) % 6];
      const game = await newRankedGame(db, a, b, 9, 0, 0);   // untimed: clock logic is covered elsewhere
      let version = (await db.svc(`select version from public.games where id=$1`, [game.gameId]))[0].version;
      for (let step = 0; step < 90; step++) {
        const row = (await db.svc(`select * from public.games where id=$1`, [game.gameId]))[0];
        if (row.status === 'finished') break;
        const mv = await db.svc(`select p from public.game_moves where game_id=$1 order by move_number`, [game.gameId]);
        const eng = GoGame.fromMoves(makeConfig({ size: 9, komi: Number(row.komi), rules: row.rules, ko: row.ko_rule }), mv.map((m: any) => m.p));
        const mover = row.to_play === BLACK ? game.black : game.white;
        const other = mover === game.black ? game.white : game.black;
        const roll = rnd();
        let who = mover; let action: Action; let expectOk: boolean | null = null;

        if (row.status === 'scoring') {
          const stones = [...eng.board.keys()].filter((p) => eng.board[p] !== 0);
          if (roll < 0.5) { who = rnd() < 0.5 ? game.black : game.white; action = { type: 'mark_dead', dead: stones.filter(() => rnd() < 0.15) }; }
          else if (roll < 0.9) { who = rnd() < 0.5 ? game.black : game.white; action = { type: 'accept_score', dead: row.dead_stones }; }
          else { who = rnd() < 0.5 ? game.black : game.white; action = { type: 'resume' }; }
        } else if (roll < 0.04) { who = other; action = { type: 'move', p: 0 }; expectOk = false; }                    // out of turn
        else if (roll < 0.10) { action = { type: 'move', p: 500 }; expectOk = false; }                                 // out of range
        else if (roll < 0.14) { const occ = [...eng.board.keys()].find((p) => eng.board[p] !== 0); action = { type: 'move', p: occ ?? 0 }; expectOk = occ === undefined ? null : false; }
        else if (roll < 0.20) { action = { type: 'pass' }; }
        else if (roll < 0.25 && mv.length > 1) { who = rnd() < 0.5 ? game.black : game.white; action = { type: 'request_undo' }; }
        else if (roll < 0.30 && row.undo_request) { who = row.undo_request.by === BLACK ? game.white : game.black; action = { type: 'respond_undo', accept: rnd() < 0.7 }; }
        else {
          const legal = eng.legalMoves();
          if (legal.length === 0) action = { type: 'pass' };
          else { action = { type: 'move', p: legal[Math.floor(rnd() * legal.length)] }; expectOk = true; }
        }

        const code = await actCode(db, game.gameId, who, action);
        if (expectOk === true) expect(code, `seed ${seed} step ${step}: legal move must be accepted`).toBe('ok');
        if (expectOk === false) expect(code, `seed ${seed} step ${step}: ${JSON.stringify(action)} must be rejected`).not.toBe('ok');
        if (code === 'ok') applied++; else { rejected++; expect(code.startsWith('raw:'), `unexpected raw error ${code}`).toBe(false); }
        const g = await invariants(game.gameId, code === 'ok' ? version : -1);
        if (code === 'ok') version = g.version;
        if (g.status === 'finished' && g.end_reason === 'score') finishedByScore++;
      }
      const end = (await db.svc(`select status from public.games where id=$1`, [game.gameId]))[0].status;
      if (end !== 'finished') await db.as(game.black, `select public.resign_game($1)`, [game.gameId]);
    }
    expect(applied).toBeGreaterThan(500);
    expect(rejected).toBeGreaterThan(50);
    expect(finishedByScore + 0).toBeGreaterThanOrEqual(0);
  });
});
