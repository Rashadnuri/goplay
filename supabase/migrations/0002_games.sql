-- GO PLAY — games, moves, matchmaking, private rooms, ratings
-- Clients can NEVER write games/moves/ratings directly. Writes happen only through:
--   * SECURITY DEFINER RPCs below (resign, draw, timeout, matchmaking, rooms), or
--   * svc_apply_game_update(), callable only by the service role from the `game-action` Edge Function,
--     which validates every move with the same rules engine used in the browser.

create table public.games (
  id            uuid primary key default gen_random_uuid(),
  status        text not null default 'active',
  board_size    smallint not null,
  komi          numeric(4,1) not null default 6.5,
  rules         text not null default 'japanese',
  handicap      smallint not null default 0,
  ko_rule       text not null default 'simple',
  time_initial_s   integer not null default 600,
  time_increment_s integer not null default 0,
  is_ranked     boolean not null default false,
  is_private    boolean not null default false,
  invite_code   text,
  created_by    uuid references public.profiles(id) on delete set null,
  tournament_match_id uuid,
  to_play       smallint not null default 1,
  move_count    integer not null default 0,
  version       integer not null default 0,
  captures_black integer not null default 0,
  captures_white integer not null default 0,
  black_ms      bigint,
  white_ms      bigint,
  clock_running smallint,
  clock_since   timestamptz,
  dead_stones   integer[] not null default '{}',
  score_accept_black boolean not null default false,
  score_accept_white boolean not null default false,
  draw_offer_by smallint,
  undo_request  jsonb,
  winner        smallint,
  end_reason    text,
  result_text   text,
  final_score   jsonb,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  last_move_at  timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz not null default now(),
  constraint games_status check (status in ('waiting','active','scoring','finished','aborted')),
  constraint games_size check (board_size in (9,13,19)),
  constraint games_rules check (rules in ('japanese','chinese')),
  constraint games_ko check (ko_rule in ('simple','superko')),
  constraint games_handicap check (handicap = 0 or handicap between 2 and 9),
  constraint games_komi check (komi between -50 and 50),
  constraint games_time check (time_initial_s between 0 and 7200 and time_increment_s between 0 and 120),
  constraint games_to_play check (to_play in (1,2)),
  constraint games_clock_color check (clock_running is null or clock_running in (1,2)),
  constraint games_winner check (winner is null or winner in (1,2)),
  constraint games_draw_by check (draw_offer_by is null or draw_offer_by in (1,2)),
  constraint games_finished_has_time check (status <> 'finished' or finished_at is not null)
);
create unique index games_invite_code_uq on public.games (invite_code) where invite_code is not null;
create index games_status_idx on public.games (status, created_at desc);
create index games_clock_idx on public.games (clock_since) where status = 'active' and clock_running is not null;
create index games_finished_idx on public.games (finished_at desc) where status = 'finished';

