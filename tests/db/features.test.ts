import { beforeAll, describe, expect, it } from 'vitest';
import { BANK, dailyPick } from '../../src/content/bank.ts';
import { createDb, errCode, type Db } from './harness.ts';
import { newRankedGame, playMoves } from './helpers.ts';

let db: Db;
let admin: string, mod: string; const u: Record<string, string> = {};

beforeAll(async () => {
  db = await createDb();
  admin = await db.user('boss', { role: 'admin' }); mod = await db.user('mod', { role: 'moderator' });
  for (const n of ['ann', 'ben', 'cat', 'dan', 'eve', 'fay']) u[n] = await db.user(n);
  for (const p of BANK) {
    await db.svc(`insert into public.puzzles (id, difficulty, kind, shape, puzzle) values ($1,$2,$3,$4,$5::jsonb)`, [p.id, p.difficulty, p.kind, p.shape ?? null, JSON.stringify({ size: p.size, rows: p.rows, toPlay: p.toPlay })]);
    await db.svc(`insert into public.puzzle_solutions (puzzle_id, points) values ($1, $2::int[])`, [p.id, `{${p.points.join(',')}}`]);
  }
});

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());

describe('daily puzzles', () => {
  it('serves 3 difficulties per day without ever exposing answers; no peeking at the future', async () => {
    const set = await db.as(u.ann, `select * from public.get_daily_set()`);
    expect(set.map((s: any) => s.difficulty)).toEqual([1, 2, 3]);
    expect(JSON.stringify(set)).not.toMatch(/points|solution/);
    expect(set.every((s: any) => s.solved === false)).toBe(true);
    expect(await errCode(db.as(u.ann, `select * from public.get_daily_set(current_date + 2)`))).toBe('invalid_settings');
  });

  it('SQL rotation equals the client rotation for 40 consecutive days (guests and members see the same puzzle)', async () => {
    for (let i = 0; i < 40; i++) {
      const day = iso(new Date(Date.UTC(2026, 0, 1 + i)));
      const rows = await db.svc(`select difficulty, puzzle_id from public.get_daily_set($1::date)`, [day]).catch(() => null);
      // get_daily_set refuses future days → query the helper directly for arbitrary dates
      for (const d of [1, 2, 3] as const) {
        const id = (await db.svc(`select public.daily_puzzle_id($1::date, $2) as id`, [day, d]))[0].id;
        expect(id, `${day} d${d}`).toBe(dailyPick(day, d).id);
      }
      void rows;
    }
  });

  it('admin scheduling overrides the rotation', async () => {
    const day = today();
    const other = BANK.find((p) => p.difficulty === 1 && p.id !== dailyPick(day, 1).id)!;
    await db.as(admin, `insert into public.daily_challenges (day, difficulty, puzzle_id) values ($1::date, 1, $2)`, [day, other.id]);
    expect((await db.as(u.ann, `select puzzle_id from public.get_daily_set() where difficulty = 1`))[0].puzzle_id).toBe(other.id);
    expect(await errCode(db.as(u.ann, `insert into public.daily_challenges (day, difficulty, puzzle_id) values (current_date, 2, 'cap-1')`))).toMatch(/row-level security/);
    await db.svc(`delete from public.daily_challenges`);
  });

  it('validates answers on the server: wrong move rejected, right move recorded once, daily completion tracked', async () => {
    const pid = (await db.as(u.ann, `select puzzle_id from public.get_daily_set() where difficulty = 1`))[0].puzzle_id;
    const pz = BANK.find((p) => p.id === pid)!;
    const wrong = [...Array(81).keys()].find((p) => !pz.points.includes(p))!;
    expect((await db.as(u.ann, `select public.solve_puzzle($1,$2) as r`, [pid, wrong]))[0].r).toMatchObject({ correct: false });
    expect((await db.svc(`select count(*)::int c from public.puzzle_solves where user_id=$1`, [u.ann]))[0].c).toBe(0);
    const r1 = (await db.as(u.ann, `select public.solve_puzzle($1,$2) as r`, [pid, pz.points[0]]))[0].r;
    expect(r1).toMatchObject({ correct: true, first_solve: true, kind: pz.kind });
    const r2 = (await db.as(u.ann, `select public.solve_puzzle($1,$2) as r`, [pid, pz.points[0]]))[0].r;
    expect(r2.first_solve).toBe(false);
    expect((await db.as(u.ann, `select solved from public.get_daily_set() where difficulty = 1`))[0].solved).toBe(true);
    expect((await db.as(u.ann, `select public.get_daily_streak() as s`))[0].s).toMatchObject({ current: 1, best: 1, solved_today: true });
    expect(await errCode(db.anon(`select public.solve_puzzle('cap-1', 1)`))).toMatch(/permission denied/);
    expect(await errCode(db.as(u.ann, `select public.solve_puzzle('nope', 1)`))).toBe('puzzle_not_found');
  });

  it('streak maths: consecutive days count, a gap resets the current streak but keeps the best', async () => {
    const d = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
    // ben: today, yesterday, 2 days ago (streak 3) + an older run of 5 days
    for (const n of [0, 1, 2, 10, 11, 12, 13, 14]) await db.svc(`insert into public.daily_completions (user_id, day, difficulty) values ($1,$2::date,1)`, [u.ben, d(n)]);
    expect((await db.as(u.ben, `select public.get_daily_streak() as s`))[0].s).toMatchObject({ current: 3, best: 5, days: 8 });
    // cat: last solved 3 days ago → current streak is broken
    for (const n of [3, 4]) await db.svc(`insert into public.daily_completions (user_id, day, difficulty) values ($1,$2::date,1)`, [u.cat, d(n)]);
    expect((await db.as(u.cat, `select public.get_daily_streak() as s`))[0].s).toMatchObject({ current: 0, best: 2 });
    // dan: solved yesterday only → streak still alive (today's puzzle not yet solved)
    await db.svc(`insert into public.daily_completions (user_id, day, difficulty) values ($1,$2::date,1)`, [u.dan, d(1)]);
    expect((await db.as(u.dan, `select public.get_daily_streak() as s`))[0].s).toMatchObject({ current: 1, solved_today: false });
    expect((await db.anon(`select public.get_player_stats($1) as s`, [u.ben]))[0].s.daily_best).toBe(5);
  });

  it('reveal requires sign-in; achievements follow real solves (10 puzzles, 7-day streak)', async () => {
    expect(await errCode(db.anon(`select public.reveal_puzzle('cap-1')`))).toMatch(/permission denied/);
    expect((await db.as(u.eve, `select public.reveal_puzzle('cap-2') as p`))[0].p).toEqual(BANK.find((p) => p.id === 'cap-2')!.points);
    expect((await db.svc(`select count(*)::int c from public.puzzle_solves where user_id=$1`, [u.eve]))[0].c).toBe(0); // revealing is not solving
    for (const p of BANK.slice(0, 10)) await db.as(u.eve, `select public.solve_puzzle($1,$2)`, [p.id, p.points[0]]);
    const codes = (await db.svc(`select code from public.user_achievements where user_id=$1`, [u.eve])).map((r: any) => r.code);
    expect(codes).toContain('puzzle_10');
    for (let n = 1; n <= 6; n++) await db.svc(`insert into public.daily_completions (user_id, day, difficulty) values ($1, current_date - $2::int, 1)`, [u.fay, n]);
    await db.as(u.fay, `select public.solve_puzzle($1,$2)`, [dailyPick(today(), 1).id, dailyPick(today(), 1).points[0]]);
    expect((await db.svc(`select code from public.user_achievements where user_id=$1 and code='daily_streak_7'`, [u.fay])).length).toBe(1);
  });
});

