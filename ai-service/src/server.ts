import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { GoGame, makeConfig, PASS } from '../../src/engine/index.ts';
import { KataGoAdapter, UnconfiguredAdapter } from './katago.ts';
import { PROFILES, chooseMove, reviewGame } from './play.ts';
import { DIFFICULTIES, EngineUnavailableError, type Difficulty, type GoEngineAdapter, type PositionRequest } from './types.ts';

export interface ServerDeps {
  adapter: GoEngineAdapter;
  /** returns a user id for a valid bearer token, null otherwise */
  authenticate: (token: string) => Promise<string | null>;
  allowedOrigins: string[];
  /** let visitors without an account use the AI (rate-limited by IP). Off by default. */
  allowAnonymous?: boolean;
  maxVisitsCap: number;
  /** requests per user per minute */
  rateLimitPerMinute: number;
  /** max concurrent engine requests; more are rejected with 503 */
  maxConcurrent: number;
  log?: (entry: Record<string, unknown>) => void;
}

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

function parsePosition(body: any): PositionRequest {
  const size = body?.size;
  if (![9, 13, 19].includes(size)) throw new HttpError(400, 'invalid_size');
  const rules = body.rules === 'chinese' ? 'chinese' : 'japanese';
  const handicap = Number.isInteger(body.handicap) ? body.handicap : 0;
  if (handicap !== 0 && (handicap < 2 || handicap > 9)) throw new HttpError(400, 'invalid_handicap');
  const komi = typeof body.komi === 'number' && Math.abs(body.komi) <= 50 ? body.komi : handicap >= 2 ? 0.5 : rules === 'chinese' ? 7.5 : 6.5;
  if (!Array.isArray(body.moves) || body.moves.length > 1000 || !body.moves.every((m: unknown) => Number.isInteger(m))) throw new HttpError(400, 'invalid_moves');
  // Validate the whole sequence with the same rules engine as the clients — KataGo only ever sees legal games.
  try {
    GoGame.fromMoves(makeConfig({ size, rules, komi, handicap }), body.moves);
  } catch {
    throw new HttpError(400, 'illegal_move_sequence');
  }
  return { size, rules, komi, handicap, moves: body.moves };
}

