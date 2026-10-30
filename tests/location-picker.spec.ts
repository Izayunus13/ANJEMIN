import { test, expect, type Page } from '@playwright/test';

const center = { lat: -7.058, lng: 110.441 };
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8efdf"/><path d="M0 90H256M120 0V256" stroke="#fff" stroke-width="15"/><path d="M0 90H256M120 0V256" stroke="#d4d6ce" stroke-width="2"/></svg>';

async function boot(page: Page, service = 'RIDE', role = 'CUSTOMER') {
  const orders: any[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Tests never download tiles from the community tile servers.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
  await page.route('https://**/*', route => {
    const host = new URL(route.request().url()).hostname;
    if (/(?:maps|places)\.googleapis\.com|maps\.google\.com|nominatim/.test(host)) throw new Error('Unexpected map service: ' + host);
    return route.fallback();
  });
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let data: any = {};
    if (path === '/api/config') data = { brand: 'ANJEMIN', mode: 'development', paymentMode: 'SIMULATION', mapsEnabled: true, mapProvider: 'openstreetmap', placesEnabled: false };
    else if (path === '/api/auth/me') data = { user: { id: 'map-fixture', role, full_name: 'Pengguna Peta', username: 'peta', profile_complete: true, ready: false } };
    else if (path === '/api/orders' && req.method() === 'POST') {
      orders.push(req.postDataJSON());
      data = { order: { id: 'map-order', platform_fee: 360, promo_discount: 0 } };
    } else if (path.includes('vouchers')) data = { vouchers: [] };
    else if (path.includes('inbox')) data = { messages: [], has_more: false };
    else if (path.includes('wallet')) data = { balance: 0, available_balance: 0, transactions: [] };
    else if (path.includes('orders')) data = { orders: [] };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  if (role === 'CUSTOMER') await page.locator('.service-card[data-service="' + service + '"]').click();
  return { orders, errors };
}
async function open(page: Page, target: string) {
  await page.locator('#order-form [data-location-target="' + target + '"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-lp-center]')).toBeEnabled();
  return dialog;
}
async function submitRide(page: Page, orders: any[]) {
  await page.locator('#order-form [name="destination"]').fill('Gerbang tujuan kampus');
  await page.locator('#order-form [type="submit"]').click();
  await expect.poll(() => orders.length).toBe(1);
  return orders[0];
}

test('cancel preserves the form; confirmation sends distinct pickup and destination pins', async ({ page }) => {
  const { orders, errors } = await boot(page);
  const pickup = page.locator('#order-form [name="pickup"]');
  await pickup.fill('Alamat jemput sebelumnya');
  let dialog = await open(page, 'pickup');
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Gerbang selatan, depan pos satpam');
  expect(await pickup.inputValue()).toBe('Alamat jemput sebelumnya');
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(pickup).toHaveValue('Alamat jemput sebelumnya');
  dialog = await open(page, 'pickup');
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Gerbang selatan, depan pos satpam');
  await dialog.locator('[data-lp-apply]').click();
  await expect(pickup).toHaveValue('Gerbang selatan, depan pos satpam');
  dialog = await open(page, 'destination');
  const box = (await dialog.locator('.location-picker-map').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 70, box.y + box.height / 2 - 30);
  await dialog.locator('textarea').fill('Kos Melati, pagar putih nomor 12');
  await dialog.locator('[data-lp-apply]').click();
  await page.locator('#order-form [type="submit"]').click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0]).toMatchObject({ pickup: 'Gerbang selatan, depan pos satpam', destination: 'Kos Melati, pagar putih nomor 12' });
  expect(orders[0].pickup_lat).toBeCloseTo(center.lat, 4);
  expect(orders[0].pickup_lng).toBeCloseTo(center.lng, 4);
  expect(orders[0].destination_lng).toBeGreaterThan(center.lng);
  expect(orders[0].destination_lat).toBeGreaterThan(center.lat);
  expect(errors).toEqual([]);
});

test('dragging a real Leaflet pin updates coordinates; editing an address clears the old point', async ({ page }) => {
  const { orders, errors } = await boot(page);
  let dialog = await open(page, 'pickup');
  await dialog.locator('[data-lp-center]').click();
  const pin = (await dialog.locator('.location-map-pin').boundingBox())!;
  await page.mouse.move(pin.x + pin.width / 2, pin.y + 17);
  await page.mouse.down();
  await page.mouse.move(pin.x + pin.width / 2 + 65, pin.y + 17, { steps: 12 });
  await page.mouse.up();
  await dialog.locator('textarea').fill('Titik jemput setelah pin digeser');
  await dialog.locator('[data-lp-apply]').click();
  const payload = await submitRide(page, orders);
  expect(payload.pickup_lng).toBeGreaterThan(center.lng + 0.001);
  expect(payload.pickup_lat).toBeCloseTo(center.lat, 3);
  expect(errors).toEqual([]);

  await page.locator('[data-nav="home"]').first().click();
  await page.locator('.service-card[data-service="RIDE"]').click();
  dialog = await open(page, 'pickup');
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Alamat dengan titik awal');
  await dialog.locator('[data-lp-apply]').click();
  await page.locator('#order-form [name="pickup"]').fill('Alamat baru yang ditulis sendiri');
  orders.length = 0;
  const manual = await submitRide(page, orders);
  expect(manual).not.toHaveProperty('pickup_lat');
  expect(manual).not.toHaveProperty('pickup_lng');
});

