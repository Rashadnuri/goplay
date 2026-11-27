import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Board, useMovePicker } from '../components/Board.tsx';
import { ResultText, ScoreSummary, type ScoreView } from '../components/GameParts.tsx';
import { ConfirmBar, GameShell, HudPlayer, LeaveButton, MenuItem, MenuSheet, Toolbar } from '../components/GameShell.tsx';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import type { DictKey } from '../i18n/az.ts';
import { Confirm, ErrorState, Field, Loading, Modal, Spinner, useToast } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { BLACK, WHITE, GoGame, makeConfig, toSGF, type Color } from '../engine/index.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n } from '../i18n/index.tsx';
import { clockOffset, loadGame, loadMoves, sendAction, type GameAction } from '../lib/online.ts';
import { backendReady, errorCode, rpc, supabase } from '../lib/supabase.ts';
import type { GameRow, MoveRow, Participant, FriendRow } from '../lib/types.ts';
import { BackendNotice } from '../components/ui.tsx';
import { Commentary } from '../components/Commentary.tsx';
import { describeMove } from '../lib/concepts.ts';
import { pointLabel } from '../engine/index.ts';
import { TutorialModal, useCoach, useImmersive, useTutorial } from '../components/Tutorial.tsx';
import { toggleDeadGroup } from './LocalGame.tsx';

export default function OnlineGame() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  if (!backendReady) return <BackendNotice />;
  if (authLoading) return <Loading />;
  // Signed-out visitors can still spectate public games (read-only); a random per-tab id keys their presence.
  return <Live id={id!} userId={user?.id ?? guestId()} signedIn={!!user} />;
}

type Conn = 'connecting' | 'online' | 'offline';
function guestId(): string {
  try { let g = sessionStorage.getItem('goplay.guest'); if (!g) { g = `guest-${crypto.randomUUID()}`; sessionStorage.setItem('goplay.guest', g); } return g; } catch { return `guest-${Math.random().toString(36).slice(2)}`; }
}

