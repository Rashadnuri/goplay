import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Reads the design tokens straight from global.css and checks WCAG contrast for the text pairs the UI actually uses. */
const css = readFileSync(join(import.meta.dirname, 'global.css'), 'utf8');

function vars(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
const dark = vars(':root');
const light = { ...dark, ...vars(":root[data-theme='light']") };

const hex = (c: string) => { const m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) throw new Error('not a hex colour: ' + c); const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c: string) => { const [r, g, b] = hex(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('design token contrast (WCAG AA = 4.5:1 for text)', () => {
  const pairs: [string, string, string][] = [
    ['--ink', '--bg', 'body text'], ['--ink', '--surface', 'text on cards'], ['--ink-2', '--surface', 'secondary text on cards'],
    ['--muted', '--surface', 'muted captions on cards'], ['--muted', '--bg', 'muted captions on the page'],
    ['--ink-2', '--surface-2', 'secondary text on the card gradient end'], ['--muted', '--surface-2', 'muted captions on the card gradient end'], ['--success', '--surface-2', 'success text on the card gradient end'], ['--danger', '--surface-2', 'danger text on the card gradient end'],
    ['--gold-hi', '--surface', 'active nav / gold text'], ['--danger', '--surface', 'danger text'], ['--success', '--surface', 'success text'], ['--warn', '--surface', 'warning text'],
  ];
  for (const [name, theme] of [['dark', dark], ['light', light]] as const) {
    for (const [fg, bg, what] of pairs) {
      it(`${name}: ${what} (${fg} on ${bg})`, () => {
        if (!theme[fg] || !theme[bg]) return;
        expect(ratio(theme[fg], theme[bg]), `${theme[fg]} on ${theme[bg]}`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('text on the gold primary button is readable at both ends of the gradient (dark theme)', () => {
    expect(ratio('#231705', '#f6d58a')).toBeGreaterThanOrEqual(7);
    expect(ratio('#231705', '#c48a2c')).toBeGreaterThanOrEqual(4.5);
  });
  it('text on the light-theme gold button', () => {
    expect(ratio('#231705', '#e8bd62')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#231705', '#c9962f')).toBeGreaterThanOrEqual(4.5);
  });
});
