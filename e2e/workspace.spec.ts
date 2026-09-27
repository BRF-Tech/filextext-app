// The whole life of a workspace in a real browser, against the fake host:
// create → password + recovery key → write → save → close → open with the
// recovery key → mandatory new password → the old password is refused.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';

import {
  createWorkspace,
  hostBytes,
  includesText,
  openHost,
  reopen,
  saveInApp,
  unlockWithPassword,
  versions,
  writePage,
} from './helpers';

const P1 = 'ilk parola 2026!';
const P2 = 'yeni parola ÇĞİÖŞÜ';
const SECRET = 'Gizli içerik: ŞİFRE-4711';
const TITLE = 'Toplantı notları';

/** Decrypt with the independent Python implementation; returns the payload files. */
function decryptWithReference(bytes: Buffer, secret: string, recovery = false): Record<string, Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'fxtxt-'));
  const file = join(dir, 'w.fxtxt');
  const out = join(dir, 'w.zip');
  writeFileSync(file, bytes);
  execFileSync('python', ['tools/fxtxt_ref.py', 'decrypt', file, '-o', out, '--stdin', ...(recovery ? ['--recovery-key'] : [])], {
    input: `${secret}\n`,
  });
  return unzipSync(new Uint8Array(readFileSync(out)));
}

test('create, write, save, reopen with the recovery key, reset the password', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const app = await openHost(page);
  const key = await createWorkspace(app, P1);

  // Creating writes the file at once: already encrypted, before any typing.
  expect(await versions(page)).toBe(1);
  expect((await hostBytes(page)).subarray(0, 8).toString()).toBe('filextxt');

  await writePage(page, app, TITLE, SECRET);
  await expect(app.getByTestId('save-status')).toHaveAttribute('data-state', 'dirty');
  await expect.poll(() => page.evaluate(() => window.fxhost.dirty)).toBe(true);
  await expect(app.getByTestId('tree')).toContainText(TITLE);
  await expect(app.getByTestId('tabs')).toContainText(TITLE);
  await saveInApp(page, app);
  expect(await page.evaluate(() => window.fxhost.dirty)).toBe(false);

  // What filex stores is ciphertext: none of the text, not even the title.
  const saved = await hostBytes(page);
  expect(saved.subarray(0, 8).toString()).toBe('filextxt');
  for (const s of [SECRET, 'ŞİFRE-4711', TITLE, 'Toplant', P1, key]) expect(includesText(saved, s)).toBe(false);

  // An independent implementation opens it with the password…
  const files = decryptWithReference(saved, P1);
  const md = Object.entries(files).find(([n]) => n.startsWith('pages/') && n.endsWith('.md'));
  expect(md?.[0]).toBe(`pages/${TITLE}.md`);
  expect(new TextDecoder().decode(md![1])).toContain(SECRET);
  // …and with the recovery key.
  expect(Object.keys(decryptWithReference(saved, key, true))).toContain('fxtxt.json');

  // Close and open again: locked.
  await reopen(page);
  await unlockWithPassword(app, 'not the password');
  await expect(app.getByRole('alert')).toContainText('Wrong password');

  // Lost the password: the recovery key opens it and a new password is required.
  await app.getByTestId('use-recovery-key').click();
  await app.getByTestId('unlock-recovery-key').fill(key.toLowerCase().replace(/-/g, ' '));
  await app.getByTestId('unlock-key-submit').click();
  await expect(app.getByTestId('reset-screen')).toBeVisible({ timeout: 60_000 });
  const before = await versions(page);
  await app.getByTestId('new-password').fill(P2);
  await app.getByTestId('new-password-2').fill(P2 + 'x');
  await app.getByTestId('reset-submit').click();
  await expect(app.getByRole('alert')).toContainText('do not match');
  const beforeReset = await hostBytes(page);
  await app.getByTestId('new-password-2').fill(P2);
  await app.getByTestId('reset-submit').click();
  // A new password is a new key: a NEW recovery key, shown once, and the
  // file is already saved under it before it is shown.
  await expect(app.getByTestId('recovery-screen')).toBeVisible({ timeout: 60_000 });
  await expect(app.getByTestId('recovery-screen')).toContainText('Your new recovery key');
  const key2 = ((await app.getByTestId('recovery-key').textContent()) ?? '').trim();
  expect(key2).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(key2).not.toBe(key);
  await expect.poll(() => versions(page)).toBe(before + 1);
  await app.getByTestId('recovery-ack').check();
  await app.getByTestId('recovery-continue').click();
  await expect(app.getByTestId('sidebar')).toBeVisible({ timeout: 60_000 });
  await expect(app.locator('affine-paragraph').filter({ hasText: SECRET }).first()).toBeVisible();
  await expect(app.getByTestId('tree')).toContainText(TITLE);

  // The old password no longer opens it; the new one does.
  await reopen(page);
  await unlockWithPassword(app, P1);
  await expect(app.getByRole('alert')).toContainText('Wrong password');
  await app.getByTestId('unlock-password').fill(P2);
  await app.getByTestId('unlock-submit').click();
  await expect(app.locator('affine-paragraph').filter({ hasText: SECRET }).first()).toBeVisible({ timeout: 60_000 });
  const reset = await hostBytes(page);
  expect(() => decryptWithReference(reset, P1)).toThrow();
  expect(Object.keys(decryptWithReference(reset, P2))).toContain('fxtxt.json');
  // The OLD recovery key no longer opens what was saved after the reset; the new one does.
  expect(() => decryptWithReference(reset, key, true)).toThrow();
  expect(Object.keys(decryptWithReference(reset, key2, true))).toContain('fxtxt.json');
  // The copy saved before the reset still opens with what it was saved with.
  expect(Object.keys(decryptWithReference(beforeReset, key, true))).toContain('fxtxt.json');
  expect(dialogs).toEqual([]);
});

