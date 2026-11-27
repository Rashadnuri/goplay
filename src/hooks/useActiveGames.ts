import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth.tsx';
import { supabase } from '../lib/supabase.ts';

export interface ActiveGame { id: string; status: string; board_size: number; opponent?: string }
export interface Invite { id: string; game_id: string; from_user: string; from_name?: string }

export function useActiveGames() {
  const { user } = useAuth();
  const [games, setGames] = useState<ActiveGame[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const load = useCallback(async () => {
    if (!supabase || !user) { setGames([]); setInvites([]); return; }
    const { data } = await supabase.from('game_participants').select('game_id, games!inner(id, status, board_size), user_id').eq('user_id', user.id).in('games.status', ['active', 'scoring', 'waiting']);
    const rows = ((data ?? []) as unknown as { games: ActiveGame }[]).map((r) => r.games);
    setGames(rows);
    const inv = await supabase.from('game_invites').select('id, game_id, from_user, profiles:from_user(username)').eq('to_user', user.id).eq('status', 'pending');
    setInvites(((inv.data ?? []) as unknown as { id: string; game_id: string; from_user: string; profiles: { username: string } | null }[]).map((i) => ({ id: i.id, game_id: i.game_id, from_user: i.from_user, from_name: i.profiles?.username })));
  }, [user]);
  useEffect(() => {
    void load();
    if (!supabase || !user) return;
    const ch = supabase.channel(`invites:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_invites', filter: `to_user=eq.${user.id}` }, () => void load())
      .subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [load, user]);
  return { games, invites, reload: load };
}
