import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackendNotice, Field, Loading, Seg, Spinner, useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { clockOptions, fmtClock } from '../lib/clocks.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { backendReady, rpc, supabase } from '../lib/supabase.ts';
import type { BoardSize } from '../engine/index.ts';

export default function Matchmaking() {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  const { fail } = useToast();
  const nav = useNavigate();
  const [size, setSize] = useState<BoardSize>(9);
  const { prefs } = usePrefs();
  const [preset, setPreset] = useState<string>('rapid');
  const options = clockOptions(prefs.clocks);
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [checking, setChecking] = useState(true);
  const matched = useRef(false);
  const aliveRef = useRef(true);

  const goto = useCallback((gid: string) => {
    matched.current = true;
    nav(`/game/${gid}`, { replace: true });
  }, [nav]);

  // resume an existing queue entry after reload
  useEffect(() => {
    aliveRef.current = true;
    if (!supabase || !user) { setChecking(false); return; }
    supabase.from('matchmaking_queue').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      if (data?.game_id) goto(data.game_id as string);
      else if (data) { setSize(data.board_size as BoardSize); const p = clockOptions(prefs.clocks).find((x) => x.initial === data.time_initial_s && x.increment === data.time_increment_s); if (p) setPreset(p.id); setSearching(true); }
      setChecking(false);
    });
    return () => { aliveRef.current = false; };
  }, [user, goto]);

  // poll + realtime while searching
  useEffect(() => {
    if (!searching || !supabase || !user) return;
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const poll = async () => {
      try { const gid = await rpc<string | null>('poll_matchmaking'); if (gid && aliveRef.current) goto(gid); }
      catch (e) { if (aliveRef.current) { fail(e); setSearching(false); } }
    };
    const pollTimer = setInterval(poll, 3000);
    const ch = supabase.channel(`mm:${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matchmaking_queue', filter: `user_id=eq.${user.id}` }, () => { void poll(); })
      .subscribe();
    return () => { clearInterval(tick); clearInterval(pollTimer); void supabase!.removeChannel(ch); };
  }, [searching, user, goto, fail]);

  // leaving the page cancels the search (unless we were matched)
  useEffect(() => () => { if (!matched.current && supabase) void supabase.rpc('leave_matchmaking'); }, []);

  if (!backendReady) return <BackendNotice />;
  if (loading || checking) return <Loading />;
  if (!user) return <div className="notice">{t('auth.required')} <Link to="/auth?next=/play/online">{t('common.signIn')}</Link></div>;

  const start = async () => {
    const p = options.find((x) => x.id === preset) ?? options[1];
    try {
      const gid = await rpc<string | null>('join_matchmaking', { p_size: size, p_initial: p.initial, p_increment: p.increment });
      if (gid) return goto(gid);
      setElapsed(0);
      setSearching(true);
    } catch (e) { fail(e); }
  };
  const cancel = async () => {
    setSearching(false);
    try { await rpc('leave_matchmaking'); } catch (e) { fail(e); }
  };

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('play.online.title')}</h1>
      <p className="muted">{t('play.online.desc')}</p>
      {searching ? (
        <div className="card gold stack center">
          <Spinner />
          <h2>{t('mm.searching')}</h2>
          <div className="muted">{size}×{size} · {(() => { const p = options.find((x) => x.id === preset); return p && p.custom ? fmtClock(p.initial, p.increment) : t(`time.${preset}` as any); })()} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</div>
          <div className="small muted">{t('mm.widening')}</div>
          <button className="btn danger" onClick={cancel}>{t('mm.cancel')}</button>
        </div>
      ) : (
        <div className="card stack">
          <Field label={t('setup.boardSize')}><Seg value={size} onChange={setSize} options={[9, 13, 19].map((s) => ({ value: s as BoardSize, label: `${s}×${s}` }))} /></Field>
          <Field label={t('setup.timeControl')}>
            <Seg value={preset} onChange={setPreset} options={options.map((p) => ({ value: p.id, label: p.custom ? fmtClock(p.initial, p.increment) : t(`time.${p.id}` as any) }))} />
            <span className="small muted">{(() => { const p = options.find((x) => x.id === preset) ?? options[1]; return p.initial ? fmtClock(p.initial, p.increment) : t('time.untimed'); })()} · {t('clock.matchHint')}</span>
          </Field>
          <div className="small muted">{t('mm.ranked')}</div>
          <button className="btn primary block" onClick={start}>{t('mm.find')}</button>
        </div>
      )}
    </div>
  );
}
