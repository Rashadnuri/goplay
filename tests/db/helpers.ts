import { ActionError, planAction, type Action, type Snapshot } from '../../supabase/functions/_shared/game-logic.ts';
import type { Db } from './harness.ts';

/** Mirrors supabase/functions/game-action/index.ts (minus HTTP): snapshot → plan → atomic apply, with retry on conflict. */
export async function act(db: Db, gameId: string, userId: string, action: Action, opts: { snapshot?: Snapshot } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const snap: Snapshot = opts.snapshot && attempt === 0 ? opts.snapshot : (await db.svc(`select public.svc_get_game($1) as s`, [gameId]))[0].s;
    const plan = planAction(snap, userId, action);
    try {
      await db.svc(`select public.svc_apply_game_update($1,$2,$3::jsonb,$4::jsonb,$5)`, [
        gameId, plan.expectedVersion, JSON.stringify(plan.patch), plan.insertMoves ? JSON.stringify(plan.insertMoves) : null, plan.deleteFrom,
      ]);
      return;
    } catch (e: any) {
      if (/version_conflict/.test(e.message)) continue;
      throw e;
    }
  }
  throw new ActionError('version_conflict');
}

export const snapshot = async (db: Db, gameId: string): Promise<Snapshot> =>
  (await db.svc(`select public.svc_get_game($1) as s`, [gameId]))[0].s;

export async function actCode(db: Db, gameId: string, userId: string, action: Action, opts: { snapshot?: Snapshot } = {}) {
  try {
    await act(db, gameId, userId, action, opts);
    return 'ok';
  } catch (e: any) {
    return e instanceof ActionError ? e.code : (/err:([a-z_]+)/.exec(e.message)?.[1] ?? `raw:${e.message}`);
  }
}

export interface Players { black: string; white: string; gameId: string }

/** Creates a ranked quick-match game between two users, returns who holds which colour. */
export async function newRankedGame(db: Db, a: string, b: string, size = 9, initial = 300, inc = 0): Promise<Players> {
  // equal ratings → the rating window never makes tests order-dependent
  await db.svc(`update public.player_ratings set rating = 1000 where user_id in ($1,$2) and board_size = $3`, [a, b, size]);
  const first = await db.as(a, `select public.join_matchmaking($1,$2,$3) as g`, [size, initial, inc]);
  if (first[0].g) throw new Error('unexpected instant match');
  const second = await db.as(b, `select public.join_matchmaking($1,$2,$3) as g`, [size, initial, inc]);
  const gameId = second[0].g as string;
  const parts = await db.svc(`select user_id, color from public.game_participants where game_id = $1`, [gameId]);
  const black = parts.find((p: any) => p.color === 1).user_id;
  const white = parts.find((p: any) => p.color === 2).user_id;
  return { black, white, gameId };
}

export const P = (x: number, y: number, size = 9) => y * size + x;

/** Plays n alternating non-conflicting moves (spread over the board). */
export async function playMoves(db: Db, g: Players, n: number, size = 9) {
  for (let i = 0; i < n; i++) {
    const who = i % 2 === 0 ? g.black : g.white;
    const col = (i * 2) % size;
    const row = Math.floor((i * 2) / size) * 2 % size;
    await act(db, g.gameId, who, { type: 'move', p: P(col, row, size) });
  }
}
