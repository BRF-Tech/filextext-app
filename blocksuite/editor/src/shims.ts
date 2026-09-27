// Runs before any BlockSuite module.
//
// 1. `process`: a few BlockSuite dependencies read process.env / platform at
//    module evaluation; library builds do not replace those.
// 2. Web storage: the app runs in a sandboxed iframe with an opaque origin,
//    where reading `localStorage` / `sessionStorage` throws a SecurityError.
//    BlockSuite keeps small UI preferences there (last colour, recent code
//    language). They get an in-memory Storage instead: nothing is written to
//    disk, nothing outlives the page, and the workspace content never goes
//    through it (it lives in the Yjs documents only).

declare global {
  // eslint-disable-next-line no-var
  var process: any;
}

const g = globalThis as unknown as { process?: any };
if (typeof g.process === 'undefined') {
  g.process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    argv: [],
    release: { name: '' },
    stdout: { isTTY: false },
    version: '',
    versions: {},
    nextTick: (cb: (...a: unknown[]) => void, ...args: unknown[]) =>
      Promise.resolve().then(() => cb(...args)),
  };
} else if (!g.process.env) {
  g.process.env = { NODE_ENV: 'production' };
}

class MemoryStorage implements Storage {
  private readonly m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(String(k), String(v));
  }
}

/**
 * Which storages were replaced (reported by the app's diagnostics). Both are
 * replaced even where they would work (an unsandboxed dev page), so the editor
 * behaves the same everywhere and never persists anything in the browser.
 */
export const replacedStorage: string[] = [];

if (typeof window !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      Object.defineProperty(window, name, {
        value: new MemoryStorage(),
        configurable: true,
      });
      replacedStorage.push(name);
    } catch {
      /* left as is: BlockSuite guards most of its storage reads */
    }
  }
}

/**
 * File pickers: BlockSuite opens its image picker with `input.showPicker()`
 * when the browser has it. For a file input the long-standing `input.click()`
 * does the same thing everywhere; measured 2026-09-27 in Playwright's WebKit,
 * `showPicker()` on a file input opened nothing (no chooser, no error), in the
 * sandboxed frame and at top level alike, while `click()` did. Other input
 * types keep their own showPicker.
 */
if (typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype) {
  const original = HTMLInputElement.prototype.showPicker;
  HTMLInputElement.prototype.showPicker = function showPicker(this: HTMLInputElement) {
    if (this.type === 'file') {
      this.click();
      return;
    }
    return original.call(this);
  };
}

export {};
