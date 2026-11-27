import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, errCode, type Db } from './harness.ts';
import { playMoves } from './helpers.ts';

let db: Db;
let admin: string;
const players: string[] = [];

beforeAll(async () => {
  db = await createDb();
  admin = await db.user('boss', { role: 'admin' });
  for (let i = 1; i <= 8; i++) players.push(await db.user(`p${i}`, { rating: 1000 + (9 - i) * 10 })); // p1 is the top seed
});

const create = async (format: string, min = 2, max = 16, size = 9) =>
  (await db.as(admin, `select public.create_tournament('Spring Cup ${format}', 'desc', $1, $2, 'japanese', 300, 0, $3, $4, null, null, 60, null) as id`, [format, size, min, max]))[0].id as string;
const reg = async (t: string, ...us: string[]) => { for (const u of us) await db.as(u, `select public.register_tournament($1)`, [t]); };
const matches = (t: string) => db.svc(`select * from public.tournament_matches where tournament_id=$1 order by round, position`, [t]);

/** Finish the active game of a match with `winner` (the other player resigns after ≥4 moves). */
async function decide(matchId: string, winner: string) {
  const m = (await db.svc(`select * from public.tournament_matches where id=$1`, [matchId]))[0];
  expect(m.status).toBe('active');
  const parts = await db.svc(`select user_id, color from public.game_participants where game_id=$1`, [m.game_id]);
  const black = parts.find((p: any) => p.color === 1).user_id, white = parts.find((p: any) => p.color === 2).user_id;
  await playMoves(db, { black, white, gameId: m.game_id }, 5);
  const loser = winner === black ? white : black;
  await db.as(loser, `select public.resign_game($1)`, [m.game_id]);
}
async function playRound(t: string, round: number, pick: (a: string, b: string) => string) {
  const ms = (await matches(t)).filter((m: any) => m.round === round && m.status === 'active');
  for (const m of ms) await decide(m.id, pick(m.player_a, m.player_b));
}

describe('tournament administration', () => {
  it('only admins create/start tournaments; invalid settings are rejected by constraints', async () => {
    expect(await errCode(db.as(players[0], `select public.create_tournament('Cup','', 'single_elimination', 9,'japanese',300,0,2,8,null,null,60,null)`))).toBe('forbidden');
    expect(await errCode(db.as(admin, `select public.create_tournament('x','', 'single_elimination', 9,'japanese',300,0,2,8,null,null,60,null)`))).toMatch(/violates check/);
    expect(await errCode(db.as(admin, `select public.create_tournament('Cup','', 'swiss', 9,'japanese',300,0,2,8,null,null,60,null)`))).toMatch(/violates check/);
    const t = await create('single_elimination');
    expect(await errCode(db.as(players[0], `select public.start_tournament($1)`, [t]))).toBe('forbidden');
    expect(await errCode(db.as(admin, `select public.start_tournament($1)`, [t]))).toBe('not_enough_players');
  });

  it('registration: join, duplicate, capacity, unregister, closed registration', async () => {
    const t = await create('single_elimination', 2, 3);
    await reg(t, players[0], players[1]);
    expect(await errCode(db.as(players[0], `select public.register_tournament($1)`, [t]))).toBe('already_registered');
    await db.as(players[1], `select public.unregister_tournament($1)`, [t]);
    await reg(t, players[1], players[2]);
    expect(await errCode(db.as(players[3], `select public.register_tournament($1)`, [t]))).toBe('tournament_full');
    const list = await db.as(players[7], `select user_id from public.tournament_participants where tournament_id=$1`, [t]);
    expect(list.length).toBe(3);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    expect(await errCode(db.as(players[5], `select public.register_tournament($1)`, [t]))).toBe('registration_closed');
  });
});

