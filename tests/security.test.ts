import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', 'dist', 'dist-mock', '.git', 'coverage']);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(root).filter((f) => /\.(ts|tsx|js|mjs|json|sql|md|html|css|toml|example)$/.test(f) && !f.endsWith('package-lock.json'));

describe('secrets and privileged code stay out of the browser', () => {
  it('no service-role key, JWT or API-key looking literal is committed anywhere', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(s)) offenders.push(`${relative(root, f)}: JWT literal`);
      if (/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)) offenders.push(`${relative(root, f)}: key material`);
    }
    expect(offenders).toEqual([]);
  });

  it('the service-role key is referenced only by the Edge Function and documentation', () => {
    const users = files.filter((f) => /SERVICE_ROLE/i.test(readFileSync(f, 'utf8'))).map((f) => relative(root, f)).filter((f) => !f.startsWith('tests/'));
    for (const f of users) expect(/^(supabase\/(functions|migrations)\/|DEPLOYMENT\.md|\.env\.example|README\.md)/.test(f), `unexpected reference in ${f}`).toBe(true);
    // and the frontend never reads a non-VITE_ env var
    for (const f of files.filter((x) => relative(root, x).startsWith('src/'))) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/import\.meta\.env\.([A-Z_]+)/g)) expect(m[1], f).toMatch(/^VITE_|^(MODE|DEV|PROD|BASE_URL|SSR)$/);
    }
  });

  it('.env files are git-ignored; only .env.example is tracked and it holds no real values', () => {
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toMatch(/^\.env$/m);
    const ex = readFileSync(join(root, '.env.example'), 'utf8');
    expect(ex).not.toMatch(/service[_-]?role/i);
    expect(ex).toMatch(/YOUR-ANON-KEY/);
  });

  it('every SECURITY DEFINER function pins its search_path (prevents search_path hijacking)', () => {
    const bad: string[] = [];
    for (const f of readdirSync(join(root, 'supabase/migrations'))) {
      const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8');
      for (const m of sql.matchAll(/create (?:or replace )?function\s+([\w.]+)[\s\S]*?(?=\$\$;|\$\$ *\n|end \$\$)/gi)) {
        const head = m[0].slice(0, m[0].search(/\bas\s*\$\$|\bas\s*\n?\s*\$\$|language\s+\w+\s+(?:stable\s+|immutable\s+)?security\s+definer\s+set\s+search_path|\$\$/i) + 400);
        if (/security definer/i.test(m[0]) && !/set search_path\s*=\s*public/i.test(m[0])) bad.push(`${f}: ${m[1]}`);
        void head;
      }
    }
    expect(bad).toEqual([]);
  });

  it('every table in the public schema has row level security enabled', () => {
    const sql = readdirSync(join(root, 'supabase/migrations')).map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
    const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    const rls = new Set([...sql.matchAll(/alter table public\.(\w+) enable row level security/g)].map((m) => m[1]));
    expect(tables.filter((t) => !rls.has(t))).toEqual([]);
    expect(tables.length).toBeGreaterThan(25);
  });

  it('production build contains no server secrets and stays within the bundle budget', () => {
    const dist = join(root, 'dist');
    if (!existsSync(dist)) return;
    const built = walk(dist).filter((f) => f.endsWith('.js'));
    for (const f of built) { const s = readFileSync(f, 'utf8'); expect(/service_role|SUPABASE_SERVICE/i.test(s), relative(root, f)).toBe(false); }
    const biggest = Math.max(...built.map((f) => statSync(f).size));
    expect(biggest, 'largest JS chunk (bytes)').toBeLessThan(300_000);
    const entry = built.filter((f) => /assets\/index-/.test(f)).map((f) => statSync(f).size);
    expect(Math.max(...entry), 'app entry chunk (bytes)').toBeLessThan(120_000);
  });
});
