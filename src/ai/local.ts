/** Client for the built-in (free, in-browser) engine. Uses a Web Worker; falls back to the main thread where workers are unavailable. */
import { Mcts, mcMove, MC_LEVELS, type McDifficulty, type McMove, type McPosition, type McResult } from './mcts.ts';

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker?.addEventListener('message', (e: MessageEvent) => {
      const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    });
    worker?.addEventListener('error', () => { worker = null; for (const [, p] of pending) p.reject(new Error('worker')); pending.clear(); });
  } catch { worker = null; }
  return worker;
}

function ask<T>(msg: Record<string, unknown>, inline: () => T): Promise<T> {
  const w = getWorker();
  if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(inline()); } catch (e) { rej(e as Error); } }, 0));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, ...msg }); });
}

export const localMove = (pos: McPosition, level: McDifficulty) => ask<McMove>({ kind: 'move', pos, level }, () => mcMove(pos, level));

export const localAnalyze = (pos: McPosition, playouts: number) => {
  const opts = { maxPlayouts: Math.min(playouts * 4, pos.size === 19 ? 1500 : 5000), maxMs: 2500, wantOwnership: true };
  return ask<McResult>({ kind: 'analyze', pos, opts }, () => new Mcts(pos).run(opts));
};
export { MC_LEVELS };
