# GO PLAY — Play. Think. Compete.
Mobile-first Go platform: local, AI (KataGo), online (Supabase), tournaments, rankings, lessons, admin. Languages: az (default), en, ru.
See `DEPLOYMENT.md`. Dev: `npm i && npm run dev` (works offline-mode without Supabase). Tests: `npm test`.
Layout: `src/engine` (pure rules engine) · `supabase/` (migrations, Edge Function) · `ai-service/` (KataGo adapter) · `src/` (PWA) · `tests/`.

## Testing
| Command | What it checks |
|---|---|
| `npm run typecheck` | strict TypeScript for the app, tests and the Edge Function |
| `npm test` | engine (+ differential fuzz vs. an independent reference), puzzles/solver, Postgres integration (RLS, matchmaking, tournaments, seasons, fuzzed server pipeline, the real Edge Function), AI service, i18n completeness, design-token contrast, security scan |
| `npm run build && npm run test:ui` | responsive layouts (6 sizes, 9/13/19 boards, orientation), touch play, offline PWA, themes, sound |
| `npm run test:online` | every backend-driven screen against a mock Supabase/AI (real engine), all three languages, resilience, accessibility (axe) in both themes |
| `npm run test:all` | everything above, in order |

Not covered by automation: a live Supabase project (Realtime, presence, pg_cron), a real KataGo, real mobile devices/Safari fullscreen.
