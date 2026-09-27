// The page tree through the interface: folder, page in a folder, rename,
// move, delete — and the tree survives a save and a reopen.
import { expect, test, type FrameLocator, type Page } from '@playwright/test';

import { createWorkspace, openHost, reopen, saveInApp, unlockWithPassword } from './helpers';

const PW = 'ağaç testi parolası';

async function nodeMenu(app: FrameLocator, name: string) {
  const row = app.locator(`.node[data-name="${name}"]`);
  await row.hover();
  await row.getByTestId('node-more').click();
  return app.getByTestId('menu');
}

async function prompt(app: FrameLocator, value: string) {
  const input = app.getByTestId('prompt-input');
  await input.fill(value);
  await app.getByTestId('prompt-ok').click();
}

async function typeTitle(page: Page, app: FrameLocator, title: string) {
  const t = app.locator('doc-title [contenteditable="true"]').first();
  await t.click();
  await page.keyboard.type(title);
  await expect(app.locator(`.node[data-name="${title}"]`)).toBeVisible();
}

test('folders and pages: add, rename, move, delete, and they persist', async ({ page }) => {
  const app = await openHost(page, 'lang=en');
  await createWorkspace(app, PW);
  await typeTitle(page, app, 'Giriş');

  // A folder, then a page inside it (the new-page button files into the
  // selected folder).
  await app.getByTestId('new-folder').click();
  await prompt(app, 'Proje');
  const folder = app.locator('.node-folder[data-name="Proje"]');
  await expect(folder).toBeVisible();
  await app.getByTestId('new-page').click();
  await typeTitle(page, app, 'Alt sayfa');
  const child = app.locator('.node-page[data-name="Alt sayfa"]');
  await expect(child).toHaveAttribute('style', /--depth:1/);

  // Rename from the page's menu.
  await (await nodeMenu(app, 'Alt sayfa')).getByTestId('menu-rename').click();
  await prompt(app, 'Toplantılar');
  await expect(app.locator('.node-page[data-name="Toplantılar"]')).toBeVisible();
  await expect(app.getByTestId('tabs')).toContainText('Toplantılar');

  // A folder inside the folder, and a folder cannot move into itself.
  await (await nodeMenu(app, 'Proje')).getByTestId('menu-new-folder-here').click();
  await prompt(app, 'Arşiv');
  await expect(app.locator('.node-folder[data-name="Arşiv"]')).toHaveAttribute('style', /--depth:1/);
  await (await nodeMenu(app, 'Proje')).getByTestId('menu-move').click();
  const dlg = app.getByTestId('move-dialog');
  await expect(dlg.locator('.dest[data-name="Arşiv"] input')).toBeDisabled();
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // Move the page to the top level, then into Arşiv.
  await (await nodeMenu(app, 'Toplantılar')).getByTestId('menu-move').click();
  await dlg.locator('.dest[data-name="Top level"] input').check();
  await dlg.getByTestId('move-ok').click();
  await expect(app.locator('.node-page[data-name="Toplantılar"]')).toHaveAttribute('style', /--depth:0/);
  await (await nodeMenu(app, 'Toplantılar')).getByTestId('menu-move').click();
  await dlg.locator('.dest[data-name="Arşiv"] input').check();
  await dlg.getByTestId('move-ok').click();
  await expect(app.locator('.node-page[data-name="Toplantılar"]')).toHaveAttribute('style', /--depth:2/);

  // Save, close, open: the same tree.
  await saveInApp(page, app);
  await reopen(page);
  await unlockWithPassword(app, PW);
  await expect(app.getByTestId('sidebar')).toBeVisible({ timeout: 60_000 });
  await app.locator('.node-folder[data-name="Proje"]').click();
  await app.locator('.node-folder[data-name="Arşiv"]').click();
  await expect(app.locator('.node-page[data-name="Toplantılar"]')).toHaveAttribute('style', /--depth:2/);
  await expect(app.locator('.node-page[data-name="Giriş"]')).toHaveAttribute('style', /--depth:0/);

  // Delete the folder: it takes its page with it (after a question).
  await app.locator('.node-page[data-name="Toplantılar"]').click();
  await expect(app.getByTestId('tabs')).toContainText('Toplantılar');
  await (await nodeMenu(app, 'Proje')).getByTestId('menu-delete').click();
  await expect(app.getByTestId('confirm-dialog')).toContainText('1 pages');
  await app.getByTestId('confirm-ok').click();
  await expect(app.locator('.node[data-name="Proje"]')).toHaveCount(0);
  await expect(app.locator('.node[data-name="Toplantılar"]')).toHaveCount(0);
  await expect(app.getByTestId('tabs')).not.toContainText('Toplantılar');
  await expect(app.locator('.node-page[data-name="Giriş"]')).toBeVisible();

  // Delete a page.
  await (await nodeMenu(app, 'Giriş')).getByTestId('menu-delete').click();
  await app.getByTestId('confirm-ok').click();
  await expect(app.locator('.node')).toHaveCount(0);
});
