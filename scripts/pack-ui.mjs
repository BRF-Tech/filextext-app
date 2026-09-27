// Packs dist/ into ui.zip — the `ui.bundle` filex installs (docs: filex
// APP-PLUGINS-API.md → "An app's own interface") — and prints its sha256.
//   node scripts/pack-ui.mjs            # release/ui.zip + release/ui.zip.sha256
//   node scripts/pack-ui.mjs --stamp    # also writes the sha256 into filex-app.json
// It also rewrites THIRD_PARTY_LICENSES.txt at the repository root: the same
// notices the zip carries (CI fails when the committed copy is stale).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const files = {};
// A fixed timestamp: the same dist/ always gives the same zip (and hash).
const mtime = new Date('2026-01-01T00:00:00Z');
const add = (name, bytes) => {
  files[name] = [new Uint8Array(bytes), { mtime, level: 9 }];
};
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else add(relative(dist, p).split(sep).join('/'), readFileSync(p));
  }
};
walk(dist);
if (!files['index.html']) throw new Error('dist/index.html missing: run vite build first');
add('LICENSE', readFileSync(join(root, 'LICENSE')));

// Third-party notices: the editor bundle's list (made at its build) plus the
// app's own two runtime dependencies.
const rule = '='.repeat(78);
const own = [
  ['fflate', 'MIT', readFileSync(join(root, 'node_modules', 'fflate', 'LICENSE'), 'utf8').trim()],
  ['@brftech/filex-app-ui (vendor/filex-app-ui)', 'MIT', 'MIT License, Copyright (c) 2026 BRF Tech (part of filex, https://github.com/BRF-Tech/filex).'],
];
// LF only: some licence files upstream are CRLF, git stores them LF, and the
// zip (and its hash) must be the same from any checkout.
const lf = (t) => t.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const parts = [lf(readFileSync(join(root, 'vendor', 'blocksuite', 'THIRD_PARTY_LICENSES.txt'), 'utf8'))];
for (const [name, lic, text] of own) parts.push(rule, `${name} — ${lic}`, '', lf(text), '');
const notices = parts.join('\n');
add('THIRD_PARTY_LICENSES.txt', new TextEncoder().encode(notices));
writeFileSync(join(root, 'THIRD_PARTY_LICENSES.txt'), notices);

const zip = zipSync(files);
mkdirSync(join(root, 'release'), { recursive: true });
writeFileSync(join(root, 'release', 'ui.zip'), zip);
const sha = createHash('sha256').update(zip).digest('hex');
writeFileSync(join(root, 'release', 'ui.zip.sha256'), `${sha}  ui.zip\n`);
const unpacked = Object.values(files).reduce((n, [b]) => n + b.length, 0);
console.log(`release/ui.zip  ${Object.keys(files).length} files  ${(zip.length / 1048576).toFixed(2)} MiB zipped  ${(unpacked / 1048576).toFixed(2)} MiB unpacked`);
console.log(`sha256 ${sha}`);
if (process.argv.includes('--stamp')) {
  const mpath = join(root, 'filex-app.json');
  const m = JSON.parse(readFileSync(mpath, 'utf8'));
  m.ui.bundle.sha256 = sha;
  writeFileSync(mpath, JSON.stringify(m, null, 2) + '\n');
  console.log('stamped filex-app.json');
}
