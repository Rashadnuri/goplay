/** GTP coordinates: columns A–T without I, rows numbered from the bottom. */
const LETTERS = 'ABCDEFGHJKLMNOPQRST';

export function toGtp(p: number, size: number): string {
  if (p < 0) return 'pass';
  return `${LETTERS[p % size]}${size - Math.floor(p / size)}`;
}

export function fromGtp(s: string, size: number): number {
  if (s.toLowerCase() === 'pass') return -1;
  const col = LETTERS.indexOf(s[0].toUpperCase());
  const row = parseInt(s.slice(1), 10);
  if (col < 0 || col >= size || !Number.isFinite(row) || row < 1 || row > size) throw new Error(`bad GTP coordinate: ${s}`);
  return (size - row) * size + col;
}
