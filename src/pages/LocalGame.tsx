import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Board, useMovePicker } from '../components/Board.tsx';
import { ResultText, ScoreSummary } from '../components/GameParts.tsx';
import { ConfirmBar, GameShell, HudPlayer, LeaveButton, MenuItem, MenuSheet, Toolbar } from '../components/GameShell.tsx';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import type { DictKey } from '../i18n/az.ts';
import { Confirm, Field, Modal, Seg } from '../components/ui.tsx';
import { BLACK, GoGame, WHITE, makeConfig, defaultKomi, type BoardSize, type RuleSet, toSGF } from '../engine/index.ts';
import { TutorialModal, useCoach, useImmersive, useTutorial } from '../components/Tutorial.tsx';
import { loadSaved, save, useGoGame } from '../hooks/useGoGame.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n } from '../i18n/index.tsx';
import { useToast } from '../components/ui.tsx';

const KEY = 'goplay.local';

export default function LocalGame() {
  const saved = useMemo(() => loadSaved(KEY), []);
  const [started, setStarted] = useState(!!saved);
  const { game, version, mutate, replace } = useGoGame(() => (saved ? GoGame.fromMoves(saved.config, saved.moves) : new GoGame(makeConfig({ size: 9 }))));

  if (!started) {
    return <Setup onStart={(g) => { replace(g); save(KEY, g); setStarted(true); }} />;
  }
  return (
    <Play
      game={game}
      version={version}
      mutate={mutate}
      onNew={() => { localStorage.removeItem(KEY); setStarted(false); }}
    />
  );
}

function Setup({ onStart }: { onStart: (g: GoGame) => void }) {
  const { t } = useI18n();
  const [size, setSize] = useState<BoardSize>(9);
  const [rules, setRules] = useState<RuleSet>('japanese');
  const [handicap, setHandicap] = useState(0);
  const [komiStr, setKomiStr] = useState<string | null>(null);
  const komi = komiStr === null ? defaultKomi(rules, handicap) : Number(komiStr);
  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>{t('play.local.title')}</h1>
      <p className="muted">{t('play.local.desc')}</p>
      <div className="card stack">
        <Field label={t('setup.boardSize')}><Seg value={size} onChange={setSize} options={[9, 13, 19].map((s) => ({ value: s as BoardSize, label: `${s}×${s}` }))} /></Field>
        <Field label={t('setup.rules')}><Seg value={rules} onChange={(r) => { setRules(r); setKomiStr(null); }} options={[{ value: 'japanese', label: t('rules.japanese') }, { value: 'chinese', label: t('rules.chinese') }]} /></Field>
        <Field label={t('setup.handicap')}>
          <select className="input" value={handicap} onChange={(e) => { setHandicap(Number(e.target.value)); setKomiStr(null); }}>
            <option value={0}>{t('setup.noHandicap')}</option>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </Field>
        <Field label={t('setup.komi')}>
          <input className="input" type="number" step="0.5" min={-50} max={50} value={komi} onChange={(e) => setKomiStr(e.target.value)} />
        </Field>
        <button className="btn primary block" onClick={() => onStart(new GoGame(makeConfig({ size, rules, handicap, komi: Number.isFinite(komi) ? komi : undefined })))}>{t('setup.start')}</button>
      </div>
    </div>
  );
}

export function toggleDeadGroup(game: GoGame, dead: Set<number>, p: number): Set<number> {
  const g = game.groupAt(p);
  if (!g) return dead;
  const next = new Set(dead);
  const allDead = g.stones.every((s) => next.has(s));
  for (const s of g.stones) allDead ? next.delete(s) : next.add(s);
  return next;
}

