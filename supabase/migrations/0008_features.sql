-- GO PLAY — puzzles & streaks, shareable replays, live games + commentary, seasons & medals, weekly tournaments,
-- personalization storage, player statistics. Everything that matters is decided on the server.

alter table public.lessons add column track text not null default 'basics' check (track in ('basics','openings'));

-- ═══════════ puzzles ═══════════
create table public.puzzles (
  id         text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  difficulty smallint not null check (difficulty between 1 and 3),
  kind       text not null check (kind in ('capture','atari','doubleAtari','escape','connect','lifeDeath')),
  shape      text,
  puzzle     jsonb not null check (jsonb_typeof(puzzle) = 'object'),     -- { size, rows, toPlay } — never the answer
  published  boolean not null default true,
  created_at timestamptz not null default now()
);
create index puzzles_diff_idx on public.puzzles (difficulty, id) where published;

create table public.puzzle_solutions (                                      -- no client policy: answers stay on the server
  puzzle_id text primary key references public.puzzles(id) on delete cascade,
  points    integer[] not null check (cardinality(points) > 0)
);

create table public.puzzle_solves (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  puzzle_id text not null references public.puzzles(id) on delete cascade,
  solved_at timestamptz not null default now(),
  primary key (user_id, puzzle_id)
);

-- the daily set: admin-scheduled rows win, otherwise a deterministic rotation through the bank
alter table public.daily_challenges drop constraint daily_i18n_title;
alter table public.daily_challenges alter column title drop not null;
alter table public.daily_challenges alter column puzzle drop not null;
alter table public.daily_challenges drop constraint daily_challenges_pkey;
alter table public.daily_challenges add column difficulty smallint not null default 1 check (difficulty between 1 and 3);
alter table public.daily_challenges add column puzzle_id text references public.puzzles(id) on delete set null;
alter table public.daily_challenges add primary key (day, difficulty);
alter table public.daily_completions drop constraint daily_completions_pkey;
alter table public.daily_completions add column difficulty smallint not null default 1;
alter table public.daily_completions add primary key (user_id, day, difficulty);
drop function public.complete_daily_challenge();

create function public.utc_today() returns date language sql stable as $$ select (now() at time zone 'utc')::date $$;

create function public.daily_puzzle_id(p_day date, p_diff integer) returns text
language plpgsql stable security definer set search_path = public as $$
declare pid text; n integer; k integer;
begin
  select puzzle_id into pid from public.daily_challenges where day = p_day and difficulty = p_diff and puzzle_id is not null;
  if pid is not null then return pid; end if;
  select count(*) into n from public.puzzles where difficulty = p_diff and published;
  if n = 0 then return null; end if;
  k := ((p_day - date '1970-01-01') % n + n) % n;
  select id into pid from public.puzzles where difficulty = p_diff and published order by id collate "C" offset k limit 1;
  return pid;
end $$;

create function public.get_daily_set(p_day date default null)
returns table (difficulty smallint, puzzle_id text, kind text, shape text, puzzle jsonb, solved boolean, scheduled boolean)
language plpgsql stable security definer set search_path = public as $$
declare d date := coalesce(p_day, public.utc_today());
begin
  if d > public.utc_today() then raise exception 'err:invalid_settings'; end if;       -- no peeking at future puzzles
  return query
    select x.diff::smallint, p.id, p.kind, p.shape, p.puzzle,
           exists (select 1 from public.daily_completions c where c.user_id = auth.uid() and c.day = d and c.difficulty = x.diff),
           exists (select 1 from public.daily_challenges s where s.day = d and s.difficulty = x.diff and s.puzzle_id is not null)
      from generate_series(1, 3) as x(diff)
      join public.puzzles p on p.id = public.daily_puzzle_id(d, x.diff)
     order by x.diff;
end $$;

