// Renders public/favicon.svg into the PNG icons the PWA manifest needs (uses the preinstalled Playwright/Chromium).
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/usr/lib/node_modules/playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/favicon.svg'), 'utf8');
mkdirSync(join(root, 'public/icons'), { recursive: true });
const maskable = svg.replace('<rect width="512" height="512" rx="112" fill="#1b2233"/>', '<rect width="512" height="512" fill="#1b2233"/>')
  .replace('<g stroke', '<g transform="translate(256 256) scale(.78) translate(-256 -256)"><g stroke').replace('</svg>', '</g></svg>');
const targets = [
  ['icon-192.png', 192, svg], ['icon-512.png', 512, svg], ['icon-maskable-512.png', 512, maskable], ['apple-touch-icon.png', 180, maskable],
];
const browser = await chromium.launch();
for (const [name, size, markup] of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markup}`);
  writeFileSync(join(root, 'public/icons', name), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  await page.close();
}
await browser.close();
console.log('icons written');
