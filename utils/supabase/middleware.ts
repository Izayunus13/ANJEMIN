import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server.js';
import { getSupabaseConfig } from './config';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Allow a fresh checkout to render before deployment variables are configured.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return response;
  }
  const { url, key } = getSupabaseConfig();
  // Accumulate cookie and cache-header changes if the SDK writes more than once.
  const pendingCookies = new Map<string, { name: string; value: string; options: import('@supabase/ssr').CookieOptions }>();
  const pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          pendingCookies.set(name, { name, value, options });
        });
        Object.assign(pendingHeaders, headers);
        response = NextResponse.next({ request });
        pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(pendingHeaders).forEach(([name, value]) => response.headers.set(name, value));
        response.headers.set('Cache-Control', 'private, no-store');
      },
    },
  });

  // Verifies the token and refreshes an expiring session. Creating a client alone
  // does not refresh anything. Route handlers still enforce their own access rules.
  await supabase.auth.getClaims();
  return response;
}
