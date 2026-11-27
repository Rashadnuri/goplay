import { AppError, errorCode, sb } from './supabase.ts';
import type { GameRow, MoveRow, Participant } from './types.ts';

export type GameAction =
  | { type: 'move'; p: number; expected_move_count?: number }
  | { type: 'pass'; expected_move_count?: number }
  | { type: 'mark_dead'; dead: number[] }
  | { type: 'accept_score'; dead?: number[] }
  | { type: 'resume' }
  | { type: 'request_undo' }
  | { type: 'respond_undo'; accept: boolean };

/** Sends an intent to the `game-action` Edge Function; the server validates against the stored game. */
export async function sendAction(gameId: string, action: GameAction): Promise<void> {
  const { error, response } = await sb().functions.invoke('game-action', { body: { game_id: gameId, action } }) as {
    error: (Error & { context?: Response }) | null;
    response?: Response;
  };
  if (!error) return;
  const ctx = error.context ?? response;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = await ctx.clone().json();
      if (j?.error) throw new AppError(String(j.error));
    } catch (e) {
      if (e instanceof AppError) throw e;
    }
  }
  throw new AppError(errorCode(error));
}

export interface LoadedGame {
  game: GameRow;
  participants: Participant[];
  moves: MoveRow[];
}

export async function loadGame(id: string): Promise<LoadedGame> {
  const client = sb();
  const [g, p, m] = await Promise.all([
    client.from('games').select('*').eq('id', id).maybeSingle(),
    client.from('game_participants').select('*, profiles(username, avatar)').eq('game_id', id),
    client.from('game_moves').select('move_number, color, p').eq('game_id', id).order('move_number'),
  ]);
  if (g.error || p.error || m.error) throw new AppError(errorCode(g.error ?? p.error ?? m.error));
  if (!g.data) throw new AppError('game_not_found');
  return { game: g.data as GameRow, participants: p.data as unknown as Participant[], moves: m.data as MoveRow[] };
}

export async function loadMoves(id: string): Promise<MoveRow[]> {
  const { data, error } = await sb().from('game_moves').select('move_number, color, p').eq('game_id', id).order('move_number');
  if (error) throw new AppError(errorCode(error));
  return data as MoveRow[];
}

/** Estimates (server clock − local clock) in ms using the database clock. */
export async function clockOffset(): Promise<number> {
  const t0 = Date.now();
  const { data, error } = await sb().rpc('server_now');
  if (error || !data) return 0;
  const t1 = Date.now();
  return new Date(data as string).getTime() - (t0 + t1) / 2;
}

export const TIME_PRESETS = [
  { id: 'blitz', initial: 180, increment: 2 },
  { id: 'rapid', initial: 600, increment: 5 },
  { id: 'classic', initial: 1200, increment: 10 },
  { id: 'untimed', initial: 0, increment: 0 },
] as const;
