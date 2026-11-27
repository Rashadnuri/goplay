/**
 * In-memory Supabase + AI stand-in for browser tests (Playwright request interception).
 * Game state is validated with the REAL rules engine, so the UI is exercised against realistic behaviour.
 */
// Playwright is installed globally in this environment, so its types are not resolvable here.
type BrowserContext = any;
type Route = any;
import { GoGame, makeConfig } from '../../src/engine/index.ts';
import { BANK } from '../../src/content/bank.ts';

export const SB = 'http://mock.supabase.test';
export const AI = 'http://mock.ai.test';
export const ME = '11111111-1111-4111-8111-111111111111';
export const BOB = '22222222-2222-4222-8222-222222222222';
export const CAT = '33333333-3333-4333-8333-333333333333';
export const G_LIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // me (black) vs bob, active
export const G_DONE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';   // public finished game
export const G_SPEC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';   // bob vs cat, active (I spectate)
export const T_OPEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const T_RUN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const profile = (id: string, username: string, extra: Row = {}) => ({ id, username, avatar: 'jade', bio: `${username} bio`, country: 'AZ', language: 'az', theme: 'dark', role: 'user', show_online: true, prefs: {}, created_at: '2025-01-01T00:00:00Z', banned_until: null, last_seen_at: now(), ...extra });

export function freshState() {
  const gameBase = (id: string, status: string, extra: Row = {}) => ({ id, status, board_size: 9, komi: 6.5, rules: 'japanese', handicap: 0, ko_rule: 'simple', time_initial_s: 600, time_increment_s: 5, is_ranked: true, is_private: false, replay_shared: false, invite_code: null, tournament_match_id: null, to_play: 1, move_count: 0, version: 0, captures_black: 0, captures_white: 0, black_ms: 600000, white_ms: 600000, clock_running: null, clock_since: null, dead_stones: [], score_accept_black: false, score_accept_white: false, draw_offer_by: null, undo_request: null, winner: null, end_reason: null, result_text: null, final_score: null, created_at: '2026-01-01T00:00:00Z', finished_at: null, ...extra });
  const doneMoves = [20, 30, 21, 31, 22, 32, 40, 41, 12, 50, 13, -1].map((p, i) => ({ move_number: i + 1, color: i % 2 === 0 ? 1 : 2, p }));
  return {
    uid: ME as string | null,
    profiles: [profile(ME, 'alice', { role: 'admin' }), profile(BOB, 'bob'), profile(CAT, 'cat')],
    ratings: [9, 13, 19].flatMap((s) => [ME, BOB, CAT].map((u, i) => ({ user_id: u, board_size: s, rating: s === 9 ? 1100 + i * 40 : 1000, peak_rating: 1200, games: s === 9 ? 12 : 0, wins: s === 9 ? 7 : 0, losses: s === 9 ? 5 : 0, draws: 0, streak: 2, best_streak: 4 }))),
    games: [
      gameBase(G_LIVE, 'active', { clock_running: 1, clock_since: now() }),
      gameBase(G_DONE, 'finished', { move_count: doneMoves.length, winner: 1, end_reason: 'resign', result_text: 'B+R', finished_at: '2026-01-01T01:00:00Z', is_ranked: true }),
      gameBase(G_SPEC, 'active', { move_count: 2, to_play: 1, clock_running: 1, clock_since: now() }),
    ] as Row[],
    participants: [
      { game_id: G_LIVE, user_id: ME, color: 1, rating_before: 1100, rating_after: null }, { game_id: G_LIVE, user_id: BOB, color: 2, rating_before: 1140, rating_after: null },
      { game_id: G_DONE, user_id: ME, color: 1, rating_before: 1100, rating_after: 1112 }, { game_id: G_DONE, user_id: BOB, color: 2, rating_before: 1140, rating_after: 1128 },
      { game_id: G_SPEC, user_id: BOB, color: 1, rating_before: 1140, rating_after: null }, { game_id: G_SPEC, user_id: CAT, color: 2, rating_before: 1180, rating_after: null },
    ] as Row[],
    moves: [
      ...doneMoves.map((m) => ({ game_id: G_DONE, ...m })),
      { game_id: G_SPEC, move_number: 1, color: 1, p: 40 }, { game_id: G_SPEC, move_number: 2, color: 2, p: 41 },
    ] as Row[],
    comments: [] as Row[],
    tournaments: [
      { id: T_OPEN, name: 'Spring Cup', description: 'Open to all', format: 'single_elimination', board_size: 9, rules: 'japanese', time_initial_s: 600, time_increment_s: 5, min_players: 2, max_players: 16, registration_closes_at: null, starts_at: '2026-12-24T10:00:00Z', status: 'registration', recurrence: 'weekly', current_round: 0, total_rounds: null, winner_id: null, created_at: now() },
      { id: T_RUN, name: 'Autumn Cup', description: '', format: 'round_robin', board_size: 13, rules: 'japanese', time_initial_s: 600, time_increment_s: 5, min_players: 2, max_players: 8, registration_closes_at: null, starts_at: null, status: 'running', recurrence: null, current_round: 1, total_rounds: 3, winner_id: null, created_at: now() },
    ] as Row[],
    tparts: [{ tournament_id: T_OPEN, user_id: BOB, seed: null, eliminated: false, points: 0, wins: 0, losses: 0 }, { tournament_id: T_RUN, user_id: ME, seed: 1, eliminated: false, points: 1, wins: 1, losses: 0 }, { tournament_id: T_RUN, user_id: BOB, seed: 2, eliminated: false, points: 0, wins: 0, losses: 1 }] as Row[],
    tmatches: [{ id: 'm1', tournament_id: T_RUN, round: 1, position: 1, player_a: ME, player_b: BOB, game_id: G_LIVE, winner_id: null, status: 'active' }] as Row[],
    solved: new Set<string>(),
    failRpc: new Map<string, string>(),   // rpc name → error code to return (HTTP 400)
    abortActions: 0,                      // number of game-action requests to drop (simulated network loss)
    registered: false,
    calls: [] as string[],
    unhandled: [] as string[],
  };
}
export type State = ReturnType<typeof freshState>;

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (k === 'or' || k === 'and') continue;
    const m = /^(eq|neq|in|ilike|gte|lte|gt|lt|is)\.(.*)$/.exec(v);
    if (!m) continue;
    const [, op, val] = m;
    out = out.filter((r) => {
      const cell = r[k];
      if (op === 'eq') return String(cell) === val;
      if (op === 'neq') return String(cell) !== val;
      if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(cell));
      if (op === 'ilike') return String(cell ?? '').toLowerCase().includes(val.replace(/\*/g, '').replace(/%/g, '').toLowerCase());
      if (op === 'is') return val === 'null' ? cell == null : cell != null;
      if (op === 'gte') return cell >= val; if (op === 'lte') return cell <= val; if (op === 'gt') return cell > val; if (op === 'lt') return cell < val;
      return true;
    });
  }
  const order = params.get('order');
  if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
  const lim = params.get('limit'); if (lim) out = out.slice(0, Number(lim));
  return out;
}

