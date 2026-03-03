import { createBrowserClient as createBrowserSupabaseClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  // During SSR/build the env vars may be placeholders — return the cached
  // client (which will be null on the server) and let the caller guard.
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key || !url.startsWith('http')) {
    // SSR / build — return a stable sentinel so reference equality holds.
    return null as unknown as SupabaseClient;
  }

  client = createBrowserSupabaseClient(url, key);
  return client;
}
