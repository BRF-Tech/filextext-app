// The workspace's folder tree, as pure functions.
//
// Pages come from BlockSuite's own page list (`meta.pages`). Folders are rows
// of the same shape AFFiNE's "Organize" folders use (`db$<ws>$folders`):
// `{id, parentId, type: 'folder' | 'doc', data, index}` — a folder's `data` is
// its name, a doc row's `data` is the page id. A page without a row sits at
// the top level. Every operation returns a Change; the caller applies it to
// the workspace (one Yjs transaction) and nothing here touches BlockSuite.

export interface FolderRow {
  id: string;
  parentId: string | null;
  type: 'folder' | 'doc';
  data: string;
  index: string;
}

export interface PageInfo {
  id: string;
  title: string;
  createDate?: number;
}

export type NodeRef = { kind: 'folder'; id: string } | { kind: 'page'; docId: string };

export interface TreeNode {
  /** Unique across the tree: `f:<row id>` or `p:<page id>`. */
  key: string;
  kind: 'folder' | 'page';
  /** Folder: its row id. Page: the page id. */
  id: string;
  name: string;
  depth: number;
  children: TreeNode[];
}

export interface Change {
  set: FolderRow[];
  remove: string[];
}

export const MAX_FOLDER_NAME = 200;

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A sort key strictly between `a` and `b` (null = open end), in the
 * alphabet 0-9a-z compared as plain strings. Never ends in '0', so there is
 * always room for another key between any two.
 */
export function indexBetween(a: string | null, b: string | null): string {
  const lo = a ?? '';
  let hi: string | null = b;
  let out = '';
  for (let i = 0; i < 64; i++) {
    const da = i < lo.length ? DIGITS.indexOf(lo[i]) : 0;
    const db = hi !== null && i < hi.length ? DIGITS.indexOf(hi[i]) : DIGITS.length;
    if (da === db) {
      out += DIGITS[da];
      continue;
    }
    const mid = Math.floor((da + db) / 2);
    if (mid > da) return out + DIGITS[mid];
    out += DIGITS[da];
    hi = null;
  }
  throw new Error('tree: no room between sort keys');
}

const byIndex = (x: FolderRow, y: FolderRow) =>
  x.index < y.index ? -1 : x.index > y.index ? 1 : x.data.localeCompare(y.data);

function cleanName(name: string): string {
  const n = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!n) throw new Error('tree: a folder needs a name');
  return n.slice(0, MAX_FOLDER_NAME);
}

function folderIds(rows: FolderRow[]): Set<string> {
  return new Set(rows.filter((r) => r.type === 'folder').map((r) => r.id));
}

/** The effective parent: null when the parent is missing or would loop. */
function parentsResolver(rows: FolderRow[]) {
  const folders = new Map(rows.filter((r) => r.type === 'folder').map((r) => [r.id, r]));
  const cache = new Map<string, string | null>();
  const effective = (r: FolderRow): string | null => {
    if (!r.parentId || !folders.has(r.parentId)) return null;
    if (r.type === 'folder') {
      if (cache.has(r.id)) return cache.get(r.id)!;
      // Walk up; a loop makes the folder a top-level one.
      const seen = new Set([r.id]);
      let p: string | null = r.parentId;
      while (p) {
        if (seen.has(p)) {
          cache.set(r.id, null);
          return null;
        }
        seen.add(p);
        const pr = folders.get(p);
        p = pr && pr.parentId && folders.has(pr.parentId) ? pr.parentId : null;
      }
      cache.set(r.id, r.parentId);
    }
    return r.parentId;
  };
  return effective;
}

/** The first row of each page (by sort key); later duplicates are ignored. */
function docRows(rows: FolderRow[], pages?: Set<string>): Map<string, FolderRow> {
  const out = new Map<string, FolderRow>();
  for (const r of rows.filter((x) => x.type === 'doc').sort(byIndex)) {
    if (pages && !pages.has(r.data)) continue;
    if (!out.has(r.data)) out.set(r.data, r);
  }
  return out;
}

export function buildTree(rows: FolderRow[], pages: PageInfo[]): TreeNode[] {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const parentOf = parentsResolver(rows);
  const filed = docRows(rows, new Set(pageById.keys()));
  const folderRows = rows.filter((r) => r.type === 'folder').sort(byIndex);

  const children = new Map<string | null, { folders: FolderRow[]; pages: FolderRow[] }>();
  const slot = (k: string | null) => {
    let s = children.get(k);
    if (!s) children.set(k, (s = { folders: [], pages: [] }));
    return s;
  };
  for (const f of folderRows) slot(parentOf(f)).folders.push(f);
  for (const r of [...filed.values()].sort(byIndex)) slot(parentOf(r)).pages.push(r);

  const make = (parent: string | null, depth: number): TreeNode[] => {
    const s = children.get(parent);
    const out: TreeNode[] = [];
    for (const f of s?.folders ?? []) {
      out.push({ key: `f:${f.id}`, kind: 'folder', id: f.id, name: f.data, depth, children: make(f.id, depth + 1) });
    }
    for (const r of s?.pages ?? []) {
      const p = pageById.get(r.data)!;
      out.push({ key: `p:${p.id}`, kind: 'page', id: p.id, name: p.title, depth, children: [] });
    }
    return out;
  };
  const top = make(null, 0);
  const unfiled = pages
    .filter((p) => !filed.has(p.id))
    .map((p, i) => ({ p, i }))
    .sort((x, y) => (x.p.createDate ?? 0) - (y.p.createDate ?? 0) || x.i - y.i);
  for (const { p } of unfiled) top.push({ key: `p:${p.id}`, kind: 'page', id: p.id, name: p.title, depth: 0, children: [] });
  return top;
}

