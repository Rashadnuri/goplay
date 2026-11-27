import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackendNotice, ErrorState, Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { backendReady, rpc } from '../lib/supabase.ts';

interface Live { game_id: string; board_size: number; move_count: number; time_initial_s: number; time_increment_s: number; is_ranked: boolean; black_name: string; black_rating: number | null; white_name: string; white_rating: number | null }

/** Live public games, strongest first. Spectating needs no account; commentary needs one. */
export default function Watch() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Live[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => { rpc<Live[]>('list_live_games', { p_limit: 30 }).then((r) => { setRows(r); setError(null); }).catch(setError); }, []);
  useEffect(() => { if (!backendReady) return; load(); const timer = setInterval(load, 15_000); return () => clearInterval(timer); }, [load]);
  if (!backendReady) return <div className="stack"><h1>{t('watch.title')}</h1><BackendNotice /></div>;
  return (
    <div className="stack">
      <h1>{t('watch.title')}</h1>
      <p className="muted">{t('watch.sub')}</p>
      {error != null && <ErrorState error={error} onRetry={load} />}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <div className="empty card">{t('watch.none')}</div>}
      <div className="grid two">
        {rows?.map((g) => (
          <Link key={g.game_id} to={`/game/${g.game_id}`} className="card stack" style={{ textDecoration: 'none', gap: 6 }}>
            <div className="row between"><strong>{g.black_name} <span className="muted">{g.black_rating ?? ''}</span></strong><span className="stone-sm b" /></div>
            <div className="row between"><strong>{g.white_name} <span className="muted">{g.white_rating ?? ''}</span></strong><span className="stone-sm w" /></div>
            <div className="small muted">{g.board_size}×{g.board_size} · {g.time_initial_s ? `${Math.round(g.time_initial_s / 60)}+${g.time_increment_s}` : t('time.untimed')} · {t('game.move', { n: g.move_count })} · {g.is_ranked ? t('game.ranked') : t('game.casual')}</div>
            <span className="btn small primary" style={{ alignSelf: 'flex-start' }}>{t('watch.watch')}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
