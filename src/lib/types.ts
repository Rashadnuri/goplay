import type { BoardSize } from '../engine/index.ts';

export type Lang = 'az' | 'en' | 'ru';
export type Localized = Record<Lang, string>;
export type Role = 'user' | 'moderator' | 'admin';

export interface Profile {
  id: string;
  username: string;
  avatar: string;
  bio: string;
  country: string | null;
  language: Lang;
  theme: 'system' | 'light' | 'dark';
  role: Role;
  show_online: boolean;
  prefs?: Record<string, unknown>;
  created_at: string;
  banned_until: string | null;
  last_seen_at: string | null;
}

export interface PlayerRating {
  user_id: string;
  board_size: BoardSize;
  rating: number;
  peak_rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  best_streak: number;
}

export interface GameRow {
  id: string;
  status: 'waiting' | 'active' | 'scoring' | 'finished' | 'aborted';
  board_size: BoardSize;
  komi: number;
  rules: 'japanese' | 'chinese';
  handicap: number;
  ko_rule: 'simple' | 'superko';
  time_initial_s: number;
  time_increment_s: number;
  is_ranked: boolean;
  is_private: boolean;
  replay_shared?: boolean;
  invite_code: string | null;
  tournament_match_id: string | null;
  to_play: 1 | 2;
  move_count: number;
  version: number;
  captures_black: number;
  captures_white: number;
  black_ms: number | null;
  white_ms: number | null;
  clock_running: 1 | 2 | null;
  clock_since: string | null;
  dead_stones: number[];
  score_accept_black: boolean;
  score_accept_white: boolean;
  draw_offer_by: 1 | 2 | null;
  undo_request: { by: 1 | 2; move_count: number } | null;
  winner: 1 | 2 | null;
  end_reason: string | null;
  result_text: string | null;
  final_score: Record<string, number | string | number[]> | null;
  created_at: string;
  finished_at: string | null;
}

export interface Participant {
  game_id: string;
  user_id: string;
  color: 1 | 2;
  rating_before: number | null;
  rating_after: number | null;
  profiles?: Pick<Profile, 'username' | 'avatar'> | null;
}

export interface MoveRow {
  move_number: number;
  color: 1 | 2;
  p: number;
}

export interface TournamentRow {
  id: string;
  name: string;
  description: string;
  format: 'single_elimination' | 'round_robin';
  board_size: BoardSize;
  rules: 'japanese' | 'chinese';
  time_initial_s: number;
  time_increment_s: number;
  min_players: number;
  max_players: number;
  registration_closes_at: string | null;
  starts_at: string | null;
  status: 'draft' | 'registration' | 'running' | 'finished' | 'cancelled';
  recurrence?: 'weekly' | null;
  current_round: number;
  total_rounds: number | null;
  winner_id: string | null;
  created_at: string;
}

export interface TournamentMatch {
  id: string;
  tournament_id: string;
  round: number;
  position: number;
  player_a: string | null;
  player_b: string | null;
  game_id: string | null;
  winner_id: string | null;
  status: 'pending' | 'active' | 'finished' | 'bye' | 'forfeit';
}

export interface TournamentParticipant {
  tournament_id: string;
  user_id: string;
  seed: number | null;
  eliminated: boolean;
  points: number;
  wins: number;
  losses: number;
  profiles?: Pick<Profile, 'username' | 'avatar'> | null;
}

export interface LeaderRow {
  rank: number;
  user_id: string;
  username: string;
  avatar: string;
  country: string | null;
  rating: number;
  league: string;
  games: number;
  wins: number;
  losses: number;
  score: number;
}

export interface FriendRow {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar: string;
  status: 'pending' | 'accepted';
  incoming: boolean;
  online: boolean;
  last_seen_at: string | null;
  unread: number;
}

export interface Exercise {
  size: BoardSize;
  /** rows of '.', 'X' (black), 'O' (white) */
  rows: string[];
  toPlay?: 1 | 2;
  /** highlighted points for explanation */
  marks?: number[];
  goal:
    | { type: 'point'; points: number[] }
    | { type: 'capture'; min?: number }
    | { type: 'any' }
    | { type: 'place'; points: number[] }
    | { type: 'quiz'; question: Localized; options: Localized[]; correct: number };
  hint?: Localized;
  success?: Localized;
}

export interface LessonStep {
  text: Localized;
  exercise?: Exercise;
}

export interface Lesson {
  id?: string;
  slug: string;
  position: number;
  level: 1 | 2 | 3 | 4 | 5;
  title: Localized;
  summary: Localized;
  steps: LessonStep[];
  published?: boolean;
  track?: 'basics' | 'openings';
}

export interface TimePreset {
  id: string;
  initial: number;
  increment: number;
}

export type ID = string;
