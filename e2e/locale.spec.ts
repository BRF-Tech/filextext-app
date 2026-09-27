// Turkish interface with the right characters, a live language switch, and
// the dark theme.
import { expect, test } from '@playwright/test';

import { createWorkspace, openHost } from './helpers';

test('Türkçe arayüz, canlı dil değişimi ve koyu tema', async ({ page }) => {
  const app = await openHost(page, 'lang=tr&theme=dark');
  await expect(app.getByTestId('create-screen')).toContainText('Şifreli çalışma alanı oluştur');
  await expect(app.getByTestId('create-screen')).toContainText('Uçtan uca şifreli');
  await app.getByTestId('new-password').fill('kısa');
  await app.getByTestId('new-password-2').fill('kısa');
  await app.getByTestId('create-submit').click();
  await expect(app.getByRole('alert')).toHaveText('En az 8 karakter.');

  await page.reload();
  const app2 = await openHost(page, 'lang=tr&theme=dark');
  await createWorkspace(app2, 'çok gizli parola');
  await expect(app2.getByTestId('sidebar')).toContainText('Sayfalar');
  await expect(app2.getByTestId('tree')).toContainText('Başlıksız');
  await expect(app2.getByTestId('save')).toHaveText('Kaydet');
  const frame = page.frames().find((f) => f.url().includes('/_appui/filextext/'))!;
  expect(await frame.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect(await frame.evaluate(() => document.documentElement.lang)).toBe('tr');

  // filex switches the language: the chrome follows without a reload.
  await page.evaluate(() => window.fxhost.api.setLocale('en'));
  await expect(app2.getByTestId('sidebar')).toContainText('Pages');
  await expect(app2.getByTestId('tree')).toContainText('Untitled');
  await page.evaluate(() => window.fxhost.api.setTheme('light'));
  await expect.poll(() => frame.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
});
