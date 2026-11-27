import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, errCode, type Db } from './harness.ts';
import { newRankedGame } from './helpers.ts';

let db: Db;
let alice: string, bob: string, carol: string, admin: string, mod: string;

beforeAll(async () => {
  db = await createDb();
  alice = await db.user('alice');
  bob = await db.user('bob');
  carol = await db.user('carol');
  admin = await db.user('root', { role: 'admin' });
  mod = await db.user('mod', { role: 'moderator' });
});

describe('authentication & profiles', () => {
  it('creates a profile and three ratings when an auth user is created', async () => {
    const p = await db.svc(`select username, language, role from public.profiles where id=$1`, [alice]);
    expect(p[0]).toEqual({ username: 'alice', language: 'az', role: 'user' });
    const r = await db.svc(`select count(*)::int c from public.player_ratings where user_id=$1`, [alice]);
    expect(r[0].c).toBe(3);
  });

  it('generates unique usernames on collision', async () => {
    const id = await db.pg.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data) values ('x@e.com', '{"username":"alice"}') returning id`,
    );
    const p = await db.svc(`select username from public.profiles where id=$1`, [id.rows[0].id]);
    expect(p[0].username).toBe('alice1');
  });

  it('users can edit their own safe fields', async () => {
    await db.as(alice, `update public.profiles set bio='hello', country='AZ', language='en' where id=$1`, [alice]);
    const p = await db.svc(`select bio, country, language from public.profiles where id=$1`, [alice]);
    expect(p[0]).toEqual({ bio: 'hello', country: 'AZ', language: 'en' });
  });

  it('users CANNOT escalate their own role or unban themselves', async () => {
    expect(await errCode(db.as(alice, `update public.profiles set role='admin' where id=$1`, [alice]))).toMatch(/raw:.*permission denied/);
    expect(await errCode(db.as(alice, `update public.profiles set banned_until=null where id=$1`, [alice]))).toMatch(/permission denied/);
    const p = await db.svc(`select role from public.profiles where id=$1`, [alice]);
    expect(p[0].role).toBe('user');
  });

  it("users cannot edit another user's profile", async () => {
    const r = await db.as(alice, `update public.profiles set bio='pwned' where id=$1 returning id`, [bob]);
    expect(r.length).toBe(0);
    const p = await db.svc(`select bio from public.profiles where id=$1`, [bob]);
    expect(p[0].bio).toBe('');
  });

  it('validates profile fields with constraints', async () => {
    expect(await errCode(db.as(alice, `update public.profiles set username='a b' where id=$1`, [alice]))).toMatch(/violates check/);
    expect(await errCode(db.as(alice, `update public.profiles set country='az' where id=$1`, [alice]))).toMatch(/violates check/);
    expect(await errCode(db.as(alice, `update public.profiles set username='BOB' where id=$1`, [alice]))).toMatch(/duplicate key/);
  });
});

describe('row level security', () => {
  it('clients cannot write games, moves or ratings directly', async () => {
    const g = await newRankedGame(db, alice, bob, 9, 300, 0);
    expect(await errCode(db.as(alice, `update public.games set winner=1, status='finished' where id=$1`, [g.gameId]))).toMatch(/permission denied/);
    expect(await errCode(db.as(alice, `insert into public.game_moves (game_id, move_number, color, p) values ($1, 1, 1, 5)`, [g.gameId]))).toMatch(/permission denied/);
    expect(await errCode(db.as(alice, `update public.player_ratings set rating = 3000 where user_id=$1`, [alice]))).toMatch(/permission denied/);
    expect(await errCode(db.as(alice, `insert into public.games (board_size) values (9)`))).toMatch(/permission denied/);
    await db.as(alice, `select public.resign_game($1)`, [g.gameId]);
  });

  it('service-only functions are not callable by users or anonymous visitors', async () => {
    const g = await newRankedGame(db, alice, bob, 9, 600, 0);
    expect(await errCode(db.as(alice, `select public.svc_get_game($1)`, [g.gameId]))).toMatch(/permission denied/);
    expect(await errCode(db.as(alice, `select public.svc_apply_game_update($1,0,'{}'::jsonb,null,null)`, [g.gameId]))).toMatch(/permission denied/);
    expect(await errCode(db.as(alice, `select public.sweep_timeouts()`))).toMatch(/permission denied/);
    expect(await errCode(db.anon(`select public.join_matchmaking(9,300,0)`))).toMatch(/permission denied/);
    await db.as(alice, `select public.resign_game($1)`, [g.gameId]);
  });

  it('private waiting rooms are invisible to non-participants; spectators can watch public games', async () => {
    const room = (await db.as(alice, `select public.create_private_game(9, 300, 0) as r`))[0].r;
    expect((await db.as(bob, `select id from public.games where id=$1`, [room.game_id])).length).toBe(0);
    expect((await db.as(alice, `select id from public.games where id=$1`, [room.game_id])).length).toBe(1);
    expect((await db.anon(`select id from public.games where id=$1`, [room.game_id])).length).toBe(0);
    await db.as(alice, `select public.cancel_room($1)`, [room.game_id]);

    const g = await newRankedGame(db, alice, bob, 9, 300, 0); // public ranked game
    expect((await db.as(carol, `select id from public.games where id=$1`, [g.gameId])).length).toBe(1);
    await db.as(alice, `select public.resign_game($1)`, [g.gameId]);
  });

  it('private active games stay hidden from outsiders (moves too)', async () => {
    const room = (await db.as(alice, `select public.create_private_game(9, 300, 0) as r`))[0].r;
    await db.as(bob, `select public.join_game_by_code($1)`, [room.invite_code]);
    expect((await db.as(carol, `select id from public.games where id=$1`, [room.game_id])).length).toBe(0);
    expect((await db.as(carol, `select * from public.game_participants where game_id=$1`, [room.game_id])).length).toBe(0);
    expect((await db.as(bob, `select * from public.game_participants where game_id=$1`, [room.game_id])).length).toBe(2);
    await db.as(alice, `select public.resign_game($1)`, [room.game_id]);
  });

  it('non-participants cannot resign, offer draws or claim timeouts', async () => {
    const g = await newRankedGame(db, alice, bob, 9, 300, 0);
    expect(await errCode(db.as(carol, `select public.resign_game($1)`, [g.gameId]))).toBe('forbidden');
    expect(await errCode(db.as(carol, `select public.offer_draw($1)`, [g.gameId]))).toBe('forbidden');
    expect(await errCode(db.as(carol, `select public.claim_timeout($1)`, [g.gameId]))).toBe('forbidden');
    await db.as(alice, `select public.resign_game($1)`, [g.gameId]);
  });

  it('audit log is readable by admins only', async () => {
    await db.as(admin, `select public.admin_set_role($1, 'moderator')`, [carol]);
    expect((await db.as(alice, `select * from public.audit_log`)).length).toBe(0);
    expect((await db.as(admin, `select * from public.audit_log`)).length).toBeGreaterThan(0);
    await db.as(admin, `select public.admin_set_role($1, 'user')`, [carol]);
  });

  it('rate_limits table is inaccessible to clients', async () => {
    expect(await errCode(db.as(alice, `select * from public.rate_limits`))).toMatch(/permission denied/);
  });
});

describe('admin authorization (enforced in the database)', () => {
  it('non-admins are refused', async () => {
    expect(await errCode(db.as(alice, `select public.admin_set_role($1,'admin')`, [alice]))).toBe('forbidden');
    expect(await errCode(db.as(alice, `select public.admin_list_users()`))).toBe('forbidden');
    expect(await errCode(db.as(alice, `select public.admin_stats()`))).toBe('forbidden');
    expect(await errCode(db.as(alice, `select public.admin_ban_user($1, now() + interval '1 day', 'x')`, [bob]))).toBe('forbidden');
    expect(await errCode(db.as(alice, `insert into public.lessons (slug,title,summary) values ('x1','{"az":"a","en":"a","ru":"a"}','{"az":"a","en":"a","ru":"a"}')`))).toMatch(/row-level security/);
    expect(await errCode(db.as(alice, `select public.create_tournament('Cup','', 'single_elimination', 9,'japanese',300,0,2,8,null,null,60,null)`))).toBe('forbidden');
  });

  it('moderators can moderate but cannot change roles or manage tournaments', async () => {
    expect((await db.as(mod, `select public.admin_stats() as s`))[0].s.users).toBeGreaterThan(0);
    expect(await errCode(db.as(mod, `select public.admin_set_role($1,'admin')`, [alice]))).toBe('forbidden');
    expect(await errCode(db.as(mod, `select public.create_tournament('Cup','', 'round_robin', 9,'japanese',300,0,2,8,null,null,60,null)`))).toBe('forbidden');
  });

  it('admins can ban; staff cannot ban admins; banned users cannot play', async () => {
    await db.as(admin, `select public.admin_ban_user($1, now() + interval '1 day', 'cheating')`, [carol]);
    expect(await errCode(db.as(carol, `select public.join_matchmaking(9,300,0)`))).toBe('banned');
    expect(await errCode(db.as(mod, `select public.admin_ban_user($1, now() + interval '1 day', 'x')`, [admin]))).toBe('forbidden');
    await db.as(admin, `select public.admin_ban_user($1, null, null)`, [carol]);
    expect(await errCode(db.as(carol, `select public.join_matchmaking(9,300,0)`))).toBe('no_error');
    await db.as(carol, `select public.leave_matchmaking()`);
  });

  it('admin actions are written to the audit log', async () => {
    const a = await db.svc(`select action from public.audit_log where action in ('user.ban','user.set_role')`);
    expect(a.length).toBeGreaterThan(1);
  });
});

describe('rate limiting', () => {
  it('limits message flooding', async () => {
    const u1 = await db.user('flood1');
    const u2 = await db.user('flood2');
    await db.as(u1, `select public.send_friend_request($1)`, [u2]);
    await db.as(u2, `select public.send_friend_request($1)`, [u1]); // auto-accepts
    let last = 'no_error';
    for (let i = 0; i < 35; i++) last = await errCode(db.as(u1, `select public.send_message($1, 'hi')`, [u2]));
    expect(last).toBe('rate_limited');
  });
});