function Live({ id, userId, signedIn }: { id: string; userId: string; signedIn: boolean }) {
  const { t } = useI18n();
  const { toast, fail } = useToast();
  const nav = useNavigate();
  const { prefs, confirm, set: setPrefs } = usePrefs();
  const [game, setGame] = useState<GameRow | null>(null);
  const [parts, setParts] = useState<Participant[]>([]);
  const [moves, setMoves] = useState<MoveRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [spectators, setSpectators] = useState(0);
  const [talk, setTalk] = useState(false);
  const roleRef = useRef<'player' | 'spectator'>('spectator');
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [askResign, setAskResign] = useState(false);
  const [report, setReport] = useState(false);
  const movesRef = useRef<MoveRow[]>([]);
  movesRef.current = moves;
  const chRef = useRef<RealtimeChannel | null>(null);

  // ── (re)load the authoritative state ──
  const refresh = useCallback(async () => {
    try {
      const l = await loadGame(id);
      setGame(l.game); setParts(l.participants); setMoves(l.moves); setError(null);
    } catch (e) { setError(e); }
  }, [id]);

  const syncMoves = useCallback(async () => {
    try {
      const m = await loadMoves(id);
      setMoves(m);
    } catch { /* next reconcile will retry */ }
  }, [id]);

  useEffect(() => { void refresh(); void clockOffset().then(setOffset); }, [refresh]);

  // ── realtime subscription: game row, moves, presence ──
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel(`game:${id}`, { config: { presence: { key: userId } } });
    chRef.current = ch;
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, (payload) => {
      if (payload.new && 'id' in payload.new) setGame(payload.new as GameRow);
    })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_moves', filter: `game_id=eq.${id}` }, (payload) => {
        const m = payload.new as MoveRow;
        setMoves((cur) => (cur.some((x) => x.move_number === m.move_number) ? cur : [...cur, m].sort((a, b) => a.move_number - b.move_number)));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_participants', filter: `game_id=eq.${id}` }, () => { void refresh(); })
      .on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState() as Record<string, { role?: string }[]>;
        setPresent(new Set(Object.keys(st)));
        setSpectators(Object.values(st).filter((m) => m[0]?.role === 'spectator').length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConn('online');
          await ch.track({ at: Date.now(), role: roleRef.current });
          void refresh(); // restore the last valid state after (re)connecting
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConn('offline');
      });
    const onOnline = () => { setConn('connecting'); void refresh(); };
    const onOffline = () => setConn('offline');
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase!.removeChannel(ch);
    };
  }, [id, userId, refresh]);

  // undo/resume delete moves (no DELETE filter on realtime) → reconcile whenever the counters disagree
  useEffect(() => {
    if (game && game.status !== 'waiting' && moves.length !== game.move_count) {
      const timer = setTimeout(() => void syncMoves(), 300);
      return () => clearTimeout(timer);
    }
  }, [game?.version, game?.move_count, moves.length, syncMoves]); // eslint-disable-line react-hooks/exhaustive-deps

  // safety net: periodic reconcile while the game is live (covers missed realtime events)
  useEffect(() => {
    if (!game || !['active', 'scoring', 'waiting'].includes(game.status)) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [game?.status, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ticking clock
  useEffect(() => {
    if (!game || game.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [game?.status]);

  // ── derived engine state (replayed from the stored moves) ──
  const engine = useMemo(() => {
    if (!game) return null;
    try {
      const cfg = makeConfig({ size: game.board_size, komi: Number(game.komi), rules: game.rules, handicap: game.handicap, ko: game.ko_rule });
      const g = GoGame.fromMoves(cfg, [...moves].sort((a, b) => a.move_number - b.move_number).map((m) => m.p));
      return g;
    } catch { return null; }
  }, [game?.board_size, game?.komi, game?.rules, game?.handicap, game?.ko_rule, moves]); // eslint-disable-line react-hooks/exhaustive-deps

  const me = parts.find((p) => p.user_id === userId);
  const myColor: Color | null = me ? (me.color as Color) : null;
  roleRef.current = myColor ? 'player' : 'spectator';
  useEffect(() => { void chRef.current?.track({ at: Date.now(), role: myColor ? 'player' : 'spectator' }); }, [myColor]);
  const opp = parts.find((p) => p.user_id !== userId);
  const nameOf = (c: Color) => parts.find((p) => p.color === c)?.profiles?.username ?? (c === BLACK ? t('game.black') : t('game.white'));
  const avatarOf = (c: Color) => parts.find((p) => p.color === c)?.profiles?.avatar;
  const ratingOf = (c: Color) => parts.find((p) => p.color === c)?.rating_before ?? null;
  const online = (c: Color) => { const p = parts.find((x) => x.color === c); return p ? (p.user_id === userId ? conn === 'online' : present.has(p.user_id)) : null; };

  const serverNow = now + offset;
  const clockLeft = (c: Color): number | null => {
    if (!game || game.time_initial_s === 0) return null;
    const base = c === BLACK ? game.black_ms : game.white_ms;
    if (base === null) return null;
    if (game.status === 'active' && game.clock_running === c && game.clock_since) return Math.max(0, Number(base) - (serverNow - new Date(game.clock_since).getTime()));
    return Number(base);
  };

  // claim timeouts (server verifies against the database clock)
  const claimed = useRef(0);
  useEffect(() => {
    if (!game || game.status !== 'active' || !myColor || game.time_initial_s === 0 || !game.clock_running) return;
    const left = clockLeft(game.clock_running);
    if (left !== null && left <= 0 && Date.now() - claimed.current > 3000) {
      claimed.current = Date.now();
      rpc('claim_timeout', { p_game: id }).then(() => refresh()).catch(() => { /* server says time remains */ });
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── actions ──
  const act = useCallback(async (a: GameAction) => {
    setBusy(true);
    try {
      await sendAction(id, a);
      await syncMoves();
      await refresh();
    } catch (e) {
      const code = errorCode(e);
      if (code === 'stale_state' || code === 'version_conflict') await refresh();
      fail(e);
    } finally { setBusy(false); }
  }, [id, fail, refresh, syncMoves]);

  const call = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    try { await rpc(fn, args); await refresh(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  useImmersive(!!game && game.status !== 'waiting');
  const tut = useTutorial(false);
  const [menu, setMenu] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const fsHook = useFullscreen();
  const coach = useCoach(engine, myColor);
  const myTurn = !!game && game.status === 'active' && myColor !== null && game.to_play === myColor;
  const onPlay = useCallback((p: number) => {
    if (!engine || !game) return;
    const pre = engine.checkMove(p, myColor ?? BLACK);
    if (!pre.ok) return toast(t(`illegal.${pre.reason}` as any), 'error');
    void act({ type: 'move', p, expected_move_count: game.move_count });
  }, [engine, game, myColor, act, toast, t]);
  const canPlay = useCallback((p: number) => myTurn && !busy && !!engine && engine.at(p) === 0, [myTurn, busy, engine]);
  const picker = useMovePicker({ confirm, onPlay, canPlay, onBlocked: (p) => { if (myTurn && !busy && engine && engine.at(p) !== 0) toast(t('illegal.occupied'), 'error'); } });

  if (error && !game) return <ErrorState error={error} onRetry={refresh} />;
  if (!game || !engine) return error ? <ErrorState error={error} onRetry={refresh} /> : <Loading />;

  if (game.status === 'waiting') return <Waiting game={game} onCancel={async () => { await call('cancel_room', { p_game: id }); nav('/play'); }} />;
  if (game.status === 'aborted') return <div className="notice stack"><span>{t('game.aborted')}</span><Link className="btn" to="/play">{t('common.back')}</Link></div>;

  const scoring = game.status === 'scoring';
  const finished = game.status === 'finished';
  const deadSet = new Set<number>(game.dead_stones ?? []);
  const scorePreview = scoring || finished ? engine.score(finished && game.final_score ? ((game.final_score.dead as number[]) ?? []) : [...deadSet]) : null;
  const finalScore = finished && game.final_score && 'blackTerritory' in game.final_score ? (game.final_score as unknown as ScoreView) : null;
  const iAccepted = myColor === BLACK ? game.score_accept_black : game.score_accept_white;
  const oppAccepted = myColor === BLACK ? game.score_accept_white : game.score_accept_black;
  const winnerColor = game.winner as Color | null;
  const iWon = myColor !== null && winnerColor === myColor;

  const sgf = () => {
    const blob = new Blob([toSGF(engine, { black: nameOf(BLACK), white: nameOf(WHITE), date: game.created_at.slice(0, 10) })], { type: 'application/x-go-sgf' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `goplay-${id.slice(0, 8)}.sgf`; a.click(); URL.revokeObjectURL(a.href);
  };

  const onSelect = (p: number) => {
    if (scoring && myColor && engine.at(p) !== 0) {
      void act({ type: 'mark_dead', dead: [...toggleDeadGroup(engine, deadSet, p)] });
      return;
    }
    picker.select(p);
  };

  const undoReq = game.undo_request;
  const drawBy = game.draw_offer_by;

  const topColor: Color = myColor === WHITE ? BLACK : WHITE;
  const botColor: Color = myColor === WHITE ? WHITE : BLACK;
  const oppOffline = !!opp && game.status === 'active' && !online(opp.color as Color);
  const incomingDraw = !!myColor && game.status === 'active' && drawBy && drawBy !== myColor;
  const incomingUndo = !!myColor && game.status === 'active' && undoReq && undoReq.by !== myColor;

  const lastRec = engine.lastMove;
  const lastEv = lastRec ? (() => { const e = describeMove(lastRec.color, lastRec.p, lastRec.captured.length, pointLabel(lastRec.p, game.board_size)); return `#${lastRec.number} · ${t(e.key as DictKey, { ...e.params, who: lastRec.color === 1 ? t('game.black') : t('game.white') } as Record<string, string | number>)}`; })() : null;
  const note = incomingDraw ? (
    <span className="row wrap"><strong>{t('game.drawOffered')}</strong><button className="btn primary small" onClick={() => call('respond_draw', { p_game: id, p_accept: true })}>{t('common.accept')}</button><button className="btn small" onClick={() => call('respond_draw', { p_game: id, p_accept: false })}>{t('common.decline')}</button></span>
  ) : incomingUndo ? (
    <span className="row wrap"><strong>{t('game.undoRequested')}</strong><button className="btn primary small" onClick={() => act({ type: 'respond_undo', accept: true })}>{t('common.accept')}</button><button className="btn small" onClick={() => act({ type: 'respond_undo', accept: false })}>{t('common.decline')}</button></span>
  ) : picker.pending !== null && myTurn ? <ConfirmBar onConfirm={picker.commit} onCancel={picker.cancel} />
    : conn !== 'online' ? <span className="warn">{conn === 'connecting' ? t('conn.connecting') : t('conn.reconnectHelp')}</span>
    : oppOffline ? <span className="warn">{t('game.opponentOffline')}</span>
    : scoring ? <span>{iAccepted ? t('game.youAccepted') : oppAccepted ? t('game.opponentAccepted') : t('game.markDeadHelp')}</span>
    : !myColor && game.status === 'active' && lastEv ? <span className="row wrap"><span className="chip ok">{t('coach.fact')}</span><span>{lastEv}</span><span className="chip">👁 {spectators}</span></span>
    : drawBy === myColor && game.status === 'active' ? <span>{t('game.drawPending')}</span>
    : undoReq?.by === myColor && game.status === 'active' ? <span>{t('game.undoPending')}</span>
    : busy ? <span className="row"><span className="spinner" /> {t('common.sending')}</span>
    : coach.tips[0] ? <span className={coach.tips[0].tone}>{t(coach.tips[0].key as DictKey, coach.tips[0].params)}</span> : null;

  const canTalk = !myColor || finished;
  const toolbar = !myColor || finished ? (
    <Toolbar items={[
      ...(finished ? [{ key: 'replay', icon: 'play', label: t('replay.title'), tone: 'gold' as const, onClick: () => nav(`/replay/${id}`) }] : []),
      ...(canTalk ? [{ key: 'talk', icon: 'msg', label: t('commentary.title'), onClick: () => setTalk(true) }] : []),
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'leave', icon: 'arrow', label: t('menu.leave'), onClick: () => nav('/play') },
    ]} />
  ) : scoring ? (
    <Toolbar items={[
      { key: 'resume', icon: 'undo', label: t('game.resume'), disabled: busy, onClick: () => act({ type: 'resume' }) },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'ok', icon: 'check', label: t('game.acceptScore'), tone: 'gold', disabled: busy || iAccepted, onClick: () => act({ type: 'accept_score', dead: [...deadSet] }) },
    ]} />
  ) : (
    <Toolbar items={[
      { key: 'undo', icon: 'undo', label: undoReq?.by === myColor ? t('game.undoPending') : t('game.undo'), disabled: busy || !!undoReq || !!game.tournament_match_id || !moves.some((m) => m.color === myColor), onClick: () => act({ type: 'request_undo' }) },
      { key: 'pass', icon: 'flag', label: t('game.pass'), disabled: !myTurn || busy, onClick: () => { picker.cancel(); void act({ type: 'pass', expected_move_count: game.move_count }); } },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'resign', icon: 'x', label: t('game.resign'), tone: 'danger', disabled: busy, onClick: () => setAskResign(true) },
    ]} />
  );

  return (
    <>
      <GameShell
        top={<HudPlayer color={topColor} name={nameOf(topColor)} avatar={avatarOf(topColor)} rating={ratingOf(topColor)} turn={game.status === 'active' && game.to_play === topColor} captures={engine.captures[topColor]} clockMs={clockLeft(topColor)} online={online(topColor)} lead={<LeaveButton />} />}
        bottom={<HudPlayer color={botColor} name={nameOf(botColor)} avatar={avatarOf(botColor)} rating={ratingOf(botColor)} turn={game.status === 'active' && game.to_play === botColor} captures={engine.captures[botColor]} clockMs={clockLeft(botColor)} online={myColor ? conn === 'online' : online(botColor)} />}
        note={note}
        toolbar={toolbar}
        board={
          <Board
            size={game.board_size}
            board={engine.board}
            lastMove={engine.lastMove?.p}
            koPoint={engine.koPoint}
            toPlay={myColor ?? game.to_play}
            pending={picker.pending}
            onSelect={finished || !myColor ? undefined : onSelect}
            coords={prefs.coords}
            disabled={busy}
            territory={scorePreview?.territory}
            dead={scoring ? deadSet : finished ? new Set(((game.final_score?.dead as number[]) ?? [])) : undefined}
          />
        }
      />
      {menu && (
        <MenuSheet title={t('menu.game')} onClose={() => setMenu(false)}>
          <div className="small muted" style={{ padding: '0 12px 8px' }}>{game.board_size}×{game.board_size} · {t(`rules.${game.rules}` as any)} · {game.time_initial_s ? `${Math.round(game.time_initial_s / 60)}+${game.time_increment_s}` : t('time.untimed')} · {game.is_ranked ? t('game.ranked') : t('game.casual')} · {t('game.move', { n: game.move_count })}</div>
          {scorePreview && (scoring || finished) && <div style={{ padding: '0 8px 8px' }}><ScoreSummary s={finalScore ?? scorePreview} /></div>}
          {myColor && game.status === 'active' && (
            <MenuItem icon="users" label={drawBy === myColor ? t('game.drawPending') : t('game.offerDraw')} onClick={() => { setMenu(false); void call('offer_draw', { p_game: id }); }} />
          )}
          {!myColor && game.status !== 'finished' && <div className="small muted" style={{ padding: '0 12px 8px' }}>👁 {t('spectate.count', { n: spectators })} · {t('spectate.hint')}</div>}
          {finished && <MenuItem icon="play" label={t('replay.title')} onClick={() => nav(`/replay/${id}`)} />}
          <MenuItem icon="book" label={t('tutorial.open')} onClick={() => { setMenu(false); tut.show(); }} />
          <MenuItem icon="msg" label={t('menu.tips')} onClick={coach.toggle} hint={coach.on ? t('settings.on') : t('settings.off')} />
          <MenuItem icon="grid" label={t('menu.coords')} onClick={() => setPrefs({ coords: !prefs.coords })} hint={prefs.coords ? t('settings.on') : t('settings.off')} />
          {fsHook.supported && <MenuItem icon="expand" label={fsHook.on ? t('menu.exitFullscreen') : t('menu.fullscreen')} onClick={() => { void fsHook.toggle(); }} />}
          <MenuItem icon="link" label={t('game.exportSgf')} onClick={sgf} />
          {opp && <MenuItem icon="user" label={t('game.opponentProfile')} onClick={() => nav(`/u/${opp.profiles?.username}`)} />}
          {opp && <MenuItem icon="flag" label={t('social.report')} onClick={() => { setMenu(false); setReport(true); }} />}
          <div className="menu-sep" />
          <MenuItem icon="arrow" label={t('menu.leave')} onClick={() => nav('/play')} />
        </MenuSheet>
      )}
      {finished && !dismissed && !menu && (
        <Modal title={myColor ? (winnerColor === null ? t('game.drawResult') : iWon ? t('game.youWon') : t('game.youLost')) : t('game.finished')} onClose={() => setDismissed(true)}>
          <div className="notice"><ResultText text={game.result_text ?? '0'} winner={winnerColor} /></div>
          {finalScore && <ScoreSummary s={finalScore} />}
          {me?.rating_before != null && me.rating_after != null && (
            <div className="row"><Icon name="chart" size={18} /> <strong>{t('game.rating')}: {me.rating_before} → {me.rating_after} ({me.rating_after - me.rating_before >= 0 ? '+' : ''}{me.rating_after - me.rating_before})</strong></div>
          )}
          <div className="row wrap"><Link className="btn primary" to={`/replay/${id}`}>{t('replay.title')}</Link><Link className="btn" to="/play">{t('menu.leave')}</Link><button className="btn" onClick={sgf}>{t('game.exportSgf')}</button></div>
        </Modal>
      )}
      {askResign && <Confirm title={t('game.resignConfirmTitle')} confirmLabel={t('game.resign')} danger onClose={() => setAskResign(false)} onConfirm={() => call('resign_game', { p_game: id })} />}
      {report && opp && <ReportModal userId={opp.user_id} gameId={id} onClose={() => setReport(false)} />}
      {tut.open && <TutorialModal onClose={tut.close} />}
      {talk && <Commentary gameId={id} moveNumber={game.move_count} canPost={signedIn && (!myColor || finished)} onClose={() => setTalk(false)} />}
    </>
  );
}

export function ReportModal({ userId, gameId, messageId, onClose }: { userId: string; gameId?: string; messageId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const { toast, fail } = useToast();
  const [reason, setReason] = useState('cheating');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await rpc('report_user', { p_user: userId, p_reason: reason, p_details: details, p_message: messageId ?? null, p_game: gameId ?? null }); toast(t('social.reported')); onClose(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('social.report')} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={busy} onClick={submit}>{t('social.sendReport')}</button></>}>
      <Field label={t('social.reason')}>
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {['cheating', 'harassment', 'spam', 'inappropriate_name', 'other'].map((r) => <option key={r} value={r}>{t(`report.${r}` as any)}</option>)}
        </select>
      </Field>
      <Field label={t('social.details')}><textarea className="input" maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
    </Modal>
  );
}

function Waiting({ game, onCancel }: { game: GameRow; onCancel: () => void }) {
  const { t } = useI18n();
  const { toast, fail } = useToast();
  const link = `${location.origin}/join/${game.invite_code}`;
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  useEffect(() => { rpc<FriendRow[]>('get_friends').then((f) => setFriends(f.filter((x) => x.status === 'accepted'))).catch(() => {}); }, []);
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast(t('common.copied')); } catch { toast(s); } };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'GO PLAY', text: t('room.shareText'), url: link }); } catch { /* cancelled */ } } else await copy(link);
  };
  const invite = async (f: FriendRow) => {
    try { await rpc('invite_friend_to_game', { p_game: game.id, p_friend: f.user_id }); setInvited((s) => new Set(s).add(f.user_id)); toast(t('room.invited', { name: f.username })); } catch (e) { fail(e); }
  };
  return (
    <div className="stack" style={{ maxWidth: 520, margin: '0 auto' }}>
      <h1>{t('room.waitingTitle')}</h1>
      <div className="card gold stack center">
        <div className="small muted">{t('room.code')}</div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '2.4rem', letterSpacing: '.3em', fontWeight: 700 }}>{game.invite_code}</div>
        <div className="small muted truncate">{link}</div>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => copy(game.invite_code ?? '')}>{t('common.copy')}</button>
          <button className="btn" onClick={() => copy(link)}><Icon name="link" size={18} /> {t('room.copyLink')}</button>
          <button className="btn primary" onClick={share}>{t('common.share')}</button>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}><Spinner label={t('room.waiting')} /></div>
        <div className="small muted">{game.board_size}×{game.board_size} · {t(`rules.${game.rules}` as any)} · {game.time_initial_s ? `${Math.round(game.time_initial_s / 60)}+${game.time_increment_s}` : t('time.untimed')}</div>
      </div>
      {friends.length > 0 && (
        <div className="card stack">
          <h3>{t('room.inviteFriend')}</h3>
          {friends.map((f) => (
            <div key={f.user_id} className="row between">
              <span className="row"><span className={`dot ${f.online ? 'on' : ''}`} /> {f.username}</span>
              <button className="btn small" disabled={invited.has(f.user_id)} onClick={() => invite(f)}>{invited.has(f.user_id) ? t('room.inviteSent') : t('room.invite')}</button>
            </div>
          ))}
        </div>
      )}
      <button className="btn danger" onClick={onCancel}>{t('room.cancel')}</button>
    </div>
  );
}

