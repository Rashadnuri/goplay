import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArtBoard, Mountains, Trophy } from '../components/Deco.tsx';
import { Icon } from '../components/Icon.tsx';
import { LeagueBadge } from '../components/ui.tsx';
import { useActiveGames } from '../hooks/useActiveGames.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useDailySet, useLessons, useProgress } from '../lib/learn.ts';
import { supabase } from '../lib/supabase.ts';
import type { PlayerRating, TournamentRow } from '../lib/types.ts';
import { ONBOARDED } from './Welcome.tsx';

const leagueOf = (r: number) => (r >= 1900 ? 'diamond' : r >= 1700 ? 'platinum' : r >= 1500 ? 'gold' : r >= 1300 ? 'silver' : r >= 1100 ? 'bronze' : 'beginner');

export default function Home() {
  const { t, loc, fmtDate } = useI18n();
  const { user, profile, loading } = useAuth();
  const { games } = useActiveGames();
  const { items: dailyItems, streak } = useDailySet();
  const dailyDone = dailyItems.filter((i) => i.solved).length;
  const { lessons } = useLessons();
  const progress = useProgress();
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [tours, setTours] = useState<TournamentRow[]>([]);

  useEffect(() => {
    if (!supabase) return;
    if (user) supabase.from('player_ratings').select('*').eq('user_id', user.id).order('board_size').then(({ data }) => setRatings((data ?? []) as PlayerRating[]));
    supabase.from('tournaments').select('*').in('status', ['registration', 'running']).order('starts_at', { nullsFirst: false }).limit(2).then(({ data }) => setTours((data ?? []) as TournamentRow[]));
  }, [user]);

  let onboarded = true;
  try { onboarded = localStorage.getItem(ONBOARDED) === '1'; } catch { /* ignore */ }
  if (!loading && !user && !onboarded) return <Navigate to="/welcome" replace />;

  const nextLesson = lessons.find((l) => !progress.isDone(l.slug));
  const played = ratings.filter((r) => r.games > 0);
  const tiles = [
    { to: '/play/ai', icon: 'bot', title: t('play.ai.title'), sub: t('tile.ai') },
    { to: '/play/online', icon: 'users', title: t('play.online.title'), sub: t('tile.online') },
    { to: '/tournaments', icon: 'trophy', title: t('nav.tournaments'), sub: t('tile.tournaments') },
    { to: '/learn', icon: 'book', title: t('nav.learn'), sub: t('tile.learn') },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card hero-scene pattern">
        <Mountains className="bg" pagoda />
        <h2 style={{ position: 'relative' }}>{profile ? t('home.welcome', { name: profile.username }) : t('home.heroTitle')}</h2>
        <p style={{ position: 'relative' }}>{t('home.heroSub')}</p>
        <div style={{ position: 'relative' }}><Link className="btn primary" to="/play/online">{t('home.playNow')} <Icon name="arrow" size={18} /></Link></div>
        <div className="art"><ArtBoard /></div>
      </section>

      {games.length > 0 && (
        <div className="card gold row between wrap">
          <div><strong>{t('play.activeGames')}</strong><div className="small muted">{games[0].board_size}×{games[0].board_size} · {t(`status.${games[0].status}` as any)}</div></div>
          <Link className="btn primary" to={`/game/${games[0].id}`}>{t('play.resume')}</Link>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {tiles.map((x) => (
          <Link key={x.to} to={x.to} className="card tile">
            <span className="big"><Icon name={x.icon} size={44} /></span>
            <strong>{x.title}</strong><small>{x.sub}</small>
            <span className="chev"><Icon name="arrow" size={18} /></span>
          </Link>
        ))}
      </div>

      <section>
        <div className="section-title"><h2>{t('home.popular')}</h2><Link to="/tournaments">{t('common.all')} ›</Link></div>
        {tours.length > 0 ? tours.map((x, i) => (
          <Link key={x.id} to={`/tournaments/${x.id}`} className="card tour-card pattern" style={{ marginBottom: 10 }}>
            <Trophy className="trophy" tone={i === 0 ? 'gold' : 'silver'} />
            <div className="grow"><h3 style={{ margin: '0 0 4px' }}>{x.name}</h3>
              <div className="small muted">{t(`tour.${x.format}` as any)} · {x.board_size}×{x.board_size}{x.starts_at ? ` · ${fmtDate(x.starts_at)}` : ''}</div></div>
            <span className="btn small">{t('tour.join')}</span>
          </Link>
        )) : (
          <Link to="/puzzles" className="card tour-card">
            <Trophy className="trophy" />
            <div className="grow"><h3 style={{ margin: '0 0 4px' }}>{t('puzzle.title')}</h3><div className="small muted">{t('puzzle.today')}: {dailyDone}/3 · 🔥 {streak.current}</div></div>
            <span className="btn small primary">{t('puzzle.solve')}</span>
          </Link>
        )}
      </section>

      <Link to={nextLesson ? `/learn/${nextLesson.slug}` : '/learn'} className="card stack" style={{ textDecoration: 'none' }}>
        <div className="row between"><h3 style={{ margin: 0 }}>{t('home.continueLearning')}</h3><span className="chip gold">{progress.doneCount}/{lessons.length}</span></div>
        <div className="muted">{nextLesson ? loc(nextLesson.title) : t('learn.allDone')}</div>
        <div className="progress"><div style={{ width: `${lessons.length ? (progress.doneCount / lessons.length) * 100 : 0}%` }} /></div>
      </Link>

      {user && (
        <section>
          <div className="section-title"><h2>{t('home.yourRating')}</h2><Link to="/profile">{t('home.viewProfile')} ›</Link></div>
          {played.length === 0 ? <div className="card muted">{t('home.noRatedYet')}</div> : (
            <div className="grid three">{played.map((r) => (
              <div key={r.board_size} className="card"><div className="row between"><strong>{r.board_size}×{r.board_size}</strong><LeagueBadge league={leagueOf(r.rating)} /></div><h2 style={{ margin: '4px 0 0' }}>{r.rating}</h2></div>
            ))}</div>
          )}
        </section>
      )}

      {!user && (
        <div className="card gold stack">
          <h3>{t('home.joinTitle')}</h3>
          <p className="muted" style={{ margin: 0 }}>{t('home.joinBody')}</p>
          <div className="row"><Link className="btn primary" to="/auth?mode=up">{t('common.signUp')}</Link><Link className="btn" to="/play/local">{t('play.local.title')}</Link></div>
        </div>
      )}
    </div>
  );
}
