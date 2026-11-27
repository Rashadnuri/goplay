/// <reference lib="webworker" />
import { Mcts, mcMove, type McOptions, type McPosition } from './mcts.ts';

type Req =
  | { id: number; kind: 'move'; pos: McPosition; level: Parameters<typeof mcMove>[1] }
  | { id: number; kind: 'analyze'; pos: McPosition; opts: McOptions };

self.onmessage = (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    const result = r.kind === 'move' ? mcMove(r.pos, r.level) : new Mcts(r.pos).run(r.opts);
    (self as unknown as Worker).postMessage({ id: r.id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: r.id, ok: false, error: String(err) });
  }
};