function Play({ game, version, mutate, onNew }: { game: GoGame; version: number; mutate: <T>(fn: (g: GoGame) => T) => T; onNew: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { prefs, confirm } = usePrefs();
  const [dead, setDead] = useState<Set<number>>(new Set());
  const [askResign, setAskResign] = useState(false);
  const persist = useCallback((g: GoGame) => save(KEY, g), []);
  useImmersive(true);
  const tut = useTutorial(true);

  const onPlay = useCallback(
    (p: number) => {
      const r = mutate((g) => g.play(p));
      if (!r.ok) toast(t(`illegal.${r.reason}` as any), 'error');
      else persist(game);
    },
    [mutate, toast, t, game, persist],
  );
  const canPlay = useCallback((p: number) => game.phase === 'playing' && game.at(p) === 0, [game, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const picker = useMovePicker({ confirm, onPlay, canPlay, onBlocked: (p) => { if (game.phase === 'playing' && game.at(p) !== 0) toast(t('illegal.occupied'), 'error'); } });

  const scoring = game.phase === 'scoring';
  const finished = game.phase === 'finished';
  const score = useMemo(() => (scoring || finished ? game.score(dead) : null), [game, version, dead, scoring, finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = (p: number) => {
    if (scoring) {
      if (game.at(p) !== 0) setDead((d) => toggleDeadGroup(game, d, p));
      return;
    }
    picker.select(p);
  };

  const sgf = () => {
    const blob = new Blob([toSGF(game, { date: new Date().toISOString().slice(0, 10) })], { type: 'application/x-go-sgf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'goplay-game.sgf';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nav = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const fsHook = useFullscreen();
  const coach = useCoach(game, game.toPlay);
  const [menu, setMenu] = useState(false);
  const { set: setPrefs } = usePrefs();
  const turnWhite = game.toPlay === WHITE && game.phase === 'playing';
  const turnBlack = game.toPlay === BLACK && game.phase === 'playing';
  const resultOpen = finished && !dismissed;

  const note = picker.pending !== null && !scoring ? <ConfirmBar onConfirm={picker.commit} onCancel={picker.cancel} />
    : scoring ? <span>{t('game.markDeadHelp')}</span>
    : coach.tips[0] ? <span className={coach.tips[0].tone}>{t(coach.tips[0].key as DictKey, coach.tips[0].params)}</span> : null;

  const toolbar = scoring ? (
    <Toolbar items={[
      { key: 'resume', icon: 'undo', label: t('game.resume'), onClick: () => { mutate((g) => g.resume()); setDead(new Set()); } },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'ok', icon: 'check', label: t('game.confirmScore'), tone: 'gold', onClick: () => { mutate((g) => g.finishByScore(dead)); persist(game); } },
    ]} />
  ) : (
    <Toolbar items={[
      { key: 'undo', icon: 'undo', label: t('game.undo'), disabled: finished || game.moveNumber === 0, onClick: () => { mutate((g) => g.undo()); persist(game); picker.cancel(); } },
      { key: 'pass', icon: 'flag', label: t('game.pass'), disabled: finished, onClick: () => { mutate((g) => g.pass()); persist(game); picker.cancel(); } },
      { key: 'menu', icon: 'cog', label: t('game.menu'), onClick: () => setMenu(true) },
      { key: 'resign', icon: 'x', label: t('game.resign'), tone: 'danger', disabled: finished, onClick: () => setAskResign(true) },
    ]} />
  );

  return (
    <>
      <GameShell
        top={<HudPlayer color={WHITE} name={t('game.white')} captures={game.captures[WHITE]} turn={turnWhite} lead={<LeaveButton />} />}
        bottom={<HudPlayer color={BLACK} name={t('game.black')} captures={game.captures[BLACK]} turn={turnBlack} />}
        note={note}
        toolbar={toolbar}
        board={
          <Board
            size={game.config.size}
            board={game.board}
            lastMove={game.lastMove?.p}
            koPoint={game.koPoint}
            toPlay={game.toPlay}
            pending={picker.pending}
            onSelect={game.phase === 'finished' ? undefined : onSelect}
            coords={prefs.coords}
            territory={score?.territory}
            dead={scoring || finished ? dead : undefined}
          />
        }
      />
      {menu && (
        <MenuSheet title={t('menu.game')} onClose={() => setMenu(false)}>
          <div className="small muted" style={{ padding: '0 12px 8px' }}>{game.config.size}×{game.config.size} · {t(`rules.${game.config.rules}` as any)} · {t('game.komi')} {game.config.komi}{game.config.handicap ? ` · ${t('setup.handicap')} ${game.config.handicap}` : ''} · {t('game.move', { n: game.moveNumber })}</div>
          {score && <div style={{ padding: '0 8px 8px' }}><ScoreSummary s={score} /></div>}
          <MenuItem icon="book" label={t('tutorial.open')} onClick={() => { setMenu(false); tut.show(); }} />
          <MenuItem icon="msg" label={t('menu.tips')} onClick={coach.toggle} hint={coach.on ? t('settings.on') : t('settings.off')} />
          <MenuItem icon="grid" label={t('menu.coords')} onClick={() => setPrefs({ coords: !prefs.coords })} hint={prefs.coords ? t('settings.on') : t('settings.off')} />
          {fsHook.supported && <MenuItem icon="expand" label={fsHook.on ? t('menu.exitFullscreen') : t('menu.fullscreen')} onClick={() => { void fsHook.toggle(); }} />}
          <MenuItem icon="link" label={t('game.exportSgf')} onClick={sgf} />
          <div className="menu-sep" />
          <MenuItem icon="play" label={t('game.newGame')} onClick={() => { setMenu(false); onNew(); }} />
          <MenuItem icon="arrow" label={t('menu.leave')} onClick={() => nav('/play')} />
        </MenuSheet>
      )}
      {resultOpen && game.result && !menu && (
        <Modal title={t('game.finished')} onClose={() => { /* result stays reachable via the menu */ setDismissed(true); }}>
          <div className="notice"><ResultText text={game.result.text} winner={game.result.winner} /></div>
          {score && <ScoreSummary s={score} />}
          <div className="row wrap"><button className="btn primary" onClick={onNew}>{t('game.newGame')}</button><button className="btn" onClick={sgf}>{t('game.exportSgf')}</button></div>
        </Modal>
      )}
      {askResign && (
        <Confirm title={t('game.resignConfirmTitle')} confirmLabel={t('game.resign')} danger onClose={() => setAskResign(false)} onConfirm={() => { mutate((g) => g.resign(g.toPlay)); persist(game); }} />
      )}
      {tut.open && <TutorialModal onClose={tut.close} />}
    </>
  );
}
