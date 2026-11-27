// Type shims so the Deno-only Edge Function can be type-checked and executed under Node in tests.
declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Promise<Response> | Response): void };
declare module 'npm:@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, opts?: unknown): any;
}
