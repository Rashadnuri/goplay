// Stand-in for `npm:@supabase/supabase-js@2` used ONLY by tests: forwards auth.getUser / rpc to the PGlite test database.
import type { Db } from './harness.ts';

export const bridge: { db: Db | null } = { db: null };

export function createClient() {
  const db = () => {
    if (!bridge.db) throw new Error('bridge.db not set');
    return bridge.db;
  };
  return {
    auth: {
      async getUser(token: string) {
        const m = /^tok:(.+)$/.exec(token);
        if (!m) return { data: { user: null }, error: { message: 'invalid token' } };
        return { data: { user: { id: m[1] } }, error: null };
      },
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args);
      const params: unknown[] = [];
      const parts = keys.map((k) => {
        const v = args[k];
        const isObj = v !== null && typeof v === 'object';
        params.push(isObj ? JSON.stringify(v) : v);
        return `${k} => $${params.length}${isObj ? '::jsonb' : ''}`;
      });
      try {
        const rows = await db().svc(`select public.${fn}(${parts.join(', ')}) as r`, params);
        return { data: rows[0]?.r ?? null, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}
