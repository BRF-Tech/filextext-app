// Markdown and plain text in and out, and Markdown that tries to run code.
import { expect, test, type Frame, type Page } from '@playwright/test';

import { createWorkspace, openHost } from './helpers';

const PW = 'içe aktarma parolası';

function appFrame(page: Page): Frame {
  const f = page.frames().find((x) => x.url().includes('/_appui/filextext/'));
  if (!f) throw new Error('no app frame');
  return f;
}

const GOOD = `# Haftalık plan

- birinci madde
- ikinci madde

\`\`\`js
const x = 1;
\`\`\`

| a | b |
|---|---|
| 1 | 2 |
`;

// Every classic way markdown smuggles script in. None may run, and none may
// leave an event handler, a script, a frame or a javascript: link behind.
const EVIL = `# Kötü niyetli

<img src=x onerror="document.documentElement.dataset.xss='img'">

<script>document.documentElement.dataset.xss='script'</script>

<svg onload="document.documentElement.dataset.xss='svg'"></svg>

<iframe src="javascript:parent.document.documentElement.dataset.xss='iframe'"></iframe>

[tıkla](javascript:document.documentElement.dataset.xss='link')

<a href="javascript:document.documentElement.dataset.xss='a'">ham bağlantı</a>

![resim](javascript:document.documentElement.dataset.xss='imgsrc')

<details open ontoggle="document.documentElement.dataset.xss='details'">x</details>

son satır
`;

test('import .md and .txt, export Markdown, and XSS in Markdown stays inert', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const app = await openHost(page, 'lang=en');
  await createWorkspace(app, PW);

  await app.getByTestId('import-input').setInputFiles([
    { name: 'Plan.md', mimeType: 'text/markdown', buffer: Buffer.from(GOOD) },
    { name: 'Düz.txt', mimeType: 'text/plain', buffer: Buffer.from('satır bir\n# bu bir başlık değil\nsatır üç') },
    { name: 'Kötü.md', mimeType: 'text/markdown', buffer: Buffer.from(EVIL) },
    { name: 'resim.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) },
  ]);
  await expect(app.locator('.node-page[data-name="Haftalık plan"]')).toBeVisible();
  await expect(app.locator('.node-page[data-name="Düz"]')).toBeVisible();
  await expect(app.locator('.node-page[data-name="Kötü niyetli"]')).toBeVisible();

  // Markdown became real blocks.
  await app.locator('.node-page[data-name="Haftalık plan"]').click();
  await expect(app.locator('affine-list')).toHaveCount(2);
  await expect(app.locator('affine-code')).toHaveCount(1);
  await expect(app.locator('affine-table')).toHaveCount(1);

  // Plain text stays text: a '#' line is not a heading.
  await app.locator('.node-page[data-name="Düz"]').click();
  await expect(app.locator('affine-paragraph').filter({ hasText: '# bu bir başlık değil' })).toHaveCount(1);

  // The hostile page: open it, click every link in it, and look.
  await app.locator('.node-page[data-name="Kötü niyetli"]').click();
  await expect(app.locator('affine-paragraph').filter({ hasText: 'son satır' })).toBeVisible();
  const links = app.locator('.editor-host a');
  for (let i = 0; i < (await links.count()); i++) await links.nth(i).click({ modifiers: [], force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  const frame = appFrame(page);
  const found = await frame.evaluate(() => {
    const host = document.querySelector('.editor-host')!;
    const handlers: string[] = [];
    for (const el of host.querySelectorAll('*')) {
      for (const a of el.getAttributeNames()) if (a.toLowerCase().startsWith('on')) handlers.push(`${el.tagName}[${a}]`);
    }
    return {
      xss: document.documentElement.dataset.xss ?? null,
      scripts: host.querySelectorAll('script').length,
      frames: host.querySelectorAll('iframe, frame, object, embed').length,
      jsLinks: [...host.querySelectorAll('a')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') ?? '')).length,
      jsImgs: [...host.querySelectorAll('img')].filter((i) => /^\s*javascript:/i.test(i.getAttribute('src') ?? '')).length,
      handlers,
    };
  });
  expect(found).toEqual({ xss: null, scripts: 0, frames: 0, jsLinks: 0, jsImgs: 0, handlers: [] });
  expect(dialogs).toEqual([]);

  // Export: the page as Markdown, through the dialog.
  await app.locator('.node-page[data-name="Haftalık plan"]').click();
  await app.getByTestId('more').click();
  await app.getByTestId('menu-export-md').click();
  const text = app.getByTestId('export-text');
  await expect(text).toHaveValue(/# Haftalık plan/);
  await expect(text).toHaveValue(/^\* birinci madde$/m);
  await expect(text).toHaveValue(/```javascript\nconst x = 1;\n```/);
  await expect(text).toHaveValue(/\| 1 \| 2 \|/);
  await app.getByTestId('export-copy').click();
  await expect.poll(() => page.evaluate(() => window.fxhost.toasts.map((t) => t.text))).toContain('Copied');

  // Download (filex ≥ 0.48.0, `ui:download`): the person's click hands the
  // plaintext to their disk through filex; nothing else ever does.
  expect(await page.evaluate(() => window.fxhost.downloads.length)).toBe(0);
  await app.getByTestId('more').click();
  await app.getByTestId('menu-export-txt').click();
  await app.getByTestId('export-download').click();
  await expect.poll(() => page.evaluate(() => window.fxhost.downloads.length)).toBe(1);
  const dl = await page.evaluate(() => window.fxhost.downloads[0]);
  expect(dl.name).toBe('Haftalık plan.txt');
  expect(dl.mime).toBe('text/plain');
  expect(dl.text).toContain('birinci madde');
  expect(dl.text).toContain('const x = 1;');
  await expect.poll(() => page.evaluate(() => window.fxhost.toasts.map((t) => t.text))).toContain('Downloaded');
});

test('without ui:download (an older filex) the export offers Copy only', async ({ page }) => {
  const app = await openHost(page, 'lang=en&nodl=1');
  await createWorkspace(app, PW);
  await app.getByTestId('more').click();
  await app.getByTestId('menu-export-md').click();
  await expect(app.getByTestId('export-copy')).toBeVisible();
  await expect(app.getByTestId('export-download')).toHaveCount(0);
});
