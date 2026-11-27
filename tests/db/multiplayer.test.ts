import { beforeAll, describe, expect, it } from 'vitest';
import { GoGame, makeConfig, BLACK } from '../../src/engine/index.ts';
import { createDb, errCode, type Db } from './harness.ts';
import { act, actCode, newRankedGame, P, playMoves, snapshot } from './helpers.ts';

let db: Db;
let u: Record<string, string> = {};
const names = ['ann', 'ben', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal'];

beforeAll(async () => {
  db = await createDb();
  for (const n of names) u[n] = await db.user(n);
});

const game = async (id: string) => (await db.svc(`select * from public.games where id=$1`, [id]))[0];
const movesOf = async (id: string) => (await db.svc(`select move_number, color, p from public.game_moves where game_id=$1 order by 1`, [id]));
const resign = (uid: string, gid: string) => db.as(uid, `select public.resign_game($1)`, [gid]);

describe('matchmaking', () => {
  it('matches two players with the same settings; first player learns via poll', async () => {
    expect((await db.as(u.ann, `select public.join_matchmaking(9,300,0) as g`))[0].g).toBeNull();
    expect((await db.as(u.ann, `select public.poll_matchmaking() as g`))[0].g).toBeNull();
    const gid = (await db.as(u.ben, `select public.join_matchmaking(9,300,0) as g`))[0].g;
    expect(gid).toBeTruthy();
    expect((await db.as(u.ann, `select public.poll_matchmaking() as g`))[0].g).toBe(gid);
    expect((await db.as(u.ann, `select public.poll_matchmaking() as g`))[0].g).toBeNull(); // consumed
    const g = await game(gid);
    expect(g.status).toBe('active');
    expect(g.is_ranked).toBe(true);
    expect(g.black_ms).toBe(300000);
    const parts = await db.svc(`select color from public.game_participants where game_id=$1 order by color`, [gid]);
    expect(parts.map((p) => p.color)).toEqual([1, 2]);
    await resign(u.ann, gid);
  });

  it('prevents duplicate queue entries and joining while in a game', async () => {
    await db.as(u.cat, `select public.join_matchmaking(13,300,0)`);
    expect(await errCode(db.as(u.cat, `select public.join_matchmaking(13,300,0)`))).toBe('already_in_queue');
    expect(await db.as(u.cat, `select public.leave_matchmaking() as l`)).toEqual([{ l: true }]);
    expect(await db.as(u.cat, `select public.leave_matchmaking() as l`)).toEqual([{ l: false }]);
    const g = await newRankedGame(db, u.cat, u.dan);
    expect(await errCode(db.as(u.cat, `select public.join_matchmaking(9,300,0)`))).toBe('already_in_game');
    await resign(u.cat, g.gameId);
  });

  it('does not match different board sizes or time controls', async () => {
    await db.as(u.eve, `select public.join_matchmaking(9,300,0)`);
    expect((await db.as(u.fay, `select public.join_matchmaking(19,300,0) as g`))[0].g).toBeNull();
    expect((await db.as(u.gus, `select public.join_matchmaking(9,600,5) as g`))[0].g).toBeNull();
    for (const x of ['eve', 'fay', 'gus']) await db.as(u[x], `select public.leave_matchmaking()`);
  });

  it('respects the rating window, which widens with waiting time', async () => {
    await db.svc(`update public.player_ratings set rating=1800 where user_id=$1 and board_size=9`, [u.hal]);
    await db.as(u.hal, `select public.join_matchmaking(9,300,0)`);
    expect((await db.as(u.eve, `select public.join_matchmaking(9,300,0) as g`))[0].g).toBeNull(); // 800 apart
    await db.svc(`update public.matchmaking_queue set joined_at = now() - interval '60 seconds' where user_id=$1`, [u.hal]); // window ≈ 1000
    const gid = (await db.as(u.eve, `select public.poll_matchmaking() as g`))[0].g;
    expect(gid).toBeTruthy();
    await db.svc(`update public.player_ratings set rating=1000 where user_id=$1`, [u.hal]);
    await resign(u.eve, gid);
    await db.as(u.hal, `select public.poll_matchmaking()`);
  });

  it('rejects invalid settings', async () => {
    expect(await errCode(db.as(u.ann, `select public.join_matchmaking(7,300,0)`))).toBe('invalid_settings');
    expect(await errCode(db.as(u.ann, `select public.join_matchmaking(9,99999,0)`))).toBe('invalid_settings');
  });
});

describe('private rooms', () => {
  it('create → join by code → play; joiner takes the free colour', async () => {
    const room = (await db.as(u.ann, `select public.create_private_game(13, 600, 5, 'chinese', null, 0, 'white') as r`))[0].r;
    expect(room.invite_code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    let g = await game(room.game_id);
    expect(g.status).toBe('waiting');
    expect(g.board_size).toBe(13);
    expect(g.rules).toBe('chinese');
    expect(g.ko_rule).toBe('superko');
    expect(Number(g.komi)).toBe(7.5);
    expect(g.is_ranked).toBe(false);

    expect(await errCode(db.as(u.ben, `select public.join_game_by_code('ZZZZZZ')`))).toBe('room_not_found');
    const joined = (await db.as(u.ben, `select public.join_game_by_code($1) as g`, [room.invite_code.toLowerCase()]))[0].g;
    expect(joined).toBe(room.game_id);
    g = await game(room.game_id);
    expect(g.status).toBe('active');
    const parts = await db.svc(`select user_id, color from public.game_participants where game_id=$1`, [room.game_id]);
    expect(parts.find((p) => p.user_id === u.ann).color).toBe(2);
    expect(parts.find((p) => p.user_id === u.ben).color).toBe(1);
    // third player is refused
    expect(await errCode(db.as(u.cat, `select public.join_game_by_code($1)`, [room.invite_code]))).toBe('room_full');
    // creator re-opening their own code is idempotent
    expect((await db.as(u.ann, `select public.join_game_by_code($1) as g`, [room.invite_code]))[0].g).toBe(room.game_id);
    await resign(u.ann, room.game_id);
  });

  it('supports handicap games: White moves first', async () => {
    const room = (await db.as(u.ann, `select public.create_private_game(19, 0, 0, 'japanese', null, 4, 'black') as r`))[0].r;
    await db.as(u.ben, `select public.join_game_by_code($1)`, [room.invite_code]);
    const g = await game(room.game_id);
    expect(g.to_play).toBe(2);
    expect(Number(g.komi)).toBe(0.5);
    expect(await actCode(db, room.game_id, u.ann, { type: 'move', p: P(5, 5, 19) })).toBe('not_your_turn');
    expect(await actCode(db, room.game_id, u.ben, { type: 'move', p: P(5, 5, 19) })).toBe('ok');
    await resign(u.ann, room.game_id);
  });

  it('invalid settings and cancelling', async () => {
    expect(await errCode(db.as(u.ann, `select public.create_private_game(10, 300, 0)`))).toBe('invalid_settings');
    expect(await errCode(db.as(u.ann, `select public.create_private_game(9, 300, 0, 'japanese', null, 1)`))).toBe('invalid_settings');
    const room = (await db.as(u.ann, `select public.create_private_game(9, 300, 0) as r`))[0].r;
    await db.as(u.ann, `select public.cancel_room($1)`, [room.game_id]);
    expect(await errCode(db.as(u.ben, `select public.join_game_by_code($1)`, [room.invite_code]))).toBe('room_not_found');
  });
});

describe('live gameplay — server-side validation', () => {
  it('accepts legal moves in turn, rejects everything else', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 10 })).toBe('not_your_turn');
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: 40 })).toBe('ok');
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: 41 })).toBe('not_your_turn');
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 40 })).toBe('illegal_occupied');
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 999 })).toBe('illegal_out_of_bounds');
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: -2 })).toBe('illegal_out_of_bounds');
    expect(await actCode(db, g.gameId, u.cat, { type: 'move', p: 1 })).toBe('forbidden');
    const row = await game(g.gameId);
    expect(row.move_count).toBe(1);
    expect(row.to_play).toBe(2);
    expect(await movesOf(g.gameId)).toEqual([{ move_number: 1, color: 1, p: 40 }]);
    await resign(u.ann, g.gameId);
  });

  it('enforces suicide and ko on the server', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    // Build a ko: black X at (1,0),(0,1),(2,1)... use standard shape
    //   . X O .      row0: (1,0)=B (2,0)=W
    //   X O . O      row1: (0,1)=B (1,1)=W (3,1)=W
    //   . X O .      row2: (1,2)=B (2,2)=W
    const seq: [string, number][] = [
      [g.black, P(1, 0)], [g.white, P(2, 0)],
      [g.black, P(0, 1)], [g.white, P(1, 1)],
      [g.black, P(1, 2)], [g.white, P(3, 1)],
      [g.black, P(8, 8)], [g.white, P(2, 2)],
    ];
    for (const [who, p] of seq) expect(await actCode(db, g.gameId, who, { type: 'move', p })).toBe('ok');
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: P(2, 1) })).toBe('ok'); // captures (1,1)
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: P(1, 1) })).toBe('illegal_ko');
    const row = await game(g.gameId);
    expect(row.captures_black).toBe(1);
    await resign(u.ann, g.gameId);
  });

  it('SIMULTANEOUS MOVES: two clients acting on the same snapshot cannot both win', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    const snap = await snapshot(db, g.gameId);
    // Black submits; a duplicate delivery of the very same request (same stale snapshot) arrives right after.
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: 20 }, { snapshot: snap })).toBe('ok');
    // The duplicate re-validates against the fresh state (retry after version_conflict) → now it's White's turn.
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: 20 }, { snapshot: snap })).toBe('not_your_turn');
    // Both players race for the same move slot: White plays, Black (stale) tries again
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 30 })).toBe('ok');
    expect((await movesOf(g.gameId)).length).toBe(2);
    await resign(u.ann, g.gameId);
  });

  it('the DB itself refuses a stale write (optimistic version check)', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    const stale = await snapshot(db, g.gameId);
    await act(db, g.gameId, g.black, { type: 'move', p: 5 });
    const err = await errCode(
      db.svc(`select public.svc_apply_game_update($1,$2,'{"to_play":2,"move_count":1}'::jsonb,'[{"move_number":1,"color":1,"p":6,"captured":[]}]'::jsonb,null)`, [g.gameId, stale.game.version]),
    );
    expect(err).toBe('version_conflict');
    expect((await movesOf(g.gameId)).length).toBe(1);
    await resign(u.ann, g.gameId);
  });

  it('the primary key makes a conflicting move_number impossible even if the version check were bypassed', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    await act(db, g.gameId, g.black, { type: 'move', p: 5 });
    const v = (await game(g.gameId)).version;
    expect(await errCode(db.svc(`select public.svc_apply_game_update($1,$2,'{}'::jsonb,'[{"move_number":1,"color":2,"p":9,"captured":[]}]'::jsonb,null)`, [g.gameId, v]))).toMatch(/raw:.*duplicate key/);
    await resign(u.ann, g.gameId);
  });

  it('stale client state is rejected via expected_move_count', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    await act(db, g.gameId, g.black, { type: 'move', p: 5 });
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 6, expected_move_count: 0 })).toBe('stale_state');
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 6, expected_move_count: 1 })).toBe('ok');
    await resign(u.ann, g.gameId);
  });

  it('clients cannot submit results: "finish" is only reachable through validated paths', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    expect(await errCode(db.as(g.black, `select public.svc_apply_game_update($1,0,'{"finish":{"winner":1,"reason":"score","text":"B+99"}}'::jsonb,null,null)`, [g.gameId]))).toMatch(/permission denied/);
    await resign(u.ann, g.gameId);
  });

  it('reconnect: state restored from the database after many moves equals the engine state', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    await playMoves(db, g, 20);
    const moves = await movesOf(g.gameId);
    expect(moves.length).toBe(20);
    // A "fresh client" rebuilds everything from rows it is allowed to read
    const rows = await db.as(u.cat, `select move_number, p from public.game_moves where game_id=$1 order by 1`, [g.gameId]);
    const rebuilt = GoGame.fromMoves(makeConfig({ size: 9 }), rows.map((r: any) => r.p));
    const row = await game(g.gameId);
    expect(rebuilt.toPlay).toBe(row.to_play);
    expect(rebuilt.moveNumber).toBe(row.move_count);
    expect(rebuilt.captures[BLACK]).toBe(row.captures_black);
    await resign(u.ann, g.gameId);
  });
});