test('mobile map keeps attribution visible and remains usable when GPS permission is denied', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) => { setTimeout(() => fail?.({ code: 1 } as GeolocationPositionError), 0); };
  });
  const { errors } = await boot(page);
  await page.locator('#order-form [data-action="gps"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.location-picker-status')).toContainText('Izin GPS ditolak');
  await expect(dialog.locator('[data-lp-center]')).toBeEnabled();
  await expect(dialog.locator('.leaflet-control-attribution')).toBeVisible();
  const rect = (await dialog.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await dialog.locator('[data-lp-center]').click();
  await expect(dialog.locator('[data-lp-apply]')).toBeDisabled();
  await dialog.locator('textarea').fill('Depan gerbang kampus');
  await page.screenshot({ path: 'test-results/location-picker-mobile.png', fullPage: true });
  await dialog.locator('[data-lp-apply]').click();
  await expect(page.locator('#order-form [name="pickup"]')).toHaveValue('Depan gerbang kampus');
  expect(errors).toEqual([]);
});

test('late GPS results cannot overwrite a manually chosen point or change a cancelled form', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = ok => { (window as any).gpsResult = ok; };
  });
  const { orders } = await boot(page);
  await page.locator('#order-form [data-action="gps"]').click();
  let dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-lp-center]')).toBeEnabled();
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Lokasi yang dipilih sendiri');
  await page.evaluate(() => (window as any).gpsResult({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 10 } }));
  await dialog.locator('[data-lp-apply]').click();
  await page.locator('#order-form [data-action="gps"]').click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.evaluate(() => (window as any).gpsResult({ coords: { latitude: -6.1, longitude: 106.9, accuracy: 10 } }));
  const payload = await submitRide(page, orders);
  expect(payload.pickup_lat).toBeCloseTo(center.lat, 4);
  expect(payload.pickup_lng).toBeCloseTo(center.lng, 4);
  expect(payload.pickup).toBe('Lokasi yang dipilih sendiri');
});

test('Jastip uses separate store and delivery points across its three steps', async ({ page }) => {
  const { orders, errors } = await boot(page, 'JASTIP');
  let dialog = await open(page, 'pickup');
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Warung selatan kampus');
  await dialog.locator('[data-lp-apply]').click();
  await page.locator('[data-jastip-next]').click();
  await page.locator('[name="item_name"]').fill('Dua nasi ayam dan es teh');
  dialog = await open(page, 'destination');
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('textarea').fill('Kos Melati, depan pagar putih');
  await dialog.locator('[data-lp-apply]').click();
  await page.locator('[data-jastip-next]').click();
  await expect(page.locator('#jastip-review')).toContainText('Kos Melati');
  await page.locator('#order-form [type="submit"]').click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0]).toMatchObject({ type: 'JASTIP', pickup: 'Warung selatan kampus', destination: 'Kos Melati, depan pagar putih' });
  expect(orders[0].pickup_lat).toBeCloseTo(center.lat, 4);
  expect(orders[0].destination_lng).toBeCloseTo(center.lng, 4);
  expect(errors).toEqual([]);
});

test('GPS success sets a device point and displays accuracy before confirmation', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = ok => { setTimeout(() => ok({ coords: { latitude: -7.06, longitude: 110.44, accuracy: 18 } } as GeolocationPosition), 0); };
  });
  const { orders } = await boot(page);
  await page.locator('#order-form [data-action="gps"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.location-picker-accuracy')).toContainText('18 meter');
  await expect(page.locator('#order-form [name="pickup"]')).toHaveValue('');
  await dialog.locator('textarea').fill('Di depan pintu masuk gedung');
  await dialog.locator('[data-lp-apply]').click();
  const payload = await submitRide(page, orders);
  expect(payload.pickup_lat).toBe(-7.06);
  expect(payload.pickup_lng).toBe(110.44);
});

