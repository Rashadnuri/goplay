import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { az } from './az.ts';
import { en } from './en.ts';
import { ru } from './ru.ts';

const keys = Object.keys(az);
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
// terms that are intentionally identical across languages
const SAME_OK = /^(ach\.games_\d+\.name|ai\.analyze)$/;

describe('translations', () => {
  it('all three languages have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
    expect(Object.keys(ru).sort()).toEqual([...keys].sort());
  });

  it('no empty strings and placeholders match across languages', () => {
    for (const k of keys) {
      for (const [name, d] of [['az', az], ['en', en], ['ru', ru]] as const) {
        const v = (d as Record<string, string>)[k];
        expect(v && v.trim().length > 0, `${name}:${k} is empty`).toBe(true);
      }
      expect(params((en as any)[k]), `placeholders ${k}`).toBe(params((az as any)[k]));
      expect(params((ru as any)[k]), `placeholders ${k}`).toBe(params((az as any)[k]));
    }
  });

  it('Russian never leaves English text untranslated and uses Cyrillic', () => {
    for (const k of keys) {
      if (SAME_OK.test(k)) continue;
      const v = (ru as any)[k] as string;
      if (/^\d+$/.test(v) || /^[A-Z]{2,}$/.test(v)) continue;
      expect(/[А-Яа-яЁё]/.test(v), `ru:${k} = ${v}`).toBe(true);
    }
  });

  it('English and Azerbaijani differ (no copy-paste) for user-facing sentences', () => {
    const same = keys.filter((k) => (az as any)[k] === (en as any)[k] && (az as any)[k].length > 12 && !SAME_OK.test(k));
    expect(same).toEqual([]);
  });

  it('every static t("key") used in the source exists', () => {
    const missing: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (!p.endsWith('i18n')) walk(p); continue; }
        if (!/\.tsx?$/.test(f) || /\.test\./.test(f)) continue;
        for (const m of readFileSync(p, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) if (!(m[1] in az)) missing.push(`${p}: ${m[1]}`);
      }
    };
    walk(join(import.meta.dirname, '..'));
    expect(missing).toEqual([]);
  });

  it('dynamic key families are fully translated', () => {
    const families: Record<string, string[]> = {
      league: ['beginner', 'bronze', 'silver', 'gold', 'platinum', 'diamond'],
      difficulty: ['beginner', 'easy', 'intermediate', 'advanced', 'expert'],
      illegal: ['game_over', 'not_playing', 'out_of_bounds', 'occupied', 'suicide', 'ko', 'superko'],
      status: ['waiting', 'active', 'scoring', 'finished', 'aborted'],
      time: ['blitz', 'rapid', 'classic', 'untimed'],
      rules: ['japanese', 'chinese'],
      report: ['cheating', 'harassment', 'spam', 'inappropriate_name', 'other'],
      review: ['good', 'inaccuracy', 'mistake', 'blunder'],
      tour: ['single_elimination', 'round_robin'],
      'tour.status': ['draft', 'registration', 'running', 'finished', 'cancelled'],
      'admin.tab': ['stats', 'users', 'tournaments', 'reports', 'messages', 'lessons', 'daily'],
      'puzzle.kind': ['capture', 'atari', 'doubleAtari', 'escape', 'connect', 'lifeDeath'],
      'puzzle.level': ['1', '2', '3'],
      'puzzle.shape': ['line3', 'bent3', 'tfour', 'cross5', 'pyramid5'],
      'puzzle.prompt': ['capture', 'atari', 'doubleAtari', 'escape', 'connect', 'ld_live', 'ld_kill'],
      'puzzle.explain': ['capture', 'atari', 'doubleAtari', 'escape', 'connect', 'ld_live', 'ld_kill'],
      'puzzle.hint': ['capture', 'atari', 'doubleAtari', 'escape', 'connect', 'lifeDeath'],
      'academy.tab': ['lessons', 'openings', 'joseki', 'lifedeath', 'tactics'],
      'joseki.verdict': ['best', 'good', 'playable', 'weak'],
      'joseki.start': ['hoshi', 'komoku', 'sansan'],
      board: ['kaya', 'walnut', 'cherry', 'bamboo', 'ebony'],
      stones: ['glossy', 'slate', 'flat'],
      concept: ['ignoredAtari', 'selfAtari', 'missedCapture', 'missedSave', 'missedAtari', 'edgeEarly', 'strongerMove'],
      event: ['play', 'capture', 'pass'],
      'admin.stat': ['users', 'users_7d', 'online_now', 'games_total', 'games_active', 'games_24h', 'queue', 'tournaments_open', 'reports_open', 'lessons'],
    };
    const ach = ['puzzle_10', 'puzzle_50', 'daily_streak_7', 'tournament_win', 'season_medal', 'first_win', 'first_online_game', 'games_10', 'games_100', 'streak_3', 'streak_5', 'streak_10', 'lesson_first', 'lessons_5', 'lessons_all', 'daily_first', 'daily_7'];
    for (const [fam, vals] of Object.entries(families)) for (const v of vals) expect(`${fam}.${v}` in az, `${fam}.${v}`).toBe(true);
    for (const a of ach) { expect(`ach.${a}.name` in az).toBe(true); expect(`ach.${a}.desc` in az).toBe(true); }
  });

  it('every error code the database / functions can raise has a message', () => {
    const codes = new Set<string>();
    const sqlDir = join(import.meta.dirname, '../../supabase/migrations');
    for (const f of readdirSync(sqlDir)) for (const m of readFileSync(join(sqlDir, f), 'utf8').matchAll(/err:([a-z_]+)/g)) codes.add(m[1]);
    const logic = readFileSync(join(import.meta.dirname, '../../supabase/functions/_shared/game-logic.ts'), 'utf8');
    for (const m of logic.matchAll(/fail\('([a-z_]+)'\)/g)) codes.add(m[1]);
    for (const m of logic.matchAll(/fail\(`(illegal)_\$\{/g)) ['occupied', 'suicide', 'ko', 'superko', 'out_of_bounds', 'game_over', 'not_playing'].forEach((r) => codes.add(`${m[1]}_${r}`));
    codes.add('network'); codes.add('unknown');
    const missing = [...codes].filter((c) => !(`err.${c}` in az));
    expect(missing).toEqual([]);
  });
});
