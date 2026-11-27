import { useMemo, useState } from 'react';
import { Board } from './Board.tsx';
import { GoGame, pointLabel, type GameConfig } from '../engine/index.ts';
import { useI18n } from '../i18n/index.tsx';
import type { AiReview } from '../lib/ai.ts';

/** Post-game review: winrate graph, classified mistakes and a position scrubber. Data comes from KataGo analysis. */
export function ReviewPanel({ config, moves, review }: { config: GameConfig; moves: number[]; review: AiReview }) {
  const { t } = useI18n();
  const [idx, setIdx] = useState(moves.length);
  const game = useMemo(() => GoGame.fromMoves(config, moves.slice(0, idx)), [config, moves, idx]);
  const wr = review.winrates;
  const W = 300, H = 90;
  const pts = wr.map((v, i) => (v === null ? null : `${(i / Math.max(1, wr.length - 1)) * W},${H - v * H}`)).filter(Boolean).join(' ');
  const cur = review.moves.find((m) => m.move === idx);
  const bad = review.moves.filter((m) => m.kind !== 'good').sort((a, b) => b.loss - a.loss).slice(0, 8);
  const label = (k: string) => t(`review.${k}` as any);

  return (
    <div className="stack">
      <div className="card stack">
        <h3>{t('review.title')}</h3>
        <div className="row wrap">
          <span className="chip bad">{t('review.blunders')}: {review.summary.blunders}</span>
          <span className="chip">{t('review.mistakes')}: {review.summary.mistakes}</span>
          <span className="chip">{t('review.inaccuracies')}: {review.summary.inaccuracies}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110, background: '#111', borderRadius: 10 }} role="img" aria-label={t('review.graph')}>
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#555" strokeDasharray="4 4" />
          <polyline points={pts} fill="none" stroke="#e8d9a6" strokeWidth="2" />
          <line x1={(idx / Math.max(1, wr.length - 1)) * W} x2={(idx / Math.max(1, wr.length - 1)) * W} y1="0" y2={H} stroke="#d4a437" strokeWidth="2" />
        </svg>
        <div className="small muted">{t('review.graphHelp')}</div>
        <input type="range" min={0} max={moves.length} value={idx} onChange={(e) => setIdx(Number(e.target.value))} aria-label={t('review.scrub')} />
        <div className="board-wrap">
          <Board size={config.size} board={game.board} lastMove={game.lastMove?.p} marks={cur?.best !== undefined && cur.best >= 0 && cur.kind !== 'good' ? [cur.best] : undefined} />
        </div>
        <div className="small">
          {t('game.move', { n: idx })}
          {cur && <> · <strong>{label(cur.kind)}</strong> ({(cur.loss * 100).toFixed(1)}%)</>}
          {cur?.best !== undefined && cur.best >= 0 && cur.kind !== 'good' && <> · {t('review.better')}: {pointLabel(cur.best, config.size)}</>}
        </div>
      </div>
      {bad.length > 0 && (
        <div className="card">
          <h3>{t('review.biggest')}</h3>
          <div className="list">
            {bad.map((m) => (
              <button key={m.move} className="btn ghost small" style={{ justifyContent: 'space-between' }} onClick={() => setIdx(m.move)}>
                <span>#{m.move} {m.color === 1 ? t('game.black') : t('game.white')} {pointLabel(m.p, config.size)}</span>
                <span>{label(m.kind)} −{(m.loss * 100).toFixed(0)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
