-- GO PLAY — tournaments (single elimination + round robin)

create table public.tournaments (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 3 and 80),
  description   text not null default '' check (char_length(description) <= 1000),
  format        text not null check (format in ('single_elimination','round_robin')),
  board_size    smallint not null check (board_size in (9,13,19)),
  rules         text not null default 'japanese' check (rules in ('japanese','chinese')),
  komi          numeric(4,1),
  time_initial_s   integer not null default 600 check (time_initial_s between 0 and 7200),
  time_increment_s integer not null default 0 check (time_increment_s between 0 and 120),
  min_players   integer not null default 2 check (min_players >= 2),
  max_players   integer not null default 16 check (max_players between 2 and 128),
  registration_closes_at timestamptz,
  starts_at     timestamptz,
  forfeit_after_minutes integer not null default 60 check (forfeit_after_minutes between 5 and 10080),
  status        text not null default 'registration' check (status in ('draft','registration','running','finished','cancelled')),
  current_round integer not null default 0,
  total_rounds  integer,
  winner_id     uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  check (min_players <= max_players)
);
create index tournaments_status_idx on public.tournaments (status, starts_at);

create table public.tournament_participants (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  seed          integer,
  eliminated    boolean not null default false,
  points        numeric(6,1) not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  registered_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index tournament_participants_user_idx on public.tournament_participants (user_id);

create table public.tournament_matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round         integer not null,
  position      integer not null,
  player_a      uuid references public.profiles(id) on delete set null,
  player_b      uuid references public.profiles(id) on delete set null,
  game_id       uuid references public.games(id) on delete set null,
  winner_id     uuid references public.profiles(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','active','finished','bye','forfeit')),
  next_match_id uuid references public.tournament_matches(id) on delete set null,
  next_slot     char(1) check (next_slot in ('a','b')),
  scheduled_at  timestamptz,
  finished_at   timestamptz,
  unique (tournament_id, round, position)
);
create index tournament_matches_game_idx on public.tournament_matches (game_id);
alter table public.tournaments add column recurrence text check (recurrence in ('weekly'));
create unique index tournaments_recurring_uq on public.tournaments (recurrence, starts_at, board_size) where recurrence is not null;
alter table public.games add constraint games_tournament_match_fk
  foreign key (tournament_match_id) references public.tournament_matches(id) on delete set null;

-- ───────── admin: create ─────────
create function public.create_tournament(
  p_name text, p_description text, p_format text, p_size integer, p_rules text, p_initial integer, p_increment integer,
  p_min integer, p_max integer, p_closes timestamptz, p_starts timestamptz, p_forfeit_minutes integer default 60, p_komi numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if not public.is_admin() then raise exception 'err:forbidden'; end if;
  insert into public.tournaments (name, description, format, board_size, rules, komi, time_initial_s, time_increment_s,
                                  min_players, max_players, registration_closes_at, starts_at, forfeit_after_minutes, created_by)
  values (btrim(p_name), coalesce(p_description,''), p_format, p_size, p_rules, p_komi, p_initial, p_increment,
          p_min, p_max, p_closes, p_starts, p_forfeit_minutes, auth.uid())
  returning id into tid;
  insert into public.audit_log (actor_id, action, target, data) values (auth.uid(), 'tournament.create', tid::text, jsonb_build_object('name', p_name));
  return tid;
end $$;

create function public.register_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t public.tournaments; n integer;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('treg:' || uid, 20, 3600);
  select * into t from public.tournaments where id = p_tournament for update;
  if not found or t.status <> 'registration' then raise exception 'err:registration_closed'; end if;
  if t.registration_closes_at is not null and t.registration_closes_at < now() then raise exception 'err:registration_closed'; end if;
  if exists (select 1 from public.tournament_participants where tournament_id = p_tournament and user_id = uid) then raise exception 'err:already_registered'; end if;
  select count(*) into n from public.tournament_participants where tournament_id = p_tournament;
  if n >= t.max_players then raise exception 'err:tournament_full'; end if;
  insert into public.tournament_participants (tournament_id, user_id) values (p_tournament, uid);
end $$;

create function public.unregister_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tournaments where id = p_tournament and status = 'registration') then raise exception 'err:registration_closed'; end if;
  delete from public.tournament_participants where tournament_id = p_tournament and user_id = auth.uid();
end $$;

-- ───────── match lifecycle ─────────
create function public._tournament_try_start_match(p_match uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.tournament_matches; t public.tournaments; gid uuid;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if m.status <> 'pending' or m.player_a is null or m.player_b is null then return; end if;
  select * into t from public.tournaments where id = m.tournament_id;
  -- higher seed (lower number) plays Black in round 1 only by convention; later rounds: a = Black
  gid := public._create_game(m.player_a, m.player_b, t.board_size, t.time_initial_s, t.time_increment_s, t.rules, t.komi, 0, true, false, m.id);
  update public.tournament_matches set status = 'active', game_id = gid, scheduled_at = now() where id = m.id;
end $$;

create function public._tournament_advance_winner(p_match uuid, p_winner uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.tournament_matches;
begin
  select * into m from public.tournament_matches where id = p_match;
  if m.next_match_id is null then return; end if;
  if m.next_slot = 'a' then update public.tournament_matches set player_a = p_winner where id = m.next_match_id;
  else update public.tournament_matches set player_b = p_winner where id = m.next_match_id; end if;
  perform public._tournament_try_start_match(m.next_match_id);
end $$;

create function public._tournament_round_robin_progress(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; open_n integer; w uuid; mid uuid;
begin
  select * into t from public.tournaments where id = p_tournament for update;
  select count(*) into open_n from public.tournament_matches where tournament_id = p_tournament and round = t.current_round and status in ('pending','active');
  if open_n > 0 then return; end if;
  if t.current_round >= t.total_rounds then
    select user_id into w from public.tournament_participants where tournament_id = p_tournament
     order by points desc, wins desc, seed asc limit 1;
    update public.tournaments set status = 'finished', winner_id = w, finished_at = now() where id = p_tournament;
    return;
  end if;
  update public.tournaments set current_round = current_round + 1 where id = p_tournament;
  for mid in select id from public.tournament_matches where tournament_id = p_tournament and round = t.current_round + 1 loop
    perform public._tournament_try_start_match(mid);
  end loop;
end $$;

create function public._tournament_game_finished(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g public.games; m public.tournament_matches; t public.tournaments; winner uuid; loser uuid; sa integer; sb integer;
begin
  select * into g from public.games where id = p_game;
  if g.tournament_match_id is null then return; end if;
  select * into m from public.tournament_matches where id = g.tournament_match_id for update;
  if m.status <> 'active' then return; end if;
  select * into t from public.tournaments where id = m.tournament_id;

  if g.winner is not null then
    select user_id into winner from public.game_participants where game_id = p_game and color = g.winner;
  elsif t.format = 'single_elimination' then
    select tp.user_id into winner from public.tournament_participants tp
     where tp.tournament_id = t.id and tp.user_id in (m.player_a, m.player_b) order by tp.seed limit 1;   -- draw: higher seed advances
  end if;
  loser := case when winner = m.player_a then m.player_b when winner = m.player_b then m.player_a end;

  update public.tournament_matches set status = case when g.end_reason = 'forfeit' then 'forfeit' else 'finished' end,
         winner_id = winner, finished_at = now() where id = m.id;

  if winner is not null then
    update public.tournament_participants set wins = wins + 1, points = points + 1 where tournament_id = t.id and user_id = winner;
    update public.tournament_participants set losses = losses + 1, eliminated = (t.format = 'single_elimination')
     where tournament_id = t.id and user_id = loser;
  else
    update public.tournament_participants set points = points + 0.5 where tournament_id = t.id and user_id in (m.player_a, m.player_b);
  end if;

  if t.format = 'single_elimination' then
    if m.next_match_id is null then
      update public.tournaments set status = 'finished', winner_id = winner, finished_at = now() where id = t.id;
    else
      perform public._tournament_advance_winner(m.id, winner);
    end if;
  else
    perform public._tournament_round_robin_progress(t.id);
  end if;
end $$;

-- ───────── admin: start ─────────
create function public.start_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tournaments; n integer; m integer; rounds integer; r integer; i integer; s integer;
        order_arr integer[]; nxt integer[]; sz integer; ids uuid[]; a uuid; b uuid; mid uuid; pos integer; ua uuid; ub uuid;
        mm record; arr uuid[]; k integer; h integer; rr integer;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'err:forbidden'; end if;   -- NULL uid = scheduler (pg_cron)
  select * into t from public.tournaments where id = p_tournament for update;
  if not found or t.status <> 'registration' then raise exception 'err:invalid_state'; end if;
  select count(*) into n from public.tournament_participants where tournament_id = p_tournament;
  if n < greatest(t.min_players, 2) then raise exception 'err:not_enough_players'; end if;

  -- seed by rating on the tournament's board size
  update public.tournament_participants tp set seed = x.rn
    from (select tp2.user_id, row_number() over (order by coalesce(pr.rating,1000) desc, tp2.registered_at) rn
            from public.tournament_participants tp2
            left join public.player_ratings pr on pr.user_id = tp2.user_id and pr.board_size = t.board_size
           where tp2.tournament_id = p_tournament) x
   where tp.tournament_id = p_tournament and tp.user_id = x.user_id;

  select array_agg(user_id order by seed) into ids from public.tournament_participants where tournament_id = p_tournament;

  if t.format = 'single_elimination' then
    m := 2; rounds := 1;
    while m < n loop m := m * 2; rounds := rounds + 1; end loop;
    order_arr := array[1,2]; sz := 2;
    while sz < m loop
      sz := sz * 2; nxt := '{}';
      foreach s in array order_arr loop nxt := nxt || s || (sz + 1 - s); end loop;
      order_arr := nxt;
    end loop;
    -- create all matches
    for r in 1..rounds loop
      for pos in 1..(m / (2 ^ r))::int loop
        ua := null; ub := null;
        if r = 1 then
          a := case when order_arr[2*pos-1] <= n then ids[order_arr[2*pos-1]] end;
          b := case when order_arr[2*pos]   <= n then ids[order_arr[2*pos]]   end;
          ua := a; ub := b;
        end if;
        insert into public.tournament_matches (tournament_id, round, position, player_a, player_b)
        values (p_tournament, r, pos, ua, ub);
      end loop;
    end loop;
    update public.tournament_matches cur set
        next_match_id = nm.id, next_slot = case when cur.position % 2 = 1 then 'a' else 'b' end
      from public.tournament_matches nm
     where cur.tournament_id = p_tournament and nm.tournament_id = p_tournament
       and nm.round = cur.round + 1 and nm.position = (cur.position + 1) / 2;
    update public.tournaments set status = 'running', started_at = now(), current_round = 1, total_rounds = rounds where id = p_tournament;
    -- byes in round 1
    for mm in select * from public.tournament_matches where tournament_id = p_tournament and round = 1 and (player_a is null or player_b is null) loop
      update public.tournament_matches set status = 'bye', winner_id = coalesce(mm.player_a, mm.player_b), finished_at = now() where id = mm.id;
      perform public._tournament_advance_winner(mm.id, coalesce(mm.player_a, mm.player_b));
    end loop;
    for mm in select id from public.tournament_matches where tournament_id = p_tournament and round = 1 and status = 'pending' loop
      perform public._tournament_try_start_match(mm.id);
    end loop;
  else
    -- round robin, circle method; odd player counts get a null "bye" slot
    arr := ids;
    if n % 2 = 1 then arr := arr || null::uuid; end if;
    k := array_length(arr, 1); h := k / 2; rounds := k - 1;
    for r in 1..rounds loop
      for i in 1..h loop
        a := arr[i]; b := arr[k + 1 - i];
        if r % 2 = 0 then s := 1; else s := 0; end if;   -- alternate colours a little
        insert into public.tournament_matches (tournament_id, round, position, player_a, player_b, status, winner_id, finished_at)
        values (p_tournament, r, i,
                case when s = 1 and a is not null and b is not null then b else a end,
                case when s = 1 and a is not null and b is not null then a else b end,
                case when a is null or b is null then 'bye' else 'pending' end,
                case when a is null then b when b is null then a end,
                case when a is null or b is null then now() end);
      end loop;
      -- rotate all but the first element
      arr := array[arr[1]] || arr[k] || arr[2:k-1];
    end loop;
    update public.tournaments set status = 'running', started_at = now(), current_round = 1, total_rounds = rounds where id = p_tournament;
    for mm in select id from public.tournament_matches where tournament_id = p_tournament and round = 1 and status = 'pending' loop
      perform public._tournament_try_start_match(mm.id);
    end loop;
    -- a round of only byes would stall; progress if nothing is open
    perform public._tournament_round_robin_progress(p_tournament);
  end if;
  insert into public.audit_log (actor_id, action, target) values (auth.uid(), 'tournament.start', p_tournament::text);
end $$;

create function public._forfeit_match(p_match uuid, p_loser uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.tournament_matches; g public.games; c smallint;
begin
  select * into m from public.tournament_matches where id = p_match for update;
  if not found or m.status <> 'active' or m.game_id is null then raise exception 'err:invalid_state'; end if;
  if p_loser not in (m.player_a, m.player_b) then raise exception 'err:invalid_target'; end if;
  select * into g from public.games where id = m.game_id for update;
  select color into c from public.game_participants where game_id = g.id and user_id = p_loser;
  perform public._finish_game(g.id, (3 - c)::smallint, 'forfeit', case when c = 1 then 'W+F' else 'B+F' end);
end $$;

create function public.forfeit_match(p_match uuid, p_loser uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'err:forbidden'; end if;
  perform public._forfeit_match(p_match, p_loser);
  insert into public.audit_log (actor_id, action, target, data) values (auth.uid(), 'tournament.forfeit', p_match::text, jsonb_build_object('loser', p_loser));
end $$;

-- Automatic scheduling enforcement: Black who never makes a first move within the window forfeits.
create function public.process_tournament_deadlines() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; black uuid;
begin
  for r in select m.id as mid, g.id as gid from public.tournament_matches m
             join public.tournaments t on t.id = m.tournament_id
             join public.games g on g.id = m.game_id
            where m.status = 'active' and g.status = 'active' and g.move_count = 0
              and m.scheduled_at < now() - make_interval(mins => t.forfeit_after_minutes) loop
    select user_id into black from public.game_participants where game_id = r.gid and color = 1;
    perform public._forfeit_match(r.mid, black);
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.cancel_tournament(p_tournament uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'err:forbidden'; end if;
  update public.tournaments set status = 'cancelled', finished_at = now() where id = p_tournament and status in ('draft','registration','running');
  update public.games set status = 'aborted', version = version + 1
   where id in (select game_id from public.tournament_matches where tournament_id = p_tournament and status = 'active') and status in ('active','scoring');
  update public.tournament_matches set status = 'finished' where tournament_id = p_tournament and status in ('pending','active');
  insert into public.audit_log (actor_id, action, target) values (auth.uid(), 'tournament.cancel', p_tournament::text);
end $$;

alter table public.tournaments enable row level security;
alter table public.tournament_participants enable row level security;
alter table public.tournament_matches enable row level security;
create policy tournaments_select on public.tournaments for select using (status <> 'draft' or public.is_admin());
create policy tparticipants_select on public.tournament_participants for select using (true);
create policy tmatches_select on public.tournament_matches for select using (true);
