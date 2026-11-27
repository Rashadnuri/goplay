# GO PLAY — deployment guide

Architecture: **React PWA** (static hosting) · **Supabase** (Auth, Postgres+RLS, Realtime, Edge Function `game-action`) · **built-in free AI** (runs in the browser, no server) · optional **ai-service** (Node + KataGo, much stronger).

## 1. Supabase
1. Create a project. `npm i -g supabase`, then `supabase link --project-ref <ref>`.
2. Apply the schema: `supabase db push` (runs `supabase/migrations/0001…0008`). **Run `supabase/seed.sql`** to load the 15 lessons and the 20-puzzle bank (answers go to `puzzle_solutions`, which clients cannot read). Regenerate with `npx tsx scripts/gen-seed.mjs`; if you change puzzles, regenerate the bank first with `npx tsx scripts/gen-bank.ts` (answers are computed by the rules engine / exhaustive search).
3. Deploy move validation: `npm run sync:engine && supabase functions deploy game-action`. It validates every move with the same engine as the browser. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected automatically; optionally `supabase secrets set ALLOWED_ORIGIN=https://your-domain`.
4. Auth → URL configuration: set Site URL and redirect URLs to your domain. Enable email confirmation as desired.
5. Enable extension **pg_cron** and schedule these jobs (SQL at the bottom of `0007_security.sql` and `0008_features.sql`):
   - every minute: `sweep_timeouts()`, `process_tournament_deadlines()`, `start_due_tournaments()` — finishes timed-out games, forfeits no-shows, starts weekly cups when due
   - Mondays: `ensure_weekly_tournaments()` — creates the Saturday 17:00 UTC cups (9×9 and 13×13, single elimination, 10+5)
   - 1st of each month: `close_season(<previous month>)` — snapshots the monthly ranking and awards season medals
   Admins can also trigger all of these from **Admin → Tournaments → Automation**.
6. Make yourself admin: `update public.profiles set role='admin' where username='YOU';` (SQL editor; users cannot change `role` themselves).

## 2. Environment variables
Frontend (public, build time): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_SERVICE_URL` (optional).
Never put the service-role key in the frontend. It lives only in the Edge Function runtime.
ai-service: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `KATAGO_BIN`, `KATAGO_MODEL`, `KATAGO_CONFIG`, optional `KATAGO_HUMAN_MODEL`, `ALLOWED_ORIGINS` (comma list), `PORT`, `MAX_VISITS_CAP`, `RATE_LIMIT_PER_MINUTE`, `MAX_CONCURRENT`, `AI_ALLOW_ANON=true` (lets guests play the AI, IP rate-limited).

## 3. KataGo / AI service (optional)
Without it, AI play, hints, territory estimates and a winrate-curve review use the **free built-in engine** (Monte-Carlo tree search in a Web Worker). It is *not* KataGo: club level on 9×9/13×13, weak on 19×19, and it cannot blame individual moves. Set `VITE_AI_SERVICE_URL` to use KataGo when it is reachable; the app falls back to the built-in engine if it is down.
Not included in this repository's runtime — you must provide the engine. Without it `/health` returns 503 `unavailable` and the app shows "AI unavailable" (it never fakes moves).
- Download KataGo (CUDA/OpenCL for GPU, Eigen for CPU) and a network (https://katagotraining.org). Use `ai-service/katago/analysis.cfg` (sets Black-relative reporting, which the adapter relies on).
- Docker: `docker build -f ai-service/Dockerfile --build-arg KATAGO_URL=… --build-arg KATAGO_MODEL_URL=… -t goplay-ai .` then run with the env vars above on a GPU host (Fly.io GPU, RunPod, a VPS…). Put it behind HTTPS and set `VITE_AI_SERVICE_URL`.
- Difficulty uses visit limits + move sampling. Rank-calibrated play (`rank_20k` … `rank_1d`) is only used if you also supply KataGo's human-SL model via `KATAGO_HUMAN_MODEL`; its strength has not been calibrated here.

## 4. Build & host
```
npm ci
npm test                 # engine, database (PGlite/Postgres), AI service, i18n, content
npm run build            # syncs engine, type-checks, builds PWA into dist/
npm run test:ui          # responsive/touch/PWA checks in Chromium (after build)
```
Host `dist/` on any static host (Netlify, Vercel, Cloudflare Pages, S3+CDN) with an SPA fallback to `/index.html` and HTTPS (required for PWA install). Point your domain's DNS (CNAME/A) at the host and add it to Supabase redirect URLs and `ALLOWED_ORIGIN`/`ALLOWED_ORIGINS`.

## 5. Feature notes
- **Puzzles**: members' answers are validated by `solve_puzzle()` in the database; daily streaks are computed from `daily_completions` (UTC days). Guests are validated in the browser and keep a device-local streak. All puzzle answers are derived by code, never typed by hand; life-and-death solutions are proven by exhaustive search (`src/engine/puzzles.ts`).
- **AI coach / territory estimate / joseki trainer** work with the built-in engine (coarser) or KataGo; the **joseki trainer** needs KataGo. Every AI-derived number is labelled *Estimate*; engine-checked board facts are labelled *Fact*; only the counted game result is labelled *Counted result*.
- **Replays** are public for public games; private games become viewable by link only after a player enables sharing (`set_replay_shared`).
- **Spectating** works without an account. Commentary needs an account and is hidden from the players while their game is running (RLS), so it cannot be used to coach them.
- **Preferences** (board wood, stone style, sound, custom clocks) are stored on the device and synced to `profiles.prefs` when signed in.

## 6. Known limitations
- AI games are played and scored client-side and are **not rated** (AI moves cannot be verified server-side); achievements come from online games only.
- Dead-stone agreement is manual (toggle groups; AI games get KataGo suggestions). No automatic seki/life detection in online games.
- Lesson/daily exercises are checked in the browser (they carry no rating).
- Edge Function and `pg_cron` could not be executed in the build sandbox (no Deno / hosted Supabase): the move planner is tested through the same code path against real Postgres, but deploy and smoke-test the function once.
- Supabase Realtime, presence and the PWA service worker were not exercised against a live project here.
- Elo (K 40 → 24 after 30 games) is used instead of a full Go-rank/Glicko model; leagues are rating bands.
- Google/OAuth sign-in is not wired; email+password only.
- Puzzles are single-move key-point problems (no multi-move variation trees yet). Life-and-death positions containing a ko are excluded because their result depends on ko threats.
- The opening library teaches geometry-exact patterns (corner points, sanrensei, tengen, handicap stones). It does not ship memorised joseki sequences; the joseki trainer evaluates your moves with KataGo instead, so it is only as good as the engine/visits configured.
- Mistake explanations are rule-based (atari, captures, first-line moves). They are not a substitute for a teacher; the "stronger move" itself is a KataGo estimate.
- Live commentary is human (spectators); there is no automatic engine commentary during live games, to avoid feeding engine suggestions to players. Moves are described factually from the rules engine.
- Season ranking uses rating *gained* in the calendar month; ratings are not reset. Medals need at least 3 rated games.
- Sound is synthesised in the browser (no audio files); the Web Audio API must be allowed by the browser, which usually requires a first tap.
