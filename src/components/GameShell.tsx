import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { formatClock, other, type Color } from '../engine/index.ts';
import { useI18n } from '../i18n/index.tsx';
import { Icon } from './Icon.tsx';
import { Modal, Avatar, StoneDot } from './ui.tsx';

/**
 * Board-first gameplay layout. The board stage takes every pixel that the minimal HUD and toolbar leave over,
 * and the board itself is the largest square that fits (CSS container query units, no fixed pixel sizes).
 *   portrait:  [top HUD] [ BOARD ] [note] [bottom HUD] [toolbar]
 *   landscape: [ BOARD ] | rail: top HUD · note · bottom HUD · toolbar
 */
export function GameShell(props: { top: ReactNode; bottom: ReactNode; board: ReactNode; note?: ReactNode; toolbar: ReactNode; overlays?: ReactNode }) {
  return createPortal(
    <div className="shell">
      <header className="shell-top">{props.top}</header>
      <main className="stage"><div className="board-box">{props.board}</div></main>
      <div className="shell-note" role="status" aria-live="polite">{props.note}</div>
      <footer className="shell-bottom">{props.bottom}</footer>
      <nav className="toolbar" aria-label="Game controls">{props.toolbar}</nav>
      {props.overlays}
    </div>,
    document.body,
  );
}

export function HudPlayer(p: { color: Color; name: string; avatar?: string; captures: number; clockMs?: number | null; turn: boolean; rating?: number | null; online?: boolean | null; lead?: ReactNode; trail?: ReactNode }) {
  const { t } = useI18n();
  const low = p.clockMs != null && p.clockMs < 20_000;
  return (
    <div className={`hudp${p.turn ? ' turn' : ''}`}>
      {p.lead}
      <span className="hudp-av"><Avatar name={p.name} avatar={p.avatar} />{p.turn && <i className="turn-dot" role="img" aria-label={t('game.yourTurn')} />}</span>
      <span className="hudp-main">
        <strong className="truncate">{p.name}{p.online != null && <span className={`dot ${p.online ? 'on' : 'off'}`} style={{ marginLeft: 6 }} />}</strong>
        <span className="hudp-sub" title={t('game.captures')}><StoneDot color={other(p.color)} /> ×{p.captures}{p.rating ? <span className="muted"> · {p.rating}</span> : null}</span>
      </span>
      {p.clockMs != null && <span className={`hud-clock${low ? ' low' : ''}${p.turn ? ' run' : ''}`}>{formatClock(p.clockMs)}</span>}
      {p.trail}
    </div>
  );
}

export function LeaveButton({ to = '/play' }: { to?: string }) {
  const { t } = useI18n();
  return <Link to={to} className="hud-icon" aria-label={t('common.back')}><Icon name="arrow" size={20} /></Link>;
}

export interface ToolItem { key: string; icon: string; label: string; onClick: () => void; disabled?: boolean; tone?: 'danger' | 'gold' }
export function Toolbar({ items }: { items: ToolItem[] }) {
  return (
    <>
      {items.map((i) => (
        <button key={i.key} className={`tool${i.tone ? ' ' + i.tone : ''}`} disabled={i.disabled} onClick={i.onClick}>
          <Icon name={i.icon} size={22} /><span>{i.label}</span>
        </button>
      ))}
    </>
  );
}

export function MenuSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Modal title={title} onClose={onClose}><div className="menu-list">{children}</div></Modal>;
}
export function MenuItem({ icon, label, onClick, danger, hint }: { icon: string; label: string; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} onClick={onClick}>
      <Icon name={icon} size={22} /><span className="grow">{label}</span>{hint && <span className="small muted">{hint}</span>}
    </button>
  );
}

/** Slot in the note row for "confirm this move" (touch mode) */
export function ConfirmBar({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <div className="confirm-bar">
      <button className="btn primary small" onClick={onConfirm}>{t('game.confirmMove')}</button>
      <button className="btn small" onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  );
}
