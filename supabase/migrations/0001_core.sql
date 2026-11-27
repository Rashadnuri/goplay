-- GO PLAY — core: profiles, ratings, rate limiting, helpers
-- Error convention: RPCs raise exceptions whose message is 'err:<code>'. The client maps codes to i18n strings.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null,
  avatar      text not null default 'stone-black',
  bio         text not null default '',
  country     text,
  language    text not null default 'az',
  theme       text not null default 'system',
  role        text not null default 'user',
  show_online boolean not null default true,
  banned_until timestamptz,
  ban_reason  text,
  last_seen_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_bio_len check (char_length(bio) <= 280),
  constraint profiles_country_fmt check (country is null or country ~ '^[A-Z]{2}$'),
  constraint profiles_language check (language in ('az','en','ru')),
  constraint profiles_theme check (theme in ('system','light','dark')),
  constraint profiles_role check (role in ('user','moderator','admin')),
  constraint profiles_avatar_fmt check (avatar ~ '^[a-z0-9-]{1,32}$')
);
create unique index profiles_username_lower_uq on public.profiles (lower(username));
create index profiles_last_seen_idx on public.profiles (last_seen_at desc);

create table public.player_ratings (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  board_size  smallint not null check (board_size in (9,13,19)),
  rating      integer not null default 1000 check (rating between 100 and 4000),
  peak_rating integer not null default 1000,
  games       integer not null default 0 check (games >= 0),
  wins        integer not null default 0 check (wins >= 0),
  losses      integer not null default 0 check (losses >= 0),
  draws       integer not null default 0 check (draws >= 0),
  streak      integer not null default 0,           -- >0 win streak, <0 loss streak
  best_streak integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, board_size)
);
create index player_ratings_lb_idx on public.player_ratings (board_size, rating desc) where games > 0;

create table public.rating_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  game_id     uuid not null,
  board_size  smallint not null,
  old_rating  integer not null,
  new_rating  integer not null,
  delta       integer not null,
  created_at  timestamptz not null default now()
);
create index rating_history_user_idx on public.rating_history (user_id, created_at desc);
create index rating_history_period_idx on public.rating_history (board_size, created_at);

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  target     text,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ───────── helpers ─────────
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

create function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role in ('admin','moderator') from public.profiles where id = auth.uid()), false) $$;

create function public.league_for(p_rating integer) returns text
language sql immutable as
$$ select case
     when p_rating >= 1900 then 'diamond'
     when p_rating >= 1700 then 'platinum'
     when p_rating >= 1500 then 'gold'
     when p_rating >= 1300 then 'silver'
     when p_rating >= 1100 then 'bronze'
     else 'beginner' end $$;

create function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns void language plpgsql security definer set search_path = public as $$
declare r public.rate_limits;
begin
  insert into public.rate_limits(key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now() else public.rate_limits.window_start end,
    count        = case when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1 else public.rate_limits.count + 1 end
  returning * into r;
  if r.count > p_max then raise exception 'err:rate_limited'; end if;
end $$;

create function public.assert_not_banned(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles where id = p_user and banned_until is not null and banned_until > now()) then
    raise exception 'err:banned';
  end if;
end $$;

create function public.touch_updated_at() returns trigger language plpgsql as
$$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ───────── new auth user → profile + ratings ─────────
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; candidate text; n int := 0; lang text;
begin
  base := regexp_replace(coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email,''),'@',1), ''), '[^A-Za-z0-9_]', '', 'g');
  if char_length(base) < 3 then base := 'player' || substr(replace(new.id::text,'-',''), 1, 6); end if;
  base := substr(base, 1, 16);
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    n := n + 1; candidate := substr(base, 1, 16) || n::text;
  end loop;
  lang := coalesce(new.raw_user_meta_data->>'language', 'az');
  if lang not in ('az','en','ru') then lang := 'az'; end if;
  insert into public.profiles (id, username, language) values (new.id, candidate, lang);
  insert into public.player_ratings (user_id, board_size) select new.id, s from unnest(array[9,13,19]) s;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Lets clients align their countdown display with the authoritative database clock
create function public.server_now() returns timestamptz language sql stable as $$ select now() $$;

-- Presence heartbeat
create function public.touch_presence() returns void
language sql security definer set search_path = public as
$$ update public.profiles set last_seen_at = now() where id = auth.uid() $$;

-- RLS
alter table public.profiles enable row level security;
alter table public.player_ratings enable row level security;
alter table public.rating_history enable row level security;
alter table public.rate_limits enable row level security;
alter table public.audit_log enable row level security;

create policy profiles_select on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy ratings_select on public.player_ratings for select using (true);
create policy rating_history_select on public.rating_history for select using (true);
create policy audit_select_admin on public.audit_log for select to authenticated using (public.is_admin());
-- rate_limits: no policies → no client access