export function createServer(deps: ServerDeps): Server {
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const buckets = new Map<string, { start: number; n: number }>();
  let inflight = 0;

  const rateLimited = (uid: string) => {
    const now = Date.now();
    const b = buckets.get(uid);
    if (!b || now - b.start > 60_000) {
      buckets.set(uid, { start: now, n: 1 });
      return false;
    }
    b.n++;
    return b.n > deps.rateLimitPerMinute;
  };

  const send = (req: IncomingMessage, res: ServerResponse, status: number, body: unknown) => {
    const origin = req.headers.origin;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Vary: 'Origin' };
    if (origin && (deps.allowedOrigins.includes('*') || deps.allowedOrigins.includes(origin))) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, content-type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  };

  const readJson = (req: IncomingMessage): Promise<any> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 200_000) {
          reject(new HttpError(413, 'payload_too_large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
        } catch {
          reject(new HttpError(400, 'invalid_json'));
        }
      });
      req.on('error', reject);
    });

  return createHttpServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'OPTIONS') return send(req, res, 204, {});
      if (req.method === 'GET' && url.pathname === '/health') {
        const h = await deps.adapter.health();
        return send(req, res, h.ok ? 200 : 503, { status: h.ok ? 'ok' : 'unavailable', ...h });
      }
      if (req.method !== 'POST' || !['/v1/move', '/v1/analyze', '/v1/review'].includes(url.pathname)) throw new HttpError(404, 'not_found');

      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      let uid = token ? await deps.authenticate(token) : null;
      if (!uid && !token && deps.allowAnonymous) uid = `ip:${req.headers['x-forwarded-for'] ?? req.socket.remoteAddress}`;
      if (!uid) throw new HttpError(401, 'auth_required');
      if (rateLimited(uid)) throw new HttpError(429, 'rate_limited');
      const body = await readJson(req);
      const pos = parsePosition(body);

      if (inflight >= deps.maxConcurrent) throw new HttpError(503, 'busy');
      inflight++;
      try {
        if (url.pathname === '/v1/move') {
          const difficulty: Difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : 'intermediate';
          const prof = PROFILES[difficulty];
          const a = await deps.adapter.analyze(pos, {
            maxVisits: Math.min(prof.maxVisits, deps.maxVisitsCap),
            humanProfile: prof.humanProfile,
          });
          const choice = chooseMove(a, difficulty);
          send(req, res, 200, {
            move: choice.p === PASS ? { type: 'pass' } : { type: 'play', p: choice.p },
            resign: choice.resign,
            winrate: a.winrate,
            scoreLead: a.scoreLead,
            difficulty,
          });
        } else if (url.pathname === '/v1/analyze') {
          const visits = Math.min(Number.isInteger(body.visits) ? body.visits : 200, deps.maxVisitsCap);
          const a = await deps.adapter.analyze(pos, { maxVisits: Math.max(1, visits), ownership: true });
          send(req, res, 200, {
            toPlay: a.toPlay,
            winrate: a.winrate,
            scoreLead: a.scoreLead,
            candidates: a.candidates.slice(0, 5),
            ownership: a.ownership,
          });
        } else {
          const visits = Math.min(Number.isInteger(body.visits) ? body.visits : 40, deps.maxVisitsCap);
          const turns = await deps.adapter.analyzeTurns(pos, { maxVisits: Math.max(1, visits) });
          const first = pos.handicap >= 2 ? 2 : 1;
          const moves = reviewGame(turns, pos.moves, first);
          send(req, res, 200, {
            winrates: turns.map((t) => t?.winrate ?? null),
            scoreLeads: turns.map((t) => t?.scoreLead ?? null),
            moves,
            summary: {
              blunders: moves.filter((m) => m.kind === 'blunder').length,
              mistakes: moves.filter((m) => m.kind === 'mistake').length,
              inaccuracies: moves.filter((m) => m.kind === 'inaccuracy').length,
            },
          });
        }
      } finally {
        inflight--;
      }
      log({ level: 'info', path: url.pathname, user: uid, ms: Date.now() - started });
    } catch (e: any) {
      if (e instanceof HttpError) return send(req, res, e.status, { error: e.code });
      if (e instanceof EngineUnavailableError) {
        log({ level: 'error', msg: 'engine_unavailable', detail: e.message });
        return send(req, res, 503, { error: 'engine_unavailable', detail: e.message });
      }
      log({ level: 'error', msg: 'unhandled', err: String(e?.message ?? e) });
      send(req, res, 500, { error: 'internal' });
    }
  });
}

/** Validates a Supabase access token by asking Supabase Auth (no JWT secret needed in this service). */
export function supabaseAuthenticator(url: string, anonKey: string) {
  const cache = new Map<string, { uid: string; exp: number }>();
  return async (token: string): Promise<string | null> => {
    const hit = cache.get(token);
    if (hit && hit.exp > Date.now()) return hit.uid;
    try {
      const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } });
      if (!r.ok) return null;
      const u = (await r.json()) as { id?: string };
      if (!u.id) return null;
      cache.set(token, { uid: u.id, exp: Date.now() + 60_000 });
      if (cache.size > 5000) cache.clear();
      return u.id;
    } catch {
      return null;
    }
  };
}

function main() {
  const env = process.env;
  const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter((k) => !env[k]);
  if (need.length) {
    console.error(`Missing required environment variables: ${need.join(', ')}`);
    process.exit(1);
  }
  const adapter: GoEngineAdapter =
    env.KATAGO_BIN && env.KATAGO_MODEL && env.KATAGO_CONFIG
      ? new KataGoAdapter({ binary: env.KATAGO_BIN, model: env.KATAGO_MODEL, config: env.KATAGO_CONFIG, humanModel: env.KATAGO_HUMAN_MODEL })
      : new UnconfiguredAdapter('KATAGO_BIN, KATAGO_MODEL and KATAGO_CONFIG are not set — no AI engine is installed on this server.');
  const server = createServer({
    adapter,
    authenticate: supabaseAuthenticator(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    maxVisitsCap: Number(env.MAX_VISITS_CAP ?? 1000),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 30),
    maxConcurrent: Number(env.MAX_CONCURRENT ?? 4),
    allowAnonymous: env.AI_ALLOW_ANON === 'true',
  });
  const port = Number(env.PORT ?? 8787);
  server.listen(port, () => console.log(JSON.stringify({ level: 'info', msg: 'ai-service listening', port })));
  process.on('SIGTERM', () => adapter.close().then(() => process.exit(0)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
