import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, errCode, type Db } from './harness.ts';

let db: Db;
let a: string, b: string, c: string, admin: string, mod: string;

beforeAll(async () => {
  db = await createDb();
  a = await db.user('amy'); b = await db.user('bob'); c = await db.user('cleo');
  admin = await db.user('adm', { role: 'admin' }); mod = await db.user('mod', { role: 'moderator' });
});

describe('friends', () => {
  it('request → accept → list with online status', async () => {
    expect((await db.as(a, `select public.send_friend_request($1) as r`, [b]))[0].r).toBe('sent');
    expect((await db.as(a, `select public.send_friend_request($1) as r`, [b]))[0].r).toBe('already_sent');
    expect(await errCode(db.as(a, `select public.send_friend_request($1)`, [a]))).toBe('invalid_target');
    const incoming = await db.as(b, `select * from public.get_friends()`);
    expect(incoming[0]).toMatchObject({ user_id: a, status: 'pending', incoming: true });
    await db.as(b, `select public.respond_friend_request($1, true)`, [incoming[0].friendship_id]);
    expect((await db.as(a, `select public.send_friend_request($1) as r`, [b]))[0].r).toBe('already_friends');
    await db.as(b, `select public.touch_presence()`);
    const fl = await db.as(a, `select * from public.get_friends()`);
    expect(fl[0]).toMatchObject({ user_id: b, status: 'accepted', online: true });
    // privacy: hide online status
    await db.as(b, `update public.profiles set show_online=false where id=$1`, [b]);
    expect((await db.as(a, `select * from public.get_friends()`))[0]).toMatchObject({ online: false, last_seen_at: null });
  });

  it('a crossing request auto-accepts; only the addressee can respond', async () => {
    await db.as(a, `select public.send_friend_request($1)`, [c]);
    const req = (await db.as(c, `select * from public.get_friends()`))[0];
    expect(await errCode(db.as(b, `select public.respond_friend_request($1, true)`, [req.friendship_id]))).toBe('request_not_found');
    expect((await db.as(c, `select public.send_friend_request($1) as r`, [a]))[0].r).toBe('accepted');
  });

  it('friendships are only visible to the two users', async () => {
    const x = await db.user('xx'), y = await db.user('yy');
    await db.as(x, `select public.send_friend_request($1)`, [y]);
    expect((await db.as(c, `select * from public.friendships where requester_id=$1`, [x])).length).toBe(0);
  });
});

describe('private messages', () => {
  it('only friends can message; messages are private to sender & recipient', async () => {
    const stranger = await db.user('stranger');
    expect(await errCode(db.as(a, `select public.send_message($1,'hi')`, [stranger]))).toBe('not_friends');
    await db.as(a, `select public.send_message($1, 'salam!')`, [b]);
    expect((await db.as(b, `select body from public.messages`)).map((m: any) => m.body)).toEqual(['salam!']);
    expect((await db.as(c, `select body from public.messages`)).length).toBe(0);
    expect((await db.as(stranger, `select body from public.messages`)).length).toBe(0);
    expect(await errCode(db.as(a, `select public.send_message($1, '')`, [b]))).toBe('invalid_message');
    expect(await errCode(db.as(a, `select public.send_message($1, $2)`, [b, 'x'.repeat(1001)]))).toBe('invalid_message');
    expect(await errCode(db.as(a, `insert into public.messages (sender_id, recipient_id, body) values ($1,$2,'forged')`, [a, b]))).toMatch(/permission denied/);
    const unread = (await db.as(b, `select * from public.get_friends()`)).find((f: any) => f.user_id === a).unread;
    expect(unread).toBe(1);
    await db.as(b, `select public.mark_messages_read($1)`, [a]);
    expect((await db.as(b, `select * from public.get_friends()`)).find((f: any) => f.user_id === a).unread).toBe(0);
  });

  it('blocking removes the friendship and stops messages and requests', async () => {
    await db.as(b, `select public.block_user($1)`, [a]);
    expect(await errCode(db.as(a, `select public.send_message($1,'hello?')`, [b]))).toMatch(/not_friends|blocked/);
    expect(await errCode(db.as(a, `select public.send_friend_request($1)`, [b]))).toBe('blocked');
    expect((await db.as(b, `select * from public.get_friends() where user_id=$1`, [a])).length).toBe(0);
    await db.as(b, `select public.unblock_user($1)`, [a]);
    expect((await db.as(a, `select public.send_friend_request($1) as r`, [b]))[0].r).toBe('sent');
  });
});