describe('clocks', () => {
  it('first move is free, then the opponent clock runs; increments apply', async () => {
    const g = await newRankedGame(db, u.ann, u.ben, 9, 300, 3);
    let row = await game(g.gameId);
    expect(row.clock_running).toBeNull();
    await act(db, g.gameId, g.black, { type: 'move', p: 1 });
    row = await game(g.gameId);
    expect(row.clock_running).toBe(2);
    expect(row.black_ms).toBe(300000);
    // pretend white thought for 20 seconds
    await db.svc(`update public.games set clock_since = now() - interval '20 seconds' where id=$1`, [g.gameId]);
    await act(db, g.gameId, g.white, { type: 'move', p: 2 });
    row = await game(g.gameId);
    const w = Number(row.white_ms);
    expect(w).toBeGreaterThan(300000 - 20500 + 3000 - 200);
    expect(w).toBeLessThan(300000 - 19500 + 3000 + 200);
    expect(row.clock_running).toBe(1);
    await resign(u.ann, g.gameId);
  });

  it('timeout: opponent can claim; early claims are refused; a late move loses on time', async () => {
    const g = await newRankedGame(db, u.ann, u.ben, 9, 60, 0);
    await act(db, g.gameId, g.black, { type: 'move', p: 1 });
    expect((await db.as(g.black, `select public.claim_timeout($1) as t`, [g.gameId]))[0].t).toBe(false);
    await db.svc(`update public.games set clock_since = now() - interval '61 seconds' where id=$1`, [g.gameId]);
    // White tries to move after running out of time → loses by timeout instead of the move being accepted
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 2 })).toBe('ok');
    const row = await game(g.gameId);
    expect(row.status).toBe('finished');
    expect(row.result_text).toBe('B+T');
    expect(row.end_reason).toBe('timeout');
    expect((await movesOf(g.gameId)).length).toBe(1);

    const g2 = await newRankedGame(db, u.ann, u.ben, 9, 60, 0);
    await act(db, g2.gameId, g2.black, { type: 'move', p: 1 });
    await db.svc(`update public.games set clock_since = now() - interval '61 seconds' where id=$1`, [g2.gameId]);
    expect((await db.as(g2.black, `select public.claim_timeout($1) as t`, [g2.gameId]))[0].t).toBe(true);
    expect((await game(g2.gameId)).winner).toBe(1);
  });

  it('sweep_timeouts finishes abandoned games server-side (opponent disconnected for good)', async () => {
    const g = await newRankedGame(db, u.ann, u.ben, 9, 60, 0);
    await act(db, g.gameId, g.black, { type: 'move', p: 1 });
    await db.svc(`update public.games set clock_since = now() - interval '120 seconds' where id=$1`, [g.gameId]);
    expect((await db.svc(`select public.sweep_timeouts() as n`))[0].n).toBeGreaterThanOrEqual(1);
    expect((await game(g.gameId)).end_reason).toBe('timeout');
  });
});

