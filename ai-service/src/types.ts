export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'advanced' | 'expert';
export const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'easy', 'intermediate', 'advanced', 'expert'];

export interface PositionRequest {
  size: 9 | 13 | 19;
  komi: number;
  rules: 'japanese' | 'chinese';
  handicap: number;
  /** point indexes (y*size+x), -1 = pass */
  moves: number[];
}

export interface Candidate {
  /** point index, or -1 for pass */
  p: number;
  visits: number;
  /** Black's win probability (0..1) after this move */
  winrate: number;
  /** Black's expected score lead */
  scoreLead: number;
  prior: number;
  pv: number[];
}

export interface Analysis {
  /** colour to move: 1 black / 2 white */
  toPlay: 1 | 2;
  /** Black's win probability for the current position */
  winrate: number;
  scoreLead: number;
  candidates: Candidate[];
  /** per point, +1 = Black owns, -1 = White owns (length size*size) */
  ownership?: number[];
  /** policy prior per point, length size*size+1 (last = pass), -1 for illegal */
  policy?: number[];
}

export interface AnalyzeOptions {
  maxVisits: number;
  ownership?: boolean;
  policy?: boolean;
  /** analyse several turns in one query (0 = empty board … moves.length = current) */
  turns?: number[];
  humanProfile?: string;
}

export interface EngineHealth {
  ok: boolean;
  engine: 'katago';
  detail: string;
  version?: string;
}

export interface GoEngineAdapter {
  health(): Promise<EngineHealth>;
  /** Analyse one position (turns omitted). */
  analyze(pos: PositionRequest, opts: AnalyzeOptions): Promise<Analysis>;
  /** Analyse many turns of one game. Result index = turn number. */
  analyzeTurns(pos: PositionRequest, opts: AnalyzeOptions): Promise<Analysis[]>;
  close(): Promise<void>;
}

export class EngineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineUnavailableError';
  }
}
