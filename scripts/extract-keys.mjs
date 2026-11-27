import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const out = new Set();
const dyn = new Set();
function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== 'i18n') walk(p); continue; }
    if (!/\.(tsx?)$/.test(f) || /\.test\./.test(f)) continue;
    const s = readFileSync(p, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) out.add(m[1]);
    for (const m of s.matchAll(/\bt\(\s*`([^`]+)`/g)) dyn.add(m[1]);
    for (const m of s.matchAll(/(?:label|title|body|text|confirmLabel)=\{t\('([a-zA-Z0-9_.]+)'/g)) out.add(m[1]);
  }
}
walk('src');
console.log([...out].sort().join('\n'));
console.log('--- dynamic ---');
console.log([...dyn].sort().join('\n'));
