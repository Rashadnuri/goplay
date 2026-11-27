import { useMemo, useState } from 'react';
import { EMPTY } from '../engine/index.ts';
import { Board } from './Board.tsx';
import { BLACK, GoGame, makeConfig } from '../engine/index.ts';
import { useI18n } from '../i18n/index.tsx';
import type { Exercise } from '../lib/types.ts';
import { usePrefs } from '../hooks/usePrefs.ts';

/** Interactive learning exercise. Move checking uses the real rules engine. */
export function ExerciseView({ exercise, onSolved }: { exercise: Exercise; onSolved: () => void }) {
  const { t, loc } = useI18n();
  const { prefs } = usePrefs();
  const initial = useMemo(() => GoGame.fromPosition(makeConfig({ size: exercise.size }), exercise.rows, exercise.toPlay ?? BLACK), [exercise]);
  const [game, setGame] = useState(initial);
  const [state, setState] = useState<'idle' | 'wrong' | 'solved'>('idle');
  const [picked, setPicked] = useState<number | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [, force] = useState(0);
  const goal = exercise.goal;

  const reset = () => { setGame(GoGame.fromPosition(makeConfig({ size: exercise.size }), exercise.rows, exercise.toPlay ?? BLACK)); setState('idle'); setPicked(null); };

  const solve = () => { setState('solved'); onSolved(); };
  const onSelect = (p: number) => {
    if (state === 'solved' || goal.type === 'quiz') return;
    if (goal.type === 'place') {
      if (!goal.points.includes(p) || game.board[p] !== EMPTY) return setState('wrong');
      game.board[p] = 1; setState('idle'); force((x) => x + 1);
      if (goal.points.every((q) => game.board[q] === 1)) solve();
      return;
    }
    const pre = game.checkMove(p);
    if (!pre.ok) return setState('wrong');
    if (goal.type === 'any') { game.play(p); force((x) => x + 1); return solve(); }
    if (goal.type === 'point') {
      if (goal.points.includes(p)) { game.play(p); force((x) => x + 1); return solve(); }
      return setState('wrong');
    }
    if (goal.type === 'capture') {
      if (pre.record.captured.length >= (goal.min ?? 1)) { game.play(p); force((x) => x + 1); return solve(); }
      return setState('wrong');
    }
  };

  return (
    <div className="stack">
      <div className="board-wrap" style={{ maxWidth: 'min(100%, 460px)' }}>
        <Board
          size={exercise.size}
          board={game.board}
          toPlay={game.toPlay}
          lastMove={game.lastMove?.p}
          marks={exercise.marks}
          onSelect={goal.type === 'quiz' || state === 'solved' ? undefined : onSelect}
          coords={prefs.coords}
        />
      </div>
      {goal.type === 'quiz' && (
        <div className="stack">
          <strong>{loc(goal.question)}</strong>
          <div className="grid two">
            {goal.options.map((o, i) => (
              <button key={i} className={`btn${picked === i ? (i === goal.correct ? ' primary' : ' danger') : ''}`} disabled={state === 'solved'} onClick={() => { setPicked(i); if (i === goal.correct) solve(); else setState('wrong'); }}>
                {loc(o)}
              </button>
            ))}
          </div>
        </div>
      )}
      {state === 'solved' && <div className="notice" role="status">✓ {exercise.success ? loc(exercise.success) : t('learn.correct')}</div>}
      {state === 'wrong' && <div className="notice error" role="status">{t('learn.tryAgain')}</div>}
      <div className="row wrap">
        {exercise.hint && state !== 'solved' && <button className="btn small" onClick={() => setShowHint(true)}>{t('learn.hint')}</button>}
        {goal.type !== 'quiz' && (state !== 'idle') && <button className="btn small" onClick={reset}>{t('learn.reset')}</button>}
      </div>
      {showHint && exercise.hint && state !== 'solved' && <div className="small muted">💡 {loc(exercise.hint)}</div>}
    </div>
  );
}
