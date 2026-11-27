import { AI_URL, supabase, AppError } from './supabase.ts';
import type { BoardSize } from '../engine/index.ts';

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

export const aiConfigured = AI_URL !== '';

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function call<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  if (!aiConfigured) throw new AppError('ai_not_configured');
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

export async function aiHealth(): Promise<{ ok: boolean; reason?: 'not_configured' | 'down' | 'no_engine' }> {
  if (!aiConfigured) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetch(AI_URL + '/health');
    if (r.ok) return { ok: true };
    return { ok: false, reason: r.status === 503 ? 'no_engine' : 'down' };
  } catch {
    return { ok: false, reason: 'down' };
  }
}

export const aiMove = (pos: AiPosition, difficulty: Difficulty) => call<AiMove>('/v1/move', { ...pos, difficulty });
export const aiAnalyze = (pos: AiPosition, visits = 200) => call<AiAnalysis>('/v1/analyze', { ...pos, visits });
export const aiReview = (pos: AiPosition) => call<AiReview>('/v1/review', pos, 180_000);
