// The folder tree: rows of the same shape AFFiNE's "Organize" folders use,
// pages from BlockSuite's own page list. Pure functions; the app applies the
// returned change to the workspace's Y.Map in one transaction.
import { describe, expect, it } from 'vitest';

import {
  type Change,
  type FolderRow,
  type PageInfo,
  addFolder,
  apply,
  buildTree,
  indexBetween,
  move,
  pathOf,
  placePage,
  remove,
  renameFolder,
} from '../src/model/tree';

let n = 0;
const id = () => `r${++n}`;

function start() {
  n = 0;
  const pages: PageInfo[] = [
    { id: 'p1', title: 'Giriş', createDate: 1 },
    { id: 'p2', title: 'Notlar', createDate: 2 },
    { id: 'p3', title: 'Çözümler', createDate: 3 },
  ];
  return { rows: [] as FolderRow[], pages };
}

const names = (nodes: ReturnType<typeof buildTree>): unknown =>
  nodes.map((x) => (x.children.length ? { [x.name]: names(x.children) } : x.name));

describe('indexBetween', () => {
  it('always sorts between its neighbours', () => {
    const a = indexBetween(null, null);
    const b = indexBetween(a, null);
    const c = indexBetween(a, b);
    const d = indexBetween(null, a);
    expect([b, c, a, d].sort()).toEqual([d, a, c, b]);
    let lo = a;
    let hi = b;
    for (let i = 0; i < 60; i++) {
      const mid = indexBetween(lo, hi);
      expect(mid > lo && mid < hi).toBe(true);
      if (i % 2) lo = mid;
      else hi = mid;
    }
  });
});

describe('add', () => {
  it('pages without a row sit at the top level, in creation order', () => {
    const { rows, pages } = start();
    expect(names(buildTree(rows, pages))).toEqual(['Giriş', 'Notlar', 'Çözümler']);
  });

  it('adds a folder, a folder inside it, and files a page into it', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'Proje', id));
    const proje = rows.find((r) => r.data === 'Proje')!;
    rows = apply(rows, addFolder(rows, proje.id, 'Toplantılar', id));
    rows = apply(rows, placePage(rows, 'p2', proje.id, id));
    expect(names(buildTree(rows, s.pages))).toEqual([{ Proje: ['Toplantılar', 'Notlar'] }, 'Giriş', 'Çözümler']);
    expect(pathOf(rows, 'p2')).toEqual(['Proje']);
  });

  it('refuses an empty folder name and trims the rest', () => {
    const s = start();
    expect(() => addFolder(s.rows, null, '   ', id)).toThrow();
    const rows = apply(s.rows, addFolder(s.rows, null, '  Arşiv  ', id));
    expect(rows[0].data).toBe('Arşiv');
  });
});

describe('rename', () => {
  it('renames a folder and keeps its place', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'Eski ad', id));
    const f = rows[0];
    rows = apply(rows, renameFolder(rows, f.id, 'Yeni ad'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: f.id, data: 'Yeni ad', index: f.index });
    expect(() => renameFolder(rows, f.id, '')).toThrow();
    expect(() => renameFolder(rows, 'nope', 'x')).toThrow();
  });
});

describe('move', () => {
  it('moves a page into a folder and back to the top level', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'A', id));
    const a = rows[0];
    rows = apply(rows, move(rows, { kind: 'page', docId: 'p1' }, a.id, id));
    expect(pathOf(rows, 'p1')).toEqual(['A']);
    rows = apply(rows, move(rows, { kind: 'page', docId: 'p1' }, null, id));
    expect(pathOf(rows, 'p1')).toEqual([]);
    expect(names(buildTree(rows, s.pages))).toContain('Giriş');
  });

  it('moves a folder with everything in it', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'A', id));
    const a = rows.find((r) => r.data === 'A')!;
    rows = apply(rows, addFolder(rows, null, 'B', id));
    const b = rows.find((r) => r.data === 'B')!;
    rows = apply(rows, placePage(rows, 'p3', a.id, id));
    rows = apply(rows, move(rows, { kind: 'folder', id: a.id }, b.id, id));
    expect(pathOf(rows, 'p3')).toEqual(['B', 'A']);
  });

  it('refuses to move a folder into itself or into its own descendant', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'A', id));
    const a = rows[0];
    rows = apply(rows, addFolder(rows, a.id, 'A1', id));
    const a1 = rows.find((r) => r.data === 'A1')!;
    expect(() => move(rows, { kind: 'folder', id: a.id }, a.id, id)).toThrow();
    expect(() => move(rows, { kind: 'folder', id: a.id }, a1.id, id)).toThrow();
  });
});

describe('delete', () => {
  it('deleting a folder removes its whole subtree and names the pages to delete', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'A', id));
    const a = rows[0];
    rows = apply(rows, addFolder(rows, a.id, 'A1', id));
    const a1 = rows.find((r) => r.data === 'A1')!;
    rows = apply(rows, placePage(rows, 'p1', a.id, id));
    rows = apply(rows, placePage(rows, 'p2', a1.id, id));
    const out = remove(rows, { kind: 'folder', id: a.id });
    expect(out.docIds.sort()).toEqual(['p1', 'p2']);
    rows = apply(rows, out.change);
    expect(rows).toEqual([]);
  });

  it('deleting a page removes its row, if it has one', () => {
    const s = start();
    let rows = apply(s.rows, addFolder(s.rows, null, 'A', id));
    rows = apply(rows, placePage(rows, 'p1', rows[0].id, id));
    const out = remove(rows, { kind: 'page', docId: 'p1' });
    expect(out.docIds).toEqual(['p1']);
    expect(apply(rows, out.change).some((r) => r.type === 'doc')).toBe(false);
    expect(remove(rows, { kind: 'page', docId: 'p3' })).toEqual({ change: { set: [], remove: [] }, docIds: ['p3'] });
  });
});

describe('robustness', () => {
  it('shows a row whose parent is gone at the top level, and hides rows of deleted pages', () => {
    const s = start();
    const rows: FolderRow[] = [
      { id: 'x', parentId: 'missing', type: 'folder', data: 'Yetim', index: 'a0' },
      { id: 'y', parentId: null, type: 'doc', data: 'gone', index: 'a1' },
      { id: 'z', parentId: null, type: 'doc', data: 'p1', index: 'a2' },
      { id: 'z2', parentId: 'x', type: 'doc', data: 'p1', index: 'a3' },
    ];
    const tree = buildTree(rows, s.pages);
    expect(names(tree)).toEqual(['Yetim', 'Giriş', 'Notlar', 'Çözümler']);
  });

  it('apply is pure', () => {
    const rows: FolderRow[] = [{ id: 'a', parentId: null, type: 'folder', data: 'A', index: 'a0' }];
    const change: Change = { set: [{ ...rows[0], data: 'B' }], remove: [] };
    const next = apply(rows, change);
    expect(rows[0].data).toBe('A');
    expect(next[0].data).toBe('B');
  });
});
