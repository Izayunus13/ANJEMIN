import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return NextResponse.json({ configured: false, authenticated: false }, { status: 503, headers });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error && error.name !== 'AuthSessionMissingError') {
    return NextResponse.json({ configured: true, authenticated: false }, { status: 401, headers });
  }
  return NextResponse.json(
    { configured: true, authenticated: Boolean(data?.claims) },
    { headers },
  );
}
