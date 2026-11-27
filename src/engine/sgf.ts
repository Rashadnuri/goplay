import type { GoGame } from './game.ts';
import { BLACK, PASS } from './types.ts';

const col = (n: number) => String.fromCharCode(97 + n);

export function toSGF(game: GoGame, meta: { black?: string; white?: string; date?: string; result?: string } = {}): string {
  const c = game.config;
  const props = [
    'GM[1]',
    'FF[4]',
    'CA[UTF-8]',
    `SZ[${c.size}]`,
    `KM[${c.komi}]`,
    `RU[${c.rules === 'chinese' ? 'Chinese' : 'Japanese'}]`,
    'AP[GO PLAY]',
  ];
  if (c.handicap >= 2) props.push(`HA[${c.handicap}]`);
  if (meta.black) props.push(`PB[${meta.black}]`);
  if (meta.white) props.push(`PW[${meta.white}]`);
  if (meta.date) props.push(`DT[${meta.date}]`);
  if (game.result) props.push(`RE[${game.result.text}]`);
  else if (meta.result) props.push(`RE[${meta.result.replace(/[\]\\]/g, '')}]`);
  const moves = game.history
    .map((m) => {
      const who = m.color === BLACK ? 'B' : 'W';
      if (m.p === PASS) return `;${who}[]`;
      return `;${who}[${col(m.p % c.size)}${col(Math.floor(m.p / c.size))}]`;
    })
    .join('');
  return `(;${props.join('')}${moves})`;
}

/** Human coordinates: columns A–T skipping I, rows counted from the bottom. */
export function pointLabel(p: number, size: number): string {
  if (p === PASS) return 'pass';
  const letters = 'ABCDEFGHJKLMNOPQRST';
  return `${letters[p % size]}${size - Math.floor(p / size)}`;
}
