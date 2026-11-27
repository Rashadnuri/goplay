import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BackendNotice, Field, Loading, Seg, Spinner, useToast } from '../components/ui.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { useI18n } from '../i18n/index.tsx';
import { clockOptions, fmtClock } from '../lib/clocks.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { backendReady, rpc } from '../lib/supabase.ts';
import type { BoardSize } from '../engine/index.ts';

export default function Rooms() {
  const { t } = useI18n();
  const { code: urlCode } = useParams();
  const { user, loading } = useAuth();
  const { fail } = useToast();
  const nav = useNavigate();
  const [size, setSize] = useState<BoardSize>(9);
  const { prefs, set: setPrefs } = usePrefs();
  const [preset, setPreset] = useState('rapid');
  const [customMin, setCustomMin] = useState(15);
  const [customInc, setCustomInc] = useState(10);
  const [rules, setRules] = useState<'japanese' | 'chinese'>('japanese');
  const [handicap, setHandicap] = useState(0);
  const [color, setColor] = useState<'random' | 'black' | 'white'>('random');
  const [code, setCode] = useState(urlCode ?? '');
  const [busy, setBusy] = useState(false);
  const autoJoined = useRef(false);

  const join = async (c: string) => {
    setBusy(true);
    try { const gid = await rpc<string>('join_game_by_code', { p_code: c.trim() }); nav(`/game/${gid}`, { replace: true }); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  // opening an invitation link joins immediately
  useEffect(() => {
    if (urlCode && user && !autoJoined.current) { autoJoined.current = true; void join(urlCode); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCode, user]);

  if (!backendReady) return <BackendNotice />;
  if (loading) return <Loading />;
  if (!user) return <div className="notice">{t('auth.required')} <Link to={`/auth?next=${encodeURIComponent(location.pathname)}`}>{t('common.signIn')}</Link></div>;
  if (urlCode) return <div className="empty"><Spinner label={t('room.joining')} /></div>;

  const create = async () => {
    const opts = clockOptions(prefs.clocks);
    const p = preset === 'custom' ? { initial: Math.round(customMin * 60), increment: customInc } : opts.find((x) => x.id === preset)!;
    setBusy(true);
    try {
      const r = await rpc<{ game_id: string }>('create_private_game', { p_size: size, p_initial: p.initial, p_increment: p.increment, p_rules: rules, p_komi: null, p_handicap: handicap, p_color: color });
      nav(`/game/${r.game_id}`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('play.room.title')}</h1>
      <p className="muted">{t('play.room.desc')}</p>
      <div className="card stack">
        <h3>{t('room.join')}</h3>
        <div className="row">
          <input className="input" placeholder="ABC123" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.3em', textAlign: 'center', fontWeight: 700 }} aria-label={t('room.code')} />
          <button className="btn primary" disabled={busy || code.trim().length < 6} onClick={() => join(code)}>{t('room.joinBtn')}</button>
        </div>
      </div>
      <div className="card stack">
        <h3>{t('room.create')}</h3>
        <Field label={t('setup.boardSize')}><Seg value={size} onChange={setSize} options={[9, 13, 19].map((s) => ({ value: s as BoardSize, label: `${s}×${s}` }))} /></Field>
        <Field label={t('setup.timeControl')}>
          <Seg value={preset} onChange={setPreset} options={[...clockOptions(prefs.clocks).map((p) => ({ value: p.id, label: p.custom ? fmtClock(p.initial, p.increment) : t(`time.${p.id}` as any) })), { value: 'custom', label: t('clock.custom') }]} />
          {preset === 'custom' && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              <label className="small muted">{t('clock.minutes')} <input className="input" style={{ width: 90 }} type="number" min={0} max={120} value={customMin} onChange={(e) => setCustomMin(Math.max(0, Math.min(120, Number(e.target.value))))} /></label>
              <label className="small muted">{t('clock.increment')} <input className="input" style={{ width: 90 }} type="number" min={0} max={120} value={customInc} onChange={(e) => setCustomInc(Math.max(0, Math.min(120, Number(e.target.value))))} /></label>
              <button className="btn small" disabled={prefs.clocks.length >= 6} onClick={() => setPrefs({ clocks: [...prefs.clocks, { initial: Math.round(customMin * 60), increment: customInc }] })}>{t('clock.save')}</button>
            </div>
          )}
        </Field>
        <Field label={t('setup.rules')}><Seg value={rules} onChange={setRules} options={[{ value: 'japanese', label: t('rules.japanese') }, { value: 'chinese', label: t('rules.chinese') }]} /></Field>
        <Field label={t('setup.yourColor')}><Seg value={color} onChange={setColor} options={[{ value: 'random', label: t('setup.random') }, { value: 'black', label: t('game.black') }, { value: 'white', label: t('game.white') }]} /></Field>
        <Field label={t('setup.handicap')}>
          <select className="input" value={handicap} onChange={(e) => setHandicap(Number(e.target.value))}>
            <option value={0}>{t('setup.noHandicap')}</option>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <button className="btn primary block" disabled={busy} onClick={create}>{t('room.createBtn')}</button>
        <div className="small muted">{t('room.casual')}</div>
      </div>
    </div>
  );
}
