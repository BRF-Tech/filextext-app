// Timings worth knowing (reported, loosely bounded): opening the app, unlocking
// a workspace of 40 pages, saving it.
import { expect, test } from '@playwright/test';

import { createWorkspace, hostBytes, openHost, reopen, saveInApp, unlockWithPassword, versions } from './helpers';

test('timings: first screen, unlock of 40 pages, save', async ({ page }, info) => {
  const t0 = Date.now();
  const app = await openHost(page, 'lang=en');
  await expect(app.getByTestId('create-screen')).toBeVisible();
  const firstScreen = Date.now() - t0;
  await createWorkspace(app, 'zamanlama parolası');

  const md = (i: number) => `# Sayfa ${i}\n\n${'Bir paragraf, biraz uzunca bir cümle ile. '.repeat(20)}\n\n- a\n- b\n- c\n`;
  await app.getByTestId('import-input').setInputFiles(
    Array.from({ length: 40 }, (_, i) => ({ name: `s${i}.md`, mimeType: 'text/markdown', buffer: Buffer.from(md(i)) })),
  );
  await expect(app.locator('.node-page')).toHaveCount(41, { timeout: 60_000 });

  const s0 = Date.now();
  await saveInApp(page, app);
  const save = Date.now() - s0;
  const size = (await hostBytes(page)).length;

  // A second save only re-renders the Markdown of pages that changed.
  const before = await versions(page);
  const s1 = Date.now();
  await page.evaluate(() => window.fxhost.api.requestSave());
  await expect.poll(() => versions(page)).toBe(before + 1);
  const resave = Date.now() - s1;

  await reopen(page);
  await expect(app.getByTestId('unlock-screen')).toBeVisible();
  const u0 = Date.now();
  await unlockWithPassword(app, 'zamanlama parolası');
  await expect(app.locator('.node-page')).toHaveCount(41, { timeout: 60_000 });
  await expect(app.locator('doc-title').first()).toBeVisible();
  const unlock = Date.now() - u0;

  const line = `firstScreen=${firstScreen}ms save(41 pages)=${save}ms resave=${resave}ms unlock+open=${unlock}ms file=${size}B`;
  info.annotations.push({ type: 'timings', description: line });
  console.log(`[${info.project.name}] ${line}`);
  expect(unlock).toBeLessThan(30_000);
});
