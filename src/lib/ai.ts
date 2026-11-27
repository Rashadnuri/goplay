import { AI_URL, supabase, AppError } from './supabase.ts';
import type { BoardSize } from '../engine/index.ts';
import { localAnalyze, localMove } from '../ai/local.ts';

export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['beginner', 'easy', 'intermediate', 'advanced', 'expert'];

export interface AiPosition {
  size: BoardSize;
  komi: number;
  rules: 'japanese' | 'chinese';
  handicap: number;
  moves: number[];
}

export interface AiCandidate { p: number; visits: number; winrate: number; scoreLead: number; prior: number; pv: number[] }
export interface AiAnalysis { toPlay: 1 | 2; winrate: number; scoreLead: number; candidates: AiCandidate[]; ownership?: number[] }
export interface AiMove { move: { type: 'play'; p: number } | { type: 'pass' }; resign: boolean; winrate: number; scoreLead: number }
export interface AiReview {
  winrates: (number | null)[];
  scoreLeads: (number | null)[];
  moves: { move: number; color: 1 | 2; p: number; loss: number; scoreLoss: number; kind: 'good' | 'inaccuracy' | 'mistake' | 'blunder'; best?: number }[];
  summary: { blunders: number; mistakes: number; inaccuracies: number };
}

/** A remote KataGo service is configured. The free built-in engine is always available as the fallback. */
export const aiRemoteConfigured = AI_URL !== '';
export const aiConfigured = true;
export type AiEngine = 'katago' | 'builtin';

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function call<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  if (!aiRemoteConfigured) throw new AppError('ai_not_configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(AI_URL + path, { method: 'POST', headers: await headers(), body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new AppError(j.error === 'engine_unavailable' ? 'ai_unavailable' : j.error === 'rate_limited' ? 'rate_limited' : j.error === 'busy' ? 'ai_busy' : j.error === 'auth_required' ? 'ai_auth_required' : 'ai_error');
    return j as T;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('ai_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

let remoteOk: boolean | null = null;

/** Which engine answers: KataGo when the service is configured and healthy, otherwise the built-in in-browser engine. */
export async function aiHealth(): Promise<{ ok: true; engine: AiEngine; reason?: 'not_configured' | 'down' | 'no_engine' }> {
  if (!aiRemoteConfigured) { remoteOk = false; return { ok: true, engine: 'builtin', reason: 'not_configured' }; }
  try {
    const r = await fetch(AI_URL + '/health');
    remoteOk = r.ok;
    if (r.ok) return { ok: true, engine: 'katago' };
    return { ok: true, engine: 'builtin', reason: r.status === 503 ? 'no_engine' : 'down' };
  } catch {
    remoteOk = false;
    return { ok: true, engine: 'builtin', reason: 'down' };
  }
}

const useRemote = () => aiRemoteConfigured && remoteOk !== false;
const toAnalysis = (r: Awaited<ReturnType<typeof localAnalyze>>): AiAnalysis => ({
  toPlay: r.toPlay, winrate: r.winrate, scoreLead: r.scoreLead, ownership: r.ownership,
  candidates: r.candidates.map((c) => ({ ...c, prior: 0, pv: [c.p] })),
});

export async function aiMove(pos: AiPosition, difficulty: Difficulty): Promise<AiMove> {
  if (useRemote()) { try { return await call<AiMove>('/v1/move', { ...pos, difficulty }); } catch (e) { if (!(e instanceof AppError) || e.code !== 'ai_unavailable') throw e; remoteOk = false; } }
  return localMove(pos, difficulty);
}
export async function aiAnalyze(pos: AiPosition, visits = 200): Promise<AiAnalysis> {
  if (useRemote()) { try { return await call<AiAnalysis>('/v1/analyze', { ...pos, visits }); } catch (e) { if (!(e instanceof AppError) || e.code !== 'ai_unavailable') throw e; remoteOk = false; } }
  return toAnalysis(await localAnalyze(pos, visits));
}

/** Game review. KataGo reviews every move; the built-in engine reviews a sample of moves with a coarse estimate. */
export async function aiReview(pos: AiPosition, onProgress?: (done: number, total: number) => void): Promise<AiReview> {
  if (useRemote()) { try { return await call<AiReview>('/v1/review', pos, 180_000); } catch (e) { if (!(e instanceof AppError) || e.code !== 'ai_unavailable') throw e; remoteOk = false; } }
  const n = pos.moves.length;
  const winrates: (number | null)[] = [], scoreLeads: (number | null)[] = [];
  const step = pos.size === 19 ? 8 : pos.size === 13 ? 3 : 2;
  const res: (Awaited<ReturnType<typeof localAnalyze>> | null)[] = [];
  for (let i = 0; i <= n; i++) {
    if (i % step === 0 || i === n) res.push(await localAnalyze({ ...pos, moves: pos.moves.slice(0, i) }, 100)); else res.push(null);
    onProgress?.(i, n);
  }
  for (const r of res) { winrates.push(r ? r.winrate : null); scoreLeads.push(r ? r.scoreLead : null); }
  // The built-in engine is too coarse to blame individual moves honestly: it only produces the winrate / score curve.
  const moves: AiReview['moves'] = [];
  return { winrates, scoreLeads, moves, summary: { blunders: 0, mistakes: 0, inaccuracies: 0 } };
}
