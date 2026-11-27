-- GO PLAY — admin & moderation RPCs. Every function re-checks the caller's role in the database.

create function public._audit(p_action text, p_target text, p_data jsonb default '{}') returns void
language sql security definer set search_path = public as
$$ insert into public.audit_log (actor_id, action, target, data) values (auth.uid(), p_action, p_target, p_data) $$;

create function public.admin_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'err:forbidden'; end if;
  if p_role not in ('user','moderator','admin') then raise exception 'err:invalid_settings'; end if;
  if p_user = auth.uid() then raise exception 'err:invalid_target'; end if;   -- cannot demote yourself by accident
  update public.profiles set role = p_role where id = p_user;
  perform public._audit('user.set_role', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function public.admin_ban_user(p_user uuid, p_until timestamptz, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then raise exception 'err:forbidden'; end if;
  update public.profiles set banned_until = p_until, ban_reason = left(p_reason, 300) where id = p_user;
  if p_until is not null and p_until > now() then
    delete from public.matchmaking_queue where user_id = p_user;
  end if;
  perform public._audit('user.ban', p_user::text, jsonb_build_object('until', p_until, 'reason', p_reason));
end $$;

create function public.admin_list_users(p_search text default '', p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, username text, email text, role text, banned_until timestamptz, created_at timestamptz, last_seen_at timestamptz, games integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  return query
    select p.id, p.username, u.email::text, p.role, p.banned_until, p.created_at, p.last_seen_at,
           (select coalesce(sum(r.games),0)::int from public.player_ratings r where r.user_id = p.id)
      from public.profiles p join auth.users u on u.id = p.id
     where p_search = '' or p.username ilike '%' || p_search || '%' or u.email ilike '%' || p_search || '%'
     order by p.created_at desc
     limit least(p_limit, 200) offset p_offset;
end $$;

create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  return jsonb_build_object(
    'users',            (select count(*) from public.profiles),
    'users_7d',         (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'online_now',       (select count(*) from public.profiles where last_seen_at > now() - interval '2 minutes'),
    'games_total',      (select count(*) from public.games where status = 'finished'),
    'games_active',     (select count(*) from public.games where status in ('active','scoring')),
    'games_24h',        (select count(*) from public.games where created_at > now() - interval '24 hours'),
    'queue',            (select count(*) from public.matchmaking_queue where game_id is null),
    'tournaments_open', (select count(*) from public.tournaments where status in ('registration','running')),
    'reports_open',     (select count(*) from public.reports where status in ('open','reviewing')),
    'lessons',          (select count(*) from public.lessons where published)
  );
end $$;

create function public.admin_resolve_report(p_report uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  if p_status not in ('reviewing','resolved','dismissed') then raise exception 'err:invalid_settings'; end if;
  update public.reports set status = p_status, handled_by = auth.uid(), resolution_note = left(p_note, 500),
         resolved_at = case when p_status = 'reviewing' then null else now() end where id = p_report;
  perform public._audit('report.' || p_status, p_report::text, jsonb_build_object('note', p_note));
end $$;

create function public.admin_hide_message(p_message uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  update public.messages set hidden = p_hidden, hidden_by = case when p_hidden then auth.uid() end where id = p_message;
  perform public._audit('message.hide', p_message::text, jsonb_build_object('hidden', p_hidden));
end $$;

-- Staff can read a user's messages only through this function, which writes an audit entry.
create function public.admin_list_messages(p_user uuid, p_limit integer default 100)
returns table (id uuid, sender_id uuid, sender_name text, recipient_id uuid, recipient_name text, body text, created_at timestamptz, hidden boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'err:forbidden'; end if;
  perform public._audit('message.review', p_user::text);
  return query
    select m.id, m.sender_id, s.username, m.recipient_id, r.username, m.body, m.created_at, m.hidden
      from public.messages m join public.profiles s on s.id = m.sender_id join public.profiles r on r.id = m.recipient_id
     where m.sender_id = p_user or m.recipient_id = p_user
     order by m.created_at desc limit least(p_limit, 200);
end $$;