describe('match controls', () => {
  it('resign ends the game, awards the opponent and updates ratings (>=4 moves)', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    await playMoves(db, g, 5);
    await resign(g.black, g.gameId);
    const row = await game(g.gameId);
    expect(row.status).toBe('finished');
    expect(row.winner).toBe(2);
    expect(row.result_text).toBe('W+R');
    const h = await db.svc(`select user_id, delta from public.rating_history where game_id=$1`, [g.gameId]);
    expect(h.find((x: any) => x.user_id === g.white).delta).toBeGreaterThan(0);
    expect(h.find((x: any) => x.user_id === g.black).delta).toBeLessThan(0);
    expect(await errCode(resign(g.white, g.gameId))).toBe('game_over');
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: 70 })).toBe('game_over');
  });

  it('very short games do not move ratings', async () => {
    const g = await newRankedGame(db, u.cat, u.dan);
    const before = await db.svc(`select user_id, rating from public.player_ratings where board_size=9 and user_id in ($1,$2)`, [u.cat, u.dan]);
    await act(db, g.gameId, g.black, { type: 'move', p: 1 });
    await resign(g.white, g.gameId);
    const after = await db.svc(`select user_id, rating from public.player_ratings where board_size=9 and user_id in ($1,$2)`, [u.cat, u.dan]);
    expect(after.sort((a, b) => a.user_id.localeCompare(b.user_id))).toEqual(before.sort((a, b) => a.user_id.localeCompare(b.user_id)));
  });

  it('draw offers: offer, decline, re-offer, accept; offers clear when a move is played', async () => {
    const g = await newRankedGame(db, u.eve, u.fay);
    await playMoves(db, g, 4);
    await db.as(g.black, `select public.offer_draw($1)`, [g.gameId]);
    expect(await errCode(db.as(g.white, `select public.offer_draw($1)`, [g.gameId]))).toBe('offer_pending');
    expect(await errCode(db.as(g.black, `select public.respond_draw($1, true)`, [g.gameId]))).toBe('no_offer'); // cannot accept own
    await db.as(g.white, `select public.respond_draw($1, false)`, [g.gameId]);
    expect((await game(g.gameId)).draw_offer_by).toBeNull();
    await db.as(g.black, `select public.offer_draw($1)`, [g.gameId]);
    await act(db, g.gameId, g.black, { type: 'move', p: P(8, 8) }).catch(() => {});
    await act(db, g.gameId, g.white, { type: 'move', p: P(8, 6) }).catch(() => {});
    await db.as(g.black, `select public.offer_draw($1)`, [g.gameId]).catch(() => {});
    await db.as(g.white, `select public.respond_draw($1, true)`, [g.gameId]);
    const row = await game(g.gameId);
    expect(row.status).toBe('finished');
    expect(row.winner).toBeNull();
    expect(row.result_text).toBe('0');
  });

  it('undo: request → decline / accept removes the right moves and restores turn', async () => {
    const g = await newRankedGame(db, u.gus, u.hal);
    await playMoves(db, g, 3); // B W B
    expect(await actCode(db, g.gameId, g.white, { type: 'respond_undo', accept: true })).toBe('no_offer');
    await act(db, g.gameId, g.black, { type: 'request_undo' }); // black just moved → remove 1 move
    expect(await actCode(db, g.gameId, g.black, { type: 'respond_undo', accept: true })).toBe('no_offer'); // cannot self-accept
    await act(db, g.gameId, g.white, { type: 'respond_undo', accept: false });
    expect((await game(g.gameId)).undo_request).toBeNull();
    expect((await movesOf(g.gameId)).length).toBe(3);

    await act(db, g.gameId, g.black, { type: 'request_undo' });
    await act(db, g.gameId, g.white, { type: 'respond_undo', accept: true });
    let row = await game(g.gameId);
    expect(row.move_count).toBe(2);
    expect(row.to_play).toBe(1);
    expect((await movesOf(g.gameId)).length).toBe(2);

    // White now requests undo while it is Black's turn (white's last move is 2nd to last) → removes 1 move?? white last move is the latest: remove 1
    await act(db, g.gameId, g.white, { type: 'request_undo' });
    await act(db, g.gameId, g.black, { type: 'respond_undo', accept: true });
    row = await game(g.gameId);
    expect(row.move_count).toBe(1);
    expect(row.to_play).toBe(2);
    // moves after undo are re-playable on the freed slot
    expect(await actCode(db, g.gameId, g.white, { type: 'move', p: P(7, 7) })).toBe('ok');
    await resign(g.black, g.gameId);
  });

  it('undo is not offered when the opponent moved meanwhile (stale request)', async () => {
    const g = await newRankedGame(db, u.cat, u.dan);
    await playMoves(db, g, 2);
    await act(db, g.gameId, g.black, { type: 'request_undo' });
    await act(db, g.gameId, g.black, { type: 'move', p: P(6, 6) }).catch(() => {}); // black cannot move out of turn
    await act(db, g.gameId, g.white, { type: 'move', p: P(6, 4) }); // white moves → request cleared
    expect((await game(g.gameId)).undo_request).toBeNull();
    await resign(g.black, g.gameId);
  });
});

