// The payload: the plaintext that the .fxtxt body encrypts (docs/FORMAT.md →
// "Payload"). An ordinary zip, so a decrypted workspace can be opened with
// any unzip tool:
//
//   fxtxt.json          manifest: pages, folder rows, images, file names
//   ydoc/root.bin       Yjs update of the workspace root (page list + tree)
//   ydoc/<n>.bin        Yjs update of one page           ← authoritative
//   pages/<path>.md     Markdown copy of one page        ← for people/tools
//   blobs/<n>           one image, by the key its block references
//
// The Yjs state is what the app reads back. The Markdown copies are written
// on every save for everything that cannot read Yjs (`filex decrypt`, an
// unzip on a laptop) and are never read by the app.

import { unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';

import type { FolderRow, PageInfo } from './tree';
import { pathOf } from './tree';

export const PAYLOAD_FORMAT = 'fxtxt-payload';
export const PAYLOAD_VERSION = 1;

export interface PayloadManifest {
  format: typeof PAYLOAD_FORMAT;
  v: number;
  /** Which editor wrote the Yjs state, e.g. `blocksuite/0.27.0`. */
  editor: string;
  saved: string;
  root: string;
  pages: { id: string; title: string; ydoc: string; md?: string }[];
  folders: FolderRow[];
  blobs: { key: string; type: string; path: string }[];
}

export interface WorkspaceData {
  editor: string;
  root: Uint8Array;
  docs: Map<string, Uint8Array>;
  blobs: Map<string, { type: string; bytes: Uint8Array }>;
  pages: { id: string; title: string }[];
  folders: FolderRow[];
  /** Page id → Markdown copy (optional per page). */
  markdown?: Map<string, string>;
  savedAt?: Date;
}

export class PayloadError extends Error {
  constructor(
    readonly code: 'damaged' | 'unsupported' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'PayloadError';
  }
}

export interface PayloadLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: PayloadLimits = {
  maxEntries: 20_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** One path segment a file system on any OS will take. */
function safeSegment(s: string, fallback: string): string {
  let out = (s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, (m) => '_'.repeat(Math.min(m.length, 1)));
  if (!out || out === '_') out = fallback;
  if (RESERVED.test(out)) out += '_';
  return out.slice(0, 120);
}

/** Page id → `pages/<folder>/<title>.md`, unique (case-insensitively) and safe. */
export function mirrorPaths(pages: PageInfo[], folders: FolderRow[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const p of pages) {
    const dirs = pathOf(folders, p.id).map((d) => safeSegment(d, 'Folder'));
    const base = safeSegment(p.title, 'Untitled');
    let candidate = '';
    for (let n = 1; ; n++) {
      candidate = ['pages', ...dirs, `${base}${n > 1 ? ` (${n})` : ''}.md`].join('/');
      if (!used.has(candidate.toLowerCase())) break;
    }
    used.add(candidate.toLowerCase());
    out.set(p.id, candidate);
  }
  return out;
}

const enc = new TextEncoder();

export function encodePayload(d: WorkspaceData): Uint8Array {
  const saved = d.savedAt ?? new Date();
  const files: Zippable = {};
  const put = (name: string, bytes: Uint8Array, compress = true) => {
    files[name] = [bytes, { level: compress ? 6 : 0, mtime: saved }];
  };
  const md = mirrorPaths(d.pages, d.folders);
  const pages: PayloadManifest['pages'] = [];
  d.pages.forEach((p, i) => {
    const update = d.docs.get(p.id);
    if (!update) return;
    const ydoc = `ydoc/${i + 1}.bin`;
    put(ydoc, update);
    const text = d.markdown?.get(p.id);
    const entry: PayloadManifest['pages'][number] = { id: p.id, title: p.title, ydoc };
    if (text !== undefined) {
      entry.md = md.get(p.id)!;
      put(entry.md, enc.encode(text));
    }
    pages.push(entry);
  });
  const blobs: PayloadManifest['blobs'] = [];
  let bi = 0;
  for (const [key, b] of d.blobs) {
    const path = `blobs/${++bi}`;
    put(path, b.bytes, false);
    blobs.push({ key, type: b.type, path });
  }
  put('ydoc/root.bin', d.root);
  const manifest: PayloadManifest = {
    format: PAYLOAD_FORMAT,
    v: PAYLOAD_VERSION,
    editor: d.editor,
    saved: saved.toISOString(),
    root: 'ydoc/root.bin',
    pages,
    folders: d.folders.map((f) => ({ ...f })),
    blobs,
  };
  put('fxtxt.json', enc.encode(JSON.stringify(manifest, null, 1)));
  return zipSync(files);
}

function isRow(r: unknown): r is FolderRow {
  const x = r as FolderRow;
  return (
    !!x &&
    typeof x.id === 'string' &&
    (x.parentId === null || typeof x.parentId === 'string') &&
    (x.type === 'folder' || x.type === 'doc') &&
    typeof x.data === 'string' &&
    typeof x.index === 'string'
  );
}

export function decodePayload(
  bytes: Uint8Array,
  limits: Partial<PayloadLimits> = {},
): WorkspaceData & { manifest: PayloadManifest } {
  const L = { ...DEFAULT_LIMITS, ...limits };
  let files: Unzipped;
  let entries = 0;
  let total = 0;
  let tooLarge = false;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        entries++;
        total += f.originalSize;
        if (entries > L.maxEntries || f.originalSize > L.maxEntryBytes || total > L.maxTotalBytes) {
          tooLarge = true;
          throw new PayloadError('too_large', 'the workspace unpacks to more than this app accepts');
        }
        return true;
      },
    });
  } catch (e) {
    if (tooLarge || (e instanceof PayloadError && e.code === 'too_large')) {
      throw new PayloadError('too_large', 'the workspace unpacks to more than this app accepts');
    }
    throw new PayloadError('damaged', 'the decrypted workspace is not readable');
  }
  const raw = files['fxtxt.json'];
  if (!raw) throw new PayloadError('damaged', 'the workspace has no manifest');
  let m: PayloadManifest;
  try {
    m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw new PayloadError('damaged', 'the workspace manifest is not readable');
  }
  if (!m || m.format !== PAYLOAD_FORMAT) throw new PayloadError('damaged', 'the workspace manifest is not ours');
  if (typeof m.v !== 'number' || m.v > PAYLOAD_VERSION) {
    throw new PayloadError('unsupported', 'this workspace was written by a newer filextext');
  }
  const need = (name: unknown): Uint8Array => {
    if (typeof name !== 'string' || !files[name]) throw new PayloadError('damaged', `the workspace is missing ${String(name)}`);
    return files[name];
  };
  const root = need(m.root);
  if (!Array.isArray(m.pages) || !Array.isArray(m.folders) || !Array.isArray(m.blobs)) {
    throw new PayloadError('damaged', 'the workspace manifest is incomplete');
  }
  const docs = new Map<string, Uint8Array>();
  const pages: { id: string; title: string }[] = [];
  for (const p of m.pages) {
    if (!p || typeof p.id !== 'string' || typeof p.title !== 'string') throw new PayloadError('damaged', 'a page entry is broken');
    docs.set(p.id, need(p.ydoc));
    pages.push({ id: p.id, title: p.title });
  }
  const blobs = new Map<string, { type: string; bytes: Uint8Array }>();
  for (const b of m.blobs) {
    if (!b || typeof b.key !== 'string') throw new PayloadError('damaged', 'an image entry is broken');
    blobs.set(b.key, { type: typeof b.type === 'string' ? b.type : 'application/octet-stream', bytes: need(b.path) });
  }
  const folders = m.folders.filter(isRow).map((r) => ({ ...r }));
  return { manifest: m, editor: m.editor, root, docs, blobs, pages, folders, savedAt: new Date(m.saved) };
}