-- Server-side answer check. Streaks and solve counts only ever come from here.
create function public.solve_puzzle(p_puzzle text, p_point integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pz public.puzzles; sol integer[]; ok boolean; first boolean := false; d date := public.utc_today(); rc integer;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('solve:' || uid, 120, 60);
  select * into pz from public.puzzles where id = p_puzzle and published;
  if not found then raise exception 'err:puzzle_not_found'; end if;
  select points into sol from public.puzzle_solutions where puzzle_id = p_puzzle;
  ok := p_point = any(sol);
  if ok then
    insert into public.puzzle_solves (user_id, puzzle_id) values (uid, p_puzzle) on conflict do nothing;
    get diagnostics rc = row_count; first := rc > 0;
    if public.daily_puzzle_id(d, pz.difficulty) = p_puzzle then
      insert into public.daily_completions (user_id, day, difficulty) values (uid, d, pz.difficulty) on conflict do nothing;
    end if;
    perform public._award_achievements(uid);
  end if;
  return jsonb_build_object('correct', ok, 'first_solve', first, 'kind', pz.kind, 'shape', pz.shape);
end $$;

-- "Show solution": returns the answer without recording a solve
create function public.reveal_puzzle(p_puzzle text) returns integer[]
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sol integer[];
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('reveal:' || uid, 30, 60);
  select s.points into sol from public.puzzle_solutions s join public.puzzles p on p.id = s.puzzle_id where p.id = p_puzzle and p.published;
  if sol is null then raise exception 'err:puzzle_not_found'; end if;
  return sol;
end $$;

create function public.get_daily_streak() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := public.utc_today(); cur integer; best integer; total integer; solved_today boolean;
begin
  if uid is null then return jsonb_build_object('current', 0, 'best', 0, 'days', 0, 'solved_today', false); end if;
  with d as (select distinct day from public.daily_completions where user_id = uid),
       g as (select day, day - (row_number() over (order by day))::integer as grp from d),
       runs as (select count(*)::integer as n, max(day) as last from g group by grp)
  select coalesce((select n from runs where last >= today - 1 order by last desc limit 1), 0), coalesce((select max(n) from runs), 0)
    into cur, best;
  select count(distinct day)::integer into total from public.daily_completions where user_id = uid;
  select exists (select 1 from public.daily_completions where user_id = uid and day = today) into solved_today;
  return jsonb_build_object('current', cur, 'best', best, 'days', total, 'solved_today', solved_today);
end $$;

-- ═══════════ achievements & medals ═══════════
create table public.user_medals (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('season_gold','season_silver','season_bronze','tournament_gold','tournament_silver','tournament_bronze')),
  ref        text not null,                       -- season key 'YYYY-MM' or tournament id
  board_size smallint,
  label      text,
  earned_at  timestamptz not null default now(),
  unique (user_id, kind, ref, board_size)
);
create index user_medals_user_idx on public.user_medals (user_id, earned_at desc);

insert into public.achievements (code, category, icon, sort) values
  ('puzzle_10', 'learning', 'puzzle', 85), ('puzzle_50', 'learning', 'puzzle', 95), ('daily_streak_7', 'daily', 'flame', 125),
  ('tournament_win', 'games', 'medal', 45), ('season_medal', 'games', 'medal', 46);

create or replace function public._award_achievements(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare finished_n integer; wins_n integer; best integer; lessons_n integer; lessons_total integer; daily_n integer;
        puzzles_n integer; dstreak integer; tmed integer; smed integer;
begin
  select count(*), count(*) filter (where g.winner = gp.color) into finished_n, wins_n
    from public.game_participants gp join public.games g on g.id = gp.game_id
   where gp.user_id = p_user and g.status = 'finished' and g.move_count >= 4 and g.end_reason not in ('abandoned','forfeit')
     and (select count(*) from public.game_participants x where x.game_id = g.id) = 2;
  select coalesce(max(best_streak), 0) into best from public.player_ratings where user_id = p_user;
  select count(*) into lessons_n from public.lesson_progress where user_id = p_user and completed_at is not null;
  select count(*) into lessons_total from public.lessons where published;
  select count(distinct day) into daily_n from public.daily_completions where user_id = p_user;
  select count(*) into puzzles_n from public.puzzle_solves where user_id = p_user;
  select coalesce((public.get_daily_streak_for(p_user)->>'best')::int, 0) into dstreak;
  select count(*) into tmed from public.user_medals where user_id = p_user and kind = 'tournament_gold';
  select count(*) into smed from public.user_medals where user_id = p_user and kind like 'season_%';
  insert into public.user_achievements (user_id, code)
  select p_user, c from (values
    ('first_win', wins_n >= 1), ('first_online_game', finished_n >= 1), ('games_10', finished_n >= 10), ('games_100', finished_n >= 100),
    ('streak_3', best >= 3), ('streak_5', best >= 5), ('streak_10', best >= 10),
    ('lesson_first', lessons_n >= 1), ('lessons_5', lessons_n >= 5), ('lessons_all', lessons_total > 0 and lessons_n >= lessons_total),
    ('daily_first', daily_n >= 1), ('daily_7', daily_n >= 7), ('daily_streak_7', dstreak >= 7),
    ('puzzle_10', puzzles_n >= 10), ('puzzle_50', puzzles_n >= 50), ('tournament_win', tmed >= 1), ('season_medal', smed >= 1)
  ) t(c, ok) where ok on conflict do nothing;
end $$;

-- same streak maths for any user (used by achievements); get_daily_streak() is the client-facing wrapper
create function public.get_daily_streak_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select distinct day from public.daily_completions where user_id = p_user),
       g as (select day, day - (row_number() over (order by day))::integer as grp from d),
       runs as (select count(*)::integer as n from g group by grp)
  select jsonb_build_object('best', coalesce((select max(n) from runs), 0)) $$;

