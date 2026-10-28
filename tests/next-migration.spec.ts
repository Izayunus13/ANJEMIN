import { test, expect } from '@playwright/test';

test('ANJEMIN boots in Next.js, preserves icons, theme, and signup interaction', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page).toHaveTitle('ANJEMIN — Mager? ANJEMIN Aja!');
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/app-booting/);
  await expect(page.locator('#i-bike')).toHaveCount(1);

  await page.locator('[data-auth-tab="signup"]').first().click();
  await expect(page.locator('#signup-form')).toBeVisible();
  await page.getByRole('button', { name: 'Tutup', exact: true }).click();
  await page.getByRole('button', { name: 'Buang perubahan', exact: true }).click();
  await page.getByRole('button', { name: 'Ganti tema', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(errors).toEqual([]);
});

test('legacy API adapter keeps streamed JSON parsing and authentication errors', async ({ request }) => {
  const config = await request.get('/api/config');
  expect(config.status()).toBe(200);
  expect(await config.json()).toMatchObject({ brand: 'ANJEMIN', mode: 'development' });

  const me = await request.get('/api/auth/me');
  expect(await me.json()).toEqual({ user: null });
  const invalid = await request.post('/api/auth/login', { data: { identifier: 'missing', password: 'incorrect-password' } });
  expect(invalid.status()).toBe(401);
  expect(await invalid.json()).toMatchObject({ error: 'Email/username atau password salah.' });

  const malformed = await request.post('/api/auth/login', {
    headers: { 'Content-Type': 'application/json' }, data: Buffer.from('{broken'),
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toMatchObject({ error: 'JSON tidak valid.' });

  const blocked = await request.post('/api/auth/login', {
    headers: { Origin: 'https://untrusted.example' }, data: { identifier: 'missing', password: 'incorrect-password' },
  });
  expect(blocked.status()).toBe(403);
});

test('Supabase session endpoint is private and does not require the example todos table', async ({ request }) => {
  const response = await request.get('/api/supabase/session');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ configured: true, authenticated: false });
});

test('original static assets resolve through Next.js', async ({ request }) => {
  for (const asset of ['/favicon.svg', '/legacy/app.js', '/legacy/location-picker.js', '/legacy/vendor/leaflet/leaflet.js', '/legacy/vendor/leaflet/leaflet.css', '/anjemin-logo.png', '/public/dashboard-promo-scene.png']) {
    const response = await request.get(asset);
    expect(response.status(), asset).toBe(200);
    expect(response.headers()['content-type']).not.toContain('text/html');
  }
});

test('expired Supabase sessions refresh cookies in both directions and disable caching', async () => {
  const { NextRequest } = await import('next/server.js');
  const { updateSession } = await import('../utils/supabase/middleware.ts');
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const url = 'https://session-test.supabase.co';
  const cookieName = 'sb-session-test-auth-token';
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated', role: 'authenticated', email: 'tester@example.test',
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  };
  const jwt = (exp: number) => [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', iat: now - 3600, exp })).toString('base64url'),
    Buffer.alloc(32, 1).toString('base64url'),
  ].join('.');
  const session = {
    access_token: jwt(now - 300), refresh_token: 'old-refresh-token',
    token_type: 'bearer', expires_at: now - 300, expires_in: 3600, user,
  };
  const freshSession = {
    ...session, access_token: jwt(now + 3600), refresh_token: 'new-refresh-token',
    expires_at: now + 3600,
  };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  let refreshes = 0;
  let verifications = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === url + '/auth/v1/token?grant_type=refresh_token') {
      expect(await request.json()).toMatchObject({ refresh_token: 'old-refresh-token' });
      refreshes++;
      return Response.json(freshSession);
    }
    if (request.url === url + '/auth/v1/user') {
      expect(request.headers.get('Authorization')).toBe('Bearer ' + freshSession.access_token);
      verifications++;
      return Response.json(user);
    }
    throw new Error('Unexpected auth request: ' + request.url);
  };
  try {
    const request = new NextRequest('http://localhost:3100/', {
      headers: { Cookie: cookieName + '=' + encoded },
    });
    const response = await updateSession(request);
    expect(refreshes).toBe(1);
    expect(verifications).toBe(1);
    const refreshed = response.cookies.get(cookieName);
    expect(refreshed?.value).toBeTruthy();
    expect(refreshed?.value).not.toBe(encoded);
    expect(request.cookies.get(cookieName)?.value).toBe(refreshed?.value);
    expect(response.headers.get('x-middleware-request-cookie')).toContain(refreshed!.value);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Pragma')).toBe('no-cache');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
});
