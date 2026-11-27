import { useMemo, useState } from 'react';
import { Spinner, Modal, useToast } from './ui.tsx';
import { GoGame, pointLabel, type GameConfig } from '../engine/index.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { aiReview, type AiReview } from '../lib/ai.ts';
import { conceptsFor, type Confidence } from '../lib/concepts.ts';

const CHIP: Record<Confidence, DictKey> = { fact: 'coach.fact', heuristic: 'coach.heuristic', estimate: 'coach.estimate' };

/**
 * AI coach for a finished game. Everything is labelled:
 *   FACT      – verified with the rules engine on the real position
 *   HEURISTIC – a rule of thumb
 *   ESTIMATE  – KataGo's evaluation (winrate, score, better move): useful, but not proven
 * The counted result of the game itself (resign / timeout / counted score) is the only "proven" outcome.
 */
export function AiCoach({ config, moves, resultText, onShow, onClose }: { config: GameConfig; moves: number[]; resultText?: string | null; onShow: (move: number, best?: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { fail } = useToast();
  const [review, setReview] = useState<AiReview | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try { setReview(await aiReview({ size: config.size, komi: config.komi, rules: config.rules, handicap: config.handicap, moves })); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const worst = useMemo(() => (review ? review.moves.filter((m) => m.kind !== 'good').sort((a, b) => b.loss - a.loss).slice(0, 8) : []), [review]);
  const explained = useMemo(() => worst.map((m) => {
    try { return { m, concepts: conceptsFor(GoGame.fromMoves(config, moves.slice(0, m.move - 1)), m.p, m.best, m.move) }; } catch { return { m, concepts: [] }; }
  }), [worst, config, moves]);

  const wr = review?.winrates ?? [];
  const W = 300, H = 90;
  const pts = wr.map((v, i) => (v === null ? null : `${(i / Math.max(1, wr.length - 1)) * W},${H - v * H}`)).filter(Boolean).join(' ');

  return (
    <Modal title={t('coach.title')} onClose={onClose}>
      <div className="notice small stack" style={{ gap: 6 }}>
        <div className="row wrap"><span className="chip ok">{t('coach.fact')}</span><span>{t('coach.factHelp')}</span></div>
        <div className="row wrap"><span className="chip">{t('coach.heuristic')}</span><span>{t('coach.heuristicHelp')}</span></div>
        <div className="row wrap"><span className="chip warn-chip">{t('coach.estimate')}</span><span>{t('coach.estimateHelp')}</span></div>
      </div>
      {resultText && <div className="row"><span className="chip ok">{t('coach.proven')}</span><strong>{resultText}</strong></div>}
      {!review && <button className="btn primary" disabled={busy} onClick={run}>{busy ? <Spinner label={t('review.running')} /> : t('review.start')}</button>}
      {review && (
        <>
          <div className="row wrap"><span className="chip bad">{t('review.blunders')}: {review.summary.blunders}</span><span className="chip">{t('review.mistakes')}: {review.summary.mistakes}</span><span className="chip">{t('review.inaccuracies')}: {review.summary.inaccuracies}</span><span className="chip warn-chip">{t('coach.estimate')}</span></div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110, background: '#111', borderRadius: 10, cursor: 'pointer' }} role="img" aria-label={t('review.graph')}
            onClick={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onShow(Math.round(((e.clientX - r.left) / r.width) * (wr.length - 1)) + 1); onClose(); }}>
            <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#555" strokeDasharray="4 4" /><polyline points={pts} fill="none" stroke="#e8d9a6" strokeWidth="2" />
          </svg>
          <div className="small muted">{t('review.graphHelp')}</div>
          <h3 style={{ margin: 0 }}>{t('review.biggest')}</h3>
          {explained.length === 0 && <div className="empty">{t('coach.noMistakes')}</div>}
          {explained.map(({ m, concepts }) => (
            <div key={m.move} className="card stack" style={{ gap: 6 }}>
              <button className="btn ghost small" style={{ justifyContent: 'space-between' }} onClick={() => { onShow(m.move, m.best); onClose(); }}>
                <span>#{m.move} {m.color === 1 ? t('game.black') : t('game.white')} {pointLabel(m.p, config.size)}</span>
                <span>{t(`review.${m.kind}` as DictKey)} −{(m.loss * 100).toFixed(0)}% <span className="chip warn-chip">{t('coach.estimate')}</span></span>
              </button>
              {m.best !== undefined && m.best >= 0 && <div className="small">{t('review.better')}: <strong>{pointLabel(m.best, config.size)}</strong> <span className="muted">({t('coach.estimate')})</span></div>}
              {concepts.map((c) => (
                <div key={c.key} className="small row" style={{ alignItems: 'flex-start' }}>
                  <span className={`chip ${c.confidence === 'fact' ? 'ok' : c.confidence === 'estimate' ? 'warn-chip' : ''}`}>{t(CHIP[c.confidence])}</span>
                  <span>{t(c.key, c.params as Record<string, number>)}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
