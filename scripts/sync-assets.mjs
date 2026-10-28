import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');
fs.mkdirSync(path.join(output, 'legacy'), { recursive: true });
fs.copyFileSync(path.join(root, 'client/app.js'), path.join(output, 'legacy/app.js'));
fs.copyFileSync(path.join(root, 'client/favicon.svg'), path.join(output, 'favicon.svg'));
// Existing image URLs use both /name.png and /public/name.png.
for (const entry of fs.readdirSync(path.join(root, 'client/public'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  for (const destination of [output, path.join(output, 'public')]) {
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(root, 'client/public', entry.name), path.join(destination, entry.name));
  }
}
console.log('ANJEMIN assets ready for Next.js.');
