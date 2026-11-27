import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, BackendNotice, Confirm, ErrorState, Loading, useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { TournamentMatch, TournamentParticipant, TournamentRow } from '../lib/types.ts';

export default function TournamentDetail() {
  const { id } = useParams();
  const { t, fmtDate } = useI18n();
  const { user, isAdmin } = useAuth();
  const { toast, fail } = useToast();
  const [tour, setTour] = useState<TournamentRow | null>(null);
  const [parts, setParts] = useState<TournamentParticipant[]>([]);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<'start' | 'cancel' | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const [a, b, c] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id!).maybeSingle(),
        supabase.from('tournament_participants').select('*, profiles(username, avatar)').eq('tournament_id', id!),
        supabase.from('tournament_matches').select('*').eq('tournament_id', id!).order('round').order('position'),
      ]);
      if (a.error || b.error || c.error) throw a.error ?? b.error ?? c.error;
      setTour(a.data as TournamentRow | null);
      setParts(b.data as unknown as TournamentParticipant[]);
      setMatches(c.data as TournamentMatch[]);
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => {
    void load();
    if (!supabase) return;
    const ch = supabase.channel(`tour:${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` }, () => void load()).subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [load, id]);

  if (!backendReady) return <BackendNotice />;
  if (error) return <ErrorState error={error} onRetry={load} />;
  if (!tour) return <Loading />;

  const nameOf = (uid: string | null) => (uid ? parts.find((p) => p.user_id === uid)?.profiles?.username ?? '…' : null);
  const joined = !!user && parts.some((p) => p.user_id === user.id);
  const act = async (fn: string, args: Record<string, unknown>, msg?: string) => { try { await rpc(fn, args); if (msg) toast(msg); await load(); } catch (e) { fail(e); } };
  const myMatch = user ? matches.find((m) => m.status === 'active' && (m.player_a === user.id || m.player_b === user.id)) : undefined;
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const standings = [...parts].sort((a, b) => Number(b.points) - Number(a.points) || b.wins - a.wins || (a.seed ?? 99) - (b.seed ?? 99));
  const winner = nameOf(tour.winner_id);

  return (
    <div className="stack">
      <Link to="/tournaments" className="small muted">← {t('nav.tournaments')}</Link>
      <div className="card gold stack">
        <div className="row between wrap"><h1 style={{ margin: 0 }}>{tour.name}</h1><span className="chip gold">{t(`tour.status.${tour.status}` as any)}</span></div>
        {tour.description && <p style={{ margin: 0 }}>{tour.description}</p>}
        <div className="row wrap small">
          <span className="chip">{t(`tour.${tour.format}` as any)}</span><span className="chip">{tour.board_size}×{tour.board_size}</span>
          <span className="chip">{t(`rules.${tour.rules}` as any)}</span>
          <span className="chip">{tour.time_initial_s ? `${Math.round(tour.time_initial_s / 60)}+${tour.time_increment_s}` : t('time.untimed')}</span>
          <span className="chip">{t('tour.players')}: {parts.length}/{tour.max_players}</span>
          {tour.starts_at && <span className="chip">{fmtDate(tour.starts_at)}</span>}
        </div>
        {tour.status === 'finished' && winner && <div className="notice">🏆 {t('tour.champion')}: <strong>{winner}</strong></div>}
        <div className="row wrap">
          {tour.status === 'registration' && user && (joined
            ? <button className="btn" onClick={() => act('unregister_tournament', { p_tournament: tour.id }, t('tour.unregistered'))}>{t('tour.leave')}</button>
            : <button className="btn primary" disabled={parts.length >= tour.max_players} onClick={() => act('register_tournament', { p_tournament: tour.id }, t('tour.registered'))}>{t('tour.register')}</button>)}
          {tour.status === 'registration' && !user && <Link className="btn primary" to={`/auth?next=/tournaments/${tour.id}`}>{t('common.signIn')}</Link>}
          {myMatch?.game_id && <Link className="btn gold" to={`/game/${myMatch.game_id}`}>{t('tour.playMatch')}</Link>}
          {isAdmin && tour.status === 'registration' && <button className="btn" disabled={parts.length < Math.max(2, tour.min_players)} onClick={() => setConfirm('start')}>{t('admin.startTournament')}</button>}
          {isAdmin && ['registration', 'running'].includes(tour.status) && <button className="btn danger" onClick={() => setConfirm('cancel')}>{t('admin.cancelTournament')}</button>}
        </div>
      </div>

      {tour.status !== 'registration' && matches.length > 0 && tour.format === 'single_elimination' && (
        <section>
          <div className="section-title"><h2>{t('tour.bracket')}</h2></div>
          <div className="bracket" tabIndex={0} aria-label={t('tour.bracket')}>
            {rounds.map((r) => (
              <div key={r} className="bracket-col">
                <div className="small muted center">{r === rounds.length ? t('tour.final') : t('tour.round', { n: r })}</div>
                {matches.filter((m) => m.round === r).map((m) => (
                  <div key={m.id} className="bmatch">
                    <div className={m.winner_id && m.winner_id === m.player_a ? 'win' : ''}><span className="truncate">{nameOf(m.player_a) ?? (m.status === 'bye' ? t('tour.bye') : 'TBD')}</span></div>
                    <div className={m.winner_id && m.winner_id === m.player_b ? 'win' : ''}><span className="truncate">{nameOf(m.player_b) ?? (m.status === 'bye' ? t('tour.bye') : 'TBD')}</span>
                      {m.game_id && <Link to={`/game/${m.game_id}`} className="small">{m.status === 'active' ? '▶' : '↗'}</Link>}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {tour.status !== 'registration' && tour.format === 'round_robin' && (
        <section>
          <div className="section-title"><h2>{t('tour.schedule')}</h2></div>
          <div className="card stack">
            {rounds.map((r) => (
              <div key={r}>
                <strong>{t('tour.round', { n: r })}</strong>{r === tour.current_round && tour.status === 'running' && <span className="chip gold" style={{ marginLeft: 8 }}>{t('tour.current')}</span>}
                <div className="list">
                  {matches.filter((m) => m.round === r && m.status !== 'bye').map((m) => (
                    <div key={m.id} className="row between small">
                      <span className="truncate"><span className={m.winner_id === m.player_a ? 'chip ok' : ''}>{nameOf(m.player_a)}</span> vs <span className={m.winner_id === m.player_b ? 'chip ok' : ''}>{nameOf(m.player_b)}</span></span>
                      {m.game_id && <Link to={`/game/${m.game_id}`}>{m.status === 'active' ? t('tour.watch') : t('tour.result')}</Link>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-title"><h2>{tour.status === 'registration' ? t('tour.participants') : t('tour.standings')}</h2></div>
        {parts.length === 0 ? <div className="empty card">{t('tour.noParticipants')}</div> : (
          <div className="card" style={{ padding: 4 }}>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>#</th><th>{t('lb.player')}</th>{tour.status !== 'registration' && <><th className="num">{t('tour.points')}</th><th className="num">{t('lb.wl')}</th></>}</tr></thead>
              <tbody>{(tour.status === 'registration' ? parts : standings).map((p, i) => (
                <tr key={p.user_id}>
                  <td>{tour.status === 'registration' ? i + 1 : p.seed ? `${i + 1}` : i + 1}</td>
                  <td><Link to={`/u/${p.profiles?.username}`} className="row" style={{ textDecoration: 'none' }}><Avatar name={p.profiles?.username ?? '?'} avatar={p.profiles?.avatar} size="sm" /><span className={p.eliminated ? 'muted' : ''}>{p.profiles?.username}</span></Link></td>
                  {tour.status !== 'registration' && <><td className="num"><strong>{Number(p.points)}</strong></td><td className="num">{p.wins}/{p.losses}</td></>}
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}
      </section>

      {confirm && (
        <Confirm title={confirm === 'start' ? t('admin.startConfirm') : t('admin.cancelConfirm')} confirmLabel={confirm === 'start' ? t('admin.startTournament') : t('admin.cancelTournament')} danger={confirm === 'cancel'}
          onClose={() => setConfirm(null)} onConfirm={() => act(confirm === 'start' ? 'start_tournament' : 'cancel_tournament', { p_tournament: tour.id })} />
      )}
    </div>
  );
}
