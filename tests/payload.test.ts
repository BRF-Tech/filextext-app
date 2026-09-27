// The payload: what is encrypted inside a .fxtxt. A zip with a manifest, the
// Yjs state of the workspace and of every page (authoritative), a Markdown
// copy of every page (for tools that cannot read Yjs) and the images.
import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { PAYLOAD_FORMAT, decodePayload, encodePayload, mirrorPaths, type WorkspaceData } from '../src/model/payload';

const u8 = (s: string) => new TextEncoder().encode(s);

function sample(): WorkspaceData {
  return {
    editor: 'blocksuite/0.27.0',
    root: u8('ROOT-YJS'),
    docs: new Map([
      ['p1', u8('DOC-1')],
      ['p2', u8('DOC-2')],
      ['p3', u8('DOC-3')],
    ]),
    blobs: new Map([['sha-abc', { type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }]]),
    pages: [
      { id: 'p1', title: 'Giriş' },
      { id: 'p2', title: 'Toplantı: 27/09' },
      { id: 'p3', title: 'Giriş' },
    ],
    folders: [
      { id: 'f1', parentId: null, type: 'folder', data: 'Proje Ö', index: 'a0' },
      { id: 'r2', parentId: 'f1', type: 'doc', data: 'p2', index: 'a1' },
    ],
    markdown: new Map([
      ['p1', '# Giriş\n\nMerhaba.\n'],
      ['p2', '# Toplantı\n'],
    ]),
  };
}

describe('payload', () => {
  it('round-trips the workspace', () => {
    const d = sample();
    const back = decodePayload(encodePayload(d));
    expect(back.root).toEqual(d.root);
    expect([...back.docs.keys()].sort()).toEqual(['p1', 'p2', 'p3']);
    expect(back.docs.get('p2')).toEqual(d.docs.get('p2'));
    expect(back.blobs.get('sha-abc')).toEqual(d.blobs.get('sha-abc'));
    expect(back.folders).toEqual(d.folders);
    expect(back.pages).toEqual(d.pages);
    expect(back.manifest.format).toBe(PAYLOAD_FORMAT);
    expect(back.manifest.editor).toBe('blocksuite/0.27.0');
  });

  it('is an ordinary zip, with readable Markdown files laid out like the tree', () => {
    const files = unzipSync(encodePayload(sample()));
    const names = Object.keys(files).sort();
    expect(names).toContain('fxtxt.json');
    expect(names).toContain('ydoc/root.bin');
    expect(names).toContain('pages/Giriş.md');
    expect(names).toContain('pages/Proje Ö/Toplantı_ 27_09.md');
    expect(new TextDecoder().decode(files['pages/Giriş.md'])).toContain('Merhaba.');
  });

  it('keeps Markdown paths unique and safe', () => {
    const paths = mirrorPaths(
      [
        { id: 'a', title: 'Aynı' },
        { id: 'b', title: 'Aynı' },
        { id: 'c', title: '../../etc/passwd' },
        { id: 'd', title: '' },
        { id: 'e', title: 'CON' },
      ],
      [],
    );
    const all = [...paths.values()];
    expect(new Set(all).size).toBe(all.length);
    for (const p of all) {
      expect(p.startsWith('pages/')).toBe(true);
      expect(p.split('/').includes('..')).toBe(false);
    }
    expect(paths.get('a')).toBe('pages/Aynı.md');
    expect(paths.get('b')).toBe('pages/Aynı (2).md');
  });

  it('refuses what is not a payload, a newer one, and one missing a page', () => {
    expect(() => decodePayload(u8('not a zip'))).toThrowError(expect.objectContaining({ code: 'damaged' }));
    const noManifest = zipSync({ 'x.txt': u8('x') });
    expect(() => decodePayload(noManifest)).toThrowError(expect.objectContaining({ code: 'damaged' }));
    const files = unzipSync(encodePayload(sample()));
    const m = JSON.parse(new TextDecoder().decode(files['fxtxt.json']));
    const newer = zipSync({ ...files, 'fxtxt.json': u8(JSON.stringify({ ...m, v: 99 })) });
    expect(() => decodePayload(newer)).toThrowError(expect.objectContaining({ code: 'unsupported' }));
    const missing = { ...files };
    delete missing[m.pages[0].ydoc];
    expect(() => decodePayload(zipSync(missing))).toThrowError(expect.objectContaining({ code: 'damaged' }));
  });

  it('refuses a payload that would unpack to something enormous', () => {
    const bomb = zipSync({ 'fxtxt.json': u8('{}'), 'big.bin': new Uint8Array(40 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => decodePayload(bomb, { maxEntryBytes: 16 * 1024 * 1024 })).toThrowError(expect.objectContaining({ code: 'too_large' }));
    const many = zipSync(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, u8('x')])));
    expect(() => decodePayload(many, { maxEntries: 20 })).toThrowError(expect.objectContaining({ code: 'too_large' }));
  });
});
