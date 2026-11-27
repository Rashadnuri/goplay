import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useEffect } from 'react';
import { BLACK, WHITE, EMPTY, type BoardSize, type Color } from '../engine/index.ts';
import { playCapture, playStone } from '../lib/sound.ts';
import { usePrefs } from '../hooks/usePrefs.ts';

export interface Hint {
  p: number;
  label?: string;
  strong?: boolean;
}

export interface BoardProps {
  size: BoardSize;
  board: Uint8Array;
  lastMove?: number;
  koPoint?: number;
  /** when provided the board is interactive; called with the intersection the user released on */
  onSelect?: (p: number) => void;
  /** colour of the preview ("ghost") stone */
  toPlay?: Color;
  /** point awaiting confirmation (touch mode) */
  pending?: number | null;
  /** territory overlay: 1 black / 2 white / 0 none */
  territory?: Uint8Array;
  /** stones agreed dead (shown faded) */
  dead?: ReadonlySet<number>;
  marks?: readonly number[];
  hints?: readonly Hint[];
  /** −1 (white) … +1 (black) per point */
  ownership?: readonly number[];
  coords?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** zoom to a square region of the board (cells), e.g. a corner for joseki training */
  crop?: { x0: number; y0: number; n: number };
}

const CELL = 100;
const LETTERS = 'ABCDEFGHJKLMNOPQRST';

function starPoints(size: BoardSize): number[] {
  const e = size === 9 ? 2 : 3;
  const far = size - 1 - e;
  const mid = (size - 1) / 2;
  const xs = size === 9 ? [e, far, mid] : [e, mid, far];
  const pts: number[] = [];
  if (size === 9) {
    for (const x of [e, far]) for (const y of [e, far]) pts.push(y * size + x);
    pts.push(mid * size + mid);
  } else for (const x of xs) for (const y of xs) pts.push(y * size + x);
  return pts;
}

