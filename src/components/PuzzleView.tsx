import { useCallback, useMemo, useState } from 'react';
import { Board, useMovePicker } from './Board.tsx';
import { Spinner, useToast } from './ui.tsx';
import { GoGame, makeConfig } from '../engine/index.ts';
import type { BankPuzzle } from '../content/bank.ts';
import { useAuth } from '../hooks/useAuth.tsx';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { revealPuzzle, solvePuzzle } from '../lib/puzzles.ts';

/** One interactive puzzle: move validation (server for members), explanation after solving, optional reveal. */
export function PuzzleView({ puzzle, onSolved }: { puzzle: BankPuzzle; onSolved?: (firstSolve: boolean) => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast, fail } = useToast();
  const { prefs, confirm } = usePrefs();
  const [game, setGame] = useState(() => GoGame.fromPosition(makeConfig({ size: puzzle.size }), puzzle.rows, puzzle.toPlay));
  const [state, setState] = useState<'idle' | 'wrong' | 'solved' | 'revealed'>('idle');
  const [attempts, setAttempts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<number[]>([]);
  const [hint, setHint] = useState(false);
  const [, force] = useState(0);

  const reset = () => { setGame(GoGame.fromPosition(makeConfig({ size: puzzle.size }), puzzle.rows, puzzle.toPlay)); setState('idle'); setShown([]); setHint(false); };
  const who = puzzle.toPlay === 1 ? t('game.black') : t('game.white');
  const lifeRole = puzzle.toPlay === 1 ? 'live' : 'kill';
  const promptKey = (puzzle.kind === 'lifeDeath' ? `puzzle.prompt.ld_${lifeRole}` : `puzzle.prompt.${puzzle.kind}`) as DictKey;
  const explainKey = (puzzle.kind === 'lifeDeath' ? `puzzle.explain.ld_${lifeRole}` : `puzzle.explain.${puzzle.kind}`) as DictKey;
  const shapeName = puzzle.shape ? t(`puzzle.shape.${puzzle.shape}` as DictKey) : '';

  const onPlay = useCallback(async (p: number) => {
    if (state === 'solved' || state === 'revealed' || busy) return;
    const pre = game.checkMove(p);
    if (!pre.ok) return toast(t(`illegal.${pre.reason}` as DictKey), 'error');
    setBusy(true);
    try {
      const r = await solvePuzzle(puzzle, p, !!user);
      if (r.correct) { game.play(p); setState('solved'); force((x) => x + 1); onSolved?.(r.firstSolve); }
      else { setState('wrong'); setAttempts((a) => a + 1); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [state, busy, game, puzzle, user, toast, fail, t, onSolved]);
  const canPlay = useCallback((p: number) => state !== 'solved' && state !== 'revealed' && !busy && game.at(p) === 0, [state, busy, game]);
  const picker = useMovePicker({ confirm, onPlay, canPlay });

  const reveal = async () => {
    setBusy(true);
    try { setShown(await revealPuzzle(puzzle, !!user)); setState('revealed'); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const marks = useMemo(() => shown, [shown]);

  return (
    <div className="stack">
      <div className="card row between wrap">
        <strong>{t(promptKey, { who })}</strong>
        <span className="chip">{t(`puzzle.level.${puzzle.difficulty}` as DictKey)}</span>
      </div>
      <div className="board-wrap" style={{ maxWidth: 'min(100%, 520px)' }}>
        <Board size={puzzle.size} board={game.board} toPlay={game.toPlay} lastMove={game.lastMove?.p} pending={picker.pending} marks={marks} onSelect={state === 'solved' || state === 'revealed' ? undefined : picker.select} coords={prefs.coords} disabled={busy} ariaLabel={t(promptKey, { who })} />
      </div>
      {picker.pending !== null && state === 'idle' && (
        <div className="row"><button className="btn primary grow" onClick={picker.commit} disabled={busy}>{busy ? <Spinner /> : t('game.confirmMove')}</button><button className="btn" onClick={picker.cancel}>{t('common.cancel')}</button></div>
      )}
      {state === 'wrong' && <div className="notice error" role="status">{t('puzzle.wrong')} {attempts >= 2 && <button className="btn small" onClick={() => setHint(true)}>{t('learn.hint')}</button>}</div>}
      {hint && state !== 'solved' && <div className="notice small">💡 {t(`puzzle.hint.${puzzle.kind}` as DictKey)}</div>}
      {state === 'solved' && (
        <div className="card stack" role="status">
          <strong>✓ {t('puzzle.correct')}</strong>
          <p style={{ margin: 0 }}>{t(explainKey, { shape: shapeName })}</p>
          <span className="chip">{t('puzzle.proven')}</span>
        </div>
      )}
      {state === 'revealed' && (
        <div className="card stack" role="status">
          <strong>{t('puzzle.solutionShown')}</strong>
          <p style={{ margin: 0 }}>{t(explainKey, { shape: shapeName })}</p>
        </div>
      )}
      <div className="row wrap">
        {state !== 'solved' && state !== 'revealed' && <button className="btn" onClick={reveal} disabled={busy}>{t('puzzle.showSolution')}</button>}
        {(state === 'wrong' || state === 'revealed') && <button className="btn" onClick={reset}>{t('learn.reset')}</button>}
      </div>
    </div>
  );
}