/** Folder names from the top down to the page's folder ([] at top level). */
export function pathOf(rows: FolderRow[], docId: string): string[] {
  const row = docRows(rows).get(docId);
  if (!row) return [];
  const parentOf = parentsResolver(rows);
  const folders = new Map(rows.filter((r) => r.type === 'folder').map((r) => [r.id, r]));
  const out: string[] = [];
  let p = parentOf(row);
  while (p) {
    const f = folders.get(p);
    if (!f) break;
    out.unshift(f.data);
    p = parentOf(f);
  }
  return out;
}

/** A sort key after the last row under `parentId`. */
function endIndex(rows: FolderRow[], parentId: string | null): string {
  const parentOf = parentsResolver(rows);
  const last = rows
    .filter((r) => parentOf(r) === parentId)
    .map((r) => r.index)
    .sort()
    .pop();
  return indexBetween(last ?? null, null);
}

function assertFolder(rows: FolderRow[], id: string | null) {
  if (id !== null && !folderIds(rows).has(id)) throw new Error('tree: no such folder');
}

export function addFolder(rows: FolderRow[], parentId: string | null, name: string, newId: () => string): Change {
  assertFolder(rows, parentId);
  return {
    set: [{ id: newId(), parentId, type: 'folder', data: cleanName(name), index: endIndex(rows, parentId) }],
    remove: [],
  };
}

/** File a page under a folder (null = top level), moving its row if it has one. */
export function placePage(rows: FolderRow[], docId: string, parentId: string | null, newId: () => string): Change {
  assertFolder(rows, parentId);
  const existing = rows.filter((r) => r.type === 'doc' && r.data === docId);
  const [keep, ...dupes] = existing.sort(byIndex);
  const index = endIndex(rows.filter((r) => r !== keep), parentId);
  const row: FolderRow = keep ? { ...keep, parentId, index } : { id: newId(), parentId, type: 'doc', data: docId, index };
  return { set: [row], remove: dupes.map((d) => d.id) };
}

export function renameFolder(rows: FolderRow[], id: string, name: string): Change {
  const f = rows.find((r) => r.id === id && r.type === 'folder');
  if (!f) throw new Error('tree: no such folder');
  return { set: [{ ...f, data: cleanName(name) }], remove: [] };
}

function descendants(rows: FolderRow[], folderId: string): FolderRow[] {
  const parentOf = parentsResolver(rows);
  const out: FolderRow[] = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const r of rows) {
      if (parentOf(r) === id) {
        out.push(r);
        if (r.type === 'folder') queue.push(r.id);
      }
    }
  }
  return out;
}

export function move(rows: FolderRow[], ref: NodeRef, parentId: string | null, newId: () => string): Change {
  if (ref.kind === 'page') return placePage(rows, ref.docId, parentId, newId);
  const f = rows.find((r) => r.id === ref.id && r.type === 'folder');
  if (!f) throw new Error('tree: no such folder');
  assertFolder(rows, parentId);
  if (parentId === f.id || descendants(rows, f.id).some((r) => r.id === parentId)) {
    throw new Error('tree: a folder cannot go inside itself');
  }
  return { set: [{ ...f, parentId, index: endIndex(rows.filter((r) => r.id !== f.id), parentId) }], remove: [] };
}

/** What to delete: the rows, and the pages that go with them. */
export function remove(rows: FolderRow[], ref: NodeRef): { change: Change; docIds: string[] } {
  if (ref.kind === 'page') {
    const ids = rows.filter((r) => r.type === 'doc' && r.data === ref.docId).map((r) => r.id);
    return { change: { set: [], remove: ids }, docIds: [ref.docId] };
  }
  const f = rows.find((r) => r.id === ref.id && r.type === 'folder');
  if (!f) throw new Error('tree: no such folder');
  const sub = descendants(rows, f.id);
  return {
    change: { set: [], remove: [f.id, ...sub.map((r) => r.id)] },
    docIds: [...new Set(sub.filter((r) => r.type === 'doc').map((r) => r.data))],
  };
}

/** A new row list with the change applied (the input is not modified). */
export function apply(rows: FolderRow[], change: Change): FolderRow[] {
  const gone = new Set(change.remove);
  const out = rows.filter((r) => !gone.has(r.id)).map((r) => ({ ...r }));
  for (const s of change.set) {
    const i = out.findIndex((r) => r.id === s.id);
    if (i >= 0) out[i] = { ...s };
    else out.push({ ...s });
  }
  return out;
}
