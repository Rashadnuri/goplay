import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExerciseView } from './Exercise.tsx';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { useFullscreen } from '../hooks/useFullscreen.ts';
import { useEffect } from 'react';
import { useLessons } from '../lib/learn.ts';
import { coachTips } from '../lib/coach.ts';
import type { Color, GoGame } from '../engine/index.ts';
import { Icon } from './Icon.tsx';

/** Hides site navigation so the board gets the whole screen. */
export function useImmersive(active: boolean) {
  useEffect(() => {
    document.body.classList.toggle('immersive', active);
    return () => document.body.classList.remove('immersive');
  }, [active]);
}

export function ImmersiveBar({ onTutorial, back = '/play' }: { onTutorial: () => void; back?: string }) {
  const { t } = useI18n();
  const fs = useFullscreen();
  return (
    <div className="immersive-bar">
      <Link to={back} className="icon-btn" aria-label={t('common.back')}>←</Link>
      <strong style={{ fontFamily: 'var(--font-serif)', letterSpacing: '.18em' }}>GO PLAY</strong>
      <span className="row">
        <button className="btn small" onClick={onTutorial} aria-label={t('tutorial.open')}>?<span className="hide-xs"> {t('tutorial.open')}</span></button>
        {fs.supported && <button className="icon-btn" onClick={fs.toggle} aria-label="Fullscreen"><Icon name="expand" size={20} /></button>}
      </span>
    </div>
  );
}

export function useCoach(game: GoGame | null, me: Color | null) {
  const [on, setOn] = useState(() => localStorage.getItem('goplay.coach') !== 'off');
  const toggle = () => { const n = !on; setOn(n); try { localStorage.setItem('goplay.coach', n ? 'on' : 'off'); } catch { /* ignore */ } };
  return { on, toggle, tips: on && game ? coachTips(game, me) : [] };
}

export function Coach({ game, me }: { game: GoGame; me: Color | null }) {
  const { t } = useI18n();
  const [on, setOn] = useState(() => localStorage.getItem('goplay.coach') !== 'off');
  const tips = on ? coachTips(game, me) : [];
  return (
    <div className="coach" aria-live="polite">
      {tips.map((tip) => <div key={tip.key} className={`coach-tip ${tip.tone}`}>{t(tip.key as DictKey, tip.params)}</div>)}
      <button className="coach-toggle" onClick={() => { setOn(!on); try { localStorage.setItem('goplay.coach', on ? 'off' : 'on'); } catch { /* ignore */ } }}>
        {on ? t('coach.hide') : t('coach.show')}
      </button>
    </div>
  );
}

/** Step-by-step interactive course (the same lessons as the Learn section) available during a game. */
export function TutorialModal({ onClose }: { onClose: () => void }) {
  const { t, loc } = useI18n();
  const { lessons } = useLessons();
  const steps = lessons.flatMap((l) => l.steps.map((s, i) => ({ lesson: l, step: s, i })));
  const [n, setN] = useState(0);
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const cur = steps[n];
  useEffect(() => { try { localStorage.setItem('goplay.tutorialSeen', '1'); } catch { /* ignore */ } }, []);
  if (!cur) return null;
  const canNext = !cur.step.exercise || solved.has(n);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal tutorial" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('tutorial.title')}>
        <div className="row between"><span className="chip gold">{t('tutorial.title')}</span><span className="small muted">{n + 1}/{steps.length}</span></div>
        <div className="progress" style={{ margin: '10px 0' }}><div style={{ width: `${((n + 1) / steps.length) * 100}%` }} /></div>
        <h2>{loc(cur.lesson.title)}</h2>
        <p>{loc(cur.step.text)}</p>
        {cur.step.exercise && <ExerciseView key={n} exercise={cur.step.exercise} onSolved={() => setSolved((s) => new Set(s).add(n))} />}
        <div className="row between" style={{ marginTop: 16 }}>
          <button className="btn" disabled={n === 0} onClick={() => setN(n - 1)}>{t('common.back')}</button>
          <button className="btn ghost" onClick={onClose}>{t('tutorial.skip')}</button>
          {n < steps.length - 1 ? <button className="btn primary" disabled={!canNext} onClick={() => setN(n + 1)}>{t('common.next')}</button> : <button className="btn gold" onClick={onClose}>{t('tutorial.start')}</button>}
        </div>
      </div>
    </div>
  );
}

export function useTutorial(autoOpen: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (autoOpen && localStorage.getItem('goplay.tutorialSeen') !== '1') setOpen(true); }, [autoOpen]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}
