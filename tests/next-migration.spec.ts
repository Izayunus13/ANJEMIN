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

for (const [role, mode] of [['CUSTOMER', 'SIMULATION'], ['DRIVER', 'MIDTRANS_SANDBOX']]) {
  test('marketplace upload fee is recoverable and gates publication for ' + role, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let listing: any = null, paid = false, uploads = 0;
    const qr = 'https://api.sandbox.midtrans.com/v2/qris/fee-fixture/qr-code';
    const payment = () => ({
      id: 'fee-fixture', amount: 3000, status: paid ? 'PAID' : 'PENDING', mode,
      expires_at: new Date(Date.now() + 900000).toISOString(), qr_url: mode === 'SIMULATION' ? null : qr,
    });
    await page.route(qr, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/></svg>' }));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      let data: any = {};
      if (path === '/api/config') data = { brand: 'ANJEMIN', mode: 'development', paymentMode: mode };
      else if (path === '/api/auth/me') data = { user: { id: 'seller-fixture', role, username: 'penjual', full_name: 'Penjual Kampus', profile_complete: true, ready: false } };
      else if (path === '/api/listings' && request.method() === 'POST') {
        uploads++;
        const body = request.postDataJSON();
        expect(body.price).toBe('20000'); expect(body.images).toHaveLength(1);
        listing = { ...body, id: 'listing-fixture', seller_id: 'seller-fixture', publication_required: 1, status: 'AVAILABLE', image_path: 'test.png' };
        data = { id: listing.id, fee: 3000, published: false, payment: payment(), message: 'Lapak disimpan. Bayar biaya pasang Rp3.000 agar tayang.' };
      } else if (path === '/api/listings') data = { listings: paid && listing ? [listing] : [] };
      else if (path === '/api/listings/mine') data = { listings: listing ? [{ ...listing, publication_payment: payment() }] : [] };
      else if (path.endsWith('/publication-payment/simulate')) { paid = true; data = { payment: payment(), published: true }; }
      else if (path.endsWith('/publication-payment')) data = { payment: payment(), published: paid };
      else if (path.includes('inbox')) data = { messages: [], has_more: false };
      else if (path.includes('wallet')) data = { balance: 0, available_balance: 0, available: 0, held: 0, transactions: [] };
      else if (path.includes('vouchers')) data = { vouchers: [] };
      else if (path.includes('jobs') || path.includes('orders')) data = { orders: [], jobs: [] };
      await route.fulfill({ json: data });
    });
    await page.route('**/api/image/test.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64') }));
    await page.goto('/');
    await page.locator('.service-card[data-service="MARKET"], .service-card[data-driverfilter="MARKET"]').click();
    await page.locator('[data-action="add-listing"]').first().click();
    const form = page.locator('#listing-form');
    await expect(form).toContainText('Biaya upload Rp3.000');
    await form.locator('[name="title"]').fill('Buku kuliah bekas');
    await form.locator('[name="price"]').fill('20000');
    await form.locator('[name="description"]').fill('Buku masih lengkap dan kondisinya bagus.');
    await form.locator('[name="category"]').selectOption('Buku & Alat Tulis');
    await form.locator('#listing-photo-picker').setInputFiles({
      name: 'buku.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64'),
    });
    await form.getByRole('button', { name: 'Lanjut bayar Rp3.000' }).click();
    let dialog = page.getByRole('dialog', { name: 'Biaya pasang lapak' });
    await expect(dialog.getByRole('heading', { name: 'Rp3.000' })).toBeVisible();
    await expect(page.locator('#market-results .product-card')).toHaveCount(0);
    if (mode === 'MIDTRANS_SANDBOX') {
      await expect(dialog.getByAltText('QRIS biaya pasang lapak Rp3.000')).toHaveAttribute('src', qr);
      await expect(dialog).toContainText('QRIS uji coba Midtrans');
      await expect(dialog.locator('[data-listing-fee-simulate]')).toHaveCount(0);
    } else await expect(dialog).toContainText('Mode simulasi');
    await dialog.locator('[data-listing-fee-close]').click();
    await expect(page.locator('#market-pending-listings')).toContainText('Buku kuliah bekas');
    await page.locator('#market-pending-listings [data-listing-fee]').click();
    dialog = page.getByRole('dialog', { name: 'Biaya pasang lapak' });
    await expect(dialog.getByRole('heading', { name: 'Rp3.000' })).toBeVisible();
    if (mode === 'SIMULATION') await dialog.locator('[data-listing-fee-simulate]').click();
    else { paid = true; await dialog.getByRole('button', { name: 'Cek status pembayaran' }).click(); }
    await expect(dialog).toContainText('Lunas');
    await expect(page.locator('#market-results .product-card')).toHaveCount(1);
    await expect(page.locator('#market-pending-listings [data-listing-fee]')).toHaveCount(0);
    expect(uploads).toBe(1);
    expect(errors).toEqual([]);
  });
}

