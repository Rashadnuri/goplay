import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the build has no Supabase credentials: online features then explain what is missing. */
export const backendReady = Boolean(url && anon);

export const supabase: SupabaseClient | null = backendReady
  ? createClient(url!, anon!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export const AI_URL = ((import.meta.env.VITE_AI_SERVICE_URL as string | undefined) ?? '').replace(/\/$/, '');

export function sb(): SupabaseClient {
  if (!supabase) throw new AppError('backend_not_configured');
  return supabase;
}

export class AppError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** Converts any thrown value into a stable error code that maps to an i18n message `err.<code>`. */
export function errorCode(e: unknown): string {
  if (e instanceof AppError) return e.code;
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  const name = String((e as { name?: string })?.name ?? '');
  const m = /err:([a-z_]+)/.exec(msg);
  if (m) return m[1];
  // supabase-js wraps lost connections in these error types; their messages vary by version
  if (/^(FunctionsFetchError|AuthRetryableFetchError)$/.test(name)) return 'network';
  if (/Failed to fetch|Failed to send a request|NetworkError|network|offline|Load failed|fetch failed/i.test(msg)) return 'network';
  if (/JWT|not authenticated|auth/i.test(msg)) return 'auth_required';
  return 'unknown';
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new AppError(errorCode(error));
  return data as T;
}
