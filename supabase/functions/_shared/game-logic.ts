/**
 * Server-side game action planner. Pure: (snapshot, user, action) → database patch.
 * The client never sends board states or results — only intents (play point X, pass, ...).
 * Everything is re-derived by replaying the stored moves with the shared rules engine.
 */
import { GoGame, BLACK, WHITE, PASS, other, makeConfig, onMove, type ClockConfig, type ClockState, type Color, type GameConfig } from './engine/index.ts';

export type Action =
  | { type: 'move'; p: number; expected_move_count?: number }
  | { type: 'pass'; expected_move_count?: number }
  | { type: 'mark_dead'; dead: number[] }
  | { type: 'accept_score'; dead?: number[] }
  | { type: 'resume' }
  | { type: 'request_undo' }
  | { type: 'respond_undo'; accept: boolean };

export interface GameRow {
  id: string;
  status: string;
  board_size: 9 | 13 | 19;
  komi: number;
  rules: 'japanese' | 'chinese';
  handicap: number;
  ko_rule: 'simple' | 'superko';
  time_initial_s: number;
  time_increment_s: number;
  tournament_match_id: string | null;
  to_play: number;
  move_count: number;
  version: number;
  black_ms: number | null;
  white_ms: number | null;
  clock_running: number | null;
  dead_stones: number[];
  undo_request: { by: number; move_count: number } | null;
  score_accept_black: boolean;
  score_accept_white: boolean;
}

export interface Snapshot {
  game: GameRow;
  participants: { user_id: string; color: number }[];
  moves: { move_number: number; color: number; p: number }[];
  now_ms: number;
  clock_since_ms: number | null;
}

export interface Plan {
  expectedVersion: number;
  patch: Record<string, unknown>;
  insertMoves: { move_number: number; color: number; p: number; captured: number[] }[] | null;
  deleteFrom: number | null;
}

export class ActionError extends Error {
  constructor(public code: string) {
    super(`err:${code}`);
  }
}

const fail = (code: string): never => {
  throw new ActionError(code);
};

export function configOf(g: GameRow): GameConfig {
  return makeConfig({ size: g.board_size, komi: Number(g.komi), rules: g.rules, handicap: g.handicap, ko: g.ko_rule });
}

function replay(snap: Snapshot, upTo = snap.moves.length): GoGame {
  const cfg = configOf(snap.game);
  const ordered = [...snap.moves].sort((a, b) => a.move_number - b.move_number).slice(0, upTo);
  try {
    return GoGame.fromMoves(cfg, ordered.map((m) => m.p));
  } catch {
    return fail('corrupt_game');
  }
}

function clockOf(snap: Snapshot): { cfg: ClockConfig; state: ClockState } {
  const g = snap.game;
  const cfg: ClockConfig = { initialMs: g.time_initial_s * 1000, incrementMs: g.time_increment_s * 1000 };
  return {
    cfg,
    state: {
      blackMs: Number(g.black_ms ?? cfg.initialMs),
      whiteMs: Number(g.white_ms ?? cfg.initialMs),
      running: (g.clock_running as Color | null) ?? null,
      runningSince: snap.clock_since_ms,
    },
  };
}

const sideLetter = (c: Color) => (c === BLACK ? 'B' : 'W');

