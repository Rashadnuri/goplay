import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { BANK } from '../content/bank.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { useDailySet, useLessons, usePuzzleProgress, useProgress } from '../lib/learn.ts';
import type { Lesson } from '../lib/types.ts';

const ICON: Record<string, string> = { intro: 'book', 'board-stones': 'grid', liberties: 'target', capturing: 'target', groups: 'stones', ko: 'flag', territory: 'mountain', 'life-death': 'crown', opening: 'play', tactics: 'bot', 'open-principles': 'mountain', 'open-corner-points': 'grid', 'open-sanrensei': 'stones', 'open-tengen': 'target', 'open-handicap': 'stones' };
type Tab = 'lessons' | 'openings' | 'joseki' | 'lifedeath' | 'tactics';
const TABS: Tab[] = ['lessons', 'openings', 'joseki', 'lifedeath', 'tactics'];

/** Go Academy: one hub, five tracks, one progress model (lessons from the lessons table, puzzles from puzzle_solves). */
export default function Learn() {
  const { t, loc } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'lessons') as Tab;
  const { lessons } = useLessons();
  const progress = useProgress();
  const { solved } = usePuzzleProgress();
  const { streak } = useDailySet();

  const basics = lessons.filter((l) => (l.track ?? 'basics') === 'basics');
  const openings = lessons.filter((l) => l.track === 'openings');
  const tactics = BANK.filter((p) => p.kind !== 'lifeDeath');
  const ld = BANK.filter((p) => p.kind === 'lifeDeath');
  const lessonsDone = lessons.filter((l) => progress.isDone(l.slug)).length;
  const done = lessonsDone + solved.size;
  const total = lessons.length + BANK.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const LessonGrid = ({ list }: { list: Lesson[] }) => (
    <div className="topic-grid">
      {list.map((l) => (
        <Link key={l.slug} to={`/learn/${l.slug}`} className={`topic${progress.isDone(l.slug) ? ' done' : ''}`}>
          <Icon name={ICON[l.slug] ?? 'book'} size={30} /><span>{loc(l.title)}</span>
        </Link>
      ))}
    </div>
  );
  const PuzzleGrid = ({ list }: { list: typeof BANK }) => (
    <div className="topic-grid">
      {list.map((p, i) => (
        <Link key={p.id} to={`/puzzles/${p.id}`} className={`topic${solved.has(p.id) ? ' done' : ''}`}>
          <Icon name={p.kind === 'lifeDeath' ? 'crown' : 'target'} size={28} />
          <span>{t(`puzzle.kind.${p.kind}` as DictKey)}{p.shape ? ` · ${t(`puzzle.shape.${p.shape}` as DictKey)}` : ''} <span className="muted">({t(`puzzle.level.${p.difficulty}` as DictKey)})</span></span>
          <span className="sr-only">{i + 1}</span>
        </Link>
      ))}
    </div>
  );
  const next = basics.find((l) => !progress.isDone(l.slug)) ?? basics[0];

  return (
    <div className="stack">
      <h1>{t('academy.title')}</h1>
      <div className="card stack">
        <div className="row between"><strong>{t('learn.progress')}</strong><span className="small muted">{t('academy.progressDetail', { lessons: lessonsDone, puzzles: solved.size })}</span></div>
        <div className="progress" role="progressbar" aria-label={t('learn.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><div style={{ width: `${pct}%` }} /></div>
      </div>

      <Link to="/puzzles" className="card row" style={{ textDecoration: 'none' }}>
        <span className="avatar" style={{ background: 'var(--surface-2)' }}>🔥</span>
        <div className="grow"><strong>{t('puzzle.title')}</strong><div className="small muted">{t('puzzle.streak')}: {streak.current}</div></div>
        <span className="btn small primary">{t('puzzle.solve')}</span>
      </Link>

      <div className="tabs" role="tablist" aria-label={t('academy.title')}>
        {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setParams({ tab: x })}>{t(`academy.tab.${x}` as DictKey)}</button>)}
      </div>

      {tab === 'lessons' && (
        <>
          {next && (
            <section className="lesson-hero">
              <h2>{loc(next.title)}</h2><p>{loc(next.summary)}</p>
              <div className="progress" style={{ margin: '8px 0 6px' }}><div style={{ width: `${basics.length ? (basics.filter((l) => progress.isDone(l.slug)).length / basics.length) * 100 : 0}%` }} /></div>
              <div className="small" style={{ marginBottom: 12 }}>{t('learn.lessonsDone', { done: basics.filter((l) => progress.isDone(l.slug)).length, total: basics.length })}</div>
              <Link className="btn primary" to={`/learn/${next.slug}`}>{t('learn.startLesson')} <Icon name="arrow" size={18} /></Link>
            </section>
          )}
          <LessonGrid list={basics} />
        </>
      )}
      {tab === 'openings' && (<><p className="muted">{t('academy.openingsIntro')}</p><LessonGrid list={openings} /></>)}
      {tab === 'joseki' && (
        <div className="card stack">
          <h2>{t('joseki.title')}</h2>
          <p style={{ margin: 0 }}>{t('joseki.intro')}</p>
          <div className="notice small">{t('joseki.honest')}</div>
          <Link className="btn primary" to="/academy/joseki">{t('joseki.start')} <Icon name="arrow" size={18} /></Link>
        </div>
      )}
      {tab === 'lifedeath' && (<><p className="muted">{t('academy.ldIntro')}</p><PuzzleGrid list={ld} /></>)}
      {tab === 'tactics' && (<><p className="muted">{t('academy.tacticsIntro')}</p><PuzzleGrid list={tactics} /></>)}
    </div>
  );
}
