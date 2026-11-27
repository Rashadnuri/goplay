import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExerciseView } from '../components/Exercise.tsx';
import { Loading } from '../components/ui.tsx';
import { useI18n } from '../i18n/index.tsx';
import { useLessons, useProgress } from '../lib/learn.ts';
import NotFound from './NotFound.tsx';

export default function LessonPage() {
  const { slug } = useParams();
  const { t, loc } = useI18n();
  const { lessons } = useLessons();
  const progress = useProgress();
  const [step, setStep] = useState(0);
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const lesson = lessons.find((l) => l.slug === slug);
  if (!lessons.length) return <Loading />;
  if (!lesson) return <NotFound />;
  const s = lesson.steps[step];
  const last = step === lesson.steps.length - 1;
  const canAdvance = !s.exercise || solved.has(step) || progress.stepsDone(lesson.slug).includes(step);
  const idx = lessons.findIndex((l) => l.slug === lesson.slug);
  const next = lessons[idx + 1];

  const onSolved = () => { setSolved((x) => new Set(x).add(step)); void progress.markStep(lesson.slug, step); };
  const advance = async () => {
    if (!s.exercise) void progress.markStep(lesson.slug, step);
    if (last) { await progress.complete(lesson.slug); setStep(lesson.steps.length); } else setStep(step + 1);
  };

  if (step >= lesson.steps.length) {
    return (
      <div className="stack center" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="card gold stack">
          <h1>🎉 {t('learn.lessonDone')}</h1>
          <p className="muted">{loc(lesson.title)}</p>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            {next && <Link className="btn primary" to={`/learn/${next.slug}`} onClick={() => setStep(0)}>{t('learn.nextLesson')}</Link>}
            <Link className="btn" to="/learn">{t('learn.allLessons')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="row between"><Link to="/learn" className="small muted">← {t('nav.learn')}</Link><span className="chip">{step + 1}/{lesson.steps.length}</span></div>
      <h1>{loc(lesson.title)}</h1>
      <div className="progress"><div style={{ width: `${((step + (canAdvance ? 1 : 0)) / lesson.steps.length) * 100}%` }} /></div>
      <p style={{ fontSize: '1.05rem' }}>{loc(s.text)}</p>
      {s.exercise && <ExerciseView key={`${lesson.slug}-${step}`} exercise={s.exercise} onSolved={onSolved} />}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('common.back')}</button>
        <button className="btn primary" disabled={!canAdvance} onClick={advance}>{last ? t('learn.finish') : t('common.next')}</button>
      </div>
    </div>
  );
}
