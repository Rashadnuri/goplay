import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AiCoach } from '../components/AiCoach.tsx';
import { Board } from '../components/Board.tsx';
import { Commentary } from '../components/Commentary.tsx';
import { GameShell, HudPlayer, LeaveButton, MenuItem, MenuSheet, Toolbar } from '../components/GameShell.tsx';
import { ErrorState, Loading, useToast } from '../components/ui.tsx';
import { BLACK, GoGame, WHITE, makeConfig, other, pointLabel, toSGF, type Color } from '../engine/index.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { aiAnalyze, aiConfigured, type AiAnalysis } from '../lib/ai.ts';
import { describeMove } from '../lib/concepts.ts';
import { loadGame, type LoadedGame } from '../lib/online.ts';
import { rpc } from '../lib/supabase.ts';
import { useImmersive } from '../components/Tutorial.tsx';

interface Frame { board: Uint8Array; caps: [number, number, number]; last: number; ko: number; toPlay: Color }

/** Replays a finished game from the database. Public games (and games a player chose to share) are viewable by anyone with the link. */
export default function Replay() {
  const { id } = useParams();
  const { t } = useI18n();
  const [data, setData] = useState<LoadedGame | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { loadGame(id!).then(setData).catch(setError); }, [id]);
  if (error) return <div className="stack"><ErrorState error={error} /><Link className="btn" to="/">{t('nav.home')}</Link></div>;
  if (!data) return <Loading />;
  if (data.game.status !== 'finished') return <div className="notice stack"><span>{t('replay.notFinished')}</span><Link className="btn primary" to={`/game/${id}`}>{t('replay.watchLive')}</Link></div>;
  return <ReplayView data={data} reload={() => loadGame(id!).then(setData)} />;
}

