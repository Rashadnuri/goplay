import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, useMovePicker, type Hint } from '../components/Board.tsx';
import { ResultText, ScoreSummary } from '../components/GameParts.tsx';
import { ConfirmBar, GameShell, HudPlayer, LeaveButton, MenuItem, MenuSheet, Toolbar } from '../components/GameShell.tsx';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import type { DictKey } from '../i18n/az.ts';
import { ReviewPanel } from '../components/Review.tsx';
import { Confirm, Field, Modal, Seg, Spinner, useToast } from '../components/ui.tsx';
import { BLACK, WHITE, GoGame, PASS, defaultKomi, makeConfig, other, type BoardSize, type Color, type RuleSet } from '../engine/index.ts';
import { TutorialModal, useCoach, useImmersive, useTutorial } from '../components/Tutorial.tsx';
import { loadSaved, save, useGoGame } from '../hooks/useGoGame.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n } from '../i18n/index.tsx';
import { DIFFICULTIES, aiAnalyze, aiConfigured, aiHealth, aiMove, aiReview, type AiAnalysis, type AiPosition, type AiReview, type Difficulty } from '../lib/ai.ts';
import { toggleDeadGroup } from './LocalGame.tsx';

const KEY = 'goplay.ai';
const posOf = (g: GoGame): AiPosition => ({ size: g.config.size, komi: g.config.komi, rules: g.config.rules, handicap: g.config.handicap, moves: g.history.map((m) => m.p) });

export default function AIGame() {
  const saved = useMemo(() => loadSaved(KEY), []);
  const extra = saved?.extra as { difficulty?: Difficulty; human?: Color } | undefined;
  const [session, setSession] = useState<{ difficulty: Difficulty; human: Color } | null>(saved && extra?.difficulty && extra.human ? { difficulty: extra.difficulty, human: extra.human } : null);
  const { game, version, mutate, replace } = useGoGame(() => (saved ? GoGame.fromMoves(saved.config, saved.moves) : new GoGame(makeConfig({ size: 9 }))));

  if (!session) {
    return <Setup onStart={(g, difficulty, human) => { replace(g); setSession({ difficulty, human }); save(KEY, g, { difficulty, human }); }} />;
  }
  return <Play game={game} version={version} mutate={mutate} session={session} onNew={() => { localStorage.removeItem(KEY); setSession(null); }} />;
}

function Setup({ onStart }: { onStart: (g: GoGame, d: Difficulty, human: Color) => void }) {
  const { t } = useI18n();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof aiHealth>> | null>(null);
  const [size, setSize] = useState<BoardSize>(9);
  const [rules, setRules] = useState<RuleSet>('japanese');
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [color, setColor] = useState<'black' | 'white' | 'random'>('black');
  const [handicap, setHandicap] = useState(0);
  useEffect(() => { aiHealth().then(setHealth); }, []);

  const start = () => {
    const human: Color = color === 'random' ? (Math.random() < 0.5 ? BLACK : WHITE) : color === 'black' ? BLACK : WHITE;
    onStart(new GoGame(makeConfig({ size, rules, handicap, komi: defaultKomi(rules, handicap) })), difficulty, human);
  };

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('play.ai.title')}</h1>
      <p className="muted">{t('play.ai.desc')}</p>
      {health && !health.ok && (
        <div className="notice error stack" role="alert">
          <strong>{t('ai.unavailableTitle')}</strong>
          <span>{t(health.reason === 'not_configured' ? 'ai.notConfigured' : health.reason === 'no_engine' ? 'ai.noEngine' : 'ai.down')}</span>
        </div>
      )}
      <div className="card stack">
        <Field label={t('setup.difficulty')}>
          <Seg value={difficulty} onChange={setDifficulty} options={DIFFICULTIES.map((d) => ({ value: d, label: t(`difficulty.${d}` as any) }))} />
        </Field>
        <Field label={t('setup.boardSize')}><Seg value={size} onChange={setSize} options={[9, 13, 19].map((s) => ({ value: s as BoardSize, label: `${s}×${s}` }))} /></Field>
        <Field label={t('setup.yourColor')}>
          <Seg value={color} onChange={setColor} options={[{ value: 'black', label: t('game.black') }, { value: 'white', label: t('game.white') }, { value: 'random', label: t('setup.random') }]} />
        </Field>
        <Field label={t('setup.rules')}><Seg value={rules} onChange={setRules} options={[{ value: 'japanese', label: t('rules.japanese') }, { value: 'chinese', label: t('rules.chinese') }]} /></Field>
        <Field label={t('setup.handicap')}>
          <select className="input" value={handicap} onChange={(e) => setHandicap(Number(e.target.value))}>
            <option value={0}>{t('setup.noHandicap')}</option>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <button className="btn primary block" disabled={!health?.ok} onClick={start}>{health ? t('setup.start') : <Spinner />}</button>
        {!aiConfigured && <p className="small muted" style={{ margin: 0 }}>{t('ai.setupHint')}</p>}
      </div>
    </div>
  );
}