describe('shareable replays, live games & spectator commentary', () => {
  it('private game replays are hidden until a participant shares them (finished games only)', async () => {
    const room = (await db.as(u.ann, `select public.create_private_game(9, 0, 0) as r`))[0].r;
    await db.as(u.ben, `select public.join_game_by_code($1)`, [room.invite_code]);
    expect(await errCode(db.as(u.ann, `select public.set_replay_shared($1, true)`, [room.game_id]))).toBe('game_not_finished');
    await db.as(u.ann, `select public.resign_game($1)`, [room.game_id]);
    expect((await db.as(u.cat, `select id from public.games where id=$1`, [room.game_id])).length).toBe(0);
    expect(await errCode(db.as(u.cat, `select public.set_replay_shared($1, true)`, [room.game_id]))).toBe('forbidden');
    await db.as(u.ben, `select public.set_replay_shared($1, true)`, [room.game_id]);
    expect((await db.as(u.cat, `select id from public.games where id=$1`, [room.game_id])).length).toBe(1);
    expect((await db.anon(`select id from public.games where id=$1`, [room.game_id])).length).toBe(1);
    await db.as(u.ann, `select public.set_replay_shared($1, false)`, [room.game_id]);
    expect((await db.anon(`select id from public.games where id=$1`, [room.game_id])).length).toBe(0);
  });

  it('live list shows public running games only; commentary is spectator-only while the game runs', async () => {
    const g = await newRankedGame(db, u.ann, u.ben);
    expect((await db.anon(`select * from public.list_live_games(10)`)).length).toBe(0); // no moves yet
    await playMoves(db, g, 3);
    const live = await db.anon(`select * from public.list_live_games(10)`);
    expect(live.length).toBe(1);
    expect(live[0]).toMatchObject({ board_size: 9, move_count: 3 });
    // spectator posts; players can neither post nor read during the game
    await db.as(u.cat, `select public.post_game_comment($1, 'Nice hane!')`, [g.gameId]);
    expect(await errCode(db.as(g.black, `select public.post_game_comment($1, 'help me')`, [g.gameId]))).toBe('forbidden');
    expect((await db.as(g.black, `select * from public.game_comments where game_id=$1`, [g.gameId])).length).toBe(0);
    expect((await db.as(u.dan, `select body from public.game_comments where game_id=$1`, [g.gameId])).map((r: any) => r.body)).toEqual(['Nice hane!']);
    expect((await db.as(u.cat, `select move_number from public.game_comments where game_id=$1`, [g.gameId]))[0].move_number).toBe(3);
    expect(await errCode(db.anon(`select public.post_game_comment($1,'x')`, [g.gameId]))).toMatch(/permission denied/);
    expect(await errCode(db.as(u.cat, `select public.post_game_comment($1, '')`, [g.gameId]))).toBe('invalid_message');
    // after the game the players can read it (and join in)
    await db.as(g.black, `select public.resign_game($1)`, [g.gameId]);
    expect((await db.as(g.black, `select * from public.game_comments where game_id=$1`, [g.gameId])).length).toBe(1);
    await db.as(g.black, `select public.post_game_comment($1, 'gg')`, [g.gameId]);
    // moderation: staff can hide
    const cid = (await db.svc(`select id from public.game_comments where body='Nice hane!'`))[0].id;
    expect(await errCode(db.as(u.cat, `select public.admin_hide_comment($1, true)`, [cid]))).toBe('forbidden');
    await db.as(mod, `select public.admin_hide_comment($1, true)`, [cid]);
    expect((await db.as(u.dan, `select * from public.game_comments where game_id=$1`, [g.gameId])).map((r: any) => r.body)).toEqual(['gg']);
  });

  it('private running games never appear in the live list or to spectators', async () => {
    const room = (await db.as(u.ann, `select public.create_private_game(9, 0, 0) as r`))[0].r;
    await db.as(u.ben, `select public.join_game_by_code($1)`, [room.invite_code]);
    expect((await db.anon(`select * from public.list_live_games(10)`)).length).toBe(0);
    expect(await errCode(db.as(u.cat, `select public.post_game_comment($1,'hi')`, [room.game_id]))).toBe('game_not_found');
    await db.as(u.ann, `select public.resign_game($1)`, [room.game_id]);
  });
});