export async function installMock(ctx: BrowserContext, st: State, opts: { ai?: boolean } = {}) {
  const prof = (id: string) => st.profiles.find((p) => p.id === id);
  const gameOf = (id: string) => st.games.find((g) => g.id === id)!;
  const engineFor = (g: Row) => GoGame.fromMoves(makeConfig({ size: g.board_size, komi: g.komi, rules: g.rules, ko: g.ko_rule }), st.moves.filter((m) => m.game_id === g.id).sort((a, b) => a.move_number - b.move_number).map((m) => m.p));

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
  const json = (route: Route, body: unknown, status = 200, extra: Record<string, string> = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...extra }, body: JSON.stringify(body) });

  const embed = (table: string, rows: Row[], select: string) => rows.map((r) => {
    const o = { ...r };
    if (/profiles(?:!\w+)?\(/.test(select) && (r.user_id || r.from_user || r.id)) { const p = prof(r.user_id ?? r.from_user); if (p) o.profiles = { username: p.username, avatar: p.avatar }; }
    if (/tournament_participants\(count\)/.test(select)) o.tournament_participants = [{ count: st.tparts.filter((p) => p.tournament_id === r.id).length + (r.id === T_OPEN && st.registered ? 1 : 0) }];
    if (/games!inner/.test(select)) o.games = st.games.find((g) => g.id === r.game_id);
    if (/reporter:|reported:/.test(select)) { o.reporter = { username: 'bob' }; o.reported = { username: 'cat' }; }
    return o;
  });

  const rpcs: Record<string, (a: Row) => unknown> = {
    touch_presence: () => null, server_now: () => now(),
    get_leaderboard: (a) => [{ rank: 1, user_id: BOB, username: 'bob', avatar: 'jade', country: 'AZ', rating: 1140, league: 'bronze', games: 12, wins: 7, losses: 5, score: a.p_period === 'all' ? 1140 : 24 }, { rank: 2, user_id: ME, username: 'alice', avatar: 'jade', country: 'AZ', rating: 1100, league: 'bronze', games: 12, wins: 7, losses: 5, score: 12 }],
    current_season: () => ({ key: '2026-06', starts_at: '2026-06-01T00:00:00Z', ends_at: '2026-07-01T00:00:00Z' }),
    list_seasons: () => ['2026-05'],
    get_season_results: () => [{ rank: 1, user_id: BOB, username: 'bob', avatar: 'jade', gain: 55, games: 9, final_rating: 1150 }],
    get_match_history: () => [{ game_id: G_DONE, board_size: 9, finished_at: '2026-01-01T01:00:00Z', result_text: 'B+R', my_color: 1, won: true, draw: false, rating_before: 1100, rating_after: 1112, opponent_id: BOB, opponent_name: 'bob', opponent_avatar: 'jade', is_ranked: true }],
    get_player_stats: () => ({ form: 'WWLWD', puzzles: 4, medals: 2, daily_best: 5, games_30d: 8 }),
    get_head_to_head: () => ({ games: 5, wins: 3, losses: 2, draws: 0 }),
    get_friends: () => [{ friendship_id: 'f1', user_id: BOB, username: 'bob', avatar: 'jade', status: 'accepted', incoming: false, online: true, last_seen_at: now(), unread: 1 }, { friendship_id: 'f2', user_id: CAT, username: 'cat', avatar: 'sky', status: 'pending', incoming: true, online: false, last_seen_at: null, unread: 0 }],
    list_live_games: () => [{ game_id: G_SPEC, board_size: 9, move_count: 2, started_at: now(), time_initial_s: 600, time_increment_s: 5, is_ranked: true, black_id: BOB, black_name: 'bob', black_rating: 1140, white_id: CAT, white_name: 'cat', white_rating: 1180 }],
    get_daily_set: () => ([1, 2, 3] as const).map((d) => { const p = BANK.filter((x) => x.difficulty === d)[0]; return { difficulty: d, puzzle_id: p.id, kind: p.kind, shape: p.shape ?? null, puzzle: { size: 9, rows: p.rows, toPlay: p.toPlay }, solved: st.solved.has(p.id), scheduled: false }; }),
    get_daily_streak: () => ({ current: st.solved.size, best: 5, days: 7, solved_today: st.solved.size > 0 }),
    solve_puzzle: (a) => { const p = BANK.find((x) => x.id === a.p_puzzle)!; const ok = p.points.includes(a.p_point); if (ok) st.solved.add(p.id); return { correct: ok, first_solve: ok, kind: p.kind, shape: p.shape ?? null }; },
    reveal_puzzle: (a) => BANK.find((x) => x.id === a.p_puzzle)!.points,
    register_tournament: () => { st.registered = true; return null; }, unregister_tournament: () => { st.registered = false; return null; },
    admin_stats: () => ({ users: 3, users_7d: 1, online_now: 2, games_total: 5, games_active: 2, games_24h: 3, queue: 0, tournaments_open: 2, reports_open: 1, lessons: 15 }),
    admin_list_users: () => st.profiles.map((p) => ({ id: p.id, username: p.username, email: `${p.username}@x.com`, role: p.role, banned_until: null, created_at: p.created_at, last_seen_at: p.last_seen_at, games: 12 })),
    mark_messages_read: () => null, send_message: () => 'msg1', send_friend_request: () => 'sent', respond_friend_request: () => null,
    join_matchmaking: () => G_LIVE, poll_matchmaking: () => null, leave_matchmaking: () => true,
    create_private_game: () => ({ game_id: G_LIVE, invite_code: 'ABC234' }), join_game_by_code: () => G_LIVE,
    resign_game: (a) => { const g = gameOf(a.p_game); g.status = 'finished'; g.winner = 2; g.result_text = 'W+R'; g.end_reason = 'resign'; g.finished_at = now(); g.version++; return null; },
    offer_draw: (a) => { gameOf(a.p_game).draw_offer_by = 1; return null; }, respond_draw: () => null, claim_timeout: () => false, cancel_room: () => null,
    post_game_comment: (a) => { st.comments.push({ id: `c${st.comments.length}`, game_id: a.p_game, user_id: st.uid, move_number: 2, body: a.p_body, created_at: now() }); return 'c'; },
    set_replay_shared: () => null, complete_lesson_step: () => null, complete_lesson: () => null,
    ensure_weekly_tournaments: () => 2, start_due_tournaments: () => 0, close_season: () => 4,
  };

  await ctx.route(`${SB}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = url.pathname;
    st.calls.push(`${req.method()} ${path}${path.includes('/rpc/') ? '' : ''}`);

    if (path.startsWith('/auth/v1/user')) return json(route, st.uid ? { id: st.uid, aud: 'authenticated', email: 'alice@x.com', app_metadata: {}, user_metadata: {}, created_at: now() } : { msg: 'no' }, st.uid ? 200 : 401);
    if (path.startsWith('/auth/v1/')) return json(route, {}, 200);

    if (path === '/functions/v1/game-action') {
      if (st.abortActions > 0) { st.abortActions--; return route.abort('failed'); }
      const body = JSON.parse(req.postData() ?? '{}');
      const g = gameOf(body.game_id);
      if (!g) return json(route, { error: 'game_not_found' }, 404);
      const mover = st.participants.find((p) => p.game_id === g.id && p.user_id === st.uid);
      if (!mover) return json(route, { error: 'forbidden' }, 409);
      const eng = engineFor(g); const a = body.action;
      if (a.type === 'move' || a.type === 'pass') {
        if (g.to_play !== mover.color) return json(route, { error: 'not_your_turn' }, 409);
        const r = a.type === 'pass' ? eng.pass() : eng.play(a.p);
        if (!r.ok) return json(route, { error: `illegal_${r.reason}` }, 409);
        st.moves.push({ game_id: g.id, move_number: eng.moveNumber, color: mover.color, p: a.type === 'pass' ? -1 : a.p });
        g.move_count = eng.moveNumber; g.to_play = eng.toPlay; g.captures_black = eng.captures[1]; g.captures_white = eng.captures[2]; g.version++; g.clock_running = eng.toPlay; g.clock_since = now();
        if (eng.phase === 'scoring') { g.status = 'scoring'; g.clock_running = null; }
      } else if (a.type === 'mark_dead') { g.dead_stones = a.dead; g.version++; }
      else if (a.type === 'accept_score') { g.score_accept_black = true; g.score_accept_white = true; g.status = 'finished'; g.result_text = 'B+3.5'; g.winner = 1; g.end_reason = 'score'; g.final_score = { black: 10, white: 6.5, komi: 6.5, rules: 'japanese', margin: 3.5, blackTerritory: 10, whiteTerritory: 0, blackStones: 4, whiteStones: 3, blackPrisoners: 0, whitePrisoners: 0, dead: [] }; g.finished_at = now(); g.version++; }
      else g.version++;
      return json(route, { ok: true, version: g.version });
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop()!;
      const args = req.postData() ? JSON.parse(req.postData()!) : {};
      if (st.failRpc.has(fn)) return json(route, { message: `err:${st.failRpc.get(fn)}` }, 400);
      const h = rpcs[fn];
      if (!h) { st.unhandled.push(`rpc ${fn}`); return json(route, { message: `err:unknown_${fn}` }, 400); }
      return json(route, h(args) ?? null);
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.split('/').pop()!;
      const q = url.searchParams;
      const select = q.get('select') ?? '*';
      const sources: Record<string, Row[]> = {
        profiles: st.profiles, player_ratings: st.ratings, games: st.games, game_participants: st.participants, game_moves: st.moves, game_comments: st.comments,
        tournaments: st.tournaments, tournament_participants: st.tparts, tournament_matches: st.tmatches,
        achievements: [{ code: 'first_win', icon: 'trophy' }, { code: 'puzzle_10', icon: 'puzzle' }], user_achievements: [{ code: 'first_win' }],
        user_medals: [{ kind: 'season_gold', label: '2026-05', board_size: 9 }, { kind: 'tournament_silver', label: 'Autumn Cup', board_size: 13 }],
        rating_history: [{ new_rating: 1112, old_rating: 1100 }, { new_rating: 1125, old_rating: 1112 }, { new_rating: 1108, old_rating: 1125 }],
        lessons: [], puzzle_solves: [...st.solved].map((id) => ({ puzzle_id: id })), lesson_progress: [], daily_completions: [], daily_challenges: [], blocks: [], reports: [{ id: 'r1', reason: 'cheating', details: 'sus', status: 'open', created_at: now(), message_id: null, game_id: null, resolution_note: null }],
        game_invites: [], matchmaking_queue: [], friendships: [], messages: [{ id: 'm1', sender_id: BOB, recipient_id: ME, body: 'salam!', created_at: now() }],
      };
      if (!(table in sources)) { st.unhandled.push(`table ${table}`); return json(route, [], 200); }
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${sources[table].length}` }, body: '' });
      if (req.method() !== 'GET') return json(route, [], 201);
      let rows = applyFilters(sources[table], q);
      rows = embed(table, rows, select);
      const accept = req.headers()['accept'] ?? '';
      if (accept.includes('vnd.pgrst.object')) return rows.length ? json(route, rows[0]) : json(route, { message: 'none' }, 406);
      return json(route, rows);
    }
    st.unhandled.push(path);
    return json(route, {}, 404);
  });

  // AI service
  await ctx.route(`${AI}/**`, async (route: Route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (path === '/health') return opts.ai === false ? json(route, { status: 'unavailable' }, 503) : json(route, { status: 'ok', ok: true });
    const body = JSON.parse(req.postData() ?? '{}');
    const g = GoGame.fromMoves(makeConfig({ size: body.size, komi: body.komi, rules: body.rules, handicap: body.handicap }), body.moves);
    const legal = g.legalMoves();
    if (path === '/v1/move') { const lastWasPass = body.moves.length > 0 && body.moves[body.moves.length - 1] === -1; const p = lastWasPass ? undefined : legal[Math.floor(legal.length / 2)]; return json(route, p === undefined ? { move: { type: 'pass' }, resign: false, winrate: 0.5, scoreLead: 0 } : { move: { type: 'play', p }, resign: false, winrate: 0.55, scoreLead: 2 }); }
    if (path === '/v1/analyze') return json(route, { toPlay: g.toPlay, winrate: 0.6, scoreLead: 3.5, candidates: legal.slice(0, 3).map((p, i) => ({ p, visits: 100 - i, winrate: 0.6 - i * 0.02, scoreLead: 3, prior: 0.3, pv: [p] })), ownership: Array.from({ length: g.board.length }, (_, i) => (i % 9 < 4 ? 0.9 : -0.9)) });
    if (path === '/v1/review') {
      const n = body.moves.length;
      const first = g.board.length; void first;
      const replay = new GoGame(makeConfig({ size: body.size, komi: body.komi, rules: body.rules, handicap: body.handicap }));
      const moves = body.moves.map((p: number, i: number) => { const color = replay.toPlay; const best = replay.legalMoves()[0]; replay.apply(p < 0 ? { type: 'pass' } : { type: 'play', p }); return { move: i + 1, color, p, winrateBefore: 0.5, winrateAfter: 0.4, loss: i % 3 === 0 ? 0.2 : 0.01, scoreLoss: 3, kind: i % 3 === 0 ? 'blunder' : 'good', best }; });
      return json(route, { winrates: Array.from({ length: n + 1 }, (_, i) => 0.5 + Math.sin(i) * 0.1), scoreLeads: Array(n + 1).fill(0), moves, summary: { blunders: moves.filter((m: any) => m.kind === 'blunder').length, mistakes: 0, inaccuracies: 0 } });
    }
    return json(route, { error: 'not_found' }, 404);
  });

  // realtime websocket: not available in this harness → the UI must degrade gracefully (shows the offline state)
  await ctx.routeWebSocket(/realtime/, (ws: any) => { void ws.close(); });

  // session in storage (supabase-js key: sb-<first label of host>-auth-token)
  await ctx.addInitScript(([uid, key]: readonly [string | null, string]) => {
    try {
      localStorage.setItem('goplay.onboarded', '1'); localStorage.setItem('goplay.tutorialSeen', '1');
      if (uid) localStorage.setItem(key, JSON.stringify({ access_token: 'a.b.c', token_type: 'bearer', expires_in: 99999, expires_at: Math.floor(Date.now() / 1000) + 99999, refresh_token: 'r', user: { id: uid, aud: 'authenticated', email: 'alice@x.com', app_metadata: {}, user_metadata: {}, created_at: '2025-01-01T00:00:00Z' } }));
    } catch { /* ignore */ }
  }, [st.uid, 'sb-mock-auth-token'] as const);
}
