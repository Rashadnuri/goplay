-- GO PLAY — learning center, achievements, daily challenges

create table public.lessons (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  position   integer not null default 0,
  level      smallint not null default 1 check (level between 1 and 5),
  title      jsonb not null,
  summary    jsonb not null,
  steps      jsonb not null default '[]',        -- [{ text:{az,en,ru}, exercise?: {...} }]
  published  boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_i18n_title check (title ?& array['az','en','ru']),
  constraint lessons_i18n_summary check (summary ?& array['az','en','ru']),
  constraint lessons_steps_array check (jsonb_typeof(steps) = 'array')
);
create index lessons_order_idx on public.lessons (published, position);
create trigger lessons_touch before update on public.lessons for each row execute function public.touch_updated_at();

create table public.lesson_progress (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  lesson_slug  text not null references public.lessons(slug) on delete cascade on update cascade,
  steps_done   integer[] not null default '{}',
  completed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_slug)
);

create table public.daily_challenges (
  day        date primary key,
  title      jsonb not null,
  puzzle     jsonb not null,                     -- same exercise shape as lessons
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint daily_i18n_title check (title ?& array['az','en','ru'])
);

create table public.daily_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.achievements (
  code     text primary key,
  category text not null check (category in ('games','streak','learning','daily')),
  icon     text not null,
  sort     integer not null default 0
);

create table public.user_achievements (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  code       text not null references public.achievements(code) on delete cascade,
  earned_at  timestamptz not null default now(),
  primary key (user_id, code)
);

insert into public.achievements (code, category, icon, sort) values
  ('first_win',          'games',    'trophy',  10),
  ('first_online_game',  'games',    'globe',   20),
  ('games_10',           'games',    'stones',  30),
  ('games_100',          'games',    'crown',   40),
  ('streak_3',           'streak',   'flame',   50),
  ('streak_5',           'streak',   'flame',   60),
  ('streak_10',          'streak',   'flame',   70),
  ('lesson_first',       'learning', 'book',    80),
  ('lessons_5',          'learning', 'book',    90),
  ('lessons_all',        'learning', 'graduation', 100),
  ('daily_first',        'daily',    'sun',     110),
  ('daily_7',            'daily',    'sun',     120);

-- Awards are derived from real, server-recorded activity only.
create function public._award_achievements(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare finished_n integer; wins_n integer; best integer; lessons_n integer; lessons_total integer; daily_n integer;
begin
  select count(*), count(*) filter (where g.winner = gp.color)
    into finished_n, wins_n
    from public.game_participants gp join public.games g on g.id = gp.game_id
   where gp.user_id = p_user and g.status = 'finished' and g.move_count >= 4
     and g.end_reason not in ('abandoned','forfeit')
     and (select count(*) from public.game_participants x where x.game_id = g.id) = 2;
  select coalesce(max(best_streak), 0) into best from public.player_ratings where user_id = p_user;
  select count(*) into lessons_n from public.lesson_progress where user_id = p_user and completed_at is not null;
  select count(*) into lessons_total from public.lessons where published;
  select count(*) into daily_n from public.daily_completions where user_id = p_user;

  insert into public.user_achievements (user_id, code)
  select p_user, c from (values
    ('first_win',         wins_n >= 1),
    ('first_online_game', finished_n >= 1),
    ('games_10',          finished_n >= 10),
    ('games_100',         finished_n >= 100),
    ('streak_3',          best >= 3),
    ('streak_5',          best >= 5),
    ('streak_10',         best >= 10),
    ('lesson_first',      lessons_n >= 1),
    ('lessons_5',         lessons_n >= 5),
    ('lessons_all',       lessons_total > 0 and lessons_n >= lessons_total),
    ('daily_first',       daily_n >= 1),
    ('daily_7',           daily_n >= 7)
  ) t(c, ok) where ok
  on conflict do nothing;
end $$;

create function public.complete_lesson_step(p_slug text, p_step integer) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('lstep:' || uid, 120, 60);
  if not exists (select 1 from public.lessons where slug = p_slug and published) then raise exception 'err:lesson_not_found'; end if;
  insert into public.lesson_progress (user_id, lesson_slug, steps_done) values (uid, p_slug, array[p_step])
  on conflict (user_id, lesson_slug) do update
    set steps_done = (select array_agg(distinct s order by s) from unnest(public.lesson_progress.steps_done || p_step) s), updated_at = now();
end $$;

create function public.complete_lesson(p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('lesson:' || uid, 60, 60);
  if not exists (select 1 from public.lessons where slug = p_slug and published) then raise exception 'err:lesson_not_found'; end if;
  insert into public.lesson_progress (user_id, lesson_slug, completed_at) values (uid, p_slug, now())
  on conflict (user_id, lesson_slug) do update set completed_at = coalesce(public.lesson_progress.completed_at, now()), updated_at = now();
  perform public._award_achievements(uid);
end $$;

-- Only today's challenge (UTC) can be completed; completion is idempotent.
create function public.complete_daily_challenge() returns date
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); d date := (now() at time zone 'utc')::date;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.check_rate_limit('daily:' || uid, 30, 60);
  insert into public.daily_completions (user_id, day) values (uid, d) on conflict do nothing;
  perform public._award_achievements(uid);
  return d;
end $$;

alter table public.lessons enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.daily_completions enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

create policy lessons_select on public.lessons for select using (published or public.is_admin());
create policy lessons_admin_write on public.lessons for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy progress_select on public.lesson_progress for select to authenticated using (user_id = auth.uid());
create policy daily_select on public.daily_challenges for select using (true);
create policy daily_admin_write on public.daily_challenges for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy daily_comp_select on public.daily_completions for select to authenticated using (user_id = auth.uid());
create policy achievements_select on public.achievements for select using (true);
create policy user_ach_select on public.user_achievements for select using (true);
