import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');

export interface Db {
  pg: PGlite;
  /** run SQL as service_role (bypasses RLS) */
  svc<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** run SQL as a signed-in user (role authenticated, RLS enforced) */
  as<T = any>(userId: string, sql: string, params?: any[]): Promise<T[]>;
  /** run SQL as anonymous visitor */
  anon<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** create an auth user (profile + ratings created by trigger) */
  user(name: string, opts?: { role?: string; rating?: number }): Promise<string>;
}

let chain: Promise<unknown> = Promise.resolve();
/** PGlite has one connection: serialise "transactions" so concurrent test code cannot interleave them. */
function withRole<T>(pg: PGlite, role: string, uid: string | null, sql: string, params?: any[]): Promise<T[]> {
  const run = chain.then(() => withRoleNow<T>(pg, role, uid, sql, params));
  chain = run.catch(() => undefined);
  return run;
}

async function withRoleNow<T>(pg: PGlite, role: string, uid: string | null, sql: string, params?: any[]): Promise<T[]> {
  // Every statement is its own transaction so a failing call cannot poison later ones.
  await pg.exec('begin');
  try {
    await pg.exec(`set local role ${role}`);
    await pg.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', true)`);
    const res = await pg.query<T>(sql, params);
    await pg.exec('commit');
    return res.rows;
  } catch (e) {
    await pg.exec('rollback');
    throw e;
  }
}

export async function createDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(root, 'tests/db/shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    try {
      await pg.exec(readFileSync(join(dir, f), 'utf8'));
    } catch (e: any) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  const db: Db = {
    pg,
    svc: (sql, params) => withRole(pg, 'service_role', null, sql, params),
    as: (uid, sql, params) => withRole(pg, 'authenticated', uid, sql, params),
    anon: (sql, params) => withRole(pg, 'anon', null, sql, params),
    async user(name, opts = {}) {
      const r = await pg.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
        [`${name}@example.com`, JSON.stringify({ username: name })],
      );
      const id = r.rows[0].id;
      if (opts.role) await pg.query(`update public.profiles set role = $2 where id = $1`, [id, opts.role]);
      if (opts.rating) await pg.query(`update public.player_ratings set rating = $2 where user_id = $1`, [id, opts.rating]);
      return id;
    },
  };
  return db;
}

/** Extract the error code from an RPC failure ('err:xxx'). */
export async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    const m = /err:([a-z_]+)/.exec(e.message ?? '');
    return m ? m[1] : `raw:${e.message}`;
  }
  return 'no_error';
}
