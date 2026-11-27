import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, BackendNotice, ErrorState, LeagueBadge, Loading, Seg } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { flag } from '../lib/countries.ts';
import { backendReady, rpc } from '../lib/supabase.ts';
import type { LeaderRow } from '../lib/types.ts';

const leagueOf = (r: number) => (r >= 1900 ? 'diamond' : r >= 1700 ? 'platinum' : r >= 1500 ? 'gold' : r >= 1300 ? 'silver' : r >= 1100 ? 'bronze' : 'beginner');
interface SeasonRow { rank: number; user_id: string; username: string; avatar: string; gain: number; games: number; final_rating: number }
import type { BoardSize } from '../engine/index.ts';

export default function Leaderboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [size, setSize] = useState<BoardSize>(9);
  const [period, setPeriod] = useState<'all' | 'week' | 'month'>('all');
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [past, setPast] = useState<string | null>(null);
  const [season, setSeason] = useState<{ key: string; ends_at: string } | null>(null);

  const load = useCallback(async () => {
    setRows(null); setError(null);
    try {
      if (period === 'month' && past) {
        const r = await rpc<SeasonRow[]>('get_season_results', { p_season: past, p_size: size, p_limit: 50 });
        setRows(r.map((x) => ({ rank: x.rank, user_id: x.user_id, username: x.username, avatar: x.avatar, country: null, rating: x.final_rating, league: leagueOf(x.final_rating), games: x.games, wins: 0, losses: 0, score: x.gain })));
        return;
      }
      const r = await rpc<LeaderRow[]>('get_leaderboard', { p_size: size, p_period: period, p_limit: 50, p_offset: 0 });
      setRows(r.map((x) => ({ ...x, rank: Number(x.rank) })));
    } catch (e) { setError(e); }
  }, [size, period, past]);
  useEffect(() => { if (backendReady) void load(); }, [load]);
  useEffect(() => { if (!backendReady) return; rpc<{ key: string; ends_at: string }>('current_season').then(setSeason).catch(() => {}); rpc<string[]>('list_seasons').then((s) => setSeasons(Array.isArray(s) ? s : [])).catch(() => {}); }, []);

  if (!backendReady) return <div className="stack"><h1>{t('nav.leaderboard')}</h1><BackendNotice /></div>;
  return (
    <div className="stack">
      <h1>{t('nav.leaderboard')}</h1>
      <div className="row wrap">
        <Seg value={size} onChange={setSize} options={[9, 13, 19].map((s) => ({ value: s as BoardSize, label: `${s}×${s}` }))} label={t('setup.boardSize')} />
        <Seg value={period} onChange={setPeriod} options={[{ value: 'all', label: t('lb.global') }, { value: 'week', label: t('lb.weekly') }, { value: 'month', label: t('lb.season') }]} />
      </div>
      {period === 'month' && season && (
        <div className="card stack">
          <div className="row between wrap"><strong>{past ? t('lb.seasonOf', { s: past }) : t('lb.seasonCurrent', { s: season.key })}</strong>{!past && <span className="chip">{t('lb.endsIn', { n: Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86_400_000)) })}</span>}</div>
          <div className="small muted">{t('lb.seasonHelp')}</div>
          {seasons.length > 0 && (
            <div className="row wrap">
              <button className="chip" aria-pressed={past === null} style={{ cursor: 'pointer', outline: past === null ? '2px solid var(--ink-2)' : 'none' }} onClick={() => setPast(null)}>{t('lb.seasonNow')}</button>
              {seasons.map((s) => <button key={s} className="chip" style={{ cursor: 'pointer', outline: past === s ? '2px solid var(--ink-2)' : 'none' }} onClick={() => setPast(s)}>🏅 {s}</button>)}
            </div>
          )}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>{period === 'all' ? t('lb.rankedHelp') : t('lb.periodHelp')}</p>
      {error != null && <ErrorState error={error} onRetry={load} />}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <div className="empty card">{t('lb.empty')}</div>}
      {rows && rows.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {rows.map((r) => (
            <Link key={r.user_id} to={`/u/${r.username}`} className={`lb-row${r.user_id === user?.id ? ' me' : ''}`}>
              <span className="lb-rank">{r.rank}</span>
              <Avatar name={r.username} avatar={r.avatar} />
              <span className="grow truncate"><strong>{r.username}</strong> {flag(r.country)}<br /><LeagueBadge league={r.league} /></span>
              <span style={{ textAlign: 'right' }}><strong className="lb-val">{period === 'all' ? r.rating : `${r.score >= 0 ? '+' : ''}${r.score}`}</strong><div className="small muted">{r.wins}/{r.losses}</div></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
