// End to end against a REAL filex with the app-interface platform (0.48.0:
// new_documents + ui.download):
//
//   install from release/ui.zip + filex-app.json (the permission review)
//   → New → Encrypted workspace (.fxtxt) → the create screen in the frame
//   → password + recovery key → write → Save (into the draft)
//   → the draft bar's Save puts the file in its folder
//   → the file ON THE SERVER'S DISK is ciphertext; the Python reference opens it
//   → Export → Download: the page as Markdown on the person's disk
//   → close, open the file from the explorer, unlock with the password.
//
//   node dev/real-filex.mjs <filex binary> [chromium firefox webkit]
//
// Build first (npm run build). The binary runs with its own temporary data
// directory and storage. FXTXT_ANY_FILEX=1 drops the manifest's `filex` range
// for a development binary (it calls itself 0.1.0-dev).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, firefox, webkit } from '@playwright/test';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINARY = process.argv[2];
const BROWSERS = process.argv.slice(3).length ? process.argv.slice(3) : ['chromium', 'firefox', 'webkit'];
const PORT = 5391;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'dev', 'out', 'real-filex');
fs.mkdirSync(OUT, { recursive: true });
const PW = 'gerçek filex parolası';
const SECRET = 'Sunucuda düz metin OLMAMALI: ŞİFRE-9031';
const TITLE = 'Gerçek sunucu notu';

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

function manifestBytes() {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'filex-app.json'), 'utf8'));
  if (process.env.FXTXT_ANY_FILEX === '1') delete m.filex;
  return Buffer.from(JSON.stringify(m));
}

function decryptWithReference(bytes, secret) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxtxt-real-'));
  fs.writeFileSync(path.join(dir, 'w.fxtxt'), bytes);
  execFileSync('python', [path.join(ROOT, 'tools', 'fxtxt_ref.py'), 'decrypt', path.join(dir, 'w.fxtxt'), '-o', path.join(dir, 'w.zip'), '--stdin'], {
    input: `${secret}\n`,
  });
  return unzipSync(new Uint8Array(fs.readFileSync(path.join(dir, 'w.zip'))));
}

async function main() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'filextext-real-'));
  const store = path.join(data, 'depo');
  fs.mkdirSync(store);
  const log = fs.openSync(path.join(OUT, 'server.log'), 'w');
  const srv = spawn(BINARY, ['serve'], {
    env: {
      ...process.env,
      FILEX_DATA_DIR: path.join(data, 'data'),
      FILEX_LISTEN: `127.0.0.1:${PORT}`,
      FILEX_PUBLIC_URL: BASE,
      FILEX_ADMIN_EMAIL: 'admin@local',
      FILEX_ADMIN_PASSWORD: 'admin',
      FILEX_SECRET_KEY: 'filextext-real-filex-test-key',
      FILEX_APP_PLUGIN_UPDATE_CHECK: '0',
    },
    stdio: ['ignore', log, log],
  });
  const results = {};
  try {
    await waitUp();
    for (const name of BROWSERS) {
      results[name] = await run(name, store);
      console.log(name, JSON.stringify(results[name], null, 1));
    }
  } finally {
    srv.kill();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  }
}