describe('seasons, medals and weekly tournaments', () => {
  it('closing a finished season ranks by rating gained, awards medals once, and refuses the running month', async () => {
    const mk = async (name: string, deltas: number[]) => {
      const id = await db.user(name);
      for (const [i, d] of deltas.entries()) await db.svc(`insert into public.rating_history (user_id, game_id, board_size, old_rating, new_rating, delta, created_at) values ($1, gen_random_uuid(), 9, 1000, $2, $3, '2025-06-10'::timestamptz + ($4 || ' hours')::interval)`, [id, 1000 + d, d, i]);
      return id;
    };
    const a = await mk('s_gold', [20, 20, 20]), b = await mk('s_silver', [15, 10, 5]), c = await mk('s_bronze', [10, 5, 5]), d = await mk('s_none', [30, 30]);
    await mk('s_fourth', [4, 3, 2]);
    expect(await errCode(db.as(u.ann, `select public.close_season('2025-06')`))).toBe('forbidden');
    expect(await errCode(db.as(admin, `select public.close_season(to_char(now(), 'YYYY-MM'))`))).toBe('season_not_finished');
    expect(await db.as(admin, `select public.close_season('2025-06') as n`)).toEqual([{ n: 4 }]); // 4 players have >= 3 rated games
    const res = await db.anon(`select * from public.get_season_results('2025-06', 9)`);
    expect(res.map((r: any) => r.username)).toEqual(['s_gold', 's_silver', 's_bronze', 's_fourth']);
    expect(res[0]).toMatchObject({ rank: 1, gain: 60, games: 3 });
    const medals = await db.anon(`select user_id, kind from public.user_medals where ref = '2025-06' order by kind`);
    expect(medals.map((m: any) => m.kind).sort()).toEqual(['season_bronze', 'season_gold', 'season_silver']);
    expect(medals.find((m: any) => m.kind === 'season_gold').user_id).toBe(a);
    expect((await db.svc(`select code from public.user_achievements where user_id=$1 and code='season_medal'`, [a])).length).toBe(1);
    expect((await db.svc(`select code from public.user_achievements where user_id=$1`, [d])).length).toBe(0); // only 2 games → not ranked
    await db.as(admin, `select public.close_season('2025-06')`); // idempotent
    expect((await db.svc(`select count(*)::int c from public.user_medals where ref='2025-06'`))[0].c).toBe(3);
    expect((await db.anon(`select * from public.list_seasons() as s`)).map((r: any) => r.s)).toContain('2025-06');
    void b; void c;
  });

  it('weekly cups are created idempotently by the scheduler/admin only; start_due starts or cancels', async () => {
    expect(await errCode(db.as(u.ann, `select public.ensure_weekly_tournaments()`))).toBe('forbidden');
    expect(await db.as(admin, `select public.ensure_weekly_tournaments() as n`)).toEqual([{ n: 2 }]);
    expect(await db.as(admin, `select public.ensure_weekly_tournaments() as n`)).toEqual([{ n: 0 }]);
    const cups = await db.anon(`select id, board_size, recurrence, starts_at, status from public.tournaments where recurrence='weekly' order by board_size`);
    expect(cups.map((c: any) => c.board_size)).toEqual([9, 13]);
    expect(new Date(cups[0].starts_at).getUTCDay()).toBe(6);
    expect(new Date(cups[0].starts_at).getUTCHours()).toBe(17);
    // 9x9 cup: 4 players register → started when due; 13x13 cup: nobody → cancelled
    for (const n of ['ann', 'ben', 'cat', 'dan']) await db.as(u[n], `select public.register_tournament($1)`, [cups[0].id]);
    await db.svc(`update public.tournaments set starts_at = now() - interval '1 minute' where recurrence='weekly'`);
    expect(await db.svc(`select public.start_due_tournaments() as n`)).toEqual([{ n: 1 }]);
    const after = await db.anon(`select board_size, status from public.tournaments where recurrence='weekly' order by board_size`);
    expect(after).toEqual([{ board_size: 9, status: 'running' }, { board_size: 13, status: 'cancelled' }]);
    expect((await db.svc(`select count(*)::int c from public.tournament_matches where tournament_id=$1`, [cups[0].id]))[0].c).toBe(3);
  });

  it('tournament medals: champion gold, finalist silver, semi-final losers bronze; achievement follows', async () => {
    const t = (await db.as(admin, `select public.create_tournament('Medal Cup','', 'single_elimination', 9,'japanese',300,0,2,8,null,null,60,null) as id`))[0].id;
    const four = [await db.user('m1'), await db.user('m2'), await db.user('m3'), await db.user('m4')];
    for (const x of four) await db.as(x, `select public.register_tournament($1)`, [t]);
    await db.as(admin, `select public.start_tournament($1)`, [t]);
    const play = async (round: number) => {
      for (const m of await db.svc(`select * from public.tournament_matches where tournament_id=$1 and round=$2 and status='active'`, [t, round])) {
        const parts = await db.svc(`select user_id, color from public.game_participants where game_id=$1`, [m.game_id]);
        await playMoves(db, { black: parts.find((p: any) => p.color === 1).user_id, white: parts.find((p: any) => p.color === 2).user_id, gameId: m.game_id }, 5);
        await db.as(m.player_b, `select public.resign_game($1)`, [m.game_id]); // player_a wins
      }
    };
    await play(1); await play(2);
    const medals = await db.svc(`select kind, count(*)::int n from public.user_medals where ref=$1 group by kind order by kind`, [t]);
    expect(medals).toEqual([{ kind: 'tournament_bronze', n: 2 }, { kind: 'tournament_gold', n: 1 }, { kind: 'tournament_silver', n: 1 }]);
    const champ = (await db.svc(`select winner_id from public.tournaments where id=$1`, [t]))[0].winner_id;
    expect((await db.svc(`select code from public.user_achievements where user_id=$1 and code='tournament_win'`, [champ])).length).toBe(1);
  });
});

