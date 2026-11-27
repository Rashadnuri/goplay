import type { Analysis, Candidate, Difficulty } from './types.ts';

export interface DifficultyProfile {
  maxVisits: number;
  /** rank profile for the KataGo human-SL model when available */
  humanProfile?: string;
  /** softmax temperature over candidate moves (0 = always the best) */
  temperature: number;
  /** only candidates within this winrate loss (fraction) of the best are eligible */
  maxLoss: number;
  /** resign when Black/White winrate for the AI falls below this (0 = never) */
  resignBelow: number;
}

export const PROFILES: Record<Difficulty, DifficultyProfile> = {
  beginner:     { maxVisits: 2,    humanProfile: 'rank_20k', temperature: 2.5,  maxLoss: 0.6,  resignBelow: 0 },
  easy:         { maxVisits: 8,    humanProfile: 'rank_12k', temperature: 1.2,  maxLoss: 0.35, resignBelow: 0 },
  intermediate: { maxVisits: 32,   humanProfile: 'rank_5k',  temperature: 0.5,  maxLoss: 0.15, resignBelow: 0.02 },
  advanced:     { maxVisits: 150,  humanProfile: 'rank_1d',  temperature: 0.15, maxLoss: 0.06, resignBelow: 0.03 },
  expert:       { maxVisits: 800,  temperature: 0,    maxLoss: 0,    resignBelow: 0.03 },
};

export interface MoveChoice {
  /** point index, -1 pass */
  p: number;
  resign: boolean;
  winrate: number; // Black's winrate
  scoreLead: number;
  candidate?: Candidate;
}

/**
 * Chooses a move from a real KataGo analysis. Weak levels sample among candidate moves with a
 * temperature so that the AI makes human-like, beatable mistakes; Expert always plays the top move.
 * `rng` is injectable for deterministic tests.
 */
export function chooseMove(a: Analysis, difficulty: Difficulty, rng: () => number = Math.random): MoveChoice {
  const prof = PROFILES[difficulty];
  const cands = [...a.candidates].sort((x, y) => y.visits - x.visits);
  if (cands.length === 0) return { p: -1, resign: false, winrate: a.winrate, scoreLead: a.scoreLead };

  const mine = (c: { winrate: number }) => (a.toPlay === 1 ? c.winrate : 1 - c.winrate);
  const best = cands[0];
  const bestWr = mine(best);

  if (prof.resignBelow > 0 && bestWr < prof.resignBelow) {
    return { p: best.p, resign: true, winrate: a.winrate, scoreLead: a.scoreLead, candidate: best };
  }
  if (prof.temperature === 0) return { p: best.p, resign: false, winrate: a.winrate, scoreLead: a.scoreLead, candidate: best };

  const eligible = cands.filter((c) => bestWr - mine(c) <= prof.maxLoss);
  // weight = prior-informed softmax over winrate loss
  const weights = eligible.map((c) => {
    const loss = bestWr - mine(c);
    const base = Math.exp(-loss / prof.temperature * 4);
    return base * (0.25 + Math.max(c.prior, 0));
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  let pick = eligible[0];
  for (let i = 0; i < eligible.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      pick = eligible[i];
      break;
    }
  }
  return { p: pick.p, resign: false, winrate: a.winrate, scoreLead: a.scoreLead, candidate: pick };
}

export interface ReviewMove {
  move: number; // 1-based move number
  color: 1 | 2;
  p: number;
  winrateBefore: number; // Black winrate
  winrateAfter: number;
  loss: number; // winrate lost by the mover (fraction)
  scoreLoss: number;
  kind: 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  best?: number; // KataGo's preferred point
}

/** Classify every move of a game from per-turn analyses (index = number of moves played). */
export function reviewGame(turns: Analysis[], moves: number[], firstColor: 1 | 2 = 1): ReviewMove[] {
  const out: ReviewMove[] = [];
  for (let i = 0; i < moves.length; i++) {
    const before = turns[i];
    const after = turns[i + 1];
    if (!before || !after) continue;
    const color = ((i % 2 === 0) === (firstColor === 1) ? 1 : 2) as 1 | 2;
    const sign = color === 1 ? 1 : -1;
    const loss = Math.max(0, sign * (before.winrate - after.winrate));
    const scoreLoss = Math.max(0, sign * (before.scoreLead - after.scoreLead));
    const kind = loss >= 0.15 ? 'blunder' : loss >= 0.07 ? 'mistake' : loss >= 0.03 ? 'inaccuracy' : 'good';
    out.push({
      move: i + 1, color, p: moves[i],
      winrateBefore: before.winrate, winrateAfter: after.winrate,
      loss, scoreLoss, kind, best: before.candidates[0]?.p,
    });
  }
  return out;
}