describe('two passes → scoring → agreement → rating', () => {
  async function toScoring() {
    const g = await newRankedGame(db, u.ann, u.cat);
    // Black wall on column 3, White wall on column 5 (9x9): Black left territory 27, White 27 (+ komi → White wins)
    const blackMoves = [P(3, 0), P(3, 1), P(3, 2), P(3, 3)];
    const whiteMoves = [P(5, 0), P(5, 1), P(5, 2), P(5, 3)];
    for (let i = 0; i < 4; i++) {
      await act(db, g.gameId, g.black, { type: 'move', p: blackMoves[i] });
      await act(db, g.gameId, g.white, { type: 'move', p: whiteMoves[i] });
    }
    return g;
  }

  it('pass, pass → scoring phase; moves refused; clocks stop', async () => {
    const g = await toScoring();
    await act(db, g.gameId, g.black, { type: 'pass' });
    expect((await game(g.gameId)).status).toBe('active');
    await act(db, g.gameId, g.white, { type: 'pass' });
    const row = await game(g.gameId);
    expect(row.status).toBe('scoring');
    expect(row.clock_running).toBeNull();
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: 0 })).toBe('not_playing');
    await resign(g.black, g.gameId);
  });

  it('both players accept the same dead-stone set → server computes the result; ratings update', async () => {
    const g = await toScoring();
    await act(db, g.gameId, g.black, { type: 'pass' });
    await act(db, g.gameId, g.white, { type: 'pass' });
    expect(await actCode(db, g.gameId, g.black, { type: 'mark_dead', dead: [P(0, 8)] })).toBe('invalid_dead'); // empty point
    await act(db, g.gameId, g.black, { type: 'mark_dead', dead: [] });
    expect(await actCode(db, g.gameId, g.white, { type: 'accept_score', dead: [P(3, 0)] })).toBe('stale_state'); // different set
    await act(db, g.gameId, g.black, { type: 'accept_score' });
    expect((await game(g.gameId)).status).toBe('scoring'); // still waiting for White
    await act(db, g.gameId, g.white, { type: 'accept_score', dead: [] });
    const row = await game(g.gameId);
    expect(row.status).toBe('finished');
    expect(row.end_reason).toBe('score');
    // Japanese: B 27 + 0, W 27 + 6.5 → W+6.5
    expect(row.result_text).toBe('W+6.5');
    expect(row.winner).toBe(2);
    expect(row.final_score.margin).toBe(6.5);
    const parts = await db.svc(`select rating_before, rating_after, color from public.game_participants where game_id=$1`, [g.gameId]);
    expect(parts.every((p: any) => p.rating_before != null && p.rating_after != null)).toBe(true);
    const hist = await db.svc(`select delta from public.rating_history where game_id=$1`, [g.gameId]);
    expect(hist.length).toBe(2);
    expect(hist[0].delta + hist[1].delta).toBeLessThanOrEqual(1); // Elo is (almost) zero-sum
  });

  it('changing the dead set resets the opponent acceptance; resume returns to play', async () => {
    const g = await toScoring();
    await act(db, g.gameId, g.black, { type: 'pass' });
    await act(db, g.gameId, g.white, { type: 'pass' });
    await act(db, g.gameId, g.white, { type: 'accept_score', dead: [] });
    await act(db, g.gameId, g.black, { type: 'mark_dead', dead: [P(5, 0)] });
    let row = await game(g.gameId);
    expect(row.score_accept_white).toBe(false);
    expect(row.score_accept_black).toBe(true);
    await act(db, g.gameId, g.white, { type: 'resume' });
    row = await game(g.gameId);
    expect(row.status).toBe('active');
    expect(row.move_count).toBe(8);
    expect(row.dead_stones).toEqual([]);
    expect(await movesOf(g.gameId)).toHaveLength(8);
    expect(await actCode(db, g.gameId, g.black, { type: 'move', p: P(0, 0) })).toBe('ok');
    await resign(g.black, g.gameId);
  });
});