describe('personalization storage and player statistics', () => {
  it('users store prefs on their own profile only, size-limited', async () => {
    await db.as(u.ann, `update public.profiles set prefs = $2::jsonb where id=$1`, [u.ann, JSON.stringify({ boardTheme: 'walnut', stoneStyle: 'slate', sound: { on: true, volume: 0.5 }, clocks: [{ initial: 300, increment: 3 }] })]);
    expect((await db.as(u.ben, `select prefs from public.profiles where id=$1`, [u.ann]))[0].prefs.boardTheme).toBe('walnut');
    expect((await db.as(u.ann, `update public.profiles set prefs = '{"x":1}'::jsonb where id=$1 returning id`, [u.ben])).length).toBe(0);
    expect(await errCode(db.as(u.ann, `update public.profiles set prefs = '[1]'::jsonb where id=$1`, [u.ann]))).toMatch(/violates check/);
    expect(await errCode(db.as(u.ann, `update public.profiles set prefs = $2::jsonb where id=$1`, [u.ann, JSON.stringify({ big: 'x'.repeat(5000) })]))).toMatch(/violates check/);
  });

  it('head-to-head and form are computed from real finished games', async () => {
    const x = await db.user('h2h_a'), y = await db.user('h2h_b');
    for (let i = 0; i < 3; i++) { const g = await newRankedGame(db, x, y); await playMoves(db, g, 5); await db.as(y, `select public.resign_game($1)`, [g.gameId]); }
    const h = (await db.as(x, `select public.get_head_to_head($1) as h`, [y]))[0].h;
    expect(h).toEqual({ games: 3, wins: 3, losses: 0, draws: 0 });
    expect((await db.as(y, `select public.get_head_to_head($1) as h`, [x]))[0].h).toMatchObject({ wins: 0, losses: 3 });
    expect((await db.anon(`select public.get_player_stats($1) as s`, [x]))[0].s.form).toBe('WWW');
    expect((await db.anon(`select public.get_player_stats($1) as s`, [y]))[0].s.form).toBe('LLL');
  });
});
