// An open workspace: its keys, the BlockSuite workspace, and the two
// directions between them — payload → editor on open, editor → encrypted
// file on save.

import { encodeContainer, openBody, sealBody, type KeyBlock } from './crypto/fxtxt';
import { decodePayload, encodePayload } from './model/payload';
import type { EditorSnapshot, FxWorkspace } from '../vendor/blocksuite/fxtxt-editor.js';

export type EditorLib = typeof import('../vendor/blocksuite/fxtxt-editor.js');

let libPromise: Promise<EditorLib> | null = null;

/** The editor bundle (~1.2 MB gzip). Started early, awaited when needed. */
export function loadEditor(): Promise<EditorLib> {
  libPromise ??= import('../vendor/blocksuite/fxtxt-editor.js').then(async (m) => {
    await import('../vendor/blocksuite/fxtxt-editor.css');
    return m;
  });
  return libPromise;
}

export class WorkspaceSession {
  /** Markdown copies of pages, recomputed only for pages that changed. */
  private readonly md = new Map<string, string>();
  private readonly stale = new Set<string>();
  private readonly offs: (() => void)[] = [];

  private constructor(
    readonly lib: EditorLib,
    readonly ws: FxWorkspace,
    public block: KeyBlock,
    public fmk: CryptoKey,
  ) {
    this.offs.push(
      ws.onChange((docId) => {
        if (docId) this.stale.add(docId);
      }),
    );
  }

  /** A brand-new workspace with one empty page. */
  static async create(block: KeyBlock, fmk: CryptoKey, firstTitle: string): Promise<WorkspaceSession> {
    const lib = await loadEditor();
    const ws = lib.createWorkspace();
    ws.createDoc(firstTitle);
    return new WorkspaceSession(lib, ws, block, fmk);
  }

  /** Decrypt a body and load it. Throws FxtxtError / PayloadError. */
  static async open(block: KeyBlock, fmk: CryptoKey, body: Uint8Array): Promise<WorkspaceSession> {
    const [lib, payload] = await Promise.all([loadEditor(), openBody(fmk, body)]);
    const data = decodePayload(payload);
    const snap: EditorSnapshot = { root: data.root, docs: data.docs, blobs: data.blobs };
    const ws = lib.createWorkspace(snap);
    const s = new WorkspaceSession(lib, ws, block, fmk);
    // The Markdown copies in the file are current for every page it holds.
    return s;
  }

  /** The whole workspace as a .fxtxt: fresh DEK and nonces every time. */
  async toFile(): Promise<Uint8Array> {
    const snap = await this.ws.snapshot();
    const pages = this.ws.docs().map((d) => ({ id: d.id, title: d.title }));
    for (const p of pages) {
      if (!this.md.has(p.id) || this.stale.has(p.id)) {
        try {
          this.md.set(p.id, await this.ws.exportMarkdown(p.id));
        } catch {
          this.md.delete(p.id);
        }
        this.stale.delete(p.id);
      }
    }
    for (const id of [...this.md.keys()]) if (!pages.some((p) => p.id === id)) this.md.delete(id);
    const payload = encodePayload({
      editor: this.lib.EDITOR_VERSION,
      root: snap.root,
      docs: snap.docs,
      blobs: snap.blobs,
      pages,
      folders: this.ws.folders(),
      markdown: this.md,
    });
    return encodeContainer(this.block, await sealBody(this.fmk, payload));
  }

  dispose() {
    for (const off of this.offs) off();
    this.ws.destroy();
  }
}