export function planAction(snap: Snapshot, userId: string, action: Action): Plan {
  const g = snap.game;
  const me = snap.participants.find((p) => p.user_id === userId);
  if (!me) return fail('forbidden');
  const color = me.color as Color;
  const base = { expectedVersion: g.version };

  switch (action.type) {
    case 'move':
    case 'pass': {
      if (g.status !== 'active') return fail(g.status === 'scoring' ? 'not_playing' : 'game_over');
      if (action.expected_move_count !== undefined && action.expected_move_count !== g.move_count) return fail('stale_state');
      if (Number(g.to_play) !== color) return fail('not_your_turn');
      if (action.type === 'move' && !Number.isInteger(action.p)) return fail('illegal_move');

      const game = replay(snap);
      if (game.toPlay !== color) return fail('not_your_turn');
      const res = action.type === 'pass' ? game.pass() : game.play(action.p);
      if (!res.ok) return fail(`illegal_${res.reason}`);

      const { cfg, state } = clockOf(snap);
      const timed = cfg.initialMs > 0;
      const patch: Record<string, unknown> = {};
      if (timed) {
        const c = onMove(state, cfg, color, snap.now_ms);
        patch.black_ms = Math.round(c.state.blackMs);
        patch.white_ms = Math.round(c.state.whiteMs);
        if (c.timedOut) {
          patch.finish = { winner: other(color), reason: 'timeout', text: `${sideLetter(other(color))}+T`, score: null };
          return { ...base, patch, insertMoves: null, deleteFrom: null };
        }
        patch.clock_running = c.state.running;
        patch.clock_restart = true;
      }
      patch.to_play = game.toPlay;
      patch.move_count = game.moveNumber;
      patch.captures_black = game.captures[BLACK];
      patch.captures_white = game.captures[WHITE];
      patch.draw_offer_by = null;
      patch.undo_request = null;
      patch.touch_move = true;
      if (game.phase === 'scoring') {
        patch.status = 'scoring';
        patch.clock_running = null; // clocks stop while counting
        delete patch.clock_restart;
        patch.dead_stones = [];
        patch.score_accept_black = false;
        patch.score_accept_white = false;
      }
      return {
        ...base,
        patch,
        insertMoves: [{ move_number: game.moveNumber, color, p: action.type === 'pass' ? PASS : action.p, captured: res.record.captured }],
        deleteFrom: null,
      };
    }

    case 'mark_dead': {
      if (g.status !== 'scoring') return fail('not_scoring');
      const game = replay(snap);
      const dead = [...new Set(action.dead)].sort((a, b) => a - b);
      if (dead.length > game.board.length) return fail('invalid_dead');
      for (const p of dead) if (!Number.isInteger(p) || p < 0 || p >= game.board.length || game.board[p] === 0) return fail('invalid_dead');
      return {
        ...base,
        patch: {
          dead_stones: dead,
          score_accept_black: color === BLACK,
          score_accept_white: color === WHITE,
          touch_move: false,
        },
        insertMoves: null,
        deleteFrom: null,
      };
    }

    case 'accept_score': {
      if (g.status !== 'scoring') return fail('not_scoring');
      const serverDead = [...(g.dead_stones ?? [])].sort((a, b) => a - b);
      if (action.dead && JSON.stringify([...new Set(action.dead)].sort((a, b) => a - b)) !== JSON.stringify(serverDead)) return fail('stale_state');
      const black = color === BLACK ? true : g.score_accept_black;
      const white = color === WHITE ? true : g.score_accept_white;
      if (!(black && white)) {
        return { ...base, patch: { score_accept_black: black, score_accept_white: white }, insertMoves: null, deleteFrom: null };
      }
      const game = replay(snap);
      const result = game.finishByScore(serverDead);
      const s = result.score!;
      return {
        ...base,
        patch: {
          score_accept_black: true,
          score_accept_white: true,
          finish: {
            winner: result.winner,
            reason: 'score',
            text: result.text,
            score: {
              black: s.black, white: s.white, komi: s.komi, rules: s.rules, margin: s.margin,
              blackTerritory: s.blackTerritory, whiteTerritory: s.whiteTerritory,
              blackStones: s.blackStones, whiteStones: s.whiteStones,
              blackPrisoners: s.blackPrisoners, whitePrisoners: s.whitePrisoners, dead: serverDead,
            },
          },
        },
        insertMoves: null,
        deleteFrom: null,
      };
    }

    case 'resume': {
      if (g.status !== 'scoring') return fail('not_scoring');
      const ordered = [...snap.moves].sort((a, b) => a.move_number - b.move_number);
      const n = ordered.length;
      if (n < 2 || ordered[n - 1].p !== PASS || ordered[n - 2].p !== PASS) return fail('invalid_state');
      const toPlay = ordered[n - 2].color;
      const { cfg } = clockOf(snap);
      const patch: Record<string, unknown> = {
        status: 'active',
        move_count: n - 2,
        to_play: toPlay,
        dead_stones: [],
        score_accept_black: false,
        score_accept_white: false,
        touch_move: true,
      };
      if (cfg.initialMs > 0) {
        patch.clock_running = toPlay;
        patch.clock_restart = true;
      }
      return { ...base, patch, insertMoves: null, deleteFrom: n - 1 };
    }

    case 'request_undo': {
      if (g.status !== 'active') return fail('game_over');
      if (g.tournament_match_id) return fail('undo_not_allowed');
      if (g.undo_request) return fail('offer_pending');
      if (!snap.moves.some((m) => m.color === color)) return fail('nothing_to_undo');
      return { ...base, patch: { undo_request: { by: color, move_count: g.move_count } }, insertMoves: null, deleteFrom: null };
    }

    case 'respond_undo': {
      if (g.status !== 'active') return fail('game_over');
      const req = g.undo_request;
      if (!req || req.by === color) return fail('no_offer');
      if (req.move_count !== g.move_count) return fail('stale_state');
      if (!action.accept) return { ...base, patch: { undo_request: null }, insertMoves: null, deleteFrom: null };

      const ordered = [...snap.moves].sort((a, b) => a.move_number - b.move_number);
      let idx = -1;
      for (let i = ordered.length - 1; i >= 0; i--) if (ordered[i].color === req.by) { idx = i; break; }
      if (idx < 0 || ordered.length - idx > 2) return fail('nothing_to_undo');
      const game = replay(snap, idx);
      const { cfg } = clockOf(snap);
      const patch: Record<string, unknown> = {
        undo_request: null,
        draw_offer_by: null,
        move_count: idx,
        to_play: game.toPlay,
        captures_black: game.captures[BLACK],
        captures_white: game.captures[WHITE],
        touch_move: true,
      };
      if (cfg.initialMs > 0) {
        patch.clock_running = idx === 0 ? null : game.toPlay;
        if (idx > 0) patch.clock_restart = true;
      }
      return { ...base, patch, insertMoves: null, deleteFrom: ordered[idx].move_number };
    }
  }
}