-- ═══════════ shareable replays, live games, spectator commentary ═══════════
alter table public.games add column replay_shared boolean not null default false;

create or replace function public.can_view_game(p_game uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select public.is_game_participant(p_game)
       or exists (select 1 from public.games g where g.id = p_game and g.is_private = false and g.status <> 'waiting')
       or exists (select 1 from public.games g where g.id = p_game and g.replay_shared and g.status = 'finished')
       or public.is_admin() $$;

create function public.set_replay_shared(p_game uuid, p_shared boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_game_participant(p_game) then raise exception 'err:forbidden'; end if;
  if not exists (select 1 from public.games where id = p_game and status = 'finished') then raise exception 'err:game_not_finished'; end if;
  update public.games set replay_shared = p_shared where id = p_game;
end $$;

create function public.list_live_games(p_limit integer default 30)
returns table (game_id uuid, board_size smallint, move_count integer, started_at timestamptz, time_initial_s integer, time_increment_s integer,
               is_ranked boolean, black_id uuid, black_name text, black_rating integer, white_id uuid, white_name text, white_rating integer)
language sql stable security definer set search_path = public as $$
  select g.id, g.board_size, g.move_count, g.started_at, g.time_initial_s, g.time_increment_s, g.is_ranked,
         pb.user_id, ub.username, rb.rating, pw.user_id, uw.username, rw.rating
    from public.games g
    join public.game_participants pb on pb.game_id = g.id and pb.color = 1
    join public.game_participants pw on pw.game_id = g.id and pw.color = 2
    join public.profiles ub on ub.id = pb.user_id join public.profiles uw on uw.id = pw.user_id
    left join public.player_ratings rb on rb.user_id = pb.user_id and rb.board_size = g.board_size
    left join public.player_ratings rw on rw.user_id = pw.user_id and rw.board_size = g.board_size
   where g.status = 'active' and not g.is_private and g.move_count >= 1
   order by (coalesce(rb.rating,0) + coalesce(rw.rating,0)) desc, g.last_move_at desc nulls last
   limit least(greatest(p_limit, 1), 100) $$;

create table public.game_comments (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  move_number integer not null check (move_number >= 0),
  body        text not null check (char_length(body) between 1 and 280),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index game_comments_game_idx on public.game_comments (game_id, created_at);

-- Players cannot read commentary while their game is running (spectators could otherwise coach them).
create function public.can_read_comments(p_game uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_view_game(p_game)
     and (not public.is_game_participant(p_game) or exists (select 1 from public.games g where g.id = p_game and g.status in ('finished','aborted'))) $$;

create function public.post_game_comment(p_game uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g public.games; cid uuid; body text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('comment:' || uid, 12, 60);
  if char_length(body) not between 1 and 280 then raise exception 'err:invalid_message'; end if;
  select * into g from public.games where id = p_game;
  if not found or not public.can_view_game(p_game) then raise exception 'err:game_not_found'; end if;
  if g.status = 'waiting' or g.status = 'aborted' then raise exception 'err:game_over'; end if;
  if public.is_game_participant(p_game) and g.status <> 'finished' then raise exception 'err:forbidden'; end if;   -- players stay out of live commentary
  insert into public.game_comments (game_id, user_id, move_number, body) values (p_game, uid, g.move_count, body) returning id into cid;
  return cid;
end $$;

create function public.admin_hide_comment(p_comment uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  update public.game_comments set hidden = p_hidden where id = p_comment;
  perform public._audit('comment.hide', p_comment::text, jsonb_build_object('hidden', p_hidden));
end $$;

-- ═══════════ monthly seasons ═══════════
create table public.season_results (
  season       text not null check (season ~ '^\d{4}-\d{2}$'),
  board_size   smallint not null check (board_size in (9,13,19)),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  rank         integer not null,
  gain         integer not null,
  games        integer not null,
  final_rating integer not null,
  primary key (season, board_size, user_id)
);
create index season_results_rank_idx on public.season_results (season, board_size, rank);

create function public.current_season() returns jsonb
language sql stable as $$
  select jsonb_build_object('key', to_char(now() at time zone 'utc', 'YYYY-MM'),
         'starts_at', date_trunc('month', now() at time zone 'utc') at time zone 'utc',
         'ends_at', (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc') $$;

-- Rating seasons = calendar months (UTC). Ratings are NOT reset; the season ranking is rating gained during the month.
-- Idempotent snapshot + medals (top 3 per board size, min. 3 rated games). Run monthly (pg_cron) or by an admin.
create function public.close_season(p_season text) returns integer
language plpgsql security definer set search_path = public as $$
declare s_start timestamptz; s_end timestamptz; n integer := 0; sz integer; r record;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'err:forbidden'; end if;
  if p_season !~ '^\d{4}-\d{2}$' then raise exception 'err:invalid_settings'; end if;
  s_start := (p_season || '-01')::date at time zone 'utc';
  s_end := s_start + interval '1 month';
  if s_end > now() then raise exception 'err:season_not_finished'; end if;
  foreach sz in array array[9,13,19] loop
    for r in
      select h.user_id, sum(h.delta)::int as gain, count(*)::int as games,
             (array_agg(h.new_rating order by h.created_at desc))[1] as final_rating,
             row_number() over (order by sum(h.delta) desc, count(*) desc, h.user_id) as rk
        from public.rating_history h
       where h.board_size = sz and h.created_at >= s_start and h.created_at < s_end
       group by h.user_id having count(*) >= 3
       order by rk limit 100
    loop
      insert into public.season_results (season, board_size, user_id, rank, gain, games, final_rating)
      values (p_season, sz, r.user_id, r.rk, r.gain, r.games, r.final_rating) on conflict do nothing;
      if r.rk <= 3 then
        insert into public.user_medals (user_id, kind, ref, board_size, label)
        values (r.user_id, case r.rk when 1 then 'season_gold' when 2 then 'season_silver' else 'season_bronze' end, p_season, sz, p_season)
        on conflict do nothing;
        perform public._award_achievements(r.user_id);
      end if;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

create function public.get_season_results(p_season text, p_size integer, p_limit integer default 50)
returns table (rank integer, user_id uuid, username text, avatar text, gain integer, games integer, final_rating integer)
language sql stable security definer set search_path = public as $$
  select s.rank, s.user_id, p.username, p.avatar, s.gain, s.games, s.final_rating
    from public.season_results s join public.profiles p on p.id = s.user_id
   where s.season = p_season and s.board_size = p_size order by s.rank limit least(greatest(p_limit,1),100) $$;

create function public.list_seasons() returns setof text
language sql stable security definer set search_path = public as $$ select distinct season from public.season_results order by season desc limit 24 $$;

-- ═══════════ tournaments: medals + weekly series ═══════════
create function public._award_tournament_medals() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; place integer := 0;
begin
  if new.status <> 'finished' or old.status = 'finished' then return new; end if;
  if new.format = 'single_elimination' then
    if new.winner_id is not null then insert into public.user_medals (user_id, kind, ref, board_size, label) values (new.winner_id, 'tournament_gold', new.id::text, new.board_size, new.name) on conflict do nothing; end if;
    for r in select m.winner_id, m.player_a, m.player_b, m.round from public.tournament_matches m
              where m.tournament_id = new.id and m.round >= new.total_rounds - 1 and m.status in ('finished','forfeit') loop
      if r.round = new.total_rounds then
        insert into public.user_medals (user_id, kind, ref, board_size, label)
        select case when r.winner_id = r.player_a then r.player_b else r.player_a end, 'tournament_silver', new.id::text, new.board_size, new.name
        where r.player_a is not null and r.player_b is not null on conflict do nothing;
      else
        insert into public.user_medals (user_id, kind, ref, board_size, label)
        select case when r.winner_id = r.player_a then r.player_b else r.player_a end, 'tournament_bronze', new.id::text, new.board_size, new.name
        where r.player_a is not null and r.player_b is not null on conflict do nothing;
      end if;
    end loop;
  else
    for r in select user_id from public.tournament_participants where tournament_id = new.id order by points desc, wins desc, seed limit 3 loop
      place := place + 1;
      insert into public.user_medals (user_id, kind, ref, board_size, label)
      values (r.user_id, case place when 1 then 'tournament_gold' when 2 then 'tournament_silver' else 'tournament_bronze' end, new.id::text, new.board_size, new.name) on conflict do nothing;
    end loop;
  end if;
  for r in select user_id from public.user_medals where ref = new.id::text loop perform public._award_achievements(r.user_id); end loop;
  return new;
end $$;
create trigger tournaments_medals after update of status on public.tournaments for each row execute function public._award_tournament_medals();

-- Weekly cups: every Saturday 17:00 UTC for 9×9 and 13×13. Called by pg_cron (no auth.uid) or an admin.
create function public.ensure_weekly_tournaments() returns integer
language plpgsql security definer set search_path = public as $$
declare t0 timestamptz; sz integer; n integer := 0; tid uuid;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'err:forbidden'; end if;
  t0 := date_trunc('week', now() at time zone 'utc') at time zone 'utc' + interval '5 days 17 hours';
  if t0 <= now() then t0 := t0 + interval '7 days'; end if;
  foreach sz in array array[9, 13] loop
    if not exists (select 1 from public.tournaments where recurrence = 'weekly' and starts_at = t0 and board_size = sz) then
      insert into public.tournaments (name, description, format, board_size, rules, time_initial_s, time_increment_s, min_players, max_players,
                                       registration_closes_at, starts_at, forfeit_after_minutes, recurrence)
      values ('Weekly Cup ' || sz || '×' || sz || ' · ' || to_char(t0, 'YYYY-MM-DD'), 'Open weekly single-elimination cup.', 'single_elimination', sz, 'japanese',
              600, 5, 4, 32, t0, t0, 60, 'weekly');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Starts registrations whose start time has passed; cancels those that never reached the minimum.
create function public.start_due_tournaments() returns integer
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n integer; started integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'err:forbidden'; end if;
  for t in select * from public.tournaments where status = 'registration' and starts_at is not null and starts_at <= now() for update skip locked loop
    select count(*) into n from public.tournament_participants where tournament_id = t.id;
    if n >= greatest(t.min_players, 2) then perform public.start_tournament(t.id); started := started + 1;
    else update public.tournaments set status = 'cancelled', finished_at = now() where id = t.id; end if;
  end loop;
  return started;
end $$;

-- ═══════════ personalization + statistics ═══════════
alter table public.profiles add column prefs jsonb not null default '{}'
  check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) < 4096);

create function public.get_head_to_head(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'games', count(*), 'wins', count(*) filter (where g.winner = me.color), 'losses', count(*) filter (where g.winner = op.color),
    'draws', count(*) filter (where g.winner is null))
    from public.game_participants me
    join public.game_participants op on op.game_id = me.game_id and op.user_id = p_user
    join public.games g on g.id = me.game_id and g.status = 'finished' and g.end_reason not in ('abandoned','forfeit')
   where me.user_id = auth.uid() and p_user <> auth.uid() $$;

create function public.get_player_stats(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'form', coalesce((select string_agg(case when x.winner is null then 'D' when x.winner = x.color then 'W' else 'L' end, '' order by x.finished_at desc)
                        from (select g.winner, gp.color, g.finished_at from public.game_participants gp join public.games g on g.id = gp.game_id
                               where gp.user_id = p_user and g.status = 'finished' and g.end_reason not in ('abandoned','forfeit') and g.move_count >= 4
                                 and (not g.is_private or g.replay_shared or public.is_game_participant(g.id))
                               order by g.finished_at desc limit 10) x), ''),
    'puzzles', (select count(*) from public.puzzle_solves where user_id = p_user),
    'medals', (select count(*) from public.user_medals where user_id = p_user),
    'daily_best', coalesce((public.get_daily_streak_for(p_user)->>'best')::int, 0),
    'games_30d', (select count(*) from public.game_participants gp join public.games g on g.id = gp.game_id
                   where gp.user_id = p_user and g.status = 'finished' and g.finished_at > now() - interval '30 days' and not g.is_private)) $$;

-- ═══════════ RLS & privileges for the new objects ═══════════
alter table public.puzzles enable row level security;
alter table public.puzzle_solutions enable row level security;
alter table public.puzzle_solves enable row level security;
alter table public.user_medals enable row level security;
alter table public.game_comments enable row level security;
alter table public.season_results enable row level security;

create policy puzzles_select on public.puzzles for select using (published or public.is_admin());
create policy puzzles_admin_write on public.puzzles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy solves_select_own on public.puzzle_solves for select to authenticated using (user_id = auth.uid());
create policy medals_select on public.user_medals for select using (true);
create policy season_select on public.season_results for select using (true);
create policy comments_select on public.game_comments for select
  using (public.can_read_comments(game_id) and (not hidden or public.is_staff()));

revoke all on public.puzzles, public.puzzle_solutions, public.puzzle_solves, public.user_medals, public.game_comments, public.season_results from anon, authenticated;
grant select on public.puzzles, public.user_medals, public.season_results to anon, authenticated;
grant select on public.puzzle_solves, public.game_comments to authenticated;
grant select on public.game_comments to anon;
grant insert, update, delete on public.puzzles to authenticated;      -- admin-only through RLS
grant update (prefs) on public.profiles to authenticated;
grant select on public.daily_completions to authenticated;

revoke execute on function
  public.utc_today(), public.daily_puzzle_id(date, integer), public.get_daily_set(date), public.solve_puzzle(text, integer), public.reveal_puzzle(text),
  public.get_daily_streak(), public.get_daily_streak_for(uuid), public.set_replay_shared(uuid, boolean), public.list_live_games(integer),
  public.can_read_comments(uuid), public.post_game_comment(uuid, text), public.admin_hide_comment(uuid, boolean), public.current_season(),
  public.close_season(text), public.get_season_results(text, integer, integer), public.list_seasons(), public._award_tournament_medals(),
  public.ensure_weekly_tournaments(), public.start_due_tournaments(), public.get_head_to_head(uuid), public.get_player_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.utc_today(), public.get_daily_set(date), public.list_live_games(integer), public.can_read_comments(uuid), public.current_season(),
  public.get_season_results(text, integer, integer), public.list_seasons(), public.get_player_stats(uuid) to anon, authenticated;
grant execute on function public.solve_puzzle(text, integer), public.reveal_puzzle(text), public.get_daily_streak(), public.set_replay_shared(uuid, boolean),
  public.post_game_comment(uuid, text), public.admin_hide_comment(uuid, boolean), public.get_head_to_head(uuid), public.close_season(text) to authenticated;
grant execute on function public.close_season(text), public.ensure_weekly_tournaments(), public.start_due_tournaments() to service_role;
grant execute on function public.ensure_weekly_tournaments(), public.start_due_tournaments() to authenticated;   -- admin-checked inside; lets admins run them by hand

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.game_comments;
  end if;
end $$;

-- Schedule (enable pg_cron):
--   select cron.schedule('goplay-weekly', '0 6 * * 1', 'select public.ensure_weekly_tournaments()');
--   select cron.schedule('goplay-start-due', '* * * * *', 'select public.start_due_tournaments()');
--   select cron.schedule('goplay-season', '5 0 1 * *', $$select public.close_season(to_char(now() at time zone 'utc' - interval '1 month', 'YYYY-MM'))$$);