test('driver can confirm a location without an address after denying GPS', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) => { setTimeout(() => fail?.({ code: 1 } as GeolocationPositionError), 0); };
  });
  const { errors } = await boot(page, 'RIDE', 'DRIVER');
  await page.locator('[data-action="driver-gps"]').click();
  const dialog = page.getByRole('dialog', { name: 'Atur lokasi saya' });
  await expect(dialog.locator('.location-picker-status')).toContainText('Izin GPS ditolak');
  await expect(dialog.locator('[data-lp-center]')).toBeEnabled();
  await dialog.locator('[data-lp-center]').click();
  await dialog.locator('[data-lp-apply]').click();
  await expect(page.locator('#driver-gps-status')).toContainText('Lokasi diperbarui');
  expect(errors).toEqual([]);
});

test('unavailable map assets still allow GPS and a manual address', async ({ page }) => {
  await page.route('**/vendor/leaflet/leaflet.js', route => route.fulfill({ status: 503, body: '' }));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = ok => { setTimeout(() => ok({ coords: { latitude: -7.06, longitude: 110.44, accuracy: 20 } } as GeolocationPosition), 0); };
  });
  const { orders } = await boot(page);
  await page.locator('#order-form [data-action="gps"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('[data-lp-retry]')).toBeVisible();
  await expect(dialog.locator('.location-picker-accuracy')).toContainText('20 meter');
  await dialog.locator('textarea').fill('Alamat jemput saat peta gagal dimuat');
  await dialog.locator('[data-lp-apply]').click();
  const payload = await submitRide(page, orders);
  expect(payload.pickup_lat).toBe(-7.06);
  expect(payload.pickup_lng).toBe(110.44);
});

test('car option requires a passenger selection and submits the selected 1-7 count', async ({ page }) => {
  const { orders, errors } = await boot(page);
  const form = page.locator('#order-form'), passenger = form.locator('[name="passenger_count"]');
  await expect(passenger).toBeDisabled(); await expect(passenger).toBeHidden();
  await form.locator('.vehicle-options label').filter({ hasText: 'Mobil' }).click();
  await expect(passenger).toBeVisible(); await expect(passenger).toBeEnabled();
  expect(await passenger.locator('option').allTextContents()).toEqual(['Pilih jumlah penumpang', '1 orang', '2 orang', '3 orang', '4 orang', '5 orang', '6 orang', '7 orang']);
  await form.locator('[name="pickup"]').fill('Gerbang kampus sebelah utara');
  await form.locator('[name="destination"]').fill('Kos Melati nomor dua');
  await form.locator('[type="submit"]').click();
  expect(orders).toHaveLength(0);
  expect(await passenger.evaluate((element: HTMLSelectElement) => element.validity.valueMissing)).toBe(true);
  await passenger.selectOption('7');
  await form.locator('[type="submit"]').click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0]).toMatchObject({ type: 'RIDE', vehicle_type: 'MOBIL', passenger_count: '7' });
  expect(errors).toEqual([]);
});

test('switching from car back to motor omits the passenger field', async ({ page }) => {
  const { orders } = await boot(page);
  const form = page.locator('#order-form'), passenger = form.locator('[name="passenger_count"]');
  await form.locator('.vehicle-options label').filter({ hasText: 'Mobil' }).click();
  await passenger.selectOption('4');
  await form.locator('.vehicle-options label').filter({ hasText: 'Motor' }).click();
  await expect(passenger).toBeHidden(); await expect(passenger).toBeDisabled();
  await form.locator('[name="pickup"]').fill('Gerbang kampus sebelah utara');
  await form.locator('[name="destination"]').fill('Kos Melati nomor dua');
  await form.locator('[type="submit"]').click();
  await expect.poll(() => orders.length).toBe(1);
  expect(orders[0].vehicle_type).toBe('MOTOR'); expect(orders[0]).not.toHaveProperty('passenger_count');
});

test('driver sees passenger count before accepting and in accepted order details', async ({ page }) => {
  const { errors } = await boot(page, 'RIDE', 'DRIVER');
  const order = { id: 'car-passengers', type: 'RIDE', vehicle_type: 'MOBIL', passenger_count: 7, customer_id: 'customer', driver_id: 'map-fixture', status: 'CLAIMED', pickup: 'Gerbang kampus', destination: 'Kos Melati', fare: 10000, platform_fee: 600 };
  await page.route('**/api/driver/jobs', route => route.fulfill({ json: { orders: [{ ...order, status: 'OPEN', driver_id: null }] } }));
  await page.locator('[data-action="refresh-driver"]').click();
  await expect(page.locator('#driver-results')).toContainText('Penumpang: 7 orang');
  await page.route('**/api/orders/mine', route => route.fulfill({ json: { orders: [order] } }));
  await page.locator('.side-link[data-nav="orders"]').click();
  await expect(page.locator('#orders-results')).toContainText('Penumpang: 7 orang');
  expect(errors).toEqual([]);
});