function ReplayView({ data, reload }: { data: LoadedGame; reload: () => void }) {
  const { game, participants, moves } = data;
  const { t, fmtDate } = useI18n();
  const { user } = useAuth();
  const { toast, fail } = useToast();
  const nav = useNavigate();
  const { prefs, set: setPrefs } = usePrefs();
  const fsHook = useFullscreen();
  useImmersive(true);

  const cfg = useMemo(() => makeConfig({ size: game.board_size, komi: Number(game.komi), rules: game.rules, handicap: game.handicap, ko: game.ko_rule }), [game]);
  const seq = useMemo(() => [...moves].sort((a, b) => a.move_number - b.move_number).map((m) => m.p), [moves]);
  const timeline = useMemo(() => {
    const g = new GoGame(cfg);
    const frames: Frame[] = [{ board: g.board.slice(), caps: [0, 0, 0], last: -1, ko: -1, toPlay: g.toPlay }];
    const records = [];
    for (const p of seq) {
      const r = p === -1 ? g.pass() : g.play(p);
      if (!r.ok) throw new Error('corrupt replay');
      records.push(r.record);
      frames.push({ board: g.board.slice(), caps: [...g.captures] as [number, number, number], last: p, ko: g.koPoint, toPlay: g.toPlay });
    }
    return { frames, records, final: g };
  }, [cfg, seq]);

  const last = seq.length;
  const [idx, setIdx] = useState(last);
  const [menu, setMenu] = useState(false);
  const [coach, setCoach] = useState(false);
  const [talk, setTalk] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [marks, setMarks] = useState<number[]>([]);
  const [est, setEst] = useState<AiAnalysis | null>(null);
  const [showEst, setShowEst] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = useCallback((n: number) => { setIdx(Math.max(0, Math.min(last, n))); setMarks([]); setEst(null); setShowEst(false); }, [last]);

  // autoplay
  useEffect(() => {
    if (!playing) return;
    if (idx >= last) { setPlaying(false); return; }
    const timer = setTimeout(() => go(idx + 1), 900 / speed);
    return () => clearTimeout(timer);
  }, [playing, idx, last, speed, go]);
  // keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(idx + 1); else if (e.key === 'ArrowLeft') go(idx - 1);
      else if (e.key === 'Home') go(0); else if (e.key === 'End') go(last); else if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [idx, last, go]);

  const f = timeline.frames[idx];
  const rec = idx > 0 ? timeline.records[idx - 1] : undefined;
  const nameOf = (c: Color) => participants.find((p) => p.color === c)?.profiles?.username ?? (c === BLACK ? t('game.black') : t('game.white'));
  const avatarOf = (c: Color) => participants.find((p) => p.color === c)?.profiles?.avatar;
  const me = participants.find((p) => p.user_id === user?.id);
  const link = `${location.origin}/replay/${game.id}`;
  const shareable = !game.is_private || game.replay_shared;

  const sgf = () => {
    const blob = new Blob([toSGF(timeline.final, { black: nameOf(BLACK), white: nameOf(WHITE), date: game.created_at.slice(0, 10), result: game.result_text ?? undefined })], { type: 'application/x-go-sgf' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `goplay-${game.id.slice(0, 8)}.sgf`; a.click(); URL.revokeObjectURL(a.href);
  };
  const copyLink = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'GO PLAY', text: `${nameOf(BLACK)} vs ${nameOf(WHITE)}`, url: link }); return; } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(link); toast(t('common.copied')); } catch { toast(link); }
  };
  const toggleShared = async () => { try { await rpc('set_replay_shared', { p_game: game.id, p_shared: !game.replay_shared }); reload(); } catch (e) { fail(e); } };
  const estimate = async () => {
    setBusy(true);
    try { setEst(await aiAnalyze({ size: cfg.size, komi: cfg.komi, rules: cfg.rules, handicap: cfg.handicap, moves: seq.slice(0, idx) }, 200)); setShowEst(true); setMenu(false); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const ev = rec ? describeMove(rec.color, rec.p, rec.captured.length, pointLabel(rec.p, cfg.size)) : null;
  const who = (c: number) => (c === 1 ? t('game.black') : t('game.white'));
  const note = showEst && est ? (
    <span className="row wrap"><span className="chip warn-chip">{t('coach.estimate')}</span><span>{t('replay.estimateLine', { lead: `${est.scoreLead >= 0 ? 'B' : 'W'}+${Math.abs(est.scoreLead).toFixed(1)}`, wr: Math.round(est.winrate * 100) })}</span></span>
  ) : idx === last ? (
    <span className="row wrap"><span className="chip ok">{t('coach.proven')}</span><strong>{game.result_text}</strong></span>
  ) : ev ? (
    <span className="row wrap"><span className="chip ok">{t('coach.fact')}</span><span>{`#${idx} · ${t(ev.key as DictKey, { ...ev.params, who: who(Number(ev.params.who)) } as Record<string, string | number>)}`}</span></span>
  ) : <span>{t('replay.start')}</span>;

  const toolbar = (
    <Toolbar items={[
      { key: 'first', icon: 'first', label: t('replay.first'), disabled: idx === 0, onClick: () => go(0) },
      { key: 'prev', icon: 'prev', label: t('replay.prev'), disabled: idx === 0, onClick: () => go(idx - 1) },
      { key: 'play', icon: playing ? 'pause' : 'play', label: playing ? t('replay.pause') : t('replay.play'), tone: 'gold', disabled: idx >= last && !playing, onClick: () => { if (idx >= last) go(0); setPlaying((p) => !p); } },
      { key: 'next', icon: 'next', label: t('replay.next'), disabled: idx >= last, onClick: () => go(idx + 1) },
      { key: 'last', icon: 'last', label: t('replay.last'), disabled: idx >= last, onClick: () => go(last) },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
    ]} />
  );

  return (
    <>
      <GameShell
        top={<HudPlayer color={WHITE} name={nameOf(WHITE)} avatar={avatarOf(WHITE)} captures={f.caps[WHITE]} turn={idx < last && f.toPlay === WHITE} rating={participants.find((p) => p.color === 2)?.rating_before} lead={<LeaveButton to={me ? '/profile' : '/'} />} />}
        bottom={<HudPlayer color={BLACK} name={nameOf(BLACK)} avatar={avatarOf(BLACK)} captures={f.caps[BLACK]} turn={idx < last && f.toPlay === BLACK} rating={participants.find((p) => p.color === 1)?.rating_before} />}
        note={note}
        toolbar={toolbar}
        board={<Board size={cfg.size} board={f.board} lastMove={f.last >= 0 ? f.last : undefined} koPoint={f.ko} marks={marks} ownership={showEst && est?.ownership ? est.ownership : undefined} coords={prefs.coords} toPlay={other(f.toPlay)} ariaLabel={t('replay.title')} />}
      />
      {menu && (
        <MenuSheet title={t('replay.title')} onClose={() => setMenu(false)}>
          <div className="small muted" style={{ padding: '0 12px' }}>{nameOf(BLACK)} vs {nameOf(WHITE)} · {cfg.size}×{cfg.size} · {game.result_text} {game.finished_at ? `· ${fmtDate(game.finished_at)}` : ''}</div>
          <div style={{ padding: '8px 12px' }}>
            <label className="small muted" htmlFor="jump">{t('replay.jump')}: {t('game.move', { n: idx })} / {last}</label>
            <input id="jump" type="range" min={0} max={last} value={idx} onChange={(e) => go(Number(e.target.value))} style={{ width: '100%' }} />
            <div className="seg" style={{ marginTop: 6 }}>{[0.5, 1, 2, 4].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
          </div>
          <div style={{ padding: '0 12px 8px', maxHeight: 130, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 4 }} role="list" aria-label={t('replay.moves')}>
            {timeline.records.map((r, i) => (
              <button key={i} role="listitem" className={`chip${i + 1 === idx ? ' gold' : ''}`} style={{ cursor: 'pointer' }} onClick={() => { go(i + 1); setMenu(false); }}>{i + 1}{r.color === 1 ? '●' : '○'} {r.p < 0 ? '—' : pointLabel(r.p, cfg.size)}</button>
            ))}
          </div>
          <div className="menu-sep" />
          <MenuItem icon="bot" label={t('coach.title')} onClick={() => { setMenu(false); setCoach(true); }} />
          <MenuItem icon="eye" label={busy ? t('common.loading') : showEst ? t('replay.hideEstimate') : t('replay.estimate')} hint={aiConfigured ? undefined : t('coach.unavailable')} onClick={() => { if (showEst) { setShowEst(false); setMenu(false); } else void estimate(); }} />
          <MenuItem icon="msg" label={t('commentary.title')} onClick={() => { setMenu(false); setTalk(true); }} />
          <div className="menu-sep" />
          {shareable ? <MenuItem icon="share" label={t('replay.share')} onClick={copyLink} /> : <div className="small muted" style={{ padding: '6px 12px' }}>{t('replay.privateHint')}</div>}
          {me && game.is_private && <MenuItem icon="link" label={game.replay_shared ? t('replay.unshare') : t('replay.makeShareable')} onClick={toggleShared} />}
          <MenuItem icon="link" label={t('game.exportSgf')} onClick={sgf} />
          <MenuItem icon="grid" label={t('menu.coords')} onClick={() => setPrefs({ coords: !prefs.coords })} hint={prefs.coords ? t('settings.on') : t('settings.off')} />
          {fsHook.supported && <MenuItem icon="expand" label={fsHook.on ? t('menu.exitFullscreen') : t('menu.fullscreen')} onClick={() => { void fsHook.toggle(); }} />}
          <MenuItem icon="arrow" label={t('menu.leave')} onClick={() => nav(-1)} />
        </MenuSheet>
      )}
      {coach && <AiCoach config={cfg} moves={seq} resultText={game.result_text} onClose={() => setCoach(false)} onShow={(n, best) => { go(Math.max(0, n - 1)); setMarks(best !== undefined && best >= 0 ? [best] : []); }} />}
      {talk && <Commentary gameId={game.id} moveNumber={idx} canPost={!!user} onClose={() => setTalk(false)} onJump={go} />}
    </>
  );
}
