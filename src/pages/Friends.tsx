import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, BackendNotice, ErrorState, Loading, useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { FriendRow, Profile } from '../lib/types.ts';

export default function Friends() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const { toast, fail } = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<FriendRow[] | null>(null);
  const [blocked, setBlocked] = useState<{ blocked_id: string; profiles: { username: string } | null }[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Pick<Profile, 'id' | 'username' | 'avatar'>[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    try {
      setRows(await rpc<FriendRow[]>('get_friends'));
      const b = await supabase.from('blocks').select('blocked_id, profiles:blocked_id(username)').eq('blocker_id', user.id);
      setBlocked((b.data ?? []) as unknown as typeof blocked);
    } catch (e) { setError(e); }
  }, [user]);
  useEffect(() => {
    void load();
    if (!supabase || !user) return;
    const ch = supabase.channel(`friends:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${user.id}` }, () => void load())
      .subscribe();
    const timer = setInterval(load, 30_000);
    return () => { clearInterval(timer); void supabase!.removeChannel(ch); };
  }, [load, user]);

  if (!backendReady) return <BackendNotice />;
  if (loading) return <Loading />;
  if (!user) return <div className="notice">{t('auth.required')} <Link to="/auth?next=/friends">{t('common.signIn')}</Link></div>;
  if (error) return <ErrorState error={error} onRetry={load} />;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    const { data } = await supabase!.from('profiles').select('id, username, avatar').ilike('username', `%${q.trim().replace(/[%_]/g, '')}%`).neq('id', user.id).limit(10);
    setFound((data ?? []) as typeof found);
  };
  const run = async (fn: string, args: Record<string, unknown>, msg?: string) => { try { await rpc(fn, args); if (msg) toast(msg); await load(); } catch (e) { fail(e); } };
  const challenge = async (f: FriendRow) => {
    try {
      const room = await rpc<{ game_id: string }>('create_private_game', { p_size: 9, p_initial: 600, p_increment: 5, p_rules: 'japanese', p_komi: null, p_handicap: 0, p_color: 'random' });
      await rpc('invite_friend_to_game', { p_game: room.game_id, p_friend: f.user_id });
      nav(`/game/${room.game_id}`);
    } catch (e) { fail(e); }
  };

  const accepted = (rows ?? []).filter((r) => r.status === 'accepted');
  const incoming = (rows ?? []).filter((r) => r.status === 'pending' && r.incoming);
  const outgoing = (rows ?? []).filter((r) => r.status === 'pending' && !r.incoming);

  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1>{t('social.friends')}</h1>
      <form className="row" onSubmit={search}>
        <input className="input" placeholder={t('social.searchPlayers')} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary">{t('common.search')}</button>
      </form>
      {found.length > 0 && (
        <div className="card list">
          {found.map((f) => (
            <div key={f.id} className="row between">
              <Link to={`/u/${f.username}`} className="row" style={{ textDecoration: 'none' }}><Avatar name={f.username} avatar={f.avatar} size="sm" /> {f.username}</Link>
              <button className="btn small" onClick={() => run('send_friend_request', { p_user: f.id }, t('social.requestSent'))}>{t('social.addFriend')}</button>
            </div>
          ))}
        </div>
      )}
      {!rows && <Loading />}
      {incoming.length > 0 && (
        <section><div className="section-title"><h2>{t('social.requests')}</h2></div>
          <div className="card list">{incoming.map((r) => (
            <div key={r.friendship_id} className="row between"><Link to={`/u/${r.username}`} className="row" style={{ textDecoration: 'none' }}><Avatar name={r.username} avatar={r.avatar} size="sm" /> {r.username}</Link>
              <span className="row"><button className="btn primary small" onClick={() => run('respond_friend_request', { p_id: r.friendship_id, p_accept: true })}>{t('common.accept')}</button><button className="btn small" onClick={() => run('respond_friend_request', { p_id: r.friendship_id, p_accept: false })}>{t('common.decline')}</button></span></div>
          ))}</div></section>
      )}
      <section><div className="section-title"><h2>{t('social.friends')}</h2><span className="small muted">{accepted.length}</span></div>
        {rows && accepted.length === 0 ? <div className="empty card">{t('social.noFriends')}</div> : (
          <div className="card list">{accepted.map((f) => (
            <div key={f.user_id} className="row">
              <Link to={`/u/${f.username}`} className="row grow" style={{ textDecoration: 'none' }}>
                <Avatar name={f.username} avatar={f.avatar} size="sm" />
                <span className="truncate">{f.username}</span>
                <span className={`dot ${f.online ? 'on' : ''}`} title={f.online ? t('social.online') : t('social.offline')} />
              </Link>
              <Link className="btn small" to={`/messages/${f.user_id}`}>{t('social.message')}{f.unread > 0 && <b className="chip bad">{f.unread}</b>}</Link>
              <button className="btn small primary" onClick={() => challenge(f)}>{t('social.challenge')}</button>
            </div>
          ))}</div>
        )}
      </section>
      {outgoing.length > 0 && (
        <section><div className="section-title"><h2>{t('social.sent')}</h2></div>
          <div className="card list">{outgoing.map((r) => <div key={r.friendship_id} className="row between"><span>{r.username}</span><button className="btn small" onClick={() => run('remove_friend', { p_user: r.user_id })}>{t('common.cancel')}</button></div>)}</div></section>
      )}
      {blocked.length > 0 && (
        <section><div className="section-title"><h2>{t('social.blockedUsers')}</h2></div>
          <div className="card list">{blocked.map((b) => <div key={b.blocked_id} className="row between"><span>{b.profiles?.username}</span><button className="btn small" onClick={() => run('unblock_user', { p_user: b.blocked_id })}>{t('social.unblock')}</button></div>)}</div></section>
      )}
    </div>
  );
}
