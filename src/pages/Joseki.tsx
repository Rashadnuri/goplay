import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Board, useMovePicker, type Hint } from '../components/Board.tsx';
import { Seg, Spinner, useToast } from '../components/ui.tsx';
import { BLACK, GoGame, PASS, WHITE, makeConfig, pointLabel } from '../engine/index.ts';
import { usePrefs } from '../hooks/usePrefs.ts';
import { useI18n, type DictKey } from '../i18n/index.tsx';
import { aiAnalyze, aiHealth, aiMove, type AiPosition } from '../lib/ai.ts';

const Q = (x: number, y: number) => y * 19 + x;
const STARTS = { hoshi: Q(15, 3), komoku: Q(16, 3), sansan: Q(16, 2) } as const;
const MAX_MOVES = 10;
type Verdict = 'best' | 'good' | 'playable' | 'weak';
interface Entry { move: number; p: number; verdict: Verdict; loss: number; better?: number }
const posOf = (g: GoGame): AiPosition => ({ size: 19, komi: g.config.komi, rules: 'japanese', handicap: 0, moves: g.history.map((m) => m.p) });

/**
 * Corner trainer. Not a joseki dictionary: every move you play is evaluated by KataGo (an ESTIMATE),
 * and KataGo answers with its preferred reply. The verdict compares your move to the engine's candidates.
 */
export default function Joseki() {
  const { t } = useI18n();
  const { fail } = useToast();
  const { confirm } = usePrefs();
  const [health, setHealth] = useState<Awaited<ReturnType<typeof aiHealth>> | null>(null);
  const [start, setStart] = useState<keyof typeof STARTS>('hoshi');
  const [game, setGame] = useState<GoGame | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState<Hint[] | undefined>();
  const [, bump] = useState(0);
  useEffect(() => { aiHealth().then(setHealth); }, []);
  const katago = health?.engine === 'katago';

  const begin = () => {
    const g = new GoGame(makeConfig({ size: 19 }));
    g.play(STARTS[start]); // Black's corner stone; the learner answers as White
    setGame(g); setLog([]); setHints(undefined);
  };

  const onPlay = useCallback(async (p: number) => {
    if (!game || busy || game.toPlay !== WHITE || log.length >= MAX_MOVES) return;
    const pre = game.checkMove(p);
    if (!pre.ok) return fail(new Error('err:illegal_move'));
    setBusy(true); setHints(undefined);
    try {
      const a = await aiAnalyze(posOf(game), 150);
      const mine = (w: number) => (a.toPlay === 1 ? w : 1 - w);
      const best = a.candidates[0];
      const cand = a.candidates.find((c) => c.p === p);
      const loss = cand && best ? Math.max(0, mine(best.winrate) - mine(cand.winrate)) : 1;
      const verdict: Verdict = best && best.p === p ? 'best' : cand && loss < 0.03 ? 'good' : cand && loss < 0.08 ? 'playable' : 'weak';
      game.play(p);
      setLog((l) => [...l, { move: game.moveNumber, p, verdict, loss, better: best && best.p !== p ? best.p : undefined }]);
      bump((x) => x + 1);
      if (game.phase === 'playing' && (game.toPlay as number) === BLACK) {
        const r = await aiMove(posOf(game), 'expert');
        if (r.move.type === 'play') game.play(r.move.p); else game.pass();
        bump((x) => x + 1);
      }
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [game, busy, log.length, fail]);
  const canPlay = useCallback((p: number) => !!game && !busy && game.toPlay === WHITE && game.at(p) === 0 && log.length < MAX_MOVES, [game, busy, log.length]);
  const picker = useMovePicker({ confirm, onPlay, canPlay });

  const showAi = async () => {
    if (!game) return;
    setBusy(true);
    try { const a = await aiAnalyze(posOf(game), 150); setHints(a.candidates.filter((c) => c.p !== PASS).slice(0, 3).map((c, i) => ({ p: c.p, label: String(i + 1), strong: i === 0 }))); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const ok = katago;
  return (
    <div className="stack" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="row between"><Link to="/learn?tab=joseki" className="small muted">← {t('academy.title')}</Link><span className="chip">{t('joseki.estimate')}</span></div>
      <h1>{t('joseki.title')}</h1>
      <div className="notice small">{t('joseki.honest')}</div>
      {health && !ok && <div className="notice error" role="alert">{t(health.reason === 'no_engine' ? 'ai.noEngine' : health.reason === 'down' ? 'ai.down' : 'ai.notConfigured')}</div>}
      {!game ? (
        <div className="card stack">
          <span className="label">{t('joseki.startPoint')}</span>
          <Seg value={start} onChange={setStart} options={(['hoshi', 'komoku', 'sansan'] as const).map((k) => ({ value: k, label: t(`joseki.start.${k}` as DictKey) }))} />
          <button className="btn primary block" disabled={!ok} onClick={begin}>{health ? t('setup.start') : <Spinner />}</button>
        </div>
      ) : (
        <>
          <div className="board-wrap" style={{ maxWidth: 'min(100%, 560px)' }}>
            <Board size={19} board={game.board} lastMove={game.lastMove?.p} toPlay={WHITE} pending={picker.pending} hints={hints} crop={{ x0: 9, y0: 0, n: 10 }} coords={false} onSelect={picker.select} disabled={busy} ariaLabel={t('joseki.title')} />
          </div>
          <div className="row between small"><span>{busy ? <span className="row"><span className="spinner" /> {t('ai.thinking')}</span> : log.length >= MAX_MOVES ? t('joseki.done') : t('joseki.yourMove')}</span><span className="muted">{log.length}/{MAX_MOVES}</span></div>
          {picker.pending !== null && <div className="row"><button className="btn primary grow" onClick={picker.commit} disabled={busy}>{t('game.confirmMove')}</button><button className="btn" onClick={picker.cancel}>{t('common.cancel')}</button></div>}
          <div className="row wrap"><button className="btn" onClick={showAi} disabled={busy || game.toPlay !== WHITE}>{t('joseki.showAi')}</button><button className="btn" onClick={begin}>{t('joseki.restart')}</button></div>
          {log.length > 0 && (
            <div className="card list" aria-live="polite">
              {log.map((e) => (
                <div key={e.move} className="row between wrap">
                  <span>#{e.move} {pointLabel(e.p, 19)}</span>
                  <span className={`chip ${e.verdict === 'weak' ? 'bad' : e.verdict === 'best' || e.verdict === 'good' ? 'ok' : ''}`}>{t(`joseki.verdict.${e.verdict}` as DictKey)}{e.loss > 0.005 ? ` (−${(e.loss * 100).toFixed(0)}%)` : ''}</span>
                  {e.better !== undefined && <span className="small muted">{t('review.better')}: {pointLabel(e.better, 19)}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
