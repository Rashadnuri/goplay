-- GO PLAY — privilege lockdown, realtime publication.
-- Supabase grants broad default privileges to anon/authenticated; we revoke everything and re-grant the minimum.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Read access (rows are further restricted by RLS policies)
grant select on public.profiles, public.player_ratings, public.rating_history,
                public.games, public.game_participants, public.game_moves, public.matchmaking_queue, public.game_invites,
                public.friendships, public.blocks, public.messages, public.reports,
                public.tournaments, public.tournament_participants, public.tournament_matches,
                public.lessons, public.lesson_progress, public.daily_challenges, public.daily_completions,
                public.achievements, public.user_achievements, public.audit_log
  to authenticated;
grant select on public.profiles, public.player_ratings, public.rating_history, public.tournaments,
                public.tournament_participants, public.tournament_matches, public.lessons, public.daily_challenges,
                public.achievements, public.user_achievements, public.games, public.game_participants, public.game_moves
  to anon;

-- Only these profile columns can be changed directly by a user. `role`, `banned_until` etc. can never be.
grant update (username, avatar, bio, country, language, theme, show_online) on public.profiles to authenticated;
-- Admin content management goes through RLS policies (is_admin()).
grant insert, update, delete on public.lessons, public.daily_challenges to authenticated;

-- Policy helpers must be callable while evaluating RLS
grant execute on function public.is_admin(), public.is_staff(), public.is_game_participant(uuid), public.can_view_game(uuid),
                          public.league_for(integer), public.server_now() to anon, authenticated;

-- Client RPCs (signed-in users only)
grant execute on function
  public.touch_presence(),
  public.join_matchmaking(integer, integer, integer), public.poll_matchmaking(), public.leave_matchmaking(),
  public.create_private_game(integer, integer, integer, text, numeric, integer, text),
  public.join_game_by_code(text), public.invite_friend_to_game(uuid, uuid), public.respond_game_invite(uuid, boolean),
  public.resign_game(uuid), public.offer_draw(uuid), public.respond_draw(uuid, boolean), public.cancel_room(uuid), public.claim_timeout(uuid),
  public.get_leaderboard(integer, text, integer, integer), public.get_match_history(uuid, integer),
  public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean), public.remove_friend(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid, text, text, uuid, uuid),
  public.send_message(uuid, text), public.mark_messages_read(uuid), public.get_friends(),
  public.register_tournament(uuid), public.unregister_tournament(uuid),
  public.create_tournament(text, text, text, integer, text, integer, integer, integer, integer, timestamptz, timestamptz, integer, numeric),
  public.start_tournament(uuid), public.forfeit_match(uuid, uuid), public.cancel_tournament(uuid),
  public.complete_lesson_step(text, integer), public.complete_lesson(text), public.complete_daily_challenge(),
  public.admin_set_role(uuid, text), public.admin_ban_user(uuid, timestamptz, text),
  public.admin_list_users(text, integer, integer), public.admin_stats(), public.admin_resolve_report(uuid, text, text),
  public.admin_hide_message(uuid, boolean), public.admin_list_messages(uuid, integer)
  to authenticated;
grant execute on function public.get_leaderboard(integer, text, integer, integer), public.get_match_history(uuid, integer) to anon;

-- Service-role only (Edge Functions / pg_cron). Never exposed to browsers.
grant execute on function public.svc_get_game(uuid), public.svc_apply_game_update(uuid, integer, jsonb, jsonb, integer),
  public.sweep_timeouts(), public.sweep_abandoned(), public.process_tournament_deadlines() to service_role;

-- Realtime: moves, game state, queue matches, invites, messages, friendships
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.games, public.game_moves, public.matchmaking_queue,
      public.game_invites, public.messages, public.friendships, public.user_achievements, public.tournament_matches;
  end if;
end $$;

-- Optional scheduling (enable the pg_cron extension in Supabase → Database → Extensions first):
--   select cron.schedule('goplay-timeouts', '* * * * *', 'select public.sweep_timeouts(); select public.process_tournament_deadlines();');
--   select cron.schedule('goplay-abandoned', '*/10 * * * *', 'select public.sweep_abandoned();');