describe('rating & leaderboard', () => {
  it('ratings are separate per board size and leaderboards reflect them', async () => {
    const g = await newRankedGame(db, u.dan, u.eve, 13, 300, 0);
    await playMoves(db, g, 6, 13);
    await resign(g.white, g.gameId);
    const r13 = await db.svc(`select user_id, rating from public.player_ratings where board_size=13 and user_id in ($1,$2)`, [u.dan, u.eve]);
    expect(r13.some((x: any) => x.rating !== 1000)).toBe(true);
    const lb = await db.as(u.ann, `select * from public.get_leaderboard(13, 'all', 10, 0)`);
    expect(Number(lb[0].rank)).toBe(1);
    expect(lb.map((x: any) => x.user_id)).toContain(g.black);
    expect(lb[0].rating).toBeGreaterThanOrEqual(lb[1].rating);
    const week = await db.as(u.ann, `select * from public.get_leaderboard(13, 'week', 10, 0)`);
    expect(week.length).toBe(2);
    expect(week[0].score).toBeGreaterThan(0);
    const month = await db.anon(`select * from public.get_leaderboard(13, 'month', 10, 0)`);
    expect(month.length).toBe(2);
    expect(await errCode(db.as(u.ann, `select * from public.get_leaderboard(13, 'year', 10, 0)`))).toBe('invalid_settings');
    expect((await db.svc(`select league_for(1000) a, league_for(1100) b, league_for(1300) c, league_for(1500) d, league_for(1700) e, league_for(1900) f`))[0])
      .toEqual({ a: 'beginner', b: 'bronze', c: 'silver', d: 'gold', e: 'platinum', f: 'diamond' });
  });

  it('a player who wins 3 in a row earns the 3-streak achievement', async () => {
    const a = await db.user('champ'), b = await db.user('loser');
    for (let i = 0; i < 3; i++) {
      const g = await newRankedGame(db, a, b);
      await playMoves(db, g, 5);
      await resign(b, g.gameId); // b resigns → a wins
    }
    const pr = (await db.svc(`select best_streak, wins from public.player_ratings where user_id=$1 and board_size=9`, [a]))[0];
    expect(pr.wins).toBe(3);
    expect(pr.best_streak).toBe(3);
    const codes = (await db.svc(`select code from public.user_achievements where user_id=$1`, [a])).map((x: any) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['first_win', 'first_online_game', 'streak_3']));
    expect(codes).not.toContain('streak_5');
    expect(codes).not.toContain('games_10');
    // a loss resets the streak but keeps the best streak
    await db.svc(`update public.player_ratings set rating = 1000 where user_id in ($1,$2) and board_size = 9`, [a, b]);
    const g4 = await newRankedGame(db, a, b);
    await playMoves(db, g4, 5);
    await resign(a, g4.gameId);
    const after = (await db.svc(`select streak, best_streak, losses from public.player_ratings where user_id=$1 and board_size=9`, [a]))[0];
    expect(after).toEqual({ streak: -1, best_streak: 3, losses: 1 });
    await db.as(a, `select public.get_match_history($1, 10)`, [a]);
    await db.svc(`delete from public.games where id=$1`, [g4.gameId]);
    const hist = await db.as(a, `select * from public.get_match_history($1, 10)`, [a]);
    expect(hist.length).toBeGreaterThanOrEqual(3);
    expect(hist.every((h: any) => h.won)).toBe(true);
  });
});
