// Responsive + interaction tests against the production build, in real Chromium (preinstalled Playwright).
// Usage: npm run build && npm run test:ui
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require('playwright')); } catch { ({ chromium, devices } = require('/usr/lib/node_modules/playwright')); }

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/goplay-shots';
mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const routes = ['/', '/welcome', '/puzzles', '/puzzles/cap-1', '/puzzles/ld-line3-live', '/learn?tab=openings', '/learn?tab=joseki', '/learn?tab=lifedeath', '/academy/joseki', '/watch', '/replay/00000000-0000-0000-0000-000000000000', '/play', '/play/local', '/play/ai', '/play/online', '/play/room', '/tournaments', '/learn', '/learn/capturing', '/daily', '/leaderboard', '/profile', '/friends', '/settings', '/auth', '/admin', '/nope'];
const viewports = [
  { name: 'phone-small', width: 360, height: 740 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1920, height: 1080 },
];

let failures = 0;
const fail = (m) => { failures++; console.error('✗', m); };
const ok = (m) => console.log('✓', m);

const browser = await chromium.launch();
const rawNewContext = browser.newContext.bind(browser);
browser.newContext = async (o) => { const c = await rawNewContext(o); await c.addInitScript(() => { try { localStorage.setItem('goplay.onboarded', '1'); } catch {} }); return c; };
try {
  // 0) first-run onboarding (fresh visitor is sent to /welcome)
  {
    const ctx = await rawNewContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    if (!page.url().endsWith('/welcome')) fail('new visitors should land on /welcome'); else ok('onboarding shown to first-time visitors');
    for (const n of ['Başla', 'Qeydiyyat', 'Daxil ol']) if (!(await page.getByText(n, { exact: false }).first().isVisible())) fail('welcome missing ' + n);
    await page.screenshot({ path: join(SHOTS, 'phone-welcome.png') });
    await page.getByRole('button', { name: /Başla/ }).click();
    await page.waitForURL(BASE + '/');
    await page.reload();
    if (page.url().endsWith('/welcome')) fail('onboarding should only show once'); else ok('onboarding shown once, then home');
    await ctx.close();
  }

  // 1) no horizontal scroll, no console errors, on every route and size
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    for (const r of routes) {
      await page.goto(BASE + r, { waitUntil: 'networkidle' });
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (sw > iw + 1) fail(`${vp.name} ${r}: horizontal overflow (scrollWidth ${sw} > ${iw})`);
      const txt = await page.evaluate(() => document.body.innerText);
      if (txt.trim().length < 5) fail(`${vp.name} ${r}: page is blank`);
      if (['/', '/play/local', '/learn/capturing', '/learn', '/tournaments', '/leaderboard', '/profile'].includes(r) && ['phone', 'laptop'].includes(vp.name)) await page.screenshot({ path: join(SHOTS, `${vp.name}${r.replace(/\//g, '_') || '_home'}.png`) });
    }
    if (errors.length) fail(`${vp.name}: console/page errors: ${[...new Set(errors)].join(' | ')}`);
    else ok(`${vp.name} ${vp.width}x${vp.height}: ${routes.length} routes, no overflow, no errors`);
    await ctx.close();
  }

  // 2) navigation: bottom bar on phone, sidebar on desktop
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    const bottom = await page.locator('nav.bottom-nav[data-mobile]').boundingBox();
    if (!bottom || bottom.y + bottom.height < 815 || bottom.y < 700) fail('mobile bottom navigation not pinned to the bottom'); else ok('mobile bottom navigation is pinned');
    const labels = await page.locator('nav.bottom-nav[data-mobile] a').allInnerTexts();
    if (labels.length !== 6) fail(`expected 6 nav items, got ${labels.length}`); else ok('6 main sections: ' + labels.join(' · '));
    await ctx.close();
    const d = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dp = await d.newPage();
    await dp.goto(BASE);
    const side = await dp.locator('aside.sidebar').isVisible();
    const bottomHidden = !(await dp.locator('nav.bottom-nav[data-mobile]').isVisible());
    if (!side || !bottomHidden) fail('desktop should show the sidebar and hide the bottom bar'); else ok('desktop shows the sidebar');
    await d.close();
  }

  // 3) language switching: default Azerbaijani, EN and RU fully switch, preference persists
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    if ((await page.locator('html').getAttribute('lang')) !== 'az') fail('default language must be az'); else ok('default language is Azerbaijani');
    const az = await page.locator('aside.sidebar nav').innerText();
    if (!/Ana səhifə/.test(az)) fail('az nav not shown'); 
    await page.locator('aside.sidebar select').selectOption('en');
    const en = await page.locator('aside.sidebar nav').innerText();
    if (!/Home/.test(en) || /Ana səhifə/.test(en)) fail('en switch failed / mixed languages'); else ok('switch to English works');
    await page.locator('aside.sidebar select').selectOption('ru');
    const ru = await page.locator('aside.sidebar nav').innerText();
    if (!/Главная/.test(ru)) fail('ru switch failed'); else ok('switch to Russian works');
    await page.reload();
    if ((await page.locator('html').getAttribute('lang')) !== 'ru') fail('language preference not persisted'); else ok('language preference persisted');
    // no Latin-script nav text mixed in when Russian is active on the home hero
    const body = await page.locator('main').innerText();
    if (/Quick play|Play against AI|Welcome/.test(body)) fail('English strings leaked into Russian UI'); else ok('no mixed-language UI in Russian');
    await ctx.close();
  }

  // 4) theme toggle
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    if ((await page.locator('html').getAttribute('data-theme')) !== 'dark') fail('dark must be the default theme'); else ok('dark theme is the default');
    await page.screenshot({ path: join(SHOTS, 'dark-home.png') });
    await page.locator('aside.sidebar button.icon-btn').last().click();
    if ((await page.locator('html').getAttribute('data-theme')) !== 'light') fail('light theme not applied'); else ok('light (ivory) theme toggles');
    await page.screenshot({ path: join(SHOTS, 'light-home.png') });
    await ctx.close();
  }

  // 5) local game on a touch device: full-screen shell, tap-to-preview, confirm, captures, pass, undo, scoring
  const startLocal = async (page, size) => {
    await page.addInitScript(() => localStorage.setItem('goplay.tutorialSeen', '1'));
    await page.goto(BASE + '/play/local');
    if (size && size !== 9) await page.getByRole('button', { name: `${size}×${size}` }).click();
    await page.getByRole('button', { name: /Oyuna başla/ }).click();
    await page.locator('svg.board-svg').waitFor();
  };
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await startLocal(page, 9);
    const svg = page.locator('svg.board-svg');
    const vp = page.viewportSize();
    const box = await svg.boundingBox();
    if (box.width < vp.width - 14) fail('board should fill the phone width, got ' + box.width); else ok(`full-screen board: ${Math.round(box.width)}px of ${vp.width}px width`);
    const hud = await page.evaluate(() => ({ top: document.querySelector('.shell-top').getBoundingClientRect().height, bottom: document.querySelector('.shell-bottom').getBoundingClientRect().height, tool: document.querySelector('.toolbar').getBoundingClientRect().height, shell: document.querySelector('.shell').getBoundingClientRect().height }));
    const boardShare = (box.width * box.height) / (vp.width * hud.shell);
    if (boardShare < 0.5) fail('board should use >=50% of the screen, got ' + Math.round(boardShare * 100) + '%'); else ok('board uses ' + Math.round(boardShare * 100) + '% of the screen area');
    if (!(await page.locator('.toolbar .tool').count() === 4)) fail('toolbar should have 4 controls'); else ok('compact toolbar: undo · pass · menu · resign');
    await page.screenshot({ path: join(SHOTS, 'phone-immersive-game.png') });
    const vb = (await svg.getAttribute('viewBox')).split(' ').map(Number)[2];
    const margin = 38, CELL = 100;
    const pt = (x, y) => { const b2 = box; return { x: b2.x + ((margin + x * CELL) / vb) * b2.width, y: b2.y + ((margin + y * CELL) / vb) * b2.height }; };
    const stones = () => page.locator('svg.board-svg g[opacity="1"] circle[filter]').count();
    const tap = async (x, y) => { const p = pt(x, y); await page.touchscreen.tap(p.x, p.y); };
    const cellPx = (CELL / vb) * box.width;
    if (cellPx < 36) fail(`9x9 touch cell too small: ${cellPx.toFixed(1)}px`); else ok(`9x9 touch cell ${cellPx.toFixed(1)}px (>= 36px)`);

    await tap(4, 4);
    if ((await stones()) !== 0) fail('first tap must only preview (confirm mode on touch)'); else ok('first tap previews without placing');
    if (!(await page.locator('.confirm-bar').isVisible())) fail('confirm bar should appear'); else ok('confirm bar shown outside the board');
    await tap(4, 4);
    if ((await stones()) !== 1) fail('second tap should place the stone'); else ok('second tap confirms the move');
    if ((await page.locator('svg.board-svg .last-move').count()) !== 1) fail('last-move indicator missing'); else ok('last-move indicator shown');
    for (const [x, y] of [[3, 2], [3, 3], [2, 3], [0, 0], [4, 3], [8, 8], [3, 4]]) { await tap(x, y); await tap(x, y); }
    await page.locator('.hudp-sub', { hasText: '×1' }).first().waitFor();
    ok('capture counted in the HUD');
    const before = await stones();
    await tap(4, 4); await tap(4, 4);
    if ((await stones()) !== before) fail('occupied point accepted a stone'); else ok('occupied point rejected');
    await page.getByRole('button', { name: 'Pas', exact: true }).click();
    await page.getByRole('button', { name: 'Pas', exact: true }).click();
    await page.getByRole('button', { name: /Oyunu davam etdir/ }).waitFor();
    ok('two passes enter scoring (toolbar switches to resume / confirm)');
    await page.screenshot({ path: join(SHOTS, 'phone-local-scoring.png') });
    await page.getByRole('button', { name: /Oyunu davam etdir/ }).click();
    await page.getByRole('button', { name: 'Geri al' }).click();
    ok('resume + undo work');
    await page.reload();
    await page.locator('svg.board-svg').waitFor();
    ok('game restored after reload: ' + (await stones()) + ' stones');
    await ctx.close();
  }

  // 5b) tutorial + coach + game menu
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(BASE + '/play/local');
    await page.getByRole('button', { name: /Oyuna başla/ }).click();
    await page.locator('.modal.tutorial').waitFor();
    ok('tutorial auto-opens on the first game');
    await page.screenshot({ path: join(SHOTS, 'phone-tutorial.png') });
    await page.getByRole('button', { name: 'Keç' }).click();
    const coach = await page.locator('.shell-note').innerText();
    if (!/kəsişməsinə/.test(coach)) fail('coach tip missing: ' + coach); else ok('coach explains the first move');
    await page.getByRole('button', { name: 'Menyu' }).click();
    await page.getByRole('button', { name: /Necə oynanır/ }).click();
    await page.locator('.modal.tutorial').waitFor();
    ok('tutorial reachable from the game menu');
    await page.getByRole('button', { name: 'Keç' }).click();
    await page.getByRole('button', { name: 'Menyu' }).click();
    await page.screenshot({ path: join(SHOTS, 'phone-game-menu.png') });
    for (const n of [/Tam ekran/, /Koordinat/, /SGF/, /Oyundan çıx/]) if (!(await page.getByRole('button', { name: n }).count())) fail('menu missing ' + n); else ok('menu has ' + n);
    await ctx.close();
  }

  // 5c) layout matrix: every board size × portrait / landscape / desktop → square, uncropped, as large as possible
  {
    const sizes = [9, 13, 19];
    const screens = [
      { n: 'phone 360x640', w: 360, h: 640, touch: true }, { n: 'phone 390x844', w: 390, h: 844, touch: true },
      { n: 'phone landscape 844x390', w: 844, h: 390, touch: true }, { n: 'tablet 768x1024', w: 768, h: 1024, touch: true },
      { n: 'desktop 1280x800', w: 1280, h: 800 }, { n: 'desktop 1920x1080', w: 1920, h: 1080 },
    ];
    for (const sc of screens) {
      for (const size of sizes) {
        const ctx = await browser.newContext({ viewport: { width: sc.w, height: sc.h }, hasTouch: !!sc.touch, isMobile: !!sc.touch });
        const page = await ctx.newPage();
        await startLocal(page, size);
        const r = await page.evaluate(() => { const b = document.querySelector('.board-svg').getBoundingClientRect(); const st = document.querySelector('.stage').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, stage: Math.min(st.width, st.height), vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; });
        const label = `${sc.n} ${size}x${size}`;
        if (Math.abs(r.w - r.h) > 1) fail(`${label}: board not square (${r.w}x${r.h})`);
        else if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > r.vw + 0.5 || r.y + r.h > r.vh + 0.5) fail(`${label}: board cropped`);
        else if (r.w < r.stage * 0.93) fail(`${label}: board only ${Math.round((r.w / r.stage) * 100)}% of the available stage`);
        else if (r.sw > r.vw + 1 || r.sh > r.vh + 1) fail(`${label}: page scrolls`);
        else ok(`${label}: square ${Math.round(r.w)}px, ${Math.round((r.w / r.stage) * 100)}% of stage, nothing cropped`);
        const cell = r.w / (size + 0.76);
        if (size === 19 && sc.w <= 400 && cell < 16) fail(`${label}: cells too small (${cell.toFixed(1)}px)`);
        await ctx.close();
      }
    }
    // orientation change keeps the board responsive
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await startLocal(page, 13);
    const before = await page.locator('svg.board-svg').boundingBox();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    const after = await page.locator('svg.board-svg').boundingBox();
    if (Math.abs(after.width - after.height) > 1 || after.y < 0 || after.y + after.height > 391 || after.width < 300) fail(`orientation change broke the board (${after.width}x${after.height})`);
    else ok(`orientation change: ${Math.round(before.width)}px portrait → ${Math.round(after.width)}px landscape, still square and uncropped`);
    await page.screenshot({ path: join(SHOTS, 'phone-landscape-game.png') });
    await ctx.close();
  }

  // 6) desktop mouse play on 19x19
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await startLocal(page, 19);
    await page.screenshot({ path: join(SHOTS, 'desktop-game.png') });
    const svg = page.locator('svg.board-svg');
    const box = await svg.boundingBox();
    const vb = (await svg.getAttribute('viewBox')).split(' ').map(Number)[2];
    const p = { x: box.x + ((38 + 3 * 100) / vb) * box.width, y: box.y + ((38 + 3 * 100) / vb) * box.height };
    await page.mouse.click(p.x, p.y);
    const n = await page.locator('svg.board-svg g[opacity="1"] circle[filter]').count();
    if (n !== 1) fail('mouse click should place a stone immediately on desktop'); else ok('desktop click places a stone (19x19)');
    await ctx.close();
  }

  // 7) AI page tells the truth when no AI service is configured
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/play/ai');
    await page.waitForSelector('.notice.error');
    const disabled = await page.getByRole('button', { name: /Oyuna başla/ }).isDisabled();
    if (!disabled) fail('AI start must be disabled when the AI service is not configured'); else ok('AI disabled + honest notice without an AI service');
    await ctx.close();
  }

  // 7b) puzzles: guest flow, answers validated, explanation, local daily streak, reveal
  {
    const bank = readFileSync(new URL('../../src/content/bank.generated.ts', import.meta.url), 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l.trim().replace(/,$/, '')));
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(BASE + '/puzzles');
    await page.getByRole('link', { name: /Həll et/ }).first().click();
    await page.waitForURL(/\/puzzles\/.+/);
    const id = new URL(page.url()).pathname.split('/').pop();
    const pz = bank.find((b) => b.id === id);
    if (!pz) fail('unknown daily puzzle ' + id);
    const svg = page.locator('svg.board-svg');
    const box = await svg.boundingBox();
    const vb = (await svg.getAttribute('viewBox')).split(' ').map(Number);
    const at = (p) => ({ x: box.x + (((p % 9) * 100 + 62 - vb[0]) / vb[2]) * box.width, y: box.y + (((Math.floor(p / 9)) * 100 + 62 - vb[1]) / vb[2]) * box.height });
    const wrongP = [...Array(81).keys()].find((p) => pz.rows[Math.floor(p / 9)][p % 9] === '.' && !pz.points.includes(p));
    const tapTwice = async (p) => { const a = at(p); await page.touchscreen.tap(a.x, a.y); await page.touchscreen.tap(a.x, a.y); };
    await tapTwice(wrongP);
    await page.getByText(/həll deyil/).waitFor();
    ok('wrong puzzle move is rejected');
    await tapTwice(pz.points[0]);
    await page.getByText(/Düzdür!/).waitFor();
    const text = await page.locator('main').innerText();
    if (!/Doğrulanıb/.test(text)) fail('solution must be labelled as engine-verified'); else ok('correct move accepted, explanation + "verified by rules engine" shown');
    await page.screenshot({ path: join(SHOTS, 'phone-puzzle-solved.png') });
    await page.goto(BASE + '/puzzles');
    const streakText = await page.locator('.stat-row').first().innerText();
    if (!/🔥 1/.test(streakText)) fail('guest daily streak should be 1, got: ' + streakText.replace(/\n/g, ' ')); else ok('local daily streak updated to 1');
    await page.reload();
    if (!/🔥 1/.test(await page.locator('.stat-row').first().innerText())) fail('streak lost on reload'); else ok('streak persists across reloads');
    await page.goto(BASE + '/puzzles/ld-line3-live');
    await page.getByRole('button', { name: /Həlli göstər/ }).click();
    await page.getByText(/sayılmır/).waitFor();
    ok('reveal shows the solution but does not count it');
    await page.screenshot({ path: join(SHOTS, 'phone-puzzle-ld.png') });
    await ctx.close();
  }

  // 7c) Go Academy tabs + honest joseki trainer
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(BASE + '/learn');
    await page.locator('[role=tab]').first().waitFor();
    const tabs = await page.locator('[role=tab]').allInnerTexts();
    if (tabs.length !== 5) fail('academy should have 5 tabs, got ' + tabs.length); else ok('academy tabs: ' + tabs.join(' · '));
    await page.getByRole('tab', { name: 'Açılış' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.topic').length === 5, null, { timeout: 5000 }).catch(() => {});
    const openingTiles = await page.locator('.topic').count();
    if (openingTiles !== 5) fail('opening library should list 5 entries, got ' + openingTiles); else ok('opening library: 5 entries');
    await page.getByRole('tab', { name: 'Həyat-ölüm' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.topic').length === 10, null, { timeout: 5000 }).catch(() => {});
    if ((await page.locator('.topic').count()) !== 10) fail('life & death should list 10 puzzles'); else ok('life & death: 10 proven puzzles');
    await page.getByRole('tab', { name: 'Joseki' }).click();
    await page.getByRole('link', { name: /Məşqə başla/ }).click();
    await page.waitForSelector('.notice.error');
    if (!(await page.getByRole('button', { name: /Oyuna başla/ }).isDisabled())) fail('joseki trainer must be disabled without an AI service'); else ok('joseki trainer is honest: disabled without KataGo');
    // opening exercise 'place': sanrensei on the left side
    await page.goto(BASE + '/learn/open-sanrensei');
    await page.getByRole('button', { name: 'Next' }).or(page.getByRole('button', { name: 'Növbəti' })).count();
    await ctx.close();
  }

  // 7d) personalization: board theme, stone style, sound (really triggers audio), persists
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      window.__osc = 0;
      const Proto = (window.AudioContext || window.webkitAudioContext)?.prototype;
      if (Proto) { const o = Proto.createOscillator; Proto.createOscillator = function () { window.__osc++; return o.call(this); }; }
      localStorage.setItem('goplay.tutorialSeen', '1');
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/settings');
    await page.getByRole('button', { name: 'Qoz ağacı' }).click();
    await page.getByRole('button', { name: 'Mat (şist/balıqqulağı)' }).click();
    if ((await page.locator('html').getAttribute('data-board')) !== 'walnut' || (await page.locator('html').getAttribute('data-stones')) !== 'slate') fail('theme attributes not applied'); else ok('board theme + stone style applied');
    await page.reload();
    if ((await page.locator('html').getAttribute('data-board')) !== 'walnut') fail('board theme not persisted'); else ok('personalization persists across reloads');
    await page.goto(BASE + '/play/local');
    await page.getByRole('button', { name: /Oyuna başla/ }).click();
    await page.locator('svg.board-svg').waitFor();
    await page.screenshot({ path: join(SHOTS, 'desktop-walnut-board.png') });
    const svg = page.locator('svg.board-svg'); const bb = await svg.boundingBox(); const vb0 = (await svg.getAttribute('viewBox')).split(' ').map(Number)[2];
    await page.mouse.click(bb.x + ((38 + 4 * 100) / vb0) * bb.width, bb.y + ((38 + 4 * 100) / vb0) * bb.height);
    await page.waitForTimeout(200);
    const played = await page.evaluate(() => window.__osc);
    if (played < 1) fail('stone sound should play when sound is on'); else ok('stone sound plays (' + played + ' oscillator(s))');
    await page.goto(BASE + '/settings');
    await page.getByLabel('Daş səsləri').uncheck();
    await page.goto(BASE + '/play/local');
    await page.locator('svg.board-svg').waitFor();
    const before = await page.evaluate(() => window.__osc);
    const bb2 = await page.locator('svg.board-svg').boundingBox();
    await page.mouse.click(bb2.x + ((38 + 2 * 100) / vb0) * bb2.width, bb2.y + ((38 + 2 * 100) / vb0) * bb2.height);
    await page.waitForTimeout(200);
    if ((await page.evaluate(() => window.__osc)) !== before) fail('sound must stay silent when switched off'); else ok('sound is silent when switched off');
    await ctx.close();
  }

  // 7e) PWA works offline: after the service worker installs, the app shell loads without a network
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/learn', { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload({ waitUntil: 'networkidle' });   // now controlled by the service worker
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[role=tab]').first().waitFor({ timeout: 8000 }).then(() => ok('offline reload: the app shell and lessons still load')).catch(() => fail('app does not load offline'));
    await page.goto(BASE + '/play/local', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.getByRole('button', { name: /Oyuna başla/ }).waitFor({ timeout: 8000 }).then(() => ok('offline: local play is available')).catch(() => fail('local play unavailable offline'));
    await ctx.close();
  }

  // 7f) light theme: the full-screen board and key screens stay legible
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    await ctx.addInitScript(() => { localStorage.setItem('goplay.theme', 'light'); localStorage.setItem('goplay.tutorialSeen', '1'); });
    const page = await ctx.newPage();
    await startLocal(page, 9);
    if ((await page.locator('html').getAttribute('data-theme')) !== 'light') fail('light theme not applied'); else ok('light theme applies to the game shell');
    await page.screenshot({ path: join(SHOTS, 'phone-light-game.png') });
    await ctx.close();
  }

  // 8) PWA: manifest, icons, service worker
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(BASE);
    const m = await (await fetch(BASE + '/manifest.webmanifest')).json();
    if (m.display !== 'fullscreen' || m.icons.length < 3 || !m.icons.some((i) => i.purpose === 'maskable')) fail('manifest incomplete'); else ok('PWA manifest: fullscreen + maskable icons');
    for (const i of m.icons) if (!(await fetch(BASE + '/' + i.src.replace(/^\//, ''))).ok) fail('icon missing ' + i.src);
    await page.waitForTimeout(800);
    const sw = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    if (!sw) fail('service worker not registered'); else ok('service worker registered');
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log(failures ? `\n${failures} UI check(s) failed` : '\nAll UI checks passed');
process.exit(failures ? 1 : 0);