for (const role of ['DRIVER', 'CUSTOMER']) {
  test('Rute Jemput only appears for paid active orders of the assigned driver: ' + role, async ({ page, context }) => {
    let paid = false, delivered = false;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const navigation = { url: 'https://www.google.com/maps/dir/?api=1&destination=-7.058%2C110.441&travelmode=two-wheeler&dir_action=navigate', source: 'GPS' };
    const fixture = (id: string, overrides: any = {}) => ({
      id, type: 'RIDE', vehicle_type: 'MOTOR', customer_id: 'customer', driver_id: 'driver', status: 'CLAIMED',
      pickup: 'Gerbang kampus', destination: 'Kos Melati', fare: 10000, platform_fee: 600,
      payment_required: 1, payment: { status: 'HELD', amount: 10000 },
      pickup_navigation: navigation, ...overrides,
    });
    await context.route('https://www.google.com/maps/dir/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Maps navigation fixture</title>' }));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data: any = {};
      if (path === '/api/config') data = { brand: 'ANJEMIN', mode: 'development', paymentMode: 'SIMULATION' };
      else if (path === '/api/auth/me') data = { user: { id: role === 'DRIVER' ? 'driver' : 'customer', role, username: 'route', full_name: 'Pengguna Rute', profile_complete: true, ready: false } };
      else if (path === '/api/orders/mine') data = { orders: [
        fixture('gps-order', { payment: { status: paid ? 'HELD' : 'PENDING' }, delivery_reported_at: delivered ? '2026-10-30 10:00:00' : null }),
        fixture('address-order', { pickup_navigation: { url: 'https://www.google.com/maps/dir/?api=1&destination=Gerbang+kampus&travelmode=driving&dir_action=navigate', source: 'ADDRESS' } }),
        fixture('finished-order', { status: 'COMPLETED', payment: { status: 'RELEASED' } }),
        fixture('cancelled-order', { status: 'CANCELLED' }),
        fixture('unclaimed-order', { status: 'OPEN', driver_id: null }),
        fixture('another-driver', { driver_id: 'another-driver' }),
        fixture('unpaid-legacy', { payment_required: 0, payment: null }),
      ] };
      else if (path.includes('inbox')) data = { messages: [], has_more: false };
      else if (path.includes('wallet')) data = { balance: 0, available_balance: 0, available: 0, held: 0, transactions: [] };
      else if (path.includes('vouchers')) data = { vouchers: [] };
      else if (path.includes('orders') || path.includes('jobs')) data = { orders: [] };
      return route.fulfill({ json: data });
    });
    await page.goto('/');
    await page.locator('.side-link[data-nav="orders"]').click();
    await expect(page.locator('[data-pickup-route]')).toHaveCount(role === 'DRIVER' ? 1 : 0);
    paid = true;
    await page.locator('[data-action="refresh-orders"]').click();
    await expect(page.locator('[data-pickup-route]')).toHaveCount(role === 'DRIVER' ? 2 : 0);
    if (role === 'DRIVER') {
      const link = page.locator('[data-pickup-route="gps-order"]');
      await expect(link).toContainText('Rute Jemput');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(page.locator('[data-pickup-route="address-order"]').locator('..')).toContainText('Rute memakai alamat');
      const [maps] = await Promise.all([context.waitForEvent('page'), link.click()]);
      await maps.waitForLoadState();
      const url = new URL(maps.url());
      expect(url.origin).toBe('https://www.google.com');
      expect(url.searchParams.get('destination')).toBe('-7.058,110.441');
      expect(url.searchParams.get('dir_action')).toBe('navigate');
      expect(url.searchParams.get('travelmode')).toBe('two-wheeler');
      expect(url.searchParams.has('origin')).toBe(false);
      await maps.close();
      await expect(page.locator('#orders-results')).toBeVisible();
    }
    delivered = true;
    await page.locator('[data-action="refresh-orders"]').click();
    await expect(page.locator('[data-pickup-route="gps-order"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
