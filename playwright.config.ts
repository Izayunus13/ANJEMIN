import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const port = 3100;
const cloudMode = process.env.ANJEMIN_TEST_VERCEL === '1';
const storage = path.join(os.tmpdir(), 'anjemin-next-e2e-' + process.pid);

export default defineConfig({
  testDir: './tests',
  testMatch: cloudMode ? 'vercel-access.spec.ts' : ['next-migration.spec.ts', 'location-picker.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:' + port,
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: cloudMode ? 'npm start' : 'npm run dev',
    url: 'http://localhost:' + port,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      APP_URL: 'http://localhost:' + port,
      ANJEMIN_DATA_DIR: path.join(storage, 'data'),
      ANJEMIN_UPLOAD_DIR: path.join(storage, 'uploads'),
      ADMIN_PASSWORD: 'GANTI_TEST_DISABLED',
      NODE_ENV: cloudMode ? 'production' : 'development',
      VERCEL: cloudMode ? '1' : '',
      ANJEMIN_DB_DRIVER: cloudMode ? 'pglite' : 'sqlite',
    },
  },
});