create table public.game_participants (
  game_id       uuid not null references public.games(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  color         smallint not null check (color in (1,2)),
  rating_before integer,
  rating_after  integer,
  joined_at     timestamptz not null default now(),
  primary key (game_id, user_id),
  unique (game_id, color)
);
create index game_participants_user_idx on public.game_participants (user_id, joined_at desc);

create table public.game_moves (
  game_id     uuid not null references public.games(id) on delete cascade,
  move_number integer not null check (move_number >= 1),
  color       smallint not null check (color in (1,2)),
  p           smallint not null check (p between -1 and 360),   -- -1 = pass
  captured    smallint[] not null default '{}',
  played_at   timestamptz not null default now(),
  primary key (game_id, move_number)                            -- duplicate/conflicting moves cannot both insert
);

create table public.matchmaking_queue (
  user_id   uuid primary key references public.profiles(id) on delete cascade,  -- one entry per user
  board_size smallint not null check (board_size in (9,13,19)),
  time_initial_s integer not null check (time_initial_s between 0 and 7200),
  time_increment_s integer not null check (time_increment_s between 0 and 120),
  rating    integer not null,
  game_id   uuid references public.games(id) on delete set null,   -- set when matched by someone else
  joined_at timestamptz not null default now()
);
create index matchmaking_lookup_idx on public.matchmaking_queue (board_size, time_initial_s, time_increment_s, rating) where game_id is null;

create table public.game_invites (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.games(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user   uuid not null references public.profiles(id) on delete cascade,
  status    text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (game_id, to_user),
  check (from_user <> to_user)
);
create index game_invites_to_idx on public.game_invites (to_user, status);

-- ───────── visibility helpers (used by RLS) ─────────
create function public.is_game_participant(p_game uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.game_participants where game_id = p_game and user_id = auth.uid()) $$;

create function public.can_view_game(p_game uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select public.is_game_participant(p_game)
       or exists (select 1 from public.games g where g.id = p_game and g.is_private = false and g.status <> 'waiting')
       or public.is_admin() $$;

-- ───────── internal: create a game ─────────
create function public._create_game(
  p_black uuid, p_white uuid, p_size integer, p_initial integer, p_inc integer,
  p_rules text, p_komi numeric, p_handicap integer, p_ranked boolean, p_private boolean,
  p_match uuid default null, p_status text default 'active'
) returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid; ko text; k numeric;
begin
  ko := case when p_rules = 'chinese' then 'superko' else 'simple' end;
  k := coalesce(p_komi, case when p_handicap >= 2 then 0.5 when p_rules = 'chinese' then 7.5 else 6.5 end);
  insert into public.games (status, board_size, komi, rules, handicap, ko_rule, time_initial_s, time_increment_s,
                            is_ranked, is_private, created_by, tournament_match_id, to_play, black_ms, white_ms, started_at)
  values (p_status, p_size, k, p_rules, coalesce(p_handicap,0), ko, p_initial, p_inc,
          p_ranked, p_private, coalesce(p_black, p_white), p_match,
          case when coalesce(p_handicap,0) >= 2 then 2 else 1 end,
          p_initial * 1000, p_initial * 1000, case when p_status = 'active' then now() end)
  returning id into gid;
  if p_black is not null then insert into public.game_participants (game_id, user_id, color) values (gid, p_black, 1); end if;
  if p_white is not null then insert into public.game_participants (game_id, user_id, color) values (gid, p_white, 2); end if;
  return gid;
end $$;

create function public._user_in_active_game(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.game_participants gp join public.games g on g.id = gp.game_id
                 where gp.user_id = p_user and g.status in ('active','scoring')) $$;

-- ───────── matchmaking ─────────
create function public.join_matchmaking(p_size integer, p_initial integer, p_increment integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r integer; cand public.matchmaking_queue; gid uuid; coin boolean;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('mm:' || uid, 20, 60);
  if p_size not in (9,13,19) or p_initial not between 0 and 7200 or p_increment not between 0 and 120 then
    raise exception 'err:invalid_settings';
  end if;
  delete from public.matchmaking_queue where joined_at < now() - interval '10 minutes';
  delete from public.matchmaking_queue where user_id = uid and game_id is not null;   -- stale "matched" marker
  if public._user_in_active_game(uid) then raise exception 'err:already_in_game'; end if;
  if exists (select 1 from public.matchmaking_queue where user_id = uid) then raise exception 'err:already_in_queue'; end if;

  select rating into r from public.player_ratings where user_id = uid and board_size = p_size;

  select * into cand from public.matchmaking_queue q
   where q.game_id is null and q.user_id <> uid and q.board_size = p_size
     and q.time_initial_s = p_initial and q.time_increment_s = p_increment
     and abs(q.rating - r) <= 100 + 15 * extract(epoch from now() - q.joined_at)
   order by abs(q.rating - r), q.joined_at
   limit 1 for update skip locked;

  if found then
    coin := random() < 0.5;
    gid := public._create_game(case when coin then uid else cand.user_id end, case when coin then cand.user_id else uid end,
                               p_size, p_initial, p_increment, 'japanese', null, 0, true, false);
    update public.matchmaking_queue set game_id = gid where user_id = cand.user_id;
    return gid;
  end if;
  insert into public.matchmaking_queue (user_id, board_size, time_initial_s, time_increment_s, rating)
  values (uid, p_size, p_initial, p_increment, r);
  return null;
end $$;

-- Called every few seconds by a waiting client. Returns the game id once matched.
create function public.poll_matchmaking() returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); me public.matchmaking_queue; cand public.matchmaking_queue; gid uuid; coin boolean;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('mmpoll:' || uid, 60, 60);
  select * into me from public.matchmaking_queue where user_id = uid for update;
  if not found then return null; end if;
  if me.game_id is not null then
    delete from public.matchmaking_queue where user_id = uid;
    return me.game_id;
  end if;
  select * into cand from public.matchmaking_queue q
   where q.game_id is null and q.user_id <> uid and q.board_size = me.board_size
     and q.time_initial_s = me.time_initial_s and q.time_increment_s = me.time_increment_s
     and abs(q.rating - me.rating) <= 100 + 15 * extract(epoch from now() - least(q.joined_at, me.joined_at))
   order by abs(q.rating - me.rating), q.joined_at
   limit 1 for update skip locked;
  if found then
    coin := random() < 0.5;
    gid := public._create_game(case when coin then uid else cand.user_id end, case when coin then cand.user_id else uid end,
                               me.board_size, me.time_initial_s, me.time_increment_s, 'japanese', null, 0, true, false);
    update public.matchmaking_queue set game_id = gid where user_id = cand.user_id;
    delete from public.matchmaking_queue where user_id = uid;
    return gid;
  end if;
  return null;
end $$;

create function public.leave_matchmaking() returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.matchmaking_queue where user_id = auth.uid() and game_id is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- ───────── private rooms ─────────
create function public.create_private_game(
  p_size integer, p_initial integer, p_increment integer,
  p_rules text default 'japanese', p_komi numeric default null, p_handicap integer default 0, p_color text default 'random'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); gid uuid; code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i integer; mycolor integer;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('room:' || uid, 10, 3600);
  if p_size not in (9,13,19) or p_initial not between 0 and 7200 or p_increment not between 0 and 120
     or p_rules not in ('japanese','chinese') or coalesce(p_handicap,0) not between 0 and 9 or p_handicap = 1
     or p_color not in ('black','white','random') then
    raise exception 'err:invalid_settings';
  end if;
  mycolor := case p_color when 'black' then 1 when 'white' then 2 else 1 + (random() < 0.5)::int end;
  gid := public._create_game(case when mycolor = 1 then uid end, case when mycolor = 2 then uid end,
                             p_size, p_initial, p_increment, p_rules, p_komi, coalesce(p_handicap,0), false, true, null, 'waiting');
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    begin
      update public.games set invite_code = code where id = gid;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('game_id', gid, 'invite_code', code);
end $$;

create function public._join_game(p_game uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare g public.games; n integer; free_color smallint;
begin
  select * into g from public.games where id = p_game for update;
  if not found or g.status = 'aborted' then raise exception 'err:room_not_found'; end if;
  if exists (select 1 from public.game_participants where game_id = p_game and user_id = p_user) then return p_game; end if;
  if g.status <> 'waiting' then raise exception 'err:room_full'; end if;
  select count(*) into n from public.game_participants where game_id = p_game;
  if n >= 2 then raise exception 'err:room_full'; end if;
  select c into free_color from unnest(array[1,2]) c
   where not exists (select 1 from public.game_participants where game_id = p_game and color = c) limit 1;
  insert into public.game_participants (game_id, user_id, color) values (p_game, p_user, free_color);
  update public.games set status = 'active', started_at = now(), version = version + 1, updated_at = now() where id = p_game;
  update public.game_invites set status = case when to_user = p_user then 'accepted' else 'declined' end
   where game_id = p_game and status = 'pending';
  return p_game;
end $$;

create function public.join_game_by_code(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); gid uuid;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('join:' || uid, 15, 60);
  select id into gid from public.games where invite_code = upper(trim(p_code)) and status in ('waiting','active');
  if gid is null then raise exception 'err:room_not_found'; end if;
  return public._join_game(gid, uid);
end $$;

create function public.invite_friend_to_game(p_game uuid, p_friend uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); iid uuid;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('invite:' || uid, 20, 3600);
  if not exists (select 1 from public.games g join public.game_participants gp on gp.game_id = g.id
                 where g.id = p_game and g.status = 'waiting' and gp.user_id = uid) then raise exception 'err:forbidden'; end if;
  if not public.are_friends(uid, p_friend) then raise exception 'err:not_friends'; end if;
  if public.is_blocked_between(uid, p_friend) then raise exception 'err:blocked'; end if;
  insert into public.game_invites (game_id, from_user, to_user) values (p_game, uid, p_friend)
  on conflict (game_id, to_user) do update set status = 'pending', created_at = now() returning id into iid;
  return iid;
end $$;

create function public.respond_game_invite(p_invite uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.game_invites;
begin
  select * into inv from public.game_invites where id = p_invite and to_user = uid and status = 'pending' for update;
  if not found then raise exception 'err:invite_not_found'; end if;
  if not p_accept then update public.game_invites set status = 'declined' where id = p_invite; return null; end if;
  perform public.assert_not_banned(uid);
  return public._join_game(inv.game_id, uid);
end $$;

-- ───────── rating (server-authoritative Elo, per board size) ─────────
create function public._apply_rating(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; ub uuid; uw uuid; rb integer; rw integer; gb integer; gw integer;
        sb numeric; sw numeric; eb numeric; kb integer; kw integer; nb integer; nw integer;
        pb public.player_ratings; pw public.player_ratings;
begin
  select * into g from public.games where id = p_game;
  if not g.is_ranked or g.move_count < 4 or g.end_reason in ('abandoned','forfeit') then return; end if;
  select user_id into ub from public.game_participants where game_id = p_game and color = 1;
  select user_id into uw from public.game_participants where game_id = p_game and color = 2;
  if ub is null or uw is null then return; end if;
  -- lock in a stable order to avoid deadlocks
  perform 1 from public.player_ratings where board_size = g.board_size and user_id in (ub, uw) order by user_id for update;
  select * into pb from public.player_ratings where user_id = ub and board_size = g.board_size;
  select * into pw from public.player_ratings where user_id = uw and board_size = g.board_size;
  sb := case g.winner when 1 then 1 when 2 then 0 else 0.5 end;
  sw := 1 - sb;
  eb := 1 / (1 + power(10, (pw.rating - pb.rating) / 400.0));
  kb := case when pb.games < 30 then 40 else 24 end;
  kw := case when pw.games < 30 then 40 else 24 end;
  nb := greatest(100, round(pb.rating + kb * (sb - eb)));
  nw := greatest(100, round(pw.rating + kw * (sw - (1 - eb))));

  update public.player_ratings set rating = nb, peak_rating = greatest(peak_rating, nb), games = games + 1,
      wins = wins + (coalesce(g.winner,0) = 1)::int, losses = losses + (coalesce(g.winner,0) = 2)::int, draws = draws + (g.winner is null)::int,
      streak = case when g.winner = 1 then greatest(streak, 0) + 1 when g.winner = 2 then least(streak, 0) - 1 else 0 end,
      best_streak = greatest(best_streak, case when g.winner = 1 then greatest(streak, 0) + 1 else 0 end),
      updated_at = now()
   where user_id = ub and board_size = g.board_size;
  update public.player_ratings set rating = nw, peak_rating = greatest(peak_rating, nw), games = games + 1,
      wins = wins + (coalesce(g.winner,0) = 2)::int, losses = losses + (coalesce(g.winner,0) = 1)::int, draws = draws + (g.winner is null)::int,
      streak = case when g.winner = 2 then greatest(streak, 0) + 1 when g.winner = 1 then least(streak, 0) - 1 else 0 end,
      best_streak = greatest(best_streak, case when g.winner = 2 then greatest(streak, 0) + 1 else 0 end),
      updated_at = now()
   where user_id = uw and board_size = g.board_size;

  insert into public.rating_history (user_id, game_id, board_size, old_rating, new_rating, delta) values
    (ub, p_game, g.board_size, pb.rating, nb, nb - pb.rating),
    (uw, p_game, g.board_size, pw.rating, nw, nw - pw.rating);
  update public.game_participants set rating_before = pb.rating, rating_after = nb where game_id = p_game and user_id = ub;
  update public.game_participants set rating_before = pw.rating, rating_after = nw where game_id = p_game and user_id = uw;
end $$;

-- ───────── finishing a game (caller must hold the game row lock) ─────────
create function public._finish_game(p_game uuid, p_winner smallint, p_reason text, p_text text, p_score jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  update public.games set status = 'finished', winner = p_winner, end_reason = p_reason, result_text = p_text,
         final_score = p_score, finished_at = now(), clock_running = null, clock_since = null,
         draw_offer_by = null, undo_request = null, version = version + 1, updated_at = now()
   where id = p_game and status in ('active','scoring');
  if not found then return; end if;
  perform public._apply_rating(p_game);
  for uid in select user_id from public.game_participants where game_id = p_game loop
    perform public._award_achievements(uid);
  end loop;
  perform public._tournament_game_finished(p_game);
end $$;

-- ───────── player-initiated controls that need no rules engine ─────────
create function public.resign_game(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; c smallint;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'err:game_not_found'; end if;
  select color into c from public.game_participants where game_id = p_game and user_id = auth.uid();
  if c is null then raise exception 'err:forbidden'; end if;
  if g.status = 'waiting' then
    update public.games set status = 'aborted', version = version + 1, updated_at = now() where id = p_game;
    return;
  end if;
  if g.status not in ('active','scoring') then raise exception 'err:game_over'; end if;
  perform public._finish_game(p_game, (3 - c)::smallint, 'resign', case when c = 1 then 'W+R' else 'B+R' end);
end $$;

create function public.offer_draw(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; c smallint;
begin
  perform public.check_rate_limit('draw:' || p_game || ':' || auth.uid(), 3, 3600);
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'err:game_not_found'; end if;
  select color into c from public.game_participants where game_id = p_game and user_id = auth.uid();
  if c is null then raise exception 'err:forbidden'; end if;
  if g.status <> 'active' then raise exception 'err:game_over'; end if;
  if g.tournament_match_id is not null then raise exception 'err:draw_not_allowed'; end if;
  if g.draw_offer_by is not null then raise exception 'err:offer_pending'; end if;
  update public.games set draw_offer_by = c, version = version + 1, updated_at = now() where id = p_game;
end $$;

create function public.respond_draw(p_game uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; c smallint;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'err:game_not_found'; end if;
  select color into c from public.game_participants where game_id = p_game and user_id = auth.uid();
  if c is null then raise exception 'err:forbidden'; end if;
  if g.status <> 'active' or g.draw_offer_by is null or g.draw_offer_by = c then raise exception 'err:no_offer'; end if;
  if p_accept then
    perform public._finish_game(p_game, null, 'draw', '0');
  else
    update public.games set draw_offer_by = null, version = version + 1, updated_at = now() where id = p_game;
  end if;
end $$;

-- Cancel a waiting private room, or abort an untouched game
create function public.cancel_room(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_participant(p_game) then raise exception 'err:forbidden'; end if;
  if g.status <> 'waiting' then raise exception 'err:game_started'; end if;
  update public.games set status = 'aborted', version = version + 1, updated_at = now() where id = p_game;
end $$;

-- Remaining time of the side whose clock is running, in ms (DB clock is authoritative)
create function public._clock_left_ms(g public.games) returns bigint language sql stable as $$
  select case when g.clock_running is null or g.clock_since is null then null
              else (case g.clock_running when 1 then g.black_ms else g.white_ms end)
                   - (extract(epoch from (now() - g.clock_since)) * 1000)::bigint end $$;

create function public.claim_timeout(p_game uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare g public.games; left_ms bigint;
begin
  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_participant(p_game) then raise exception 'err:forbidden'; end if;
  if g.status <> 'active' or g.time_initial_s = 0 then return false; end if;
  left_ms := public._clock_left_ms(g);
  if left_ms is null or left_ms > 0 then return false; end if;
  perform public._finish_game(p_game, (3 - g.clock_running)::smallint, 'timeout', case when g.clock_running = 1 then 'W+T' else 'B+T' end);
  return true;
end $$;

-- Sweeper for pg_cron / scheduled function: finishes every game whose running clock expired.
create function public.sweep_timeouts() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; g public.games; n integer := 0;
begin
  for r in select id from public.games where status = 'active' and time_initial_s > 0 and clock_running is not null loop
    select * into g from public.games where id = r.id for update skip locked;
    continue when not found or g.status <> 'active' or public._clock_left_ms(g) is null or public._clock_left_ms(g) > 0;
    perform public._finish_game(g.id, (3 - g.clock_running)::smallint, 'timeout', case when g.clock_running = 1 then 'W+T' else 'B+T' end);
    n := n + 1;
  end loop;
  -- stale private rooms nobody joined within 24h
  update public.games set status = 'aborted', version = version + 1 where status = 'waiting' and created_at < now() - interval '24 hours';
  return n;
end $$;

-- Games abandoned before the first move (both players gone) are aborted without rating change.
create function public.sweep_abandoned() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.games set status = 'aborted', end_reason = 'abandoned', version = version + 1, updated_at = now()
   where status = 'active' and move_count = 0 and tournament_match_id is null and started_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────── service-role only: atomic apply of a validated action ─────────
create function public.svc_get_game(p_game uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'game', to_jsonb(g),
    'participants', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'color', color)), '[]') from public.game_participants where game_id = g.id),
    'moves', (select coalesce(jsonb_agg(jsonb_build_object('move_number', move_number, 'color', color, 'p', p) order by move_number), '[]') from public.game_moves where game_id = g.id),
    'now_ms', (extract(epoch from now()) * 1000)::bigint,
    'clock_since_ms', (extract(epoch from g.clock_since) * 1000)::bigint
  ) from public.games g where g.id = p_game $$;

create function public.svc_apply_game_update(p_game uuid, p_expected_version integer, p_patch jsonb, p_insert_moves jsonb, p_delete_from integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.games; m jsonb; fin jsonb;
begin
  select * into g from public.games where id = p_game for update;       -- serialises concurrent actions
  if not found then raise exception 'err:game_not_found'; end if;
  if g.version <> p_expected_version then raise exception 'err:version_conflict'; end if;
  if g.status in ('finished','aborted','waiting') then raise exception 'err:game_over'; end if;

  if p_delete_from is not null then
    delete from public.game_moves where game_id = p_game and move_number >= p_delete_from;
  end if;
  if p_insert_moves is not null then
    for m in select * from jsonb_array_elements(p_insert_moves) loop
      insert into public.game_moves (game_id, move_number, color, p, captured)
      values (p_game, (m->>'move_number')::int, (m->>'color')::smallint, (m->>'p')::smallint,
              coalesce(array(select jsonb_array_elements_text(m->'captured'))::smallint[], '{}'));
    end loop;
  end if;

  update public.games set
    status             = case when p_patch ? 'status' then p_patch->>'status' else status end,
    to_play            = case when p_patch ? 'to_play' then (p_patch->>'to_play')::smallint else to_play end,
    move_count         = case when p_patch ? 'move_count' then (p_patch->>'move_count')::int else move_count end,
    captures_black     = case when p_patch ? 'captures_black' then (p_patch->>'captures_black')::int else captures_black end,
    captures_white     = case when p_patch ? 'captures_white' then (p_patch->>'captures_white')::int else captures_white end,
    black_ms           = case when p_patch ? 'black_ms' then (p_patch->>'black_ms')::bigint else black_ms end,
    white_ms           = case when p_patch ? 'white_ms' then (p_patch->>'white_ms')::bigint else white_ms end,
    clock_running      = case when p_patch ? 'clock_running' then (p_patch->>'clock_running')::smallint else clock_running end,
    clock_since        = case when coalesce((p_patch->>'clock_restart')::boolean, false) then now()
                              when p_patch ? 'clock_running' and p_patch->>'clock_running' is null then null
                              else clock_since end,
    dead_stones        = case when p_patch ? 'dead_stones' then coalesce(array(select jsonb_array_elements_text(p_patch->'dead_stones'))::int[], '{}') else dead_stones end,
    score_accept_black = case when p_patch ? 'score_accept_black' then (p_patch->>'score_accept_black')::boolean else score_accept_black end,
    score_accept_white = case when p_patch ? 'score_accept_white' then (p_patch->>'score_accept_white')::boolean else score_accept_white end,
    draw_offer_by      = case when p_patch ? 'draw_offer_by' then (p_patch->>'draw_offer_by')::smallint else draw_offer_by end,
    undo_request       = case when p_patch ? 'undo_request' then p_patch->'undo_request' else undo_request end,
    last_move_at       = case when coalesce((p_patch->>'touch_move')::boolean, false) then now() else last_move_at end,
    version            = version + 1,
    updated_at         = now()
  where id = p_game;

  -- JSON null for undo_request must become SQL null
  update public.games set undo_request = null where id = p_game and undo_request = 'null'::jsonb;

  fin := p_patch->'finish';
  if fin is not null and jsonb_typeof(fin) = 'object' then
    perform public._finish_game(p_game, (fin->>'winner')::smallint, fin->>'reason', fin->>'text', fin->'score');
  end if;
  return jsonb_build_object('version', (select version from public.games where id = p_game));
end $$;

-- ───────── ranking queries ─────────
create function public.get_leaderboard(p_size integer, p_period text default 'all', p_limit integer default 50, p_offset integer default 0)
returns table (rank bigint, user_id uuid, username text, avatar text, country text, rating integer, league text,
               games integer, wins integer, losses integer, score integer)
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz;
begin
  if p_size not in (9,13,19) then raise exception 'err:invalid_settings'; end if;
  p_limit := least(greatest(p_limit, 1), 100);
  if p_period = 'all' then
    return query
      select row_number() over (order by r.rating desc, r.games desc, p.created_at), r.user_id, p.username, p.avatar, p.country,
             r.rating, public.league_for(r.rating), r.games, r.wins, r.losses, r.rating
        from public.player_ratings r join public.profiles p on p.id = r.user_id
       where r.board_size = p_size and r.games > 0
       order by 1 limit p_limit offset p_offset;
  else
    since := case p_period when 'week' then date_trunc('week', now()) when 'month' then date_trunc('month', now())
                           else null end;
    if since is null then raise exception 'err:invalid_settings'; end if;
    return query
      select row_number() over (order by sum(h.delta) desc, count(*) desc, p.username), h.user_id, p.username, p.avatar, p.country,
             pr.rating, public.league_for(pr.rating), count(*)::int,
             count(*) filter (where h.delta > 0)::int, count(*) filter (where h.delta < 0)::int, sum(h.delta)::int
        from public.rating_history h
        join public.profiles p on p.id = h.user_id
        join public.player_ratings pr on pr.user_id = h.user_id and pr.board_size = h.board_size
       where h.board_size = p_size and h.created_at >= since
       group by h.user_id, p.username, p.avatar, p.country, pr.rating, p.created_at
       order by 1 limit p_limit offset p_offset;
  end if;
end $$;

create function public.get_match_history(p_user uuid, p_limit integer default 20)
returns table (game_id uuid, board_size smallint, finished_at timestamptz, result_text text, my_color smallint,
               won boolean, draw boolean, rating_before integer, rating_after integer, opponent_id uuid, opponent_name text, opponent_avatar text, is_ranked boolean)
language sql stable security definer set search_path = public as $$
  select g.id, g.board_size, g.finished_at, g.result_text, me.color,
         g.winner = me.color, g.winner is null, me.rating_before, me.rating_after,
         op.user_id, p.username, p.avatar, g.is_ranked
    from public.game_participants me
    join public.games g on g.id = me.game_id and g.status = 'finished'
    left join public.game_participants op on op.game_id = g.id and op.user_id <> me.user_id
    left join public.profiles p on p.id = op.user_id
   where me.user_id = p_user and (g.is_private = false or public.is_game_participant(g.id) or public.is_admin())
   order by g.finished_at desc
   limit least(greatest(p_limit,1), 100) $$;

-- ───────── RLS ─────────
alter table public.games enable row level security;
alter table public.game_participants enable row level security;
alter table public.game_moves enable row level security;
alter table public.matchmaking_queue enable row level security;
alter table public.game_invites enable row level security;

create policy games_select on public.games for select using (public.can_view_game(id));
create policy participants_select on public.game_participants for select using (public.can_view_game(game_id));
create policy moves_select on public.game_moves for select using (public.can_view_game(game_id));
create policy queue_select_own on public.matchmaking_queue for select to authenticated using (user_id = auth.uid());
create policy invites_select on public.game_invites for select to authenticated using (auth.uid() in (from_user, to_user));
-- No INSERT/UPDATE/DELETE policies and no table privileges: all writes go through SECURITY DEFINER functions.