function Play({ game, version, mutate, session, onNew }: { game: GoGame; version: number; mutate: <T>(fn: (g: GoGame) => T) => T; session: { difficulty: Difficulty; human: Color }; onNew: () => void }) {
  const { t } = useI18n();
  const { toast, fail } = useToast();
  const { prefs, confirm } = usePrefs();
  const aiColor = other(session.human);
  const [thinking, setThinking] = useState(false);
  const [dead, setDead] = useState<Set<number>>(new Set());
  const [hints, setHints] = useState<Hint[] | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [showOwn, setShowOwn] = useState(false);
  const [review, setReview] = useState<AiReview | null>(null);
  const [busy, setBusy] = useState<'hint' | 'analysis' | 'review' | 'dead' | null>(null);
  const [askResign, setAskResign] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const token = useRef(0);

  const persist = useCallback(() => save(KEY, game, session), [game, session]);
  useImmersive(true);
  const tut = useTutorial(true);

  // ── AI's turn ──
  useEffect(() => {
    if (game.phase !== 'playing' || game.toPlay !== aiColor || thinking || error) return;
    const my = ++token.current;
    const movesAtStart = game.moveNumber;
    setThinking(true);
    setHints(null);
    aiMove(posOf(game), session.difficulty)
      .then((r) => {
        if (token.current !== my || game.moveNumber !== movesAtStart) return; // position changed (undo/new game)
        if (r.resign) {
          mutate((g) => g.resign(aiColor));
        } else if (r.move.type === 'pass') {
          mutate((g) => g.pass());
        } else {
          const res = mutate((g) => g.play((r.move as { p: number }).p));
          if (!res.ok) { setError(new Error('err:ai_error')); return; }
        }
        persist();
      })
      .catch((e) => { if (token.current === my) setError(e); })
      .finally(() => { if (token.current === my) setThinking(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, game.phase, error]);

  const onPlay = useCallback(
    (p: number) => {
      if (game.toPlay !== session.human || thinking) return;
      const r = mutate((g) => g.play(p));
      if (!r.ok) toast(t(`illegal.${r.reason}` as any), 'error');
      else { persist(); setHints(null); setAnalysis(null); }
    },
    [game, session.human, thinking, mutate, toast, t, persist],
  );
  const canPlay = useCallback((p: number) => game.phase === 'playing' && game.toPlay === session.human && !thinking && game.at(p) === 0, [game, session.human, thinking, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const picker = useMovePicker({ confirm, onPlay, canPlay, onBlocked: (p) => { if (game.phase === 'playing' && game.toPlay === session.human && !thinking && game.at(p) !== 0) toast(t('illegal.occupied'), 'error'); } });

  const scoring = game.phase === 'scoring';
  const finished = game.phase === 'finished';
  const score = useMemo(() => (scoring || finished ? game.score(dead) : null), [game, version, dead, scoring, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── scoring: let KataGo propose which stones are dead ──
  useEffect(() => {
    if (!scoring) return;
    setBusy('dead');
    aiAnalyze(posOf(game), 300)
      .then((a) => {
        const d = new Set<number>();
        a.ownership?.forEach((v, p) => {
          const c = game.at(p);
          if (c === BLACK && v < -0.6) d.add(p);
          if (c === WHITE && v > 0.6) d.add(p);
        });
        setDead(d);
      })
      .catch(() => { /* manual marking still works */ })
      .finally(() => setBusy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring]);

  const runHint = async () => {
    setBusy('hint');
    try {
      const a = await aiAnalyze(posOf(game), 250);
      const mine = (w: number) => (game.toPlay === BLACK ? w : 1 - w);
      setHints(a.candidates.filter((c) => c.p !== PASS).slice(0, 3).map((c, i) => ({ p: c.p, label: `${Math.round(mine(c.winrate) * 100)}`, strong: i === 0 })));
      setAnalysis(a);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const runAnalysis = async () => {
    setBusy('analysis');
    try { setAnalysis(await aiAnalyze(posOf(game), 300)); setShowOwn(true); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  const runReview = async () => {
    setBusy('review');
    try { setReview(await aiReview(posOf(game))); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const undo = () => {
    token.current++;
    mutate((g) => {
      // take back to the human's previous turn
      do { g.undo(); } while (g.moveNumber > 0 && g.toPlay !== session.human);
    });
    setThinking(false); setHints(null); setAnalysis(null); picker.cancel(); persist();
  };

  const onSelect = (p: number) => {
    if (scoring) { if (game.at(p) !== 0) setDead((d) => toggleDeadGroup(game, d, p)); return; }
    picker.select(p);
  };

  const humanTurn = game.phase === 'playing' && game.toPlay === session.human && !thinking;
  const wr = analysis ? analysis.winrate : null;
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const fsHook = useFullscreen();
  const coach = useCoach(game, session.human);
  const { set: setPrefs } = usePrefs();
  const lvl = t(`difficulty.${session.difficulty}` as any);

  const note = error != null ? (
    <span className="row"><span className="warn">{t('ai.errorMid')}</span><button className="btn small" onClick={() => setError(null)}>{t('common.retry')}</button></span>
  ) : picker.pending !== null && !scoring ? <ConfirmBar onConfirm={picker.commit} onCancel={picker.cancel} />
    : thinking ? <span className="row"><span className="spinner" /> {t('ai.thinking')}</span>
    : scoring ? <span>{busy === 'dead' ? t('ai.proposingDead') : t('game.markDeadHelp')}</span>
    : coach.tips[0] ? <span className={coach.tips[0].tone}>{t(coach.tips[0].key as DictKey, coach.tips[0].params)}</span> : null;

  const toolbar = scoring ? (
    <Toolbar items={[
      { key: 'resume', icon: 'undo', label: t('game.resume'), onClick: () => { mutate((g) => g.resume()); setDead(new Set()); persist(); } },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'ok', icon: 'check', label: t('game.confirmScore'), tone: 'gold', disabled: busy === 'dead', onClick: () => { mutate((g) => g.finishByScore(dead)); persist(); } },
    ]} />
  ) : (
    <Toolbar items={[
      { key: 'undo', icon: 'undo', label: t('game.undo'), disabled: finished || thinking || game.moveNumber === 0, onClick: undo },
      { key: 'pass', icon: 'flag', label: t('game.pass'), disabled: !humanTurn, onClick: () => { mutate((g) => g.pass()); persist(); picker.cancel(); } },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'resign', icon: 'x', label: t('game.resign'), tone: 'danger', disabled: finished, onClick: () => setAskResign(true) },
    ]} />
  );

  return (
    <>
      <GameShell
        top={<HudPlayer color={aiColor} name={`KataGo · ${lvl}`} captures={game.captures[aiColor]} turn={game.toPlay === aiColor && game.phase === 'playing'} lead={<LeaveButton />} />}
        bottom={<HudPlayer color={session.human} name={t('game.you')} captures={game.captures[session.human]} turn={humanTurn} />}
        note={note}
        toolbar={toolbar}
        board={
          <Board
            size={game.config.size}
            board={game.board}
            lastMove={game.lastMove?.p}
            koPoint={game.koPoint}
            toPlay={session.human}
            pending={picker.pending}
            onSelect={finished ? undefined : onSelect}
            coords={prefs.coords}
            hints={hints ?? undefined}
            ownership={showOwn && analysis?.ownership ? analysis.ownership : undefined}
            territory={score?.territory}
            dead={scoring || finished ? dead : undefined}
            disabled={thinking}
          />
        }
      />
      {menu && (
        <MenuSheet title={t('menu.game')} onClose={() => setMenu(false)}>
          <div className="small muted" style={{ padding: '0 12px 8px' }}>{game.config.size}×{game.config.size} · {t(`rules.${game.config.rules}` as any)} · {t('game.komi')} {game.config.komi} · {t('game.move', { n: game.moveNumber })}</div>
          {!finished && (
            <>
              <MenuItem icon="bot" label={busy === 'hint' ? t('common.loading') : t('ai.hint')} onClick={() => { setMenu(false); void runHint(); }} />
              <MenuItem icon="chart" label={busy === 'analysis' ? t('common.loading') : t('ai.analyze')} onClick={() => { void runAnalysis(); }} />
            </>
          )}
          {wr !== null && analysis && (
            <div className="stack" style={{ gap: 6, padding: '6px 12px 10px' }}>
              <div className="winbar" aria-label={t('ai.winrate')}><div style={{ width: `${(1 - wr) * 100}%` }} /></div>
              <div className="row between small"><span>{t('game.black')} {(wr * 100).toFixed(0)}%</span><span>{t('ai.scoreLead')}: {analysis.scoreLead >= 0 ? 'B' : 'W'}+{Math.abs(analysis.scoreLead).toFixed(1)}</span><span>{t('game.white')} {((1 - wr) * 100).toFixed(0)}%</span></div>
              {analysis.ownership && <label className="row small"><input type="checkbox" checked={showOwn} onChange={(e) => setShowOwn(e.target.checked)} /> {t('ai.showOwnership')}</label>}
            </div>
          )}
          {score && <div style={{ padding: '0 8px 8px' }}><ScoreSummary s={score} /></div>}
          <div className="menu-sep" />
          <MenuItem icon="book" label={t('tutorial.open')} onClick={() => { setMenu(false); tut.show(); }} />
          <MenuItem icon="msg" label={t('menu.tips')} onClick={coach.toggle} hint={coach.on ? t('settings.on') : t('settings.off')} />
          <MenuItem icon="grid" label={t('menu.coords')} onClick={() => setPrefs({ coords: !prefs.coords })} hint={prefs.coords ? t('settings.on') : t('settings.off')} />
          {fsHook.supported && <MenuItem icon="expand" label={fsHook.on ? t('menu.exitFullscreen') : t('menu.fullscreen')} onClick={() => { void fsHook.toggle(); }} />}
          <div className="menu-sep" />
          <MenuItem icon="play" label={t('game.newGame')} onClick={() => { setMenu(false); onNew(); }} />
          <MenuItem icon="arrow" label={t('menu.leave')} onClick={() => nav('/play')} />
        </MenuSheet>
      )}
      {finished && !dismissed && !menu && !showReview && game.result && (
        <Modal title={t('game.finished')} onClose={() => setDismissed(true)}>
          <div className="notice"><ResultText text={game.result.text} winner={game.result.winner} /></div>
          {score && <ScoreSummary s={score} />}
          <div className="row wrap">
            <button className="btn primary" disabled={busy !== null} onClick={async () => { if (!review) await runReview(); setShowReview(true); }}>{busy === 'review' ? <Spinner label={t('review.running')} /> : t('review.start')}</button>
            <button className="btn" onClick={onNew}>{t('game.newGame')}</button>
          </div>
        </Modal>
      )}
      {showReview && review && (
        <Modal title={t('review.title')} onClose={() => setShowReview(false)}>
          <ReviewPanel config={game.config} moves={game.history.map((m) => m.p)} review={review} />
        </Modal>
      )}
      {askResign && <Confirm title={t('game.resignConfirmTitle')} confirmLabel={t('game.resign')} danger onClose={() => setAskResign(false)} onConfirm={() => { token.current++; mutate((g) => g.resign(session.human)); persist(); }} />}
      {tut.open && <TutorialModal onClose={tut.close} />}
    </>
  );
}