async function run(name, store) {
  const type = { chromium, firefox, webkit }[name];
  const browser = await type.launch(name === 'chromium' ? { channel: 'chrome' } : {});
  const R = { browser: `${name} ${browser.version()}` };
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const consoleMsgs = [];
  const shot = (page, step) => page.screenshot({ path: path.join(OUT, `${name}-${step}.png`) });
  let page;
  try {
    await ctx.request.post('/api/auth/login', { data: { email: 'admin@local', password: 'admin' } });
    const list = await (await ctx.request.get('/api/admin/storages')).json();
    const rows = Array.isArray(list) ? list : (list.storages ?? []);
    if (!rows.find((s) => s.name === 'depo')) {
      const r = await ctx.request.post('/api/admin/storages', { data: { name: 'depo', driver: 'local', mount_path: store, config: { path: store }, enabled: true } });
      if (!r.ok()) throw new Error('storage ' + r.status() + ' ' + (await r.text()));
    }
    const apps = await (await ctx.request.get('/api/admin/app-plugins')).json();
    if (!(apps.plugins ?? []).find((p) => p.name === 'filextext')) {
      const files = {
        manifest: { name: 'filex-app.json', mimeType: 'application/json', buffer: manifestBytes() },
        ui: { name: 'ui.zip', mimeType: 'application/zip', buffer: fs.readFileSync(path.join(ROOT, 'release', 'ui.zip')) },
      };
      const dry = await ctx.request.post('/api/admin/app-plugins?dry_run=1', { multipart: { ...files, grant: JSON.stringify({ permissions: [] }) } });
      if (!dry.ok()) throw new Error('dry run ' + dry.status() + ' ' + (await dry.text()));
      const d = await dry.json();
      R.review = d.permissions.map((p) => p.id);
      const inst = await ctx.request.post('/api/admin/app-plugins', { multipart: { ...files, grant: JSON.stringify({ permissions: R.review }) } });
      if (!inst.ok()) throw new Error('install ' + inst.status() + ' ' + (await inst.text()));
    }
    page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`${m.type()}: ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => consoleMsgs.push('pageerror: ' + String(e.message).slice(0, 200)));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('filex.tourDone', '1');
        localStorage.setItem('filex.installPrompt.dismissed', '1');
        localStorage.setItem('filex.locale', 'tr');
      } catch {
        /* ignore */
      }
      // Chromium's File System Access save picker cannot be driven headless;
      // without it filex hands the file over as an ordinary download.
      try {
        delete window.showSaveFilePicker;
      } catch {
        /* ignore */
      }
    });
    const base = `notlar-${name}`;
    const file = path.join(store, `${base}.fxtxt`);
    const frameLoc = () => page.frameLocator('iframe[data-testid="app-frame"]');

    // 1. New → Encrypted workspace (.fxtxt)
    await page.goto('/admin/explore?storage=depo');
    const nav = page.getByTestId('sidenav-new');
    if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('toolbar-nav').click();
    await nav.click();
    await page.locator('.fe-ctx__item').filter({ hasText: /Yeni belge|New document/ }).click();
    await page.getByTestId('newdoc-modal').waitFor();
    const row = page.getByTestId('newdoc-type-app:filextext:fxtxt');
    R.newMenuRow = (await row.textContent())?.replace(/\s+/g, ' ').trim();
    await row.click();
    const input = page.getByTestId('newdoc-name');
    await input.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(base);
    await shot(page, '1-new-document');
    await page.getByTestId('newdoc-create').click();
    await page.locator('iframe[data-testid="app-frame"]').waitFor({ timeout: 30000 });
    let app = frameLoc();
    const t0 = Date.now();
    await app.getByTestId('create-screen').waitFor({ timeout: 60000 });
    R.createScreenMs = Date.now() - t0;
    R.draft = await page.getByTestId('draft-bar').isVisible().catch(() => false);
    await shot(page, '2-create');

    // 2. Password + recovery key
    await app.getByTestId('new-password').fill(PW);
    await app.getByTestId('new-password-2').fill(PW);
    await app.getByTestId('create-submit').click();
    await app.getByTestId('recovery-screen').waitFor({ timeout: 60000 });
    const key = ((await app.getByTestId('recovery-key').textContent()) ?? '').trim();
    R.keyFormat = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/.test(key);
    await shot(page, '3-recovery-key');
    await app.getByTestId('recovery-ack').check();
    await app.getByTestId('recovery-continue').click();
    await app.getByTestId('sidebar').waitFor({ timeout: 60000 });

    // 3. Write and save (into the draft)
    const title = app.locator('doc-title [contenteditable="true"]').first();
    await title.click();
    await page.keyboard.type(TITLE);
    await page.keyboard.press('Enter');
    await page.keyboard.type(SECRET);
    await app.locator('affine-paragraph').filter({ hasText: SECRET }).first().waitFor();
    await app.getByTestId('save').click();
    await app.locator('[data-testid="save-status"][data-state="clean"]').waitFor({ timeout: 30000 });
    await shot(page, '4-workspace');

    // 4. The draft goes to its folder (the draft bar's Save)
    if (R.draft) {
      await page.getByTestId('draft-save').click();
      for (let i = 0; i < 60 && !fs.existsSync(file); i++) await page.waitForTimeout(500);
    }
    R.fileInFolder = fs.existsSync(file);
    const saved = fs.readFileSync(file);
    R.onDisk = {
      bytes: saved.length,
      magic: saved.subarray(0, 8).toString(),
      plaintextFound: [SECRET, 'ŞİFRE-9031', TITLE, 'Sunucuda', PW, key].filter((s) => saved.includes(Buffer.from(s, 'utf8'))),
    };
    const payload = decryptWithReference(saved, PW);
    const md = Object.entries(payload).find(([n]) => n.startsWith('pages/') && n.endsWith('.md'));
    R.referenceDecrypt = { md: md?.[0], hasSecret: md ? new TextDecoder().decode(md[1]).includes(SECRET) : false };
    await shot(page, '5-saved');

    // 5. Export → Download (the person's click in the frame). filex does not
    // count a gesture for 5 s after a click on its OWN page (the draft bar's
    // Save above), so wait that out: this measures whether a click in the
    // frame alone is taken as the person's call.
    await page.waitForTimeout(6000);
    app = frameLoc();
    await app.getByTestId('more').click();
    await app.getByTestId('menu-export-md').click();
    await app.getByTestId('export-dialog').waitFor();
    const dlWait = page.waitForEvent('download', { timeout: 20000 });
    await app.getByTestId('export-download').click();
    // filex asks only when the click did not count as the person's gesture.
    const consent = page.getByTestId('appframe-consent');
    const race = await Promise.race([
      dlWait.then(() => 'download'),
      consent.waitFor({ timeout: 8000 }).then(() => 'consent').catch(() => 'none'),
    ]);
    R.downloadAsked = race === 'consent';
    if (race === 'consent') {
      await shot(page, '6-download-consent');
      await page.waitForTimeout(700);
      await page.getByTestId('appframe-consent-allow').click();
    }
    const dl = await dlWait;
    const dlPath = path.join(OUT, `${name}-${dl.suggestedFilename()}`);
    await dl.saveAs(dlPath);
    const dlText = fs.readFileSync(dlPath, 'utf8');
    R.download = { name: dl.suggestedFilename(), hasTitle: dlText.includes(`# ${TITLE}`), hasSecret: dlText.includes(SECRET) };
    await shot(page, '6-exported');

    // 6. Close, open the file again, unlock with the password
    await page.goto('/admin/explore?storage=depo');
    const fileRow = page.locator(`[data-fe-path="depo://${base}.fxtxt"]`);
    await fileRow.waitFor({ timeout: 30000 });
    await fileRow.getByText(`${base}.fxtxt`, { exact: true }).dblclick();
    await page.locator('iframe[data-testid="app-frame"]').waitFor({ timeout: 30000 });
    app = frameLoc();
    await app.getByTestId('unlock-screen').waitFor({ timeout: 60000 });
    await app.getByTestId('unlock-password').fill(PW);
    const u0 = Date.now();
    await app.getByTestId('unlock-submit').click();
    await app.locator('affine-paragraph').filter({ hasText: SECRET }).first().waitFor({ timeout: 60000 });
    R.unlockMs = Date.now() - u0;
    await shot(page, '7-reopened');
    R.ok =
      R.fileInFolder &&
      R.onDisk.magic === 'filextxt' &&
      R.onDisk.plaintextFound.length === 0 &&
      R.referenceDecrypt.hasSecret &&
      R.download.hasSecret &&
      R.download.hasTitle;
  } catch (e) {
    R.failure = String(e && e.stack ? e.stack : e).slice(0, 900);
    try {
      if (page) await shot(page, 'failure');
    } catch {
      /* ignore */
    }
  } finally {
    R.console = consoleMsgs.slice(0, 20);
    await ctx.close();
    await browser.close();
  }
  return R;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