describe('reports & moderation', () => {
  it('reports are visible to the reporter and staff only; staff can hide messages and resolve', async () => {
    const m = (await db.as(a, `select public.send_message($1,'you suck') as id`, [c]))[0].id;
    const rid = (await db.as(c, `select public.report_user($1,'harassment','rude',$2,null) as id`, [a, m]))[0].id;
    expect(await errCode(db.as(c, `select public.report_user($1,'bogus','',null,null)`, [a]))).toMatch(/violates check/);
    expect((await db.as(b, `select * from public.reports`)).length).toBe(0);
    expect((await db.as(c, `select * from public.reports`)).length).toBe(1);
    expect((await db.as(mod, `select * from public.reports`)).length).toBe(1);
    expect(await errCode(db.as(a, `select public.admin_hide_message($1,true)`, [m]))).toBe('forbidden');
    await db.as(mod, `select public.admin_hide_message($1,true)`, [m]);
    expect((await db.as(c, `select * from public.messages where id=$1`, [m])).length).toBe(0); // hidden for recipient
    expect((await db.as(a, `select * from public.messages where id=$1`, [m])).length).toBe(1); // sender still sees theirs
    const msgs = await db.as(mod, `select * from public.admin_list_messages($1, 50)`, [a]);
    expect(msgs.length).toBeGreaterThan(0);
    expect((await db.svc(`select * from public.audit_log where action='message.review'`)).length).toBe(1); // reviewing DMs is audited
    await db.as(mod, `select public.admin_resolve_report($1,'resolved','warned')`, [rid]);
    expect((await db.as(c, `select status from public.reports where id=$1`, [rid]))[0].status).toBe('resolved');
    const users = await db.as(admin, `select * from public.admin_list_users('am', 10, 0)`);
    expect(users.map((u: any) => u.username)).toContain('amy');
  });
});

describe('learning, daily challenge and achievements', () => {
  const t = (s: string) => JSON.stringify({ az: s, en: s, ru: s });
  it('admins manage lessons; users see only published ones and track their own progress', async () => {
    await db.as(admin, `insert into public.lessons (slug, position, title, summary, steps) values ('intro', 1, $1::jsonb, $1::jsonb, '[]'), ('draft1', 2, $1::jsonb, $1::jsonb, '[]')`, [t('Intro')]);
    await db.as(admin, `update public.lessons set published=false where slug='draft1'`);
    expect((await db.as(a, `select slug from public.lessons`)).map((l: any) => l.slug)).toEqual(['intro']);
    expect((await db.as(admin, `select slug from public.lessons`)).length).toBe(2);
    expect(await errCode(db.as(a, `update public.lessons set position=9 where slug='intro'`))).toBe('no_error'); // RLS silently filters the row: 0 rows updated, nothing changes
    expect((await db.svc(`select position from public.lessons where slug='intro'`))[0].position).toBe(1);
    expect(await errCode(db.as(admin, `insert into public.lessons (slug, title, summary) values ('bad', '{"en":"x"}', '{"en":"x"}')`))).toMatch(/violates check/);

    await db.as(a, `select public.complete_lesson_step('intro', 0)`);
    await db.as(a, `select public.complete_lesson_step('intro', 0)`);
    await db.as(a, `select public.complete_lesson_step('intro', 2)`);
    expect((await db.as(a, `select steps_done from public.lesson_progress`))[0].steps_done).toEqual([0, 2]);
    expect((await db.as(b, `select * from public.lesson_progress`)).length).toBe(0);
    expect(await errCode(db.as(a, `select public.complete_lesson('draft1')`))).toBe('lesson_not_found');
    await db.as(a, `select public.complete_lesson('intro')`);
    const codes = (await db.as(a, `select code from public.user_achievements where user_id=$1`, [a])).map((x: any) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['lesson_first', 'lessons_all']));
  });

  it('users cannot write puzzles or read answers directly', async () => {
    expect(await errCode(db.as(a, `insert into public.puzzles (id, difficulty, kind, puzzle) values ('x1', 1, 'capture', '{}')`))).toMatch(/row-level security/);
    expect(await errCode(db.as(a, `select * from public.puzzle_solutions`))).toMatch(/permission denied/);
  });

  it('users cannot grant themselves achievements', async () => {
    expect(await errCode(db.as(b, `insert into public.user_achievements (user_id, code) values ($1,'games_100')`, [b]))).toMatch(/permission denied/);
  });
});
