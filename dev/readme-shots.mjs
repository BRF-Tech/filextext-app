// The README's screenshots, taken in a real filex (English):
//   node dev/readme-shots.mjs <filex binary>        (build first: npm run build)
// Writes docs/screenshots/*.png. FXTXT_ANY_FILEX=1 as in dev/real-filex.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINARY = process.argv[2];
const PORT = 5392;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const PLAN = `# Project plan

This workspace is **end-to-end encrypted**: filex only ever stores ciphertext.

## To do

- [x] Password and recovery key
- [ ] Pages, folders and tabs
- [ ] Markdown in and out

## Code

\`\`\`ts
const fmk = await unlock(block, { password });
const payload = await openBody(fmk, body);
\`\`\`

| Step | Time |
|---|---|
| PBKDF2 (600,000) | 130 ms |
| Open 40 pages | 0.5 s |

> Lose both the password and the recovery key, and nobody can open it.
`;

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE + '/healthz')).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('filex did not come up');
}

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'filextext-shots-'));
const store = path.join(data, 'Notes');
fs.mkdirSync(store);
const srv = spawn(BINARY, ['serve'], {
  env: {
    ...process.env,
    FILEX_DATA_DIR: path.join(data, 'data'),
    FILEX_LISTEN: `127.0.0.1:${PORT}`,
    FILEX_PUBLIC_URL: BASE,
    FILEX_ADMIN_EMAIL: 'admin@local',
    FILEX_ADMIN_PASSWORD: 'admin',
    FILEX_SECRET_KEY: 'filextext-readme-shots-key',
    FILEX_APP_PLUGIN_UPDATE_CHECK: '0',
  },
  stdio: 'ignore',
});
const browser = await chromium.launch({ channel: 'chrome' });
try {
  await waitUp();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
  await ctx.request.post('/api/auth/login', { data: { email: 'admin@local', password: 'admin' } });
  await ctx.request.post('/api/admin/storages', { data: { name: 'Notes', driver: 'local', mount_path: store, config: { path: store }, enabled: true } });
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
  if (process.env.FXTXT_ANY_FILEX === '1') delete m.filex;
  const files = {
    manifest: { name: 'filex-app.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(m)) },
    ui: { name: 'ui.zip', mimeType: 'application/zip', buffer: fs.readFileSync(path.join(ROOT, 'release', 'ui.zip')) },
  };
  const dry = await (await ctx.request.post('/api/admin/app-plugins?dry_run=1', { multipart: { ...files, grant: JSON.stringify({ permissions: [] }) } })).json();
  await ctx.request.post('/api/admin/app-plugins', { multipart: { ...files, grant: JSON.stringify({ permissions: dry.permissions.map((p) => p.id) }) } });

  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('filex.tourDone', '1');
    localStorage.setItem('filex.installPrompt.dismissed', '1');
    localStorage.setItem('filex.locale', 'en');
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.goto('/admin/explore?storage=Notes');
  const nav = page.getByTestId('sidenav-new');
  if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('toolbar-nav').click();
  await nav.click();
  await page.locator('.fe-ctx__item').filter({ hasText: 'New document' }).click();
  await page.getByTestId('newdoc-modal').waitFor();
  await page.getByTestId('newdoc-type-app:filextext:fxtxt').click();
  const input = page.getByTestId('newdoc-name');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('project-notes');
  await page.getByTestId('newdoc-type-app:filextext:fxtxt').scrollIntoViewIfNeeded();
  await shot('new-document');
  await page.getByTestId('newdoc-create').click();
  const app = page.frameLocator('iframe[data-testid="app-frame"]');
  await app.getByTestId('create-screen').waitFor({ timeout: 60000 });
  await app.getByTestId('new-password').fill('a long example passphrase');
  await app.getByTestId('new-password-2').fill('a long example passphrase');
  await shot('create');
  await app.getByTestId('create-submit').click();
  await app.getByTestId('recovery-screen').waitFor({ timeout: 60000 });
  await app.getByTestId('recovery-ack').check();
  await shot('recovery-key');
  await app.getByTestId('recovery-continue').click();
  await app.getByTestId('sidebar').waitFor({ timeout: 60000 });
  await app.getByTestId('import-input').setInputFiles([{ name: 'Project plan.md', mimeType: 'text/markdown', buffer: Buffer.from(PLAN) }]);
  await app.getByTestId('new-folder').click();
  await app.getByTestId('prompt-input').fill('Meetings');
  await app.getByTestId('prompt-ok').click();
  await app.getByTestId('new-page').click();
  await app.locator('doc-title [contenteditable="true"]').first().click();
  await page.keyboard.type('Monday meeting');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Agenda: encrypted notes, the page tree, exports.');
  await app.locator('.node-page').filter({ hasText: 'Untitled' }).click({ button: 'right' });
  await app.getByTestId('menu-delete').click();
  await app.getByTestId('confirm-ok').click();
  await page.waitForTimeout(1500);
  await app.getByTestId('save').click();
  await app.locator('[data-testid="save-status"][data-state="clean"]').waitFor({ timeout: 30000 });
  if (await page.getByTestId('draft-bar').isVisible().catch(() => false)) {
    await page.getByTestId('draft-save').click();
    await page.getByTestId('draft-bar').waitFor({ state: 'hidden', timeout: 30000 });
  }

  // Open it again from the explorer, as anyone would.
  await page.goto('/admin/explore?storage=Notes');
  const row = page.locator('[data-fe-path="Notes://project-notes.fxtxt"]');
  await row.waitFor({ timeout: 30000 });
  await row.getByText('project-notes.fxtxt', { exact: true }).dblclick();
  const again = page.frameLocator('iframe[data-testid="app-frame"]');
  await again.getByTestId('unlock-screen').waitFor({ timeout: 60000 });
  await shot('unlock');
  await again.getByTestId('unlock-password').fill('a long example passphrase');
  await again.getByTestId('unlock-submit').click();
  await again.getByTestId('sidebar').waitFor({ timeout: 60000 });
  const folder = again.locator('[data-testid="tree-folder"][data-name="Meetings"]');
  if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
  await again.locator('.node-page').filter({ hasText: 'Monday meeting' }).click();
  await again.locator('.node-page').filter({ hasText: 'Project plan' }).click();
  await page.waitForTimeout(2500);
  await shot('workspace');
  await again.getByTestId('more').click();
  await again.getByTestId('menu-export-md').click();
  await again.getByTestId('export-dialog').waitFor();
  await again.getByTestId('export-text').evaluate((t) => {
    t.setSelectionRange(0, 0);
    t.scrollTop = 0;
    t.blur();
  });
  await page.waitForTimeout(300);
  await shot('export');
  console.log('screenshots in', OUT);
} finally {
  await browser.close();
  srv.kill();
}
