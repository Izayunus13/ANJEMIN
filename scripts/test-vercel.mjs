import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'test'], {
  stdio: 'inherit',
  env: { ...process.env, ANJEMIN_TEST_VERCEL: '1' },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
