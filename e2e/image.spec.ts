// Images live inside the encrypted file: insert one, save, reopen, and it is
// still drawn — from bytes that came out of the decrypted payload.
import { expect, test } from '@playwright/test';

import { createWorkspace, hostBytes, openHost, reopen, saveInApp, unlockWithPassword, writePage } from './helpers';

// A 2×2 PNG, red.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

test('an image goes into the encrypted file and comes back', async ({ page }) => {
  const app = await openHost(page, 'lang=en');
  await createWorkspace(app, 'resimli parola');
  await writePage(page, app, 'Resimler', 'aşağıda bir resim var');

  // The slash menu's Image item opens a file picker from inside the sandbox.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/image');
  await expect(app.getByRole('button', { name: /^Image/ })).toBeVisible();
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await (await chooser).setFiles({ name: 'kırmızı.png', mimeType: 'image/png', buffer: PNG });

  const img = app.locator('affine-image img').first();
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(2);
  expect(await img.getAttribute('src')).toMatch(/^blob:/);

  await saveInApp(page, app);
  const saved = await hostBytes(page);
  // The PNG is inside the ciphertext, not next to it.
  expect(saved.includes(PNG.subarray(0, 16))).toBe(false);

  await reopen(page);
  await unlockWithPassword(app, 'resimli parola');
  const back = app.locator('affine-image img').first();
  await expect(back).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => back.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(2);
});