describe('single elimination', () => {
  it('4 players: seeded 1v4, 2v3 → final → champion', async () => {
    const t = await create('single_elimination');
    await reg(t, players[0], players[1], players[2], players[3]);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    let ms = await matches(t);
    expect(ms.length).toBe(3);
    const r1 = ms.filter((m: any) => m.round === 1);
    expect([r1[0].player_a, r1[0].player_b]).toEqual([players[0], players[3]]); // seed 1 v seed 4
    expect([r1[1].player_a, r1[1].player_b]).toEqual([players[1], players[2]]);
    expect(r1.every((m: any) => m.status === 'active' && m.game_id)).toBe(true);
    // the final waits for winners
    expect(ms[2].status).toBe('pending');

    await playRound(t, 1, (a) => a); // higher seeds (player_a) win
    ms = await matches(t);
    expect(ms[2].player_a).toBe(players[0]);
    expect(ms[2].player_b).toBe(players[1]);
    expect(ms[2].status).toBe('active');
    expect(ms[2].game_id).toBeTruthy();

    const tour = async () => (await db.svc(`select status, winner_id, current_round from public.tournaments where id=$1`, [t]))[0];
    expect((await tour()).status).toBe('running');
    await playRound(t, 2, (_a, b) => b); // underdog wins final
    expect(await tour()).toMatchObject({ status: 'finished', winner_id: players[1] });
    const standings = await db.svc(`select user_id, wins, losses, eliminated from public.tournament_participants where tournament_id=$1 order by wins desc`, [t]);
    expect(standings[0].user_id).toBe(players[1]);
    expect(standings[0].wins).toBe(2);
    expect(standings.filter((s: any) => s.eliminated).length).toBe(3);
    // tournament games are ranked games
    expect((await db.svc(`select is_ranked from public.games where id=$1`, [ms[2].game_id]))[0].is_ranked).toBe(true);
  });

  it('5 players → 3 byes for top seeds, bracket advances correctly', async () => {
    const t = await create('single_elimination');
    await reg(t, ...players.slice(0, 5));
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    const seeds = (await db.svc(`select user_id from public.tournament_participants where tournament_id=$1 order by seed`, [t])).map((r: any) => r.user_id);
    let ms = await matches(t);
    expect(ms.length).toBe(7); // 8-slot bracket
    const byes = ms.filter((m: any) => m.status === 'bye');
    expect(byes.length).toBe(3);
    expect(byes.map((m: any) => m.winner_id).sort()).toEqual(seeds.slice(0, 3).sort()); // seeds 1-3 skip round 1
    const active = ms.filter((m: any) => m.status === 'active' && m.round === 1);
    expect(active.length).toBe(1); // only seed 4 v seed 5 is a real round-1 game
    expect(new Set([active[0].player_a, active[0].player_b])).toEqual(new Set(seeds.slice(3, 5)));
    const early = ms.find((m: any) => m.round === 2 && m.status === 'active'); // seeds 2 v 3 (both had byes) start at once
    expect(new Set([early.player_a, early.player_b])).toEqual(new Set([seeds[1], seeds[2]]));
    await playRound(t, 1, (a) => a);
    ms = await matches(t);
    const r2 = ms.filter((m: any) => m.round === 2);
    expect(r2.every((m: any) => m.status === 'active')).toBe(true);
    await playRound(t, 2, (a) => a);
    await playRound(t, 3, (a) => a);
    const tour = (await db.svc(`select status, winner_id from public.tournaments where id=$1`, [t]))[0];
    expect(tour.status).toBe('finished');
    expect(tour.winner_id).toBeTruthy();
  });

  it('forfeit by admin and automatic no-show forfeits', async () => {
    const t = await create('single_elimination');
    await reg(t, players[0], players[1]);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    const m = (await matches(t))[0];
    expect(await errCode(db.as(players[0], `select public.forfeit_match($1,$2)`, [m.id, players[0]]))).toBe('forbidden');
    expect(await db.svc(`select public.process_tournament_deadlines() as n`)).toEqual([{ n: 0 }]);
    await db.svc(`update public.tournament_matches set scheduled_at = now() - interval '2 hours' where id=$1`, [m.id]);
    expect((await db.svc(`select public.process_tournament_deadlines() as n`))[0].n).toBe(1);
    const after = (await matches(t))[0];
    expect(after.status).toBe('forfeit');
    const g = (await db.svc(`select end_reason, status from public.games where id=$1`, [m.game_id]))[0];
    expect(g).toEqual({ end_reason: 'forfeit', status: 'finished' });
    expect((await db.svc(`select status from public.tournaments where id=$1`, [t]))[0].status).toBe('finished');
    // forfeits never change ratings
    expect((await db.svc(`select count(*)::int c from public.rating_history where game_id=$1`, [m.game_id]))[0].c).toBe(0);
  });

  it('draw offers are disallowed in tournament games; cancelling aborts everything', async () => {
    const t = await create('single_elimination');
    await reg(t, players[0], players[1], players[2], players[3]);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    const m = (await matches(t))[0];
    expect(await errCode(db.as(m.player_a, `select public.offer_draw($1)`, [m.game_id]))).toBe('draw_not_allowed');
    await db.as(admin, `select public.cancel_tournament($1)`, [t]);
    expect((await db.svc(`select status from public.tournaments where id=$1`, [t]))[0].status).toBe('cancelled');
    expect((await db.svc(`select status from public.games where id=$1`, [m.game_id]))[0].status).toBe('aborted');
  });
});

