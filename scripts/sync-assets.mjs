import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');
fs.mkdirSync(path.join(output, 'legacy'), { recursive: true });
for (const name of ['app.js', 'location-picker.js']) {
  fs.copyFileSync(path.join(root, 'client', name), path.join(output, 'legacy', name));
}
fs.copyFileSync(path.join(root, 'client/favicon.svg'), path.join(output, 'favicon.svg'));
// Existing image URLs use both /name.png and /public/name.png.
for (const entry of fs.readdirSync(path.join(root, 'client/public'), { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  for (const destination of [output, path.join(output, 'public')]) {
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(root, 'client/public', entry.name), path.join(destination, entry.name));
  }
}
// Serve the same pinned Leaflet assets from our own origin in Next.js and legacy mode.
for (const destination of [path.join(output, 'legacy/vendor/leaflet'), path.join(root, 'client/vendor/leaflet')]) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['leaflet.js', 'leaflet.css']) {
    fs.copyFileSync(path.join(root, 'node_modules/leaflet/dist', name), path.join(destination, name));
  }
  fs.cpSync(path.join(root, 'node_modules/leaflet/dist/images'), path.join(destination, 'images'), { recursive: true });
  fs.copyFileSync(path.join(root, 'node_modules/leaflet/LICENSE'), path.join(destination, 'LICENSE'));
}
console.log('ANJEMIN assets ready for Next.js.');
