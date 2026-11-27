-- GO PLAY — friends, blocks, reports, private messages

create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_uq on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 1000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  hidden       boolean not null default false,
  hidden_by    uuid references public.profiles(id) on delete set null,
  check (sender_id <> recipient_id)
);
create index messages_pair_idx on public.messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc);
create index messages_recipient_idx on public.messages (recipient_id, read_at);

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  reported_id     uuid not null references public.profiles(id) on delete cascade,
  reason          text not null check (reason in ('cheating','harassment','spam','inappropriate_name','other')),
  details         text not null default '' check (char_length(details) <= 500),
  message_id      uuid references public.messages(id) on delete set null,
  game_id         uuid references public.games(id) on delete set null,
  status          text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  handled_by      uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  check (reporter_id <> reported_id)
);
create index reports_status_idx on public.reports (status, created_at desc);

create function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships where status = 'accepted'
                 and least(requester_id, addressee_id) = least(a, b) and greatest(requester_id, addressee_id) = greatest(a, b)) $$;

create function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)) $$;

create function public.send_friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); f public.friendships;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  if p_user = uid then raise exception 'err:invalid_target'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('freq:' || uid, 20, 3600);
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'err:user_not_found'; end if;
  if public.is_blocked_between(uid, p_user) then raise exception 'err:blocked'; end if;
  select * into f from public.friendships
   where least(requester_id, addressee_id) = least(uid, p_user) and greatest(requester_id, addressee_id) = greatest(uid, p_user);
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requester_id = uid then return 'already_sent'; end if;
    update public.friendships set status = 'accepted', responded_at = now() where id = f.id;   -- they asked first
    return 'accepted';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (uid, p_user);
  return 'sent';
end $$;

create function public.respond_friend_request(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
     where id = p_id and addressee_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships where id = p_id and addressee_id = auth.uid() and status = 'pending';
  end if;
  if not found then raise exception 'err:request_not_found'; end if;
end $$;

create function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.friendships
   where least(requester_id, addressee_id) = least(auth.uid(), p_user) and greatest(requester_id, addressee_id) = greatest(auth.uid(), p_user) $$;

create function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_user = uid then raise exception 'err:invalid_target'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (uid, p_user) on conflict do nothing;
  perform public.remove_friend(p_user);
  delete from public.matchmaking_queue where false;
end $$;

create function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user $$;

create function public.report_user(p_user uuid, p_reason text, p_details text default '', p_message uuid default null, p_game uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rid uuid;
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  if p_user = uid then raise exception 'err:invalid_target'; end if;
  perform public.check_rate_limit('report:' || uid, 5, 3600);
  insert into public.reports (reporter_id, reported_id, reason, details, message_id, game_id)
  values (uid, p_user, p_reason, left(coalesce(p_details,''), 500), p_message, p_game) returning id into rid;
  return rid;
end $$;

create function public.send_message(p_to uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid; body text := btrim(coalesce(p_body,''));
begin
  if uid is null then raise exception 'err:auth_required'; end if;
  perform public.assert_not_banned(uid);
  perform public.check_rate_limit('msg:' || uid, 30, 60);
  if char_length(body) not between 1 and 1000 then raise exception 'err:invalid_message'; end if;
  if not public.are_friends(uid, p_to) then raise exception 'err:not_friends'; end if;
  if public.is_blocked_between(uid, p_to) then raise exception 'err:blocked'; end if;
  insert into public.messages (sender_id, recipient_id, body) values (uid, p_to, body) returning id into mid;
  return mid;
end $$;

create function public.mark_messages_read(p_from uuid) returns void
language sql security definer set search_path = public as $$
  update public.messages set read_at = now() where recipient_id = auth.uid() and sender_id = p_from and read_at is null $$;

create function public.get_friends() returns table (
  friendship_id uuid, user_id uuid, username text, avatar text, status text, incoming boolean,
  online boolean, last_seen_at timestamptz, unread integer)
language sql stable security definer set search_path = public as $$
  select f.id, p.id, p.username, p.avatar, f.status, f.addressee_id = auth.uid(),
         case when f.status = 'accepted' and p.show_online then coalesce(p.last_seen_at > now() - interval '2 minutes', false) else false end,
         case when f.status = 'accepted' and p.show_online then p.last_seen_at end,
         (select count(*)::int from public.messages m where m.sender_id = p.id and m.recipient_id = auth.uid() and m.read_at is null and not m.hidden)
    from public.friendships f
    join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
   where auth.uid() in (f.requester_id, f.addressee_id)
     and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.id)
   order by f.status desc, p.username $$;

-- RLS
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;

create policy friendships_select on public.friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy messages_select on public.messages for select to authenticated
  using ((recipient_id = auth.uid() and not hidden) or sender_id = auth.uid() or public.is_staff());
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());
