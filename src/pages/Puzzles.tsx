import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { Seg } from '../components/ui.tsx';
import { BANK } from '../content/bank.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { useDailySet, usePuzzleProgress } from '../lib/puzzles.ts';

export default function Puzzles() {
  const { t } = useI18n();
  const { items, streak } = useDailySet();
  const { solved } = usePuzzleProgress();
  const [lvl, setLvl] = useState<1 | 2 | 3>(1);
  const cur = items.find((i) => i.difficulty === lvl) ?? items[0];
  const allDone = items.every((i) => i.solved);

  return (
    <div className="stack">
      <h1>{t('puzzle.title')}</h1>
      <p className="muted">{t('puzzle.sub')}</p>

      <div className="stat-row" aria-label={t('puzzle.streak')}>
        <div><b>🔥 {streak.current}</b><span>{t('puzzle.streak')}</span></div>
        <div><b>{streak.best}</b><span>{t('puzzle.bestStreak')}</span></div>
        <div><b>{solved.size}/{BANK.length}</b><span>{t('puzzle.solved')}</span></div>
      </div>
      {allDone && <div className="notice">✓ {t('puzzle.allDailyDone')}</div>}

      <section className="stack">
        <div className="section-title" style={{ margin: '8px 0 0' }}><h2>{t('puzzle.today')}</h2></div>
        <Seg value={lvl} onChange={setLvl} label={t('puzzle.difficulty')} options={([1, 2, 3] as const).map((d) => ({ value: d, label: `${t(`puzzle.level.${d}` as DictKey)}${items.find((i) => i.difficulty === d)?.solved ? ' ✓' : ''}` }))} />
        {cur && (
          <Link to={`/puzzles/${cur.puzzle.id}`} className="card row" style={{ textDecoration: 'none' }}>
            <span className="avatar" style={{ background: 'var(--surface-2)' }}><Icon name="target" size={22} /></span>
            <div className="grow"><strong>{t(`puzzle.kind.${cur.puzzle.kind}` as DictKey)}</strong><div className="small muted">{t(`puzzle.level.${cur.puzzle.difficulty}` as DictKey)}</div></div>
            <span className={`btn small${cur.solved ? '' : ' primary'}`}>{cur.solved ? t('puzzle.again') : t('puzzle.solve')}</span>
          </Link>
        )}
      </section>

      {([1, 2, 3] as const).map((d) => (
        <section key={d}>
          <div className="section-title"><h2>{t(`puzzle.level.${d}` as DictKey)}</h2><span className="small muted">{BANK.filter((p) => p.difficulty === d && solved.has(p.id)).length}/{BANK.filter((p) => p.difficulty === d).length}</span></div>
          <div className="topic-grid">
            {BANK.filter((p) => p.difficulty === d).map((p, i) => (
              <Link key={p.id} to={`/puzzles/${p.id}`} className={`topic${solved.has(p.id) ? ' done' : ''}`}>
                <Icon name={p.kind === 'lifeDeath' ? 'crown' : 'target'} size={26} />
                <span>{t(`puzzle.kind.${p.kind}` as DictKey)} #{i + 1}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
