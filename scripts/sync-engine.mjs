// Copies the pure rules engine into the Edge Function tree so the SAME code validates moves server-side.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/engine');
const dst = join(root, 'supabase/functions/_shared/engine');
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith('.test.ts')) continue;
  cpSync(join(src, f), join(dst, f));
}
console.log('engine synced →', dst);