describe('round robin', () => {
  it('3 players: 3 rounds, everyone plays everyone once, standings decide the winner', async () => {
    const t = await create('round_robin');
    await reg(t, players[0], players[1], players[2]);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    let ms = await matches(t);
    expect(ms.length).toBe(6); // 4 slots × 3 rounds / 2
    const real = ms.filter((m: any) => m.status !== 'bye');
    expect(real.length).toBe(3);
    const pairs = new Set(real.map((m: any) => [m.player_a, m.player_b].sort().join('|')));
    expect(pairs.size).toBe(3);

    const tour = async () => (await db.svc(`select status, current_round, winner_id from public.tournaments where id=$1`, [t]))[0];
    // seed order wins: lower index player wins every match
    const rank = (u: string) => players.indexOf(u);
    for (let round = 1; round <= 3; round++) {
      expect((await tour()).current_round).toBe(round);
      await playRound(t, round, (a, b) => (rank(a) < rank(b) ? a : b));
    }
    const final = await tour();
    expect(final.status).toBe('finished');
    expect(final.winner_id).toBe(players[0]);
    const st = await db.svc(`select user_id, points, wins, losses from public.tournament_participants where tournament_id=$1 order by points desc, wins desc`, [t]);
    expect(st.map((s: any) => Number(s.points))).toEqual([2, 1, 0]);
  });

  it('4 players: 3 rounds × 2 simultaneous games', async () => {
    const t = await create('round_robin');
    await reg(t, ...players.slice(0, 4));
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    const ms = await matches(t);
    expect(ms.length).toBe(6);
    expect(ms.filter((m: any) => m.round === 1 && m.status === 'active').length).toBe(2);
    expect(ms.filter((m: any) => m.round === 2 && m.status === 'pending').length).toBe(2);
    const rank = (u: string) => players.indexOf(u);
    for (let round = 1; round <= 3; round++) await playRound(t, round, (a, b) => (rank(a) < rank(b) ? a : b));
    expect((await db.svc(`select status, winner_id from public.tournaments where id=$1`, [t]))[0]).toEqual({ status: 'finished', winner_id: players[0] });
  });

  it('tournament visibility: drafts are admin-only; matches and standings are public', async () => {
    await db.svc(`update public.tournaments set status='draft' where id = (select id from public.tournaments where format='round_robin' limit 1)`);
    const visible = await db.as(players[0], `select id from public.tournaments`);
    const all = await db.svc(`select id from public.tournaments`);
    expect(visible.length).toBe(all.length - 1);
    expect((await db.anon(`select id from public.tournament_matches limit 1`)).length).toBe(1);
  });
});
