// Supabase Edge Function (Deno): validates and applies a single game action.
// Deploy: supabase functions deploy game-action
// Secrets (auto-provided by Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ActionError, planAction, type Action, type Snapshot } from '../_shared/game-logic.ts';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, fn: 'game-action', ...extra }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAction(a: any): Action | null {
  if (!a || typeof a !== 'object') return null;
  const exp = a.expected_move_count;
  if (exp !== undefined && !Number.isInteger(exp)) return null;
  const pts = (x: any) => Array.isArray(x) && x.length <= 361 && x.every((n) => Number.isInteger(n));
  switch (a.type) {
    case 'move': return Number.isInteger(a.p) ? { type: 'move', p: a.p, expected_move_count: exp } : null;
    case 'pass': return { type: 'pass', expected_move_count: exp };
    case 'mark_dead': return pts(a.dead) ? { type: 'mark_dead', dead: a.dead } : null;
    case 'accept_score': return a.dead === undefined || pts(a.dead) ? { type: 'accept_score', dead: a.dead } : null;
    case 'resume': return { type: 'resume' };
    case 'request_undo': return { type: 'request_undo' };
    case 'respond_undo': return typeof a.accept === 'boolean' ? { type: 'respond_undo', accept: a.accept } : null;
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  if (!token) return json(401, { error: 'auth_required' });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: u, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !u.user) return json(401, { error: 'auth_required' });
  const userId = u.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  if (!UUID.test(body?.game_id ?? '')) return json(400, { error: 'invalid_game_id' });
  const action = parseAction(body.action);
  if (!action) return json(400, { error: 'invalid_action' });

  const rl = await admin.rpc('check_rate_limit', { p_key: `act:${userId}`, p_max: 120, p_window_seconds: 60 });
  if (rl.error) return json(429, { error: 'rate_limited' });
  const ban = await admin.rpc('assert_not_banned', { p_user: userId });
  if (ban.error) return json(403, { error: 'banned' });

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: snap, error } = await admin.rpc('svc_get_game', { p_game: body.game_id });
    if (error || !snap) return json(404, { error: 'game_not_found' });
    let plan;
    try {
      plan = planAction(snap as Snapshot, userId, action);
    } catch (e) {
      if (e instanceof ActionError) {
        log('info', 'action_rejected', { code: e.code, game: body.game_id, user: userId, type: action.type });
        return json(409, { error: e.code });
      }
      log('error', 'plan_failed', { game: body.game_id, err: String(e) });
      return json(500, { error: 'internal' });
    }
    const res = await admin.rpc('svc_apply_game_update', {
      p_game: body.game_id,
      p_expected_version: plan.expectedVersion,
      p_patch: plan.patch,
      p_insert_moves: plan.insertMoves,
      p_delete_from: plan.deleteFrom,
    });
    if (!res.error) return json(200, { ok: true, version: res.data?.version });
    if (/version_conflict/.test(res.error.message)) continue; // someone else acted first: re-read and re-validate
    if (/game_over/.test(res.error.message)) return json(409, { error: 'game_over' });
    log('error', 'apply_failed', { game: body.game_id, err: res.error.message });
    return json(500, { error: 'internal' });
  }
  return json(409, { error: 'version_conflict' });
});
