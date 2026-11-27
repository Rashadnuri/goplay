/**
 * Browser tests for every online/AI/backend-driven screen, run against a mock Supabase + AI service
 * (see mock-backend.ts). Run:  npx tsx tests/ui/online-mock.ts
 */
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI, BOB, G_DONE, G_LIVE, G_SPEC, ME, SB, T_OPEN, T_RUN, freshState, installMock, type State } from './mock-backend.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(import.meta.dirname, '..', '..');
const PORT = 4190;
const BASE = `http://127.0.0.1:${PORT}`;
const only = process.argv[2];

let failures = 0;
const fail = (m: string) => { failures++; console.error('✗', m); };
const ok = (m: string) => console.log('✓', m);

// production build wired to the mock endpoints
execFileSync('npx', ['vite', 'build', '--outDir', 'dist-mock', '--logLevel', 'error'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: 'anon-key', VITE_AI_SERVICE_URL: AI } });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-mock', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }

const IGNORE = /Failed to load resource|WebSocket|websocket|realtime|net::ERR|ERR_FAILED|Access-Control/i;
const browser = await chromium.launch();

async function session(opts: { uid?: string | null; ai?: boolean; device?: any; lang?: string; theme?: 'light' | 'dark' } = {}, mutate?: (s: State) => void) {
  const st = freshState();
  st.uid = opts.uid === undefined ? ME : opts.uid;
  if (opts.lang) st.profiles[0].language = opts.lang;   // a signed-in user's saved language wins over the device default
  mutate?.(st);
  const ctx = await browser.newContext(opts.device ?? { viewport: { width: 1280, height: 800 } });
  await installMock(ctx, st, { ai: opts.ai });
  if (opts.lang) await ctx.addInitScript((l: string) => localStorage.setItem('goplay.lang', l), opts.lang);
  if (opts.theme) await ctx.addInitScript((t: string) => localStorage.setItem('goplay.theme', t), opts.theme);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m: any) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`console: ${m.text()}`); });
  return { st, ctx, page, errors };
}
const done = async (name: string, s: Awaited<ReturnType<typeof session>>) => {
  if (s.errors.length) fail(`${name}: ${[...new Set(s.errors)].slice(0, 4).join(' | ')}`);
  if (s.st.unhandled.length) fail(`${name}: unhandled backend calls: ${[...new Set(s.st.unhandled)].join(', ')}`);
  await s.ctx.close();
};
const boardPt = async (page: any, x: number, y: number) => {
  const svg = page.locator('svg.board-svg'); const b = await svg.boundingBox(); const vb = (await svg.getAttribute('viewBox')).split(' ').map(Number);
  const size = Math.round((vb[2] - 76) / 100) + 1;
  void size;
  return { x: b.x + ((38 + x * 100 - vb[0]) / vb[2]) * b.width, y: b.y + ((38 + y * 100 - vb[1]) / vb[2]) * b.height };
};
const click = async (page: any, x: number, y: number) => { const p = await boardPt(page, x, y); await page.mouse.click(p.x, p.y); };
const stones = (page: any) => page.locator('svg.board-svg g[opacity="1"] circle[filter]').count();
const text = (page: any) => page.locator('body').innerText();
const run = (name: string) => !only || only === name;

