import { BLACK, WHITE, formatClock, type Color } from '../engine/index.ts';
import { useI18n } from '../i18n/index.tsx';
import { Avatar, StoneDot } from './ui.tsx';

export function PlayerBar(props: {
  color: Color;
  name: string;
  avatar?: string;
  active?: boolean;
  captures: number;
  rating?: number | null;
  clockMs?: number | null;
  online?: boolean | null;
  extra?: string;
}) {
  const { t } = useI18n();
  const low = props.clockMs !== null && props.clockMs !== undefined && props.clockMs < 20_000;
  return (
    <div className={`player-bar${props.active ? ' active' : ''}`}>
      <Avatar name={props.name} avatar={props.avatar} />
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          <StoneDot color={props.color} />
          <strong className="truncate">{props.name}</strong>
          {props.online !== undefined && props.online !== null && <span className={`dot ${props.online ? 'on' : 'off'}`} title={props.online ? t('game.online') : t('game.offline')} />}
          <span className="small muted" style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{props.rating ? `${props.rating} · ` : ''}{t('game.captures')}: {props.captures}{props.extra ? ` · ${props.extra}` : ''}</span>
        </div>
      </div>
      {props.clockMs !== null && props.clockMs !== undefined && <div className={`clock${low ? ' low' : ''}`}>{formatClock(props.clockMs)}</div>}
    </div>
  );
}

export interface ScoreView {
  black: number; white: number; komi: number; rules: string; margin: number;
  blackTerritory: number; whiteTerritory: number;
  blackStones: number; whiteStones: number;
  blackPrisoners: number; whitePrisoners: number;
}

export function ScoreSummary({ s }: { s: ScoreView }) {
  const { t } = useI18n();
  const area = s.rules === 'chinese';
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr><th /><th className="num"><StoneDot color={BLACK} /> {t('game.black')}</th><th className="num"><StoneDot color={WHITE} /> {t('game.white')}</th></tr>
        </thead>
        <tbody>
          <tr><td>{t('game.territory')}</td><td className="num">{s.blackTerritory}</td><td className="num">{s.whiteTerritory}</td></tr>
          {area ? (
            <tr><td>{t('game.stones')}</td><td className="num">{s.blackStones}</td><td className="num">{s.whiteStones}</td></tr>
          ) : (
            <tr><td>{t('game.prisoners')}</td><td className="num">{s.blackPrisoners}</td><td className="num">{s.whitePrisoners}</td></tr>
          )}
          <tr><td>{t('game.komi')}</td><td className="num">–</td><td className="num">{s.komi}</td></tr>
          <tr><td><strong>{t('game.total')}</strong></td><td className="num"><strong>{s.black}</strong></td><td className="num"><strong>{s.white}</strong></td></tr>
        </tbody>
      </table>
    </div>
  );
}

/** "B+3.5", "W+R" … → localised sentence */
export function ResultText({ text, winner }: { text: string; winner: Color | null }) {
  const { t } = useI18n();
  let reason = '';
  if (/\+R$/.test(text)) reason = t('result.resign');
  else if (/\+T$/.test(text)) reason = t('result.timeout');
  else if (/\+F$/.test(text)) reason = t('result.forfeit');
  else if (text === '0') reason = t('result.draw');
  else if (/\+$/.test(text)) reason = t('result.agreement');
  else if (/\+[\d.]+$/.test(text)) reason = t('result.points', { n: text.split('+')[1] });
  if (winner === null) return <>{t('result.draw')}</>;
  return <>{t(winner === BLACK ? 'result.blackWins' : 'result.whiteWins')} — {reason}</>;
}
