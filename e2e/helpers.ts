import { expect, type FrameLocator, type Page } from '@playwright/test';

declare global {
  interface Window {
    fxhost: {
      bytes: Uint8Array | null;
      versions: Uint8Array[];
      dirty: boolean;
      title: string;
      toasts: { text: string; tone?: string }[];
      clipboard: string | null;
      downloads: { name: string; mime: string; text: string }[];
      rejected: string[];
      api: {
        newFile(): void;
        reopen(): void;
        requestSave(): Promise<void>;
        setTheme(t: string): void;
        setLocale(l: string): void;
        setBytes(u8: Uint8Array | number[] | null): void;
        fileChanged(): void;
      };
    };
  }
}

export async function openHost(page: Page, query = ''): Promise<FrameLocator> {
  await page.goto(`/?${query}`);
  return page.frameLocator('iframe[title="app"]');
}

export async function createWorkspace(app: FrameLocator, password: string): Promise<string> {
  await expect(app.getByTestId('create-screen')).toBeVisible();
  await app.getByTestId('new-password').fill(password);
  await app.getByTestId('new-password-2').fill(password);
  await app.getByTestId('create-submit').click();
  await expect(app.getByTestId('recovery-screen')).toBeVisible({ timeout: 60_000 });
  const key = ((await app.getByTestId('recovery-key').textContent()) ?? '').trim();
  expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  await expect(app.getByTestId('recovery-continue')).toBeDisabled();
  await app.getByTestId('recovery-ack').check();
  await app.getByTestId('recovery-continue').click();
  await expect(app.getByTestId('sidebar')).toBeVisible({ timeout: 60_000 });
  return key;
}

export async function hostBytes(page: Page): Promise<Buffer> {
  const arr = await page.evaluate(() => (window.fxhost.bytes ? Array.from(window.fxhost.bytes) : []));
  return Buffer.from(arr);
}

export async function versions(page: Page): Promise<number> {
  return page.evaluate(() => window.fxhost.versions.length);
}

export async function reopen(page: Page) {
  await page.evaluate(() => window.fxhost.api.reopen());
}

export async function unlockWithPassword(app: FrameLocator, password: string) {
  await expect(app.getByTestId('unlock-screen')).toBeVisible();
  await app.getByTestId('unlock-password').fill(password);
  await app.getByTestId('unlock-submit').click();
}

/** Type a title and a first paragraph into the open page, with the keyboard. */
export async function writePage(page: Page, app: FrameLocator, title: string, body: string) {
  const t = app.locator('doc-title [contenteditable="true"]').first();
  await expect(t).toBeVisible();
  await t.click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.keyboard.type(body);
  await expect(app.locator('affine-paragraph').filter({ hasText: body }).first()).toBeVisible();
}

export async function saveInApp(page: Page, app: FrameLocator) {
  const before = await versions(page);
  await app.getByTestId('save').click();
  await expect.poll(() => versions(page), { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(app.getByTestId('save-status')).toHaveAttribute('data-state', 'clean');
}

export function includesText(bytes: Buffer, text: string): boolean {
  return bytes.includes(Buffer.from(text, 'utf8'));
}
