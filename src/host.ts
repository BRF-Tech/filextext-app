// The one place the app talks to filex: a thin adapter over the platform SDK
// (@brftech/filex-app-ui, bridge protocol v1 — filex docs/APP-PLUGINS-API.md
// → "An app's own interface").
//
// ⚠ What crosses this boundary is ENCRYPTED BYTES ONLY (read and save), plus
// the dirty flag, a title and short notices. The password, the recovery key,
// the keys and the plaintext never do. The single exception is an explicit
// "copy page as Markdown/text" the person asks for, and even that tries the
// frame's own clipboard first (see copyText).

import { FilexError, connect, type FilexApp } from '@brftech/filex-app-ui';

export interface HostInfo {
  locale: string;
  theme: 'light' | 'dark';
  fileName: string;
  fileSize: number;
  readOnly: boolean;
  userName: string;
  /** The app was granted `ui:download` (filex ≥ 0.48.0): it can hand files to the person's disk. */
  canDownload: boolean;
}

export interface Host {
  readonly info: HostInfo;
  /** The opened file's bytes (empty for a brand-new file). */
  read(): Promise<Uint8Array>;
  /** Save these (already encrypted) bytes over the opened file. */
  save(bytes: Uint8Array): Promise<void>;
  dirty(on: boolean): void;
  title(text: string): void;
  toast(text: string, tone?: 'info' | 'success' | 'warning' | 'error'): void;
  /** filex's Save button, a draft's "Save to disk", Ctrl+S in the frame. */
  onSaveRequest(handler: () => Promise<void>): void;
  on(event: 'theme' | 'locale' | 'file.changed' | 'close.request' | 'app.updated', cb: (data: unknown) => void): () => void;
  /** Clipboard through filex (Chrome refuses a sandboxed frame's own). */
  hostCopy(text: string): Promise<void>;
  /**
   * A file for the person's own disk, through filex (a sandboxed frame cannot
   * download). Only ever called from the person's click on "Download".
   */
  download(name: string, text: string, mime: string): Promise<void>;
}

export { FilexError };

export async function connectHost(): Promise<Host> {
  const fx: FilexApp = await connect({ applyTheme: true, saveShortcut: true });
  const s = fx.session;
  const file = s.files?.[0];
  const info: HostInfo = {
    locale: s.locale,
    theme: s.theme?.mode === 'dark' ? 'dark' : 'light',
    fileName: file?.name ?? 'workspace.fxtxt',
    fileSize: file?.size ?? 0,
    readOnly: !!file?.readOnly || !(s.grants ?? []).includes('files:write'),
    userName: s.user?.name ?? '',
    canDownload: (s.grants ?? []).includes('ui:download'),
  };
  return {
    info,
    async read() {
      if (!file) throw new FilexError({ code: 'not_found', message: 'no file' });
      const f = await fx.open(0);
      const buf = await f.bytes();
      return new Uint8Array(buf ?? new ArrayBuffer(0));
    },
    async save(bytes) {
      // A copy: the SDK transfers (detaches) the buffer it is given.
      await fx.save(bytes.slice(), { index: 0, mime: 'application/octet-stream' });
    },
    dirty: (on) => fx.dirty(on),
    title: (text) => fx.title(text),
    toast: (text, tone) => fx.toast(text, tone),
    onSaveRequest(handler) {
      // Returning nothing tells the SDK the handler saved by itself.
      fx.onSave(async () => {
        await handler();
      });
    },
    on: (event, cb) => fx.on(event, cb),
    hostCopy: (text) => fx.copy(text),
    async download(name, text, mime) {
      await fx.download(name, text, mime);
    },
  };
}