function BoardImpl(props: BoardProps) {
  const { size, board, lastMove, koPoint, onSelect, toPlay = BLACK, pending, territory, dead, marks, hints, ownership, coords = true, disabled } = props;
  const uid = useId().replace(/:/g, '');
  const { prefs } = usePrefs();
  // stone sound: only when the position actually changes after first render (never on mount)
  const stoneCount = useMemo(() => { let n = 0; for (let i = 0; i < board.length; i++) if (board[i] !== EMPTY) n++; return n; }, [board]);
  const prev = useRef<{ n: number; last: number | undefined } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { n: stoneCount, last: lastMove };
    if (!before || !prefs.sound.on || (before.n === stoneCount && before.last === lastMove)) return;
    if (stoneCount < before.n + (lastMove !== before.last ? 1 : 0)) playCapture(prefs.sound.volume); else if (lastMove !== before.last) playStone(prefs.sound.volume);
  }, [stoneCount, lastMove]); // eslint-disable-line react-hooks/exhaustive-deps
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const margin = coords ? 62 : 38;
  const span = (size - 1) * CELL;
  const vb = span + margin * 2;
  const cropBox = props.crop ? { x: margin + props.crop.x0 * CELL - 70, y: margin + props.crop.y0 * CELL - 70, w: (props.crop.n - 1) * CELL + 140 } : { x: 0, y: 0, w: vb };
  const pos = (p: number) => ({ x: margin + (p % size) * CELL, y: margin + Math.floor(p / size) * CELL });
  const interactive = !!onSelect && !disabled;

  const grid = useMemo(() => {
    let d = '';
    for (let i = 0; i < size; i++) {
      const o = margin + i * CELL;
      d += `M${margin} ${o}H${margin + span}M${o} ${margin}V${margin + span}`;
    }
    return d;
  }, [size, margin, span]);
  const stars = useMemo(() => starPoints(size), [size]);

  const pointFromEvent = useCallback(
    (e: React.PointerEvent): number | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      const x = cropBox.x + ((e.clientX - r.left) / r.width) * cropBox.w;
      const y = cropBox.y + ((e.clientY - r.top) / r.height) * cropBox.w;
      const cx = Math.round((x - margin) / CELL);
      const cy = Math.round((y - margin) / CELL);
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return null;
      return cy * size + cx;
    },
    [cropBox.x, cropBox.y, cropBox.w, margin, size],
  );

  const down = (e: React.PointerEvent) => {
    if (!interactive) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setHover(pointFromEvent(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!interactive) return;
    if (e.pointerType === 'mouse' || e.buttons) setHover(pointFromEvent(e));
  };
  const up = (e: React.PointerEvent) => {
    if (!interactive) return;
    const p = pointFromEvent(e);
    if (e.pointerType !== 'mouse') setHover(null);
    if (p !== null) onSelect!(p);
  };
  const keyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    const cur = hover ?? Math.floor((size * size) / 2);
    let n = cur;
    if (e.key === 'ArrowRight') n = Math.min(size * size - 1, cur + (cur % size < size - 1 ? 1 : 0));
    else if (e.key === 'ArrowLeft') n = cur - (cur % size > 0 ? 1 : 0);
    else if (e.key === 'ArrowDown') n = Math.min(size * size - 1, cur + size);
    else if (e.key === 'ArrowUp') n = Math.max(0, cur - size);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect!(cur);
      return;
    } else return;
    e.preventDefault();
    setHover(n);
  };

  const r = CELL * 0.47;
  const ghost = pending ?? hover;

  return (
    <svg
      ref={svgRef}
      className="board-svg"
      viewBox={`${cropBox.x} ${cropBox.y} ${cropBox.w} ${cropBox.w}`}
      role="application"
      aria-label={props.ariaLabel ?? 'Go board'}
      tabIndex={interactive ? 0 : -1}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={() => setHover(null)}
      onKeyDown={keyDown}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      <defs>
        <linearGradient id={`${uid}wood`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--wood-hi, #f6d38c)" />
          <stop offset=".45" stopColor="var(--wood)" />
          <stop offset="1" stopColor="var(--wood-2)" />
        </linearGradient>
        <radialGradient id={`${uid}vig`} cx="50%" cy="45%" r="75%">
          <stop offset=".6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#3a2208" stopOpacity=".38" />
        </radialGradient>
        <pattern id={`${uid}grain`} width="520" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-1.2)">
          <path d="M0 6c60-5 120 5 180 0s120-5 180 0 120 5 160 0M0 15c70 4 130-5 200 0s120 5 190 0 90-4 130 0" fill="none" stroke="#6b4015" strokeOpacity=".13" strokeWidth="2.2" />
        </pattern>
        <radialGradient id={`${uid}b`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor="var(--sb0, #8c919e)" />
          <stop offset=".32" stopColor="var(--sb1, #2c2f38)" />
          <stop offset="1" stopColor="var(--sb2, #040507)" />
        </radialGradient>
        <radialGradient id={`${uid}w`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="var(--sw0, #ffffff)" />
          <stop offset=".55" stopColor="var(--sw1, #f0ece0)" />
          <stop offset="1" stopColor="var(--sw2, #b7b09d)" />
        </radialGradient>
        <filter id={`${uid}sh`} x="-20%" y="-20%" width="150%" height="150%">
          <feDropShadow dx="2" dy="4" stdDeviation="3" floodColor="#000" floodOpacity=".35" />
        </filter>
      </defs>
      <rect width={vb} height={vb} fill={`url(#${uid}wood)`} />
      <rect width={vb} height={vb} fill={`url(#${uid}grain)`} />
      <rect width={vb} height={vb} fill={`url(#${uid}vig)`} />
      <path d={grid} stroke="var(--wood-line)" strokeWidth={2.2} fill="none" opacity={0.85} />
      <rect x={margin} y={margin} width={span} height={span} fill="none" stroke="var(--wood-line)" strokeWidth={4} opacity={0.9} />
      {stars.map((p) => {
        const { x, y } = pos(p);
        return <circle key={`s${p}`} cx={x} cy={y} r={7.5} fill="var(--wood-line)" />;
      })}
      {coords &&
        Array.from({ length: size }, (_, i) => (
          <g key={`c${i}`} fill="var(--wood-line)" fontSize={26} textAnchor="middle" fontFamily="var(--font-sans)" opacity={0.75}>
            <text x={margin + i * CELL} y={margin - 28} dominantBaseline="middle">{LETTERS[i]}</text>
            <text x={margin + i * CELL} y={margin + span + 28} dominantBaseline="middle">{LETTERS[i]}</text>
            <text x={margin - 30} y={margin + i * CELL} dominantBaseline="middle">{size - i}</text>
            <text x={margin + span + 30} y={margin + i * CELL} dominantBaseline="middle">{size - i}</text>
          </g>
        ))}

      {ownership &&
        ownership.map((v, p) => {
          if (Math.abs(v) < 0.25) return null;
          const { x, y } = pos(p);
          return <rect key={`o${p}`} x={x - 16} y={y - 16} width={32} height={32} rx={4} fill={v > 0 ? '#0b0d12' : '#ffffff'} opacity={Math.min(0.75, Math.abs(v) * 0.75)} pointerEvents="none" />;
        })}
      {territory &&
        Array.from(territory).map((t, p) => {
          if (!t || board[p] !== EMPTY) return null;
          const { x, y } = pos(p);
          return <rect key={`t${p}`} x={x - 18} y={y - 18} width={36} height={36} rx={5} fill={t === BLACK ? '#0b0d12' : '#ffffff'} stroke={t === BLACK ? '#fff' : '#0b0d12'} strokeWidth={2} opacity={0.88} pointerEvents="none" />;
        })}
      {territory &&
        dead &&
        [...dead].map((p) => {
          const { x, y } = pos(p);
          const owner = territory[p];
          return owner ? <rect key={`td${p}`} x={x - 18} y={y - 18} width={36} height={36} rx={5} fill={owner === BLACK ? '#0b0d12' : '#ffffff'} stroke={owner === BLACK ? '#fff' : '#0b0d12'} strokeWidth={2} opacity={0.88} pointerEvents="none" /> : null;
        })}

      {Array.from(board).map((v, p) => {
        if (v === EMPTY) return null;
        const { x, y } = pos(p);
        const isDead = dead?.has(p);
        return (
          <g key={`st${p}`} opacity={isDead ? 0.35 : 1}>
            <circle cx={x} cy={y} r={r} fill={`url(#${uid}${v === BLACK ? 'b' : 'w'})`} filter={`url(#${uid}sh)`} stroke={v === WHITE ? '#b9b2a0' : 'none'} strokeWidth={1} />
            <ellipse cx={x - r * 0.3} cy={y - r * 0.42} rx={r * 0.36} ry={r * 0.2} fill="#fff" style={{ opacity: v === BLACK ? 'var(--hl-b, .28)' : 'var(--hl-w, .85)' }} transform={`rotate(-28 ${x - r * 0.3} ${y - r * 0.42})`} pointerEvents="none" />
            {isDead && <path d={`M${x - 14} ${y - 14}L${x + 14} ${y + 14}M${x + 14} ${y - 14}L${x - 14} ${y + 14}`} stroke="#c0392b" strokeWidth={5} strokeLinecap="round" />}
          </g>
        );
      })}

      {lastMove !== undefined && lastMove >= 0 && board[lastMove] !== EMPTY && (() => {
        const { x, y } = pos(lastMove);
        return (
          <g pointerEvents="none" className="last-move">
            <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke="#f0b63a" strokeWidth={5} opacity={0.95} />
            <circle cx={x} cy={y} r={r * 0.2} fill="#f0b63a" stroke={board[lastMove] === BLACK ? '#000' : '#5a3a17'} strokeWidth={2} />
          </g>
        );
      })()}
      {koPoint !== undefined && koPoint >= 0 && board[koPoint] === EMPTY && (() => {
        const { x, y } = pos(koPoint);
        return <rect x={x - 14} y={y - 14} width={28} height={28} fill="none" stroke="#c0392b" strokeWidth={5} pointerEvents="none" />;
      })()}
      {marks?.map((p) => {
        const { x, y } = pos(p);
        return <circle key={`m${p}`} cx={x} cy={y} r={r * 0.95} fill="none" stroke="var(--gold)" strokeWidth={6} strokeDasharray="14 9" pointerEvents="none" />;
      })}
      {hints?.map((h) => {
        const { x, y } = pos(h.p);
        return (
          <g key={`h${h.p}`} pointerEvents="none">
            <circle cx={x} cy={y} r={r * 0.9} fill={h.strong ? '#2e8b57' : '#3b6ea5'} opacity={0.78} stroke="#fff" strokeWidth={3} />
            {h.label && <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={h.label.length > 3 ? 30 : 38} fontWeight="700" fill="#fff">{h.label}</text>}
          </g>
        );
      })}

      {interactive && ghost !== null && ghost !== undefined && board[ghost] === EMPTY && (() => {
        const { x, y } = pos(ghost);
        return (
          <g pointerEvents="none">
            {pending === ghost && <path d={`M${margin} ${y}H${margin + span}M${x} ${margin}V${margin + span}`} stroke="var(--gold)" strokeWidth={2.5} opacity={0.7} />}
            <circle cx={x} cy={y} r={r} fill={`url(#${uid}${toPlay === BLACK ? 'b' : 'w'})`} opacity={pending === ghost ? 0.85 : 0.5} stroke={pending === ghost ? 'var(--gold)' : 'none'} strokeWidth={5} />
          </g>
        );
      })()}
    </svg>
  );
}

export const Board = memo(BoardImpl);

/** Tap-to-preview / tap-again-to-confirm logic shared by every playable board. */
export function useMovePicker(opts: { confirm: boolean; onPlay: (p: number) => void; canPlay?: (p: number) => boolean; /** called when a tap is refused (e.g. occupied point) so the UI can explain why */ onBlocked?: (p: number) => void }) {
  const [pending, setPending] = useState<number | null>(null);
  const { confirm, onPlay, canPlay, onBlocked } = opts;
  const select = useCallback(
    (p: number) => {
      if (canPlay && !canPlay(p)) {
        setPending(null);
        onBlocked?.(p);
        return;
      }
      if (!confirm) return onPlay(p);
      if (pending === p) {
        setPending(null);
        onPlay(p);
      } else setPending(p);
    },
    [confirm, onPlay, canPlay, onBlocked, pending],
  );
  const commit = useCallback(() => {
    if (pending !== null) {
      const p = pending;
      setPending(null);
      onPlay(p);
    }
  }, [pending, onPlay]);
  return { pending, select, commit, cancel: () => setPending(null) };
}
