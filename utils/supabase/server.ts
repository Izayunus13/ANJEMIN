import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from './config';

export async function createClient(cookieStore?: Awaited<ReturnType<typeof cookies>>) {
  const store = cookieStore ?? await cookies();
  const { url, key } = getSupabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them first.
        }
      },
    },
  });
}
