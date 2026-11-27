import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from '../components/Deco.tsx';
import { BackendNotice, ErrorState, Loading, Seg } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { backendReady, supabase } from '../lib/supabase.ts';
import type { TournamentRow } from '../lib/types.ts';

type Row = TournamentRow & { tournament_participants: { count: number }[] };

export default function Tournaments() {
  const { t, fmtDate } = useI18n();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'registration' | 'running' | 'finished'>('registration');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!supabase) return;
    setRows(null); setError(null);
    supabase.from('tournaments').select('*, tournament_participants(count)').eq('status', tab).order('starts_at', { ascending: tab !== 'finished', nullsFirst: false }).limit(50)
      .then(({ data, error: e }) => (e ? setError(e) : setRows(data as unknown as Row[])));
  }, [tab]);

  return (
    <div className="stack">
      <div className="row between"><h1>{t('nav.tournaments')}</h1>{isAdmin && <Link className="btn small primary" to="/admin?tab=tournaments">{t('admin.createTournament')}</Link>}</div>
      {!backendReady ? <BackendNotice /> : (
        <>
          <Seg value={tab} onChange={setTab} options={[{ value: 'registration', label: t('tour.open') }, { value: 'running', label: t('tour.running') }, { value: 'finished', label: t('tour.finished') }]} />
          {error != null && <ErrorState error={error} />}
          {!rows && !error && <Loading />}
          {rows && rows.length === 0 && <div className="empty card">{t('tour.none')}</div>}
          <div className="grid two">
            {rows?.map((r) => (
              <Link key={r.id} to={`/tournaments/${r.id}`} className="card tour-card pattern" style={{ textDecoration: 'none' }}>
                <Trophy className="trophy" tone={tab === 'finished' ? 'silver' : 'gold'} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 4px' }}>{r.name}</h3>
                  {r.recurrence === 'weekly' && <span className="chip" style={{ marginBottom: 4 }}>{t('tour.weekly')}</span>}
                  <div className="small muted">{t(`tour.${r.format}` as any)}{r.starts_at ? ` · ${fmtDate(r.starts_at)}` : ''}</div>
                  <div className="small muted">{r.board_size}×{r.board_size} · {r.time_initial_s ? `${Math.round(r.time_initial_s / 60)}+${r.time_increment_s}` : t('time.untimed')}</div>
                  <div className="small" style={{ color: 'var(--success)' }}>● {r.tournament_participants?.[0]?.count ?? 0}/{r.max_players} {t('tour.players')}</div>
                </div>
                <span className={`btn small${tab === 'registration' ? ' primary' : ''}`}>{tab === 'registration' ? t('tour.join') : t('tour.watch')}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