test('change the password from the menu: a new key, the old password and recovery key stop opening', async ({ page }) => {
  const app = await openHost(page);
  const key = await createWorkspace(app, P1);
  await writePage(page, app, 'Parola testi', 'içerik');
  await saveInApp(page, app);

  await app.getByTestId('more').click();
  await app.getByTestId('menu-change-password').click();
  const dlg = app.getByTestId('change-password-dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('current-password').fill('yanlış parola 1');
  await dlg.getByTestId('new-password').fill(P2);
  await dlg.getByTestId('new-password-2').fill(P2);
  await dlg.getByTestId('change-submit').click();
  await expect(dlg.getByRole('alert')).toContainText('Wrong password');
  await dlg.getByTestId('current-password').fill(P1);
  const before = await versions(page);
  await dlg.getByTestId('change-submit').click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => versions(page)).toBe(before + 1);

  // The new recovery key, once, in a dialog Escape does not close.
  const rk = app.getByTestId('recovery-dialog');
  await expect(rk).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rk).toBeVisible();
  const key2 = ((await rk.getByTestId('recovery-key').textContent()) ?? '').trim();
  expect(key2).not.toBe(key);
  await expect(rk.getByTestId('recovery-continue')).toBeDisabled();
  await rk.getByTestId('recovery-ack').check();
  await rk.getByTestId('recovery-continue').click();
  await expect(rk).toBeHidden();

  const bytes = await hostBytes(page);
  expect(() => decryptWithReference(bytes, P1)).toThrow();
  expect(() => decryptWithReference(bytes, key, true)).toThrow();
  expect(Object.keys(decryptWithReference(bytes, P2))).toContain('fxtxt.json');
  expect(Object.keys(decryptWithReference(bytes, key2, true))).toContain('fxtxt.json');

  // The old recovery key is refused as a proof; the new one is accepted.
  await app.getByTestId('more').click();
  await app.getByTestId('menu-change-password').click();
  await dlg.getByTestId('change-with-key').click();
  await dlg.getByTestId('change-recovery-key').fill(key);
  await dlg.getByTestId('new-password').fill('üçüncü parola');
  await dlg.getByTestId('new-password-2').fill('üçüncü parola');
  await dlg.getByTestId('change-submit').click();
  await expect(dlg.getByRole('alert')).toContainText('does not open');
  await dlg.getByTestId('change-recovery-key').fill(key2);
  await dlg.getByTestId('change-submit').click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const key3 = ((await rk.getByTestId('recovery-key').textContent()) ?? '').trim();
  await rk.getByTestId('recovery-ack').check();
  await rk.getByTestId('recovery-continue').click();
  const third = await hostBytes(page);
  expect(() => decryptWithReference(third, P2)).toThrow();
  expect(() => decryptWithReference(third, key2, true)).toThrow();
  expect(Object.keys(decryptWithReference(third, 'üçüncü parola'))).toContain('fxtxt.json');
  expect(Object.keys(decryptWithReference(third, key3, true))).toContain('fxtxt.json');

  // Lock: back to the password prompt, and the content comes back.
  await app.getByTestId('more').click();
  await app.getByTestId('menu-lock').click();
  await unlockWithPassword(app, 'üçüncü parola');
  await expect(app.locator('affine-paragraph').filter({ hasText: 'içerik' }).first()).toBeVisible({ timeout: 60_000 });
});

test('files that are not workspaces, and a read-only new file', async ({ page }) => {
  let app = await openHost(page);
  await page.evaluate(() => {
    window.fxhost.api.setBytes(Array.from(new TextEncoder().encode('just some plain text')));
    window.fxhost.api.reopen();
  });
  await expect(app.getByTestId('open-error')).toContainText('not a filextext workspace');

  await page.evaluate(() => {
    const b = new TextEncoder().encode('filextxt\u0001\u0000\u0000\u0000\u0010{}');
    window.fxhost.api.setBytes(Array.from(b));
    window.fxhost.api.reopen();
  });
  await expect(app.getByTestId('open-error')).toContainText('damaged');

  app = await openHost(page, 'readonly=1');
  await expect(app.getByTestId('read-only-new')).toBeVisible();
});
