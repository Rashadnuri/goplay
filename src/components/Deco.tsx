import { useId } from 'react';
import { Board } from './Board.tsx';

/** Hand-built decorative SVGs (no raster assets): sakura branch, misty mountains + pagoda, trophies, art board. */
const PETALS: [number, number, number, number][] = [
  [40, 52, 15, 0], [88, 30, 12, 20], [120, 78, 16, 40], [168, 46, 11, 10], [64, 110, 13, 30], [20, 150, 12, 5], [150, 128, 10, 25], [196, 96, 9, 15], [100, 166, 9, 35],
];
function Flower({ x, y, r, rot }: { x: number; y: number; r: number; rot: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy={-r * 0.62} rx={r * 0.5} ry={r * 0.7} fill="#f6b9c6" opacity=".95" transform={`rotate(${a})`} />)}
      <circle r={r * 0.22} fill="#e5748f" />
    </g>
  );
}
export function Sakura({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 230 200" aria-hidden="true">
      <path d="M-4 20 C40 40 70 30 110 70 S170 120 200 150" fill="none" stroke="#2b1d1a" strokeWidth="7" strokeLinecap="round" />
      <path d="M60 52 C70 90 56 110 64 140 M120 78 C150 70 170 80 196 70 M40 40 L30 8" fill="none" stroke="#2b1d1a" strokeWidth="4" strokeLinecap="round" />
      {PETALS.map(([x, y, r, rot], i) => <Flower key={i} x={x} y={y} r={r} rot={rot} />)}
    </svg>
  );
}

export function Mountains({ className, pagoda = true, style }: { className?: string; pagoda?: boolean; style?: React.CSSProperties }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} style={style} viewBox="0 0 400 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a3260" /><stop offset="1" stopColor="#141a30" /></linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#252a4a" /><stop offset="1" stopColor="#0d1222" /></linearGradient>
        <radialGradient id={`${id}m`}><stop offset="0" stopColor="#f6d58a" stopOpacity=".5" /><stop offset="1" stopColor="#f6d58a" stopOpacity="0" /></radialGradient>
      </defs>
      <circle cx="300" cy="70" r="70" fill={`url(#${id}m)`} />
      <path d="M0 170 L70 100 L120 150 L190 70 L260 150 L320 110 L400 170 V260 H0Z" fill={`url(#${id}a)`} opacity=".85" />
      <path d="M0 200 L80 150 L150 195 L230 135 L310 190 L400 150 V260 H0Z" fill={`url(#${id}b)`} />
      {pagoda && (
        <g fill="#0a0e1a" transform="translate(292 112)">
          <path d="M18 0h4v10h-4z" /><path d="M2 14 L20 6 L38 14 Z" /><rect x="8" y="14" width="24" height="8" />
          <path d="M-2 28 L20 18 L42 28 Z" /><rect x="6" y="28" width="28" height="10" />
          <path d="M-6 44 L20 32 L46 44 Z" /><rect x="4" y="44" width="32" height="16" />
        </g>
      )}
      <path d="M0 236 C80 220 140 245 220 232 S340 222 400 238 V260 H0Z" fill="#0a0e1a" />
    </svg>
  );
}

export function Trophy({ tone = 'gold', className }: { tone?: 'gold' | 'silver'; className?: string }) {
  const id = useId().replace(/:/g, '');
  const [a, b, c] = tone === 'gold' ? ['#fbe3a0', '#e3b45e', '#a8731f'] : ['#f4f6fa', '#b9c1cf', '#7c8698'];
  return (
    <svg className={className} viewBox="0 0 120 130" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset=".5" stopColor={b} /><stop offset="1" stopColor={c} /></linearGradient></defs>
      <path d="M26 20 H94 V50 C94 74 78 88 60 88 C42 88 26 74 26 50Z" fill={`url(#${id})`} />
      <path d="M26 28 H10 C8 52 20 64 34 66 M94 28 H110 C112 52 100 64 86 66" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" />
      <rect x="54" y="86" width="12" height="18" fill={`url(#${id})`} />
      <path d="M36 104 H84 L92 120 H28Z" fill={`url(#${id})`} />
      <path d="M38 24 V48 C38 62 46 74 58 78" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="5" strokeLinecap="round" />
      <path d="M60 36 l4 9 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z" fill="#fff" fillOpacity=".55" />
    </svg>
  );
}

/** Decorative tilted board with a scattered mid-game position. */
export function ArtBoard({ size = 9, className }: { size?: 9 | 13; className?: string }) {
  const b = new Uint8Array(size * size);
  const put = (c: 1 | 2, pts: [number, number][]) => pts.forEach(([x, y]) => (b[y * size + x] = c));
  put(1, [[2, 2], [3, 3], [4, 5], [5, 4], [6, 6], [3, 5], [2, 6]]);
  put(2, [[3, 2], [4, 3], [5, 3], [4, 4], [5, 5], [6, 4], [2, 5]]);
  return <div className={`tilt ${className ?? ''}`}><Board size={size} board={b} coords={false} lastMove={4 * size + 4} /></div>;
}

export function Logo({ size = 120 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" role="img" aria-label="GO PLAY">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbe3a0" /><stop offset=".55" stopColor="#e3b45e" /><stop offset="1" stopColor="#a8731f" /></linearGradient>
        <radialGradient id={`${id}b`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#8c919e" /><stop offset=".35" stopColor="#2c2f38" /><stop offset="1" stopColor="#040507" /></radialGradient>
        <radialGradient id={`${id}w`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#fff" /><stop offset=".6" stopColor="#f0ece0" /><stop offset="1" stopColor="#b7b09d" /></radialGradient>
      </defs>
      <path d="M150 38 A78 78 0 1 0 172 112" fill="none" stroke={`url(#${id}g)`} strokeWidth="11" strokeLinecap="round" />
      <path d="M156 28 A86 86 0 0 1 182 100" fill="none" stroke={`url(#${id}g)`} strokeWidth="4" strokeLinecap="round" opacity=".7" />
      <circle cx="80" cy="104" r="38" fill={`url(#${id}b)`} />
      <circle cx="124" cy="96" r="38" fill={`url(#${id}w)`} />
      <ellipse cx="68" cy="90" rx="13" ry="7" fill="#fff" opacity=".25" transform="rotate(-28 68 90)" />
    </svg>
  );
}
