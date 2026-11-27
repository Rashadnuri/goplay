import { useCallback, useEffect, useState } from 'react';
import { LESSONS } from '../content/lessons.ts';
import { backendReady, rpc, supabase } from './supabase.ts';
import type { Lesson } from './types.ts';
import { useAuth } from '../hooks/useAuth.tsx';

const LOCAL = 'goplay.learn';
type LocalProgress = Record<string, { steps: number[]; done: boolean }>;
const readLocal = (): LocalProgress => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '{}'); } catch { return {}; } };
const writeLocal = (p: LocalProgress) => { try { localStorage.setItem(LOCAL, JSON.stringify(p)); } catch { /* ignore */ } };

/** Lessons come from the database (admin-editable); bundled lessons are used when the backend is not configured or unreachable. */
export function useLessons() {
  const [lessons, setLessons] = useState<Lesson[]>(LESSONS);
  const [source, setSource] = useState<'bundled' | 'database'>('bundled');
  useEffect(() => {
    if (!supabase) return;
    supabase.from('lessons').select('*').eq('published', true).order('position').then(({ data, error }) => {
      if (!error && data && data.length) { setLessons(data as Lesson[]); setSource('database'); }
    });
  }, []);
  return { lessons, source };
}

export interface Progress { stepsDone: (slug: string) => number[]; isDone: (slug: string) => boolean; doneCount: number; markStep: (slug: string, i: number) => Promise<void>; complete: (slug: string) => Promise<void> }

export function useProgress(): Progress {
  const { user } = useAuth();
  const [prog, setProg] = useState<LocalProgress>(readLocal);
  useEffect(() => {
    if (!supabase || !user) { setProg(readLocal()); return; }
    supabase.from('lesson_progress').select('lesson_slug, steps_done, completed_at').eq('user_id', user.id).then(({ data }) => {
      const m: LocalProgress = {};
      for (const r of (data ?? []) as { lesson_slug: string; steps_done: number[]; completed_at: string | null }[]) m[r.lesson_slug] = { steps: r.steps_done, done: !!r.completed_at };
      setProg(m);
    });
  }, [user]);

  const update = useCallback((fn: (p: LocalProgress) => LocalProgress) => setProg((cur) => { const n = fn(cur); if (!user) writeLocal(n); return n; }), [user]);
  const markStep = useCallback(async (slug: string, i: number) => {
    update((p) => ({ ...p, [slug]: { steps: [...new Set([...(p[slug]?.steps ?? []), i])], done: p[slug]?.done ?? false } }));
    if (backendReady && user) await rpc('complete_lesson_step', { p_slug: slug, p_step: i }).catch(() => {});
  }, [update, user]);
  const complete = useCallback(async (slug: string) => {
    update((p) => ({ ...p, [slug]: { steps: p[slug]?.steps ?? [], done: true } }));
    if (backendReady && user) await rpc('complete_lesson', { p_slug: slug }).catch(() => {});
  }, [update, user]);
  return { stepsDone: (s) => prog[s]?.steps ?? [], isDone: (s) => !!prog[s]?.done, doneCount: Object.values(prog).filter((x) => x.done).length, markStep, complete };
}

export { useDailySet, usePuzzleProgress } from './puzzles.ts';
