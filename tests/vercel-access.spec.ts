import { test, expect } from '@playwright/test';

test('Vercel production renders ANJEMIN without SQLite, failing startup requests, or a broken login form', async ({ page, request }) => {
  const errors: string[] = [];
  const failedResponses: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push(response.url());
  });

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('ANJEMIN — Mager? ANJEMIN Aja!');
  await expect(page.locator('#app h1')).toContainText('ANJEMIN');
  await expect(page.locator('#app .service-card')).toHaveCount(4);
  await expect(page.locator('html')).not.toHaveClass(/app-booting/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Masuk / Daftar', exact: true }).click();
  await expect(page.locator('#toast-area')).toContainText('Layanan akun belum tersedia');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const config = await request.get('/api/config');
  expect(config.status()).toBe(200);
  expect(await config.json()).toMatchObject({
    brand: 'ANJEMIN', mode: 'production', backendAvailable: false, paymentMode: 'DISABLED',
  });
  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);

  const legacy = await request.get('/api/auth/me');
  expect(legacy.status()).toBe(503);
  expect(await legacy.json()).toMatchObject({ code: 'PERSISTENT_BACKEND_REQUIRED' });
});
