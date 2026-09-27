// Screenshots of every screen, against the fake host, for review.
//   node dev/shots.mjs [outDir]      (build first: npm run build)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2] || 'dev/out/shots';
mkdirSync(out, { recursive: true });
const PORT = 7287;
const srv = spawn(process.execPath, ['dev/serve.mjs', '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const browser = await chromium.launch({ channel: 'chrome' });

const RICH = `# Proje planı

Bu çalışma alanı **uçtan uca şifreli**: filex yalnızca şifreli baytları görür.

## Yapılacaklar

- [x] Parola ve kurtarma anahtarı
- [ ] Sayfa ağacı ve sekmeler
- [ ] Markdown içe/dışa aktarma

## Örnek kod

\`\`\`ts
const fmk = await unlock(block, { password });
const payload = await openBody(fmk, body);
\`\`\`

| Adım | Süre |
|---|---|
| PBKDF2 (600k) | ~130 ms |
| Açılış | ~1 sn |

> Parolayı ve kurtarma anahtarını birlikte kaybederseniz kimse açamaz.
`;

async function run(lang, theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const shot = (name) => page.screenshot({ path: `${out}/${lang}-${theme}-${name}.png` });
  await page.goto(`http://127.0.0.1:${PORT}/?lang=${lang}&theme=${theme}&name=${lang === 'tr' ? 'notlarım.fxtxt' : 'notes.fxtxt'}`);
  const app = page.frameLocator('iframe[title="app"]');
  await app.getByTestId('create-screen').waitFor();
  await shot('01-create');
  const pw = 'örnek parola 2026';
  await app.getByTestId('new-password').fill(pw);
  await app.getByTestId('new-password-2').fill(pw);
  await app.getByTestId('create-submit').click();
  await app.getByTestId('recovery-screen').waitFor({ timeout: 60000 });
  const key = (await app.getByTestId('recovery-key').textContent()).trim();
  await app.getByTestId('recovery-ack').check();
  await shot('02-recovery-key');
  await app.getByTestId('recovery-continue').click();
  await app.getByTestId('sidebar').waitFor({ timeout: 60000 });
  await app.getByTestId('import-input').setInputFiles([{ name: lang === 'tr' ? 'Proje planı.md' : 'Project plan.md', mimeType: 'text/markdown', buffer: Buffer.from(RICH) }]);
  await app.getByTestId('new-folder').click();
  await app.getByTestId('prompt-input').fill(lang === 'tr' ? 'Toplantılar' : 'Meetings');
  await app.getByTestId('prompt-ok').click();
  await app.getByTestId('new-page').click();
  await app.locator('doc-title [contenteditable="true"]').first().click();
  await page.keyboard.type(lang === 'tr' ? 'Pazartesi toplantısı' : 'Monday meeting');
  await page.keyboard.press('Enter');
  await page.keyboard.type(lang === 'tr' ? 'Gündem: şifreli notlar, çalışma alanı ağacı.' : 'Agenda: encrypted notes, the page tree.');
  await app.locator('.node-page').filter({ hasText: /Proje planı|Project plan/ }).click();
  await page.waitForTimeout(2500);
  await shot('03-workspace');
  await app.locator('.node-page').filter({ hasText: /Proje planı|Project plan/ }).click({ button: 'right' });
  await page.waitForTimeout(300);
  await shot('04-page-menu');
  await page.keyboard.press('Escape');
  await app.getByTestId('more').click();
  await app.getByTestId('menu-export-md').click();
  await app.getByTestId('export-dialog').waitFor();
  await page.waitForTimeout(300);
  await shot('05-export');
  await page.keyboard.press('Escape');
  await app.getByTestId('more').click();
  await app.getByTestId('menu-change-password').click();
  await app.getByTestId('change-password-dialog').waitFor();
  await shot('06-change-password');
  await page.keyboard.press('Escape');
  await app.getByTestId('save').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.fxhost.api.reopen());
  await app.getByTestId('unlock-screen').waitFor();
  await app.getByTestId('unlock-password').fill('yanlış parola');
  await app.getByTestId('unlock-submit').click();
  await app.getByRole('alert').waitFor();
  await shot('07-unlock-wrong');
  await app.getByTestId('use-recovery-key').click();
  await app.getByTestId('unlock-recovery-key').fill(key);
  await shot('08-recovery-unlock');
  await app.getByTestId('unlock-key-submit').click();
  await app.getByTestId('reset-screen').waitFor({ timeout: 60000 });
  await shot('09-reset');
  await page.close();
}

try {
  await run('tr', 'light');
  await run('tr', 'dark');
  await run('en', 'light');
} finally {
  await browser.close();
  srv.kill();
}
console.log('shots in', out);