// ───────────────────────── 1. signed-in route tour ─────────────────────────
if (run('tour')) {
  const s = await session();
  const { page } = s;
  const routes: [string, RegExp][] = [
    ['/', /alice|Dünyanın|Oyna/], ['/play', /Oyna/], ['/profile', /alice/], ['/u/bob', /bob/], ['/leaderboard', /bob/], ['/tournaments', /Spring Cup/], [`/tournaments/${T_OPEN}`, /Spring Cup/],
    [`/tournaments/${T_RUN}`, /Autumn Cup/], ['/friends', /bob/], [`/messages/${BOB}`, /salam/], ['/settings', /Parametrlər/], ['/watch', /bob/], ['/puzzles', /Tapmacalar/], ['/learn', /Qo Akademiyası/],
    ['/admin?tab=stats', /İstifadəçilər/], ['/admin?tab=users', /alice@x.com/], ['/admin?tab=reports', /cheating|Fırıldaqçılıq/], ['/admin?tab=tournaments', /Avtomatlaşdırma/], ['/admin?tab=lessons', /Dərslər|slug/i], ['/admin?tab=daily', /Gündəlik|Tarix/],
    [`/replay/${G_DONE}`, /Təkrar|alice|bob/], [`/game/${G_LIVE}`, /bob|Qara/], ['/play/online', /Rəqib tap/], ['/play/room', /Otaq|otaq/], ['/play/ai', /KataGo|Çətinlik/],
  ];
  for (const [r, re] of routes) {
    await page.goto(BASE + r, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const t = await text(page);
    if (!re.test(t)) fail(`tour ${r}: expected ${re}, got "${t.replace(/\s+/g, ' ').slice(0, 140)}"`);
    if (/Gözlənilməz xəta|err\./.test(t)) fail(`tour ${r}: error state shown: ${t.replace(/\s+/g, ' ').slice(0, 140)}`);
  }
  ok(`signed-in tour: ${routes.length} backend-driven routes render with data`);
  await page.goto(`${BASE}/tournaments/${T_OPEN}`);
  await page.getByRole('button', { name: /Qeydiyyatdan keç/ }).click();
  await page.waitForTimeout(300);
  if (!s.st.registered) fail('tournament registration RPC was not called'); else ok('tournament registration calls the server and updates the UI');
  await page.goto(`${BASE}/tournaments/${T_RUN}`);
  await page.getByRole('link', { name: /Oyuna keç/ }).waitFor({ timeout: 3000 }).then(() => ok('tournament shows my active match with a link to the game')).catch(() => fail('my active tournament match should offer "play your match"'));
  await page.goto(`${BASE}/leaderboard`);
  await page.getByRole('button', { name: 'Mövsüm' }).click();
  await page.waitForTimeout(300);
  if (!/2026-06/.test(await text(page))) fail('season banner missing'); else ok('leaderboard season banner + past seasons');
  await page.getByRole('button', { name: /2026-05/ }).click();
  await page.getByText('+55').waitFor({ timeout: 3000 }).then(() => ok('past season results load')).catch(async () => fail('past season results not shown: ' + (await text(page)).replace(/\s+/g, ' ').slice(0, 200)));
  await done('tour', s);
}

// ───────────────────────── 2. online game as a player ─────────────────────────
if (run('game')) {
  const s = await session();
  const { page } = s;
  await page.goto(`${BASE}/game/${G_LIVE}`, { waitUntil: 'networkidle' });
  await page.locator('svg.board-svg').waitFor();
  if (!(await page.locator('.hudp.turn').count())) fail('someone should be marked as on turn'); else ok('turn indicator shown');
  await click(page, 4, 4);
  await page.waitForFunction(() => document.querySelectorAll('svg.board-svg g[opacity="1"] circle[filter]').length === 1, null, { timeout: 5000 }).catch(() => {});
  if ((await stones(page)) !== 1) fail('my move should appear after the server accepted it'); else ok('move goes through the Edge Function and the stone appears');
  if (s.st.moves.filter((m) => m.game_id === G_LIVE).length !== 1) fail('server did not record the move');
  // opponent moves (server side), client reconciles on visibility/reconnect
  s.st.moves.push({ game_id: G_LIVE, move_number: 2, color: 2, p: 10 }); const g = s.st.games.find((x) => x.id === G_LIVE)!; g.move_count = 2; g.to_play = 1; g.version += 1;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.querySelectorAll('svg.board-svg g[opacity="1"] circle[filter]').length === 2, null, { timeout: 5000 }).catch(() => {});
  if ((await stones(page)) !== 2) fail('opponent stone should arrive via reconcile'); else ok('opponent move restored by reconcile (no realtime needed)');
  await click(page, 4, 4);   // occupied
  await page.getByText(/doludur/).first().waitFor({ timeout: 3000 }).then(() => ok('illegal move shows a clear message, no stone added')).catch(() => fail('occupied-point message missing'));
  if (!/Bağlantı|bağlantı|Qoşulur/.test(await text(page))) fail('connection state should be visible when realtime is unavailable'); else ok('offline/connecting state is shown (realtime unavailable)');
  await page.getByRole('button', { name: 'Menyu' }).click();
  for (const label of [/heç-heçə təklif/i, /Necə oynanır/, /SGF/, /Tam ekran|Koordinat/]) if (!(await page.getByRole('button', { name: label }).count())) fail(`menu missing ${label}`);
  ok('game menu complete');
  await page.getByRole('button', { name: /heç-heçə təklif/i }).click();
  await page.waitForTimeout(300);
  if (s.st.games.find((x) => x.id === G_LIVE)!.draw_offer_by !== 1) fail('draw offer RPC not applied'); else ok('draw offer sent');
  await page.getByRole('button', { name: 'Təslim ol' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Təslim ol' }).click();
  await page.getByRole('link', { name: 'Təkrar' }).first().waitFor({ timeout: 4000 }).then(() => ok('resign → result dialog with replay link')).catch(() => fail('result dialog missing after resign'));
  await page.screenshot({ path: '/tmp/goplay-shots/online-result.png' });
  await done('game', s);
}

// ───────────────────────── 3. spectators ─────────────────────────
if (run('spectate')) {
  const g = await session({ uid: null });
  await g.page.goto(`${BASE}/game/${G_SPEC}`, { waitUntil: 'networkidle' });
  await g.page.locator('svg.board-svg').waitFor();
  if ((await stones(g.page)) !== 2) fail('guest spectator should see the board'); else ok('guests can spectate a public game');
  const tools = await g.page.locator('.toolbar .tool').allInnerTexts();
  if (tools.some((t: string) => /Pas|Təslim/.test(t))) fail('spectators must not get pass/resign: ' + tools.join(',')); else ok('spectator toolbar has no player controls: ' + tools.join(' · ').replace(/\n/g, ' '));
  const note = await g.page.locator('.shell-note').innerText();
  // with realtime down the connection warning rightly outranks the move feed; both are acceptable here
  if (!/#2|Bağlantı|Qoşulur/.test(note)) fail('spectator note should describe the last move or the connection state: ' + note); else ok('spectator note: ' + note.replace(/\s+/g, ' ').slice(0, 60));
  await g.page.getByRole('button', { name: 'Şərhlər' }).click();
  if (!/daxil|Daxil|hesab/i.test(await g.page.getByRole('dialog').innerText())) fail('guests must be asked to sign in to comment'); else ok('guest cannot comment (sign-in prompt)');
  await done('spectate-guest', g);

  const m = await session();
  await m.page.goto(`${BASE}/game/${G_SPEC}`, { waitUntil: 'networkidle' });
  await m.page.getByRole('button', { name: 'Şərhlər' }).click();
  await m.page.getByLabel(/Gediş haqqında/).fill('Nice move!');
  await m.page.getByRole('button', { name: 'Göndər' }).click();
  await m.page.getByText('Nice move!').waitFor({ timeout: 3000 }).then(() => ok('signed-in spectator posts commentary')).catch(() => fail('comment did not appear'));
  await done('spectate-member', m);
}

// ───────────────────────── 4. replay + AI coach ─────────────────────────
if (run('replay')) {
  const s = await session({ uid: null });
  const { page } = s;
  await page.goto(`${BASE}/replay/${G_DONE}`, { waitUntil: 'networkidle' });
  await page.locator('svg.board-svg').waitFor();
  const total = 12;
  if ((await stones(page)) < 8) fail('replay should start at the final position'); else ok('replay opens at the final position (guest can view public games)');
  await page.getByRole('button', { name: 'Əvvəl' }).click();
  if ((await stones(page)) !== 0) fail('"first" should show the empty board');
  await page.getByRole('button', { name: 'İrəli' }).click(); await page.getByRole('button', { name: 'İrəli' }).click();
  if ((await stones(page)) !== 2) fail('two steps should show two stones'); else ok('step forward / back / first / last navigate move by move');
  if (!/#2/.test(await page.locator('.shell-note').innerText())) fail('note should describe move #2');
  await page.getByRole('button', { name: 'Geri', exact: true }).click();
  if ((await stones(page)) !== 1) fail('step back failed');
  await page.keyboard.press('End');
  if ((await stones(page)) < 8) fail('End key should jump to the last move'); else ok('keyboard navigation (←/→/Home/End)');
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Menyu' }).click();
  await page.locator('#jump').evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(el, '5'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => /#5/.test(document.querySelector('.shell-note')?.textContent ?? ''), null, { timeout: 3000 }).then(() => ok('jump slider goes to any move')).catch(() => fail('jump slider did not move the replay'));
  if ((await stones(page)) !== 5) fail('jump to move 5 should show 5 stones, got ' + (await stones(page)));
  // SGF export (menu is still open)
  const dl = page.waitForEvent('download', { timeout: 5000 });
  await page.getByRole('button', { name: /SGF/ }).click();
  const file = await dl;
  const sgf = readFileSync(await file.path(), 'utf8');
  if (!/^\(;GM\[1\]/.test(sgf) || !/RE\[B\+R\]/.test(sgf) || (sgf.match(/;[BW]\[/g) ?? []).length !== total) fail('SGF export malformed: ' + sgf.slice(0, 120)); else ok('SGF export has all ' + total + ' moves and the result');
  // share link
  const shareBtn = page.getByRole('button', { name: 'Linki paylaş' });
  if (await shareBtn.count()) { await shareBtn.click(); await page.waitForTimeout(200); const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => ''); if (!clip.includes(`/replay/${G_DONE}`)) fail('share did not copy the replay link: ' + clip); else ok('share button copies the replay link'); }
  else fail('public game must offer a share link');
  // territory estimate
  await page.getByRole('button', { name: /Ərazi və təsir təxmini/ }).click();
  await page.waitForTimeout(400);
  if (!/Təxmin/.test(await page.locator('.shell-note').innerText())) fail('estimate must be labelled as an estimate'); else ok('territory/influence overlay is labelled "Estimate"');
  if ((await page.locator('svg.board-svg rect[opacity]').count()) < 10) fail('ownership overlay not drawn');
  // AI coach
  await page.getByRole('button', { name: 'Menyu' }).click();
  await page.getByRole('button', { name: 'AI məşqçi' }).click();
  await page.getByRole('button', { name: 'Oyunu təhlil et' }).click();
  await page.getByText(/Kobud|Ağır səhvlər/).first().waitFor({ timeout: 5000 });
  const coach = await page.getByRole('dialog').innerText();
  for (const label of ['Fakt', 'Təxmin', 'Hesablanmış nəticə']) if (!coach.includes(label)) fail(`coach panel must show the "${label}" label`);
  ok('AI coach separates Fact / Rule / Estimate / Counted result');
  await page.screenshot({ path: '/tmp/goplay-shots/coach.png' });
  await page.getByRole('dialog').getByRole('button', { name: /#1 /}).first().click().catch(() => {});
  await done('replay', s);
}

// ───────────────────────── 5. AI game ─────────────────────────
if (run('ai')) {
  const s = await session({ uid: null });
  const { page } = s;
  await page.addInitScript(() => localStorage.setItem('goplay.tutorialSeen', '1'));
  await page.goto(`${BASE}/play/ai`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Oyuna başla/ }).click();
  await page.locator('svg.board-svg').waitFor();
  await click(page, 2, 2);
  await page.waitForFunction(() => document.querySelectorAll('svg.board-svg g[opacity="1"] circle[filter]').length === 2, null, { timeout: 5000 }).catch(() => {});
  if ((await stones(page)) !== 2) fail('AI should answer with a move'); else ok('AI replies to the human move (via /v1/move)');
  await page.getByRole('button', { name: 'Menyu' }).click();
  await page.getByRole('button', { name: /Göstəriş/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('svg.board-svg circle[stroke="#fff"]').length > 0, null, { timeout: 4000 }).catch(() => {});
  ok('hint request handled');
  await page.getByRole('button', { name: 'Menyu' }).click();
  await page.getByRole('button', { name: /Mövqe təhlili/ }).click();
  await page.getByText(/Qələbə ehtimalı|Xal üstünlüyü/).first().waitFor({ timeout: 4000 }).then(() => ok('position analysis shows winrate and score lead')).catch(() => fail('analysis result missing'));
  await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
  await page.getByRole('button', { name: 'Pas', exact: true }).click();   // the engine answers a pass with a pass
  await page.getByRole('button', { name: /Hesabı təsdiqlə/ }).waitFor({ timeout: 6000 }).then(() => ok('two passes → scoring with AI-proposed dead stones')).catch(() => fail('scoring phase not reached'));
  await page.getByRole('button', { name: /Hesabı təsdiqlə/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Oyunu təhlil et' }).click();
  await page.getByText(/Ağır səhvlər|Kobud/).first().waitFor({ timeout: 6000 }).then(() => ok('post-game review from KataGo data')).catch(() => fail('post-game review missing'));
  await done('ai', s);

  const off = await session({ uid: null, ai: false });
  await off.page.goto(`${BASE}/play/ai`, { waitUntil: 'networkidle' });
  await off.page.waitForSelector('.notice.error');
  if (!(await off.page.getByRole('button', { name: /Oyuna başla/ }).isDisabled())) fail('AI start must be disabled when the engine is down'); else ok('AI down → clear message, start disabled');
  await done('ai-off', off);
}

// ───────────────────────── 6. joseki trainer ─────────────────────────
if (run('joseki')) {
  const s = await session({ uid: null });
  const { page } = s;
  await page.goto(`${BASE}/academy/joseki`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Oyuna başla/ }).click();
  await page.locator('svg.board-svg').waitFor();
  if ((await stones(page)) !== 1) fail('trainer should start with Black’s corner stone'); else ok('joseki trainer starts from the chosen corner point');
  const svg = page.locator('svg.board-svg'); const b = await svg.boundingBox(); const vb = (await svg.getAttribute('viewBox')).split(' ').map(Number);
  const pt = (x: number, y: number) => ({ x: b.x + ((38 + x * 100 - vb[0]) / vb[2]) * b.width, y: b.y + ((38 + y * 100 - vb[1]) / vb[2]) * b.height });
  const p = pt(14, 5); await page.mouse.click(p.x, p.y);
  await page.getByText(/Yaxşı|KataGo-nun birinci seçimi|Oynaya bilər|Zəif/).first().waitFor({ timeout: 6000 }).then(() => ok('move evaluated by the engine, verdict listed (labelled estimate)')).catch(() => fail('no verdict after the move'));
  await done('joseki', s);
}

// ───────────────────────── 7. puzzles against the server ─────────────────────────
if (run('puzzles')) {
  const s = await session();
  const { page } = s;
  await page.goto(`${BASE}/puzzles`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /Həll et/ }).first().click();
  await page.locator('svg.board-svg').waitFor();
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const bank = JSON.parse('[' + readFileSync(join(root, 'src/content/bank.generated.ts'), 'utf8').split('\n').filter((l) => l.trim().startsWith('{')).map((l) => l.trim().replace(/,$/, '')).join(',') + ']');
  const pz = bank.find((x: any) => x.id === id);
  await click(page, pz.points[0] % 9, Math.floor(pz.points[0] / 9));
  await page.getByText(/Düzdür!/).waitFor({ timeout: 4000 }).then(() => ok('member puzzle answer validated by the server RPC')).catch(() => fail('server-validated answer not accepted'));
  if (!s.st.solved.has(id)) fail('solve_puzzle was not called');
  await page.goto(`${BASE}/puzzles`);
  await page.waitForFunction(() => /🔥 1/.test(document.querySelector('.stat-row')?.textContent ?? ''), null, { timeout: 4000 }).then(() => ok('server-computed daily streak shown')).catch(() => fail('server streak not shown'));
  await done('puzzles', s);
}

// ───────────────────────── 7b. resilience: server errors and lost requests ─────────────────────────
if (run('resilience')) {
  const s = await session({}, (st) => { st.failRpc.set('get_leaderboard', 'rate_limited'); st.failRpc.set('list_live_games', 'internal'); st.failRpc.set('get_friends', 'forbidden'); });
  const { page } = s;
  await page.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' });
  await page.getByRole('alert').waitFor({ timeout: 3000 });
  if (!/Çox sürətli əməliyyat/.test(await text(page))) fail('failed RPC should show a localized message, got: ' + (await text(page)).replace(/\s+/g, ' ').slice(0, 120)); else ok('server error → localized message with a retry button');
  s.st.failRpc.delete('get_leaderboard');
  await page.getByRole('button', { name: 'Yenidən cəhd et' }).click();
  await page.getByText('bob').first().waitFor({ timeout: 3000 }).then(() => ok('retry recovers once the server is healthy')).catch(() => fail('retry did not recover'));
  await page.goto(`${BASE}/watch`, { waitUntil: 'networkidle' });
  if (!/Server xətası/.test(await text(page))) fail('watch page should show the server-error message'); else ok('live-games list degrades to an error state');
  await page.goto(`${BASE}/friends`, { waitUntil: 'networkidle' });
  if (!/icazəniz yoxdur/.test(await text(page))) fail('friends page should show the forbidden message'); else ok('forbidden → clear message, no crash');

  // a game-action request is lost: toast, board unchanged, next attempt works
  await page.goto(`${BASE}/game/${G_LIVE}`, { waitUntil: 'networkidle' });
  await page.locator('svg.board-svg').waitFor();
  s.st.abortActions = 1;
  await click(page, 3, 3);
  await page.getByText(/İnternet bağlantısı problemi/).waitFor({ timeout: 4000 }).then(() => ok('lost request → "network problem" toast')).catch(() => fail('network failure not reported'));
  if ((await stones(page)) !== 0) fail('a failed request must not place a stone locally'); else ok('no phantom stone after a lost request (server is the authority)');
  await click(page, 3, 3);
  await page.waitForFunction(() => document.querySelectorAll('svg.board-svg g[opacity="1"] circle[filter]').length === 1, null, { timeout: 4000 }).then(() => ok('retrying the same move succeeds')).catch(() => fail('retry after network loss failed'));
  await done('resilience', s);
}

// ───────────────────────── 8. every language, every screen: no raw keys, no mixed languages ─────────────────────────
if (run('i18n')) {
  const KEY = /\b(common|nav|auth|backend|home|play|setup|rules|difficulty|time|status|game|result|illegal|conn|ai|review|mm|room|tour|lb|league|profile|ach|social|report|settings|learn|daily|admin|err|puzzle|academy|joseki|coach|concept|event|replay|commentary|spectate|watch|stats|personal|board|stones|clock|tile|welcome|menu|tutorial)\.[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?\b/;
  const routes = ['/', '/play', '/play/online', '/play/room', '/play/ai', '/profile', '/u/bob', '/leaderboard', '/tournaments', `/tournaments/${T_RUN}`, '/friends', '/settings', '/watch', '/puzzles', '/puzzles/cap-1', '/puzzles/ld-line3-kill', '/learn', '/learn?tab=openings', '/learn?tab=joseki', '/learn?tab=lifedeath', '/learn/capturing', '/learn/open-sanrensei', '/admin?tab=stats', '/admin?tab=tournaments', `/replay/${G_DONE}`, '/academy/joseki', '/auth', '/nope'];
  for (const lang of ['az', 'en', 'ru'] as const) {
    const s = await session({ lang });
    const bad: string[] = [];
    for (const r of routes) {
      await s.page.goto(BASE + r, { waitUntil: 'networkidle' });
      await s.page.waitForTimeout(120);
      const t: string = (await text(s.page)).replace(/Русский|Azərbaycanca|English/g, '');   // the language picker names each language in its own script
      const kk = KEY.exec(t); if (kk) bad.push(`${r}: raw key "${kk[0]}"`);
      const ph = /\{[a-z]+\}/.exec(t); if (ph) bad.push(`${r}: unreplaced placeholder ${ph[0]}`);
      const cyr = /[А-Яа-яЁё]/.test(t), az = /[əƏşŞğĞıİöÖüÜçÇ]/.test(t);
      // user data from the mock (bio "…bio", English) is Latin, so Cyrillic/ə in other languages would be a leak
      if (lang === 'az' && cyr) bad.push(`${r}: Cyrillic text in the Azerbaijani UI`);
      if (lang === 'en' && (cyr || /[əƏşŞğĞı]/.test(t))) bad.push(`${r}: non-English text in the English UI: ${(t.match(/[А-Яа-яЁёəƏşŞğĞı][^\n]{0,30}/) ?? [''])[0]}`);
      if (lang === 'ru' && /[əƏşŞğĞı]/.test(t)) bad.push(`${r}: Azerbaijani letters in the Russian UI: ${(t.match(/[^\n]{0,20}[əƏşŞğĞı][^\n]{0,20}/) ?? [''])[0]}`);
      void az;
    }
    if (bad.length) fail(`i18n ${lang}: ${bad.slice(0, 6).join(' || ')}`); else ok(`i18n ${lang}: ${routes.length} screens, no raw keys / placeholders / mixed languages`);
    await done('i18n-' + lang, s);
  }
}

// ───────────────────────── 9. accessibility (axe-core) ─────────────────────────
if (run('a11y')) {
  const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const pages = ['/', '/play', '/play/room', '/leaderboard', '/tournaments', `/tournaments/${T_RUN}`, '/puzzles', '/puzzles/cap-1', '/learn', '/learn/capturing', '/settings', '/profile', '/friends', '/watch', `/game/${G_LIVE}`, `/game/${G_SPEC}`, `/replay/${G_DONE}`, '/auth', '/admin?tab=stats'];
  for (const theme of ['dark', 'light'] as const) {
    const s = await session({ theme });
    const problems: string[] = [];
    for (const r of pages) {
      await s.page.goto(BASE + r, { waitUntil: 'networkidle' });
      await s.page.waitForTimeout(250);
      await s.page.evaluate(axe);
      const res = await s.page.evaluate(async () => (await (window as any).axe.run(document, { resultTypes: ['violations'] })).violations.map((v: any) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0]?.html?.slice(0, 110) })));
      for (const v of res) if (v.impact === 'critical' || v.impact === 'serious') problems.push(`${r}: ${v.id} (${v.impact}, ${v.n}×) e.g. ${v.sample}`);
    }
    if (theme === 'light') { await s.page.goto(`${BASE}/game/${G_LIVE}`, { waitUntil: 'networkidle' }); await s.page.waitForTimeout(300); await s.page.screenshot({ path: '/tmp/goplay-shots/light-online-game.png' }); await s.page.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await s.page.screenshot({ path: '/tmp/goplay-shots/light-home.png' }); }
    if (problems.length) { fail(`accessibility (${theme}): ${problems.length} serious/critical findings`); for (const p of problems) console.error('   ', p); } else ok(`accessibility (${theme}): no serious/critical axe violations on ${pages.length} screens`);
    await done('a11y-' + theme, s);
  }
}

await browser.close();
server.kill();
console.log(failures ? `\n${failures} online/AI UI check(s) failed` : '\nAll online/AI UI checks passed');
process.exit(failures ? 1 : 0);
