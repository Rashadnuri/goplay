import { Link, useParams } from 'react-router-dom';
import { PuzzleView } from '../components/PuzzleView.tsx';
import { BANK, BANK_BY_ID } from '../content/bank.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { useDailySet, usePuzzleProgress } from '../lib/puzzles.ts';
import NotFound from './NotFound.tsx';

export default function PuzzleSolve() {
  const { id } = useParams();
  const { t } = useI18n();
  const { items, refresh } = useDailySet();
  const { solved, reload } = usePuzzleProgress();
  const remote = items.find((i) => i.puzzle.id === id)?.puzzle;
  const puzzle = (id && BANK_BY_ID[id]) || remote;
  if (!puzzle) return <NotFound />;
  const same = BANK.filter((p) => p.difficulty === puzzle.difficulty);
  const next = same.find((p) => p.id !== puzzle.id && !solved.has(p.id)) ?? same[(same.findIndex((p) => p.id === puzzle.id) + 1) % same.length];
  const isDaily = items.some((i) => i.puzzle.id === puzzle.id);
  return (
    <div className="stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="row between"><Link to="/puzzles" className="small muted">← {t('puzzle.title')}</Link>{isDaily && <span className="chip">{t('puzzle.dailyBadge')}</span>}</div>
      <h1>{t(`puzzle.kind.${puzzle.kind}` as DictKey)}</h1>
      <PuzzleView key={puzzle.id} puzzle={puzzle} onSolved={() => { void reload(); void refresh(); }} />
      {next && next.id !== puzzle.id && <Link className="btn" to={`/puzzles/${next.id}`}>{t('puzzle.next')} →</Link>}
    </div>
  );
}
