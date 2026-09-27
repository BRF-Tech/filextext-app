// fxtxt editor: a BlockSuite (AFFiNE) page editor over an in-memory workspace.
//
// This library is the only place BlockSuite is touched. The app around it
// (crypto, file format, folder tree logic, tabs, host bridge) talks to it
// through the small API at the bottom of this file:
//
//   createWorkspace(snapshot?)  -> FxWorkspace
//   ws.mount(el)                -> FxEditorView (one editor; .open(docId))
//   ws.snapshot()               -> Yjs updates (root + one per doc) + blobs
//
// Storage model. Everything lives in memory. The workspace root Y.Doc holds
// the page list (`meta.pages`, BlockSuite's own) and the folder tree
// (`fxtxt:folders`, the same row shape AFFiNE's "Organize" folders use); each
// page is its own Y.Doc. There is no IndexedDB, no localStorage (see
// shims.ts) and no network: images live in a MemoryBlobSource and travel in
// the snapshot, which the app encrypts before anything leaves the frame.

import './shims';
import '@toeverything/theme/style.css';

import { Container } from '@blocksuite/affine/global/di';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import {
  StoreExtensionManager,
  ViewExtensionManager,
} from '@blocksuite/affine/ext-loader';
import { AffineSchemas } from '@blocksuite/affine/schemas';
import {
  MarkdownAdapter,
  PlainTextAdapter,
  fileNameMiddleware,
  titleMiddleware,
} from '@blocksuite/affine/shared/adapters';
import { ThemeProvider } from '@blocksuite/affine/shared/services';
import {
  BlockComponent,
  BlockStdScope,
  BlockViewExtension,
  ShadowlessElement,
} from '@blocksuite/affine/std';
import {
  type ExtensionType,
  Schema,
  type Store,
  Text,
  Transformer,
} from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { MemoryBlobSource } from '@blocksuite/affine/sync';
import { RefNodeSlotsProvider } from '@blocksuite/affine/inlines/reference';
import { computed, signal } from '@preact/signals-core';
import { css, html, nothing } from 'lit';
import { keyed } from 'lit/directives/keyed.js';
import { literal } from 'lit/static-html.js';
import * as Y from 'yjs';

import { FoundationStoreExtension } from '@blocksuite/affine/foundation/store';
import { FoundationViewExtension } from '@blocksuite/affine/foundation/view';
import { CalloutStoreExtension } from '@blocksuite/affine/blocks/callout/store';
import { CalloutViewExtension } from '@blocksuite/affine/blocks/callout/view';
import { CodeStoreExtension } from '@blocksuite/affine/blocks/code/store';
import { CodeBlockViewExtension } from '@blocksuite/affine/blocks/code/view';
import { DividerStoreExtension } from '@blocksuite/affine/blocks/divider/store';
import { DividerViewExtension } from '@blocksuite/affine/blocks/divider/view';
import { ImageStoreExtension } from '@blocksuite/affine/blocks/image/store';
import { ImageViewExtension } from '@blocksuite/affine/blocks/image/view';
import { ListStoreExtension } from '@blocksuite/affine/blocks/list/store';
import { ListViewExtension } from '@blocksuite/affine/blocks/list/view';
import { NoteStoreExtension } from '@blocksuite/affine/blocks/note/store';
import { NoteViewExtension } from '@blocksuite/affine/blocks/note/view';
import { ParagraphStoreExtension } from '@blocksuite/affine/blocks/paragraph/store';
import { ParagraphViewExtension } from '@blocksuite/affine/blocks/paragraph/view';
import { RootStoreExtension } from '@blocksuite/affine/blocks/root/store';
import { RootViewExtension } from '@blocksuite/affine/blocks/root/view';
import { SurfaceStoreExtension } from '@blocksuite/affine/blocks/surface/store';
import { TableStoreExtension } from '@blocksuite/affine/blocks/table/store';
import { TableViewExtension } from '@blocksuite/affine/blocks/table/view';
import { LinkStoreExtension } from '@blocksuite/affine/inlines/link/store';
import { LinkViewExtension } from '@blocksuite/affine/inlines/link/view';
import { InlinePresetStoreExtension } from '@blocksuite/affine/inlines/preset/store';
import { InlineCommentViewExtension as CommentViewExtension } from '@blocksuite/affine-inline-comment/view';
import { FootnoteStoreExtension } from '@blocksuite/affine/inlines/footnote/store';
import { FootnoteViewExtension } from '@blocksuite/affine/inlines/footnote/view';
import { LatexStoreExtension as InlineLatexStoreExtension } from '@blocksuite/affine/inlines/latex/store';
import { LatexViewExtension as InlineLatexViewExtension } from '@blocksuite/affine/inlines/latex/view';
import { MentionViewExtension } from '@blocksuite/affine/inlines/mention/view';
import { LatexStoreExtension } from '@blocksuite/affine/blocks/latex/store';
import { LatexViewExtension } from '@blocksuite/affine/blocks/latex/view';
import { InlinePresetViewExtension } from '@blocksuite/affine/inlines/preset/view';
import { ReferenceStoreExtension } from '@blocksuite/affine/inlines/reference/store';
import { ReferenceViewExtension } from '@blocksuite/affine/inlines/reference/view';
import { DocTitleViewExtension } from '@blocksuite/affine/fragments/doc-title/view';
import { DragHandleViewExtension } from '@blocksuite/affine/widgets/drag-handle/view';
import { LinkedDocViewExtension } from '@blocksuite/affine/widgets/linked-doc/view';
import { PageDraggingAreaViewExtension } from '@blocksuite/affine/widgets/page-dragging-area/view';
import { ScrollAnchoringViewExtension } from '@blocksuite/affine/widgets/scroll-anchoring/view';
import { SlashMenuViewExtension } from '@blocksuite/affine/widgets/slash-menu/view';
import { ToolbarViewExtension } from '@blocksuite/affine/widgets/toolbar/view';
import { ViewportOverlayViewExtension } from '@blocksuite/affine/widgets/viewport-overlay/view';

export { replacedStorage } from './shims';

/** Bumped when this library's API or the bundled BlockSuite changes. */
export const EDITOR_VERSION = 'fxtxt-editor/1 blocksuite/0.27.0';

// ───────────────────────── extension sets (page only) ─────────────────────────
// A curated page-mode subset of AFFiNE's `getInternalViewExtensions()`: text
// blocks, lists, code, tables, images, callouts, LaTeX, links and links
// between pages. No edgeless/whiteboard, no database views, no embeds or bookmarks
// (those fetch link previews over the network, which the sandbox has not got).

const STORE_EXTENSIONS = [
  FoundationStoreExtension,
  CalloutStoreExtension,
  CodeStoreExtension,
  DividerStoreExtension,
  ImageStoreExtension,
  LatexStoreExtension,
  ListStoreExtension,
  NoteStoreExtension,
  ParagraphStoreExtension,
  TableStoreExtension,
  SurfaceStoreExtension,
  RootStoreExtension,
  LinkStoreExtension,
  ReferenceStoreExtension,
  InlineLatexStoreExtension,
  FootnoteStoreExtension,
  InlinePresetStoreExtension,
];

const VIEW_EXTENSIONS = [
  FoundationViewExtension,
  CalloutViewExtension,
  CodeBlockViewExtension,
  DividerViewExtension,
  ImageViewExtension,
  LatexViewExtension,
  ListViewExtension,
  NoteViewExtension,
  ParagraphViewExtension,
  TableViewExtension,
  RootViewExtension,
  LinkViewExtension,
  ReferenceViewExtension,
  // The default inline manager (paragraphs, lists, table cells) asks for every
  // one of these inline specs, used or not.
  InlineLatexViewExtension,
  FootnoteViewExtension,
  MentionViewExtension,
  CommentViewExtension,
  InlinePresetViewExtension,
  DragHandleViewExtension,
  LinkedDocViewExtension,
  ScrollAnchoringViewExtension,
  SlashMenuViewExtension,
  ToolbarViewExtension,
  ViewportOverlayViewExtension,
  PageDraggingAreaViewExtension,
  DocTitleViewExtension,
];

let managers: { view: ViewExtensionManager; store: StoreExtensionManager } | null = null;
function getManagers() {
  managers ??= {
    view: new ViewExtensionManager(VIEW_EXTENSIONS as never),
    store: new StoreExtensionManager(STORE_EXTENSIONS as never),
  };
  return managers;
}

let schema: Schema | null = null;
function getSchema() {
  if (!schema) {
    schema = new Schema();
    schema.register(AffineSchemas);
  }
  return schema;
}

// ───────────────────────────────── editor element ─────────────────────────────

/** The page editor: doc title + BlockSuite page view for one Store at a time. */
class FxtxtEditorElement extends SignalWatcher(WithDisposable(ShadowlessElement)) {
  static override styles = css`
    fxtxt-editor {
      display: block;
      height: 100%;
    }
    fxtxt-editor .affine-page-viewport {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow-x: hidden;
      overflow-y: auto;
      container-name: viewport;
      container-type: inline-size;
      font-family: var(--affine-font-family);
      background: var(--affine-background-primary-color);
    }
    fxtxt-editor .affine-page-viewport * {
      box-sizing: border-box;
    }
    fxtxt-editor .fxtxt-page {
      flex-grow: 1;
      display: block;
      font-family: var(--affine-font-family);
    }
  `;

  private readonly _doc = signal<Store | null>(null);
  private readonly _specs = signal<ExtensionType[]>([]);
  private readonly _std = computed(() => {
    const store = this._doc.value;
    if (!store) return null;
    return new BlockStdScope({ store, extensions: this._specs.value });
  });

  get doc(): Store | null {
    return this._doc.value;
  }
  set doc(store: Store | null) {
    this._doc.value = store;
  }
  set specs(specs: ExtensionType[]) {
    this._specs.value = specs;
  }
  get std() {
    return this._std.value;
  }

  override connectedCallback() {
    super.connectedCallback();
  }

  override render() {
    const store = this._doc.value;
    const std = this._std.value;
    // A doc whose page block has not materialised yet renders nothing; the
    // rootAdded subscription below re-renders the moment it appears.
    let root: { id: string } | null = null;
    try {
      root = (store?.root as { id: string } | null) ?? null;
    } catch {
      root = null;
    }
    if (!store || !std || !root) return html`${nothing}`;
    let theme = 'light';
    try {
      theme = std.get(ThemeProvider).app$.value;
    } catch {
      /* default */
    }
    return html`${keyed(
      root.id,
      html`<div data-theme=${theme} class="affine-page-viewport">
        <doc-title .doc=${store}></doc-title>
        <div class="page-editor fxtxt-page">${std.render()}</div>
      </div>`
    )}`;
  }
}

/**
 * Page mode never draws the whiteboard surface, but pages made by the
 * Markdown importer (and by AFFiNE) carry an `affine:surface` block. Without
 * a view for it BlockSuite warns on every open; this one draws nothing.
 */
class FxtxtSurfaceVoid extends BlockComponent {
  override renderBlock() {
    return html`${nothing}`;
  }
}

const SurfaceVoidView = BlockViewExtension('affine:surface', literal`fxtxt-surface-void`);

function ensureElements() {
  if (!customElements.get('fxtxt-editor')) {
    customElements.define('fxtxt-editor', FxtxtEditorElement);
  }
  if (!customElements.get('fxtxt-surface-void')) {
    customElements.define('fxtxt-surface-void', FxtxtSurfaceVoid);
  }
}

// ─────────────────────────────── workspace model ──────────────────────────────

export interface DocInfo {
  id: string;
  title: string;
  createDate: number;
  updatedDate?: number;
}

/**
 * A row of the folder tree, the same shape AFFiNE's "Organize" folders use
 * (`db$<workspace>$folders`): a folder carries its name in `data`, a doc row
 * carries the page id in `data`. `parentId` null = top level. `index` is a
 * string that sorts the rows of one parent.
 */
export interface FolderRow {
  id: string;
  parentId: string | null;
  type: 'folder' | 'doc';
  data: string;
  index: string;
}

export interface EditorSnapshot {
  /** Yjs update of the workspace root doc (page list + folder tree). */
  root: Uint8Array;
  /** Yjs update of each page, by page id. */
  docs: Map<string, Uint8Array>;
  /** Images, by the key the image blocks reference (their sha-256). */
  blobs: Map<string, { type: string; bytes: Uint8Array }>;
}

export interface FxEditorView {
  /** Show a page. Returns false when there is no such page. */
  open(docId: string): boolean;
  current(): string | null;
  focus(): void;
  destroy(): void;
}

export interface FxWorkspace {
  readonly id: string;
  docs(): DocInfo[];
  hasDoc(id: string): boolean;
  createDoc(title?: string, text?: string): string;
  renameDoc(id: string, title: string): void;
  removeDoc(id: string): void;
  folders(): FolderRow[];
  /** Apply folder-tree changes in one transaction. */
  updateFolders(change: { set?: FolderRow[]; remove?: string[] }): void;
  /**
   * Any change to the workspace content: the page id for a change inside a
   * page, null for the page list or the folder tree.
   */
  onChange(cb: (docId: string | null) => void): () => void;
  /** The page list or a title changed. */
  onDocsChanged(cb: () => void): () => void;
  /** A link to another page was clicked inside the editor. */
  onOpenDoc(cb: (docId: string) => void): () => void;
  snapshot(): Promise<EditorSnapshot>;
  exportMarkdown(id: string): Promise<string>;
  exportText(id: string): Promise<string>;
  importMarkdown(markdown: string, title?: string): Promise<string>;
  importText(text: string, title?: string): string;
  mount(el: HTMLElement): FxEditorView;
  setTheme(theme: 'light' | 'dark'): void;
  destroy(): void;
}

const WORKSPACE_ID = 'fxtxt';
const FOLDERS_KEY = 'fxtxt:folders';
const SEED = 'fxtxt-seed';
const BLOB_FLAVOURS = new Set(['affine:image', 'affine:attachment']);

type Blocks = Y.Map<Y.Map<unknown>>;

function blocksOf(doc: Y.Doc): Blocks {
  return doc.getMap('blocks') as Blocks;
}

function pageBlock(doc: Y.Doc): Y.Map<unknown> | null {
  for (const b of blocksOf(doc).values()) {
    if (b.get('sys:flavour') === 'affine:page') return b;
  }
  return null;
}

function titleOf(doc: Y.Doc): string {
  const t = pageBlock(doc)?.get('prop:title');
  return t instanceof Y.Text ? t.toString() : '';
}

function blobKeysOf(doc: Y.Doc): string[] {
  const keys: string[] = [];
  for (const b of blocksOf(doc).values()) {
    if (!BLOB_FLAVOURS.has(b.get('sys:flavour') as string)) continue;
    const key = b.get('prop:sourceId');
    if (typeof key === 'string' && key) keys.push(key);
  }
  return keys;
}

type TestDocLike = {
  id: string;
  spaceDoc: Y.Doc;
  loaded: boolean;
  ready: boolean;
  load(init?: () => void): unknown;
  getStore(opts?: { id?: string }): Store;
};

export function createWorkspace(snapshot?: EditorSnapshot): FxWorkspace {
  ensureElements();
  const { view, store: storeManager } = getManagers();
  const blobSource = new MemoryBlobSource();
  const collection = new TestWorkspace({
    id: WORKSPACE_ID,
    blobSources: { main: blobSource },
  });
  const storeExtensions = storeManager.get('store');
  collection.storeExtensions = storeExtensions;

  const changeCbs = new Set<(docId: string | null) => void>();
  const docsCbs = new Set<() => void>();
  const openCbs = new Set<(id: string) => void>();
  const watched = new Map<string, () => void>();
  let quiet = 0;

  const emit = (set: Set<() => void>) => {
    if (quiet) return;
    for (const cb of set) cb();
  };
  const changed = (docId: string | null) => {
    if (quiet) return;
    for (const cb of changeCbs) cb(docId);
  };

  const bc = (id: string) =>
    collection.getBlockCollection(id) as unknown as TestDocLike | null;

  // Keep the page list's title equal to the page's own title block, the way
  // AFFiNE does, so the tree and the tabs never show a stale name.
  const syncTitle = (id: string) => {
    const d = bc(id);
    if (!d) return;
    const title = titleOf(d.spaceDoc);
    const meta = collection.meta.getDocMeta(id);
    if (meta && meta.title !== title) {
      collection.meta.setDocMeta(id, { title });
    }
  };

  const watch = (id: string) => {
    if (watched.has(id)) return;
    const d = bc(id);
    if (!d) return;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === SEED) return;
      syncTitle(id);
      changed(id);
    };
    d.spaceDoc.on('update', onUpdate);
    watched.set(id, () => d.spaceDoc.off('update', onUpdate));
  };

  collection.doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin === SEED) return;
    changed(null);
  });
  collection.slots.docListUpdated.subscribe(() => emit(docsCbs));

  if (snapshot) {
    quiet++;
    try {
      Y.applyUpdate(collection.doc, snapshot.root, SEED);
      collection.meta.initialize();
      for (const [id, update] of snapshot.docs) {
        const d = bc(id);
        if (!d) continue;
        Y.applyUpdate(d.spaceDoc, update, SEED);
        d.load();
      }
      for (const [key, b] of snapshot.blobs) {
        blobSource.map.set(key, new Blob([b.bytes as BlobPart], { type: b.type }));
      }
    } finally {
      quiet--;
    }
  } else {
    collection.meta.initialize();
  }
  for (const m of collection.meta.docMetas) watch(m.id);

  const folderMap = () => collection.doc.getMap(FOLDERS_KEY) as Y.Map<FolderRow>;

  const createDoc = (title = '', text = ''): string => {
    const doc = collection.createDoc() as unknown as TestDocLike;
    const store = doc.getStore();
    doc.load(() => {
      const rootId = store.addBlock('affine:page', { title: new Text(title) });
      const noteId = store.addBlock('affine:note', {}, rootId);
      const lines = text ? text.split(/\r?\n/) : [''];
      for (const line of lines) {
        store.addBlock('affine:paragraph', { text: new Text(line) }, noteId);
      }
    });
    store.resetHistory();
    collection.meta.setDocMeta(doc.id, { title });
    watch(doc.id);
    changed(doc.id);
    return doc.id;
  };

  const storeOf = (id: string): Store | null => {
    const d = bc(id);
    if (!d) return null;
    if (!d.loaded || !d.ready) d.load();
    return d.getStore();
  };

  const transformer = (middlewares: never[] = []) =>
    new Transformer({
      schema: getSchema(),
      blobCRUD: collection.blobSync,
      docCRUD: {
        create: (id: string) => collection.createDoc(id).getStore({ id }),
        get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
        delete: (id: string) => collection.removeDoc(id),
      },
      middlewares,
    });

  const provider = () => {
    const container = new Container();
    for (const ext of storeExtensions) ext.setup(container);
    return container.provider();
  };

  const exportWith = async (
    id: string,
    Adapter: typeof MarkdownAdapter | typeof PlainTextAdapter
  ): Promise<string> => {
    const store = storeOf(id);
    if (!store) throw new Error('no such page');
    const job = store.getTransformer([
      titleMiddleware(collection.meta.docMetas),
    ] as never);
    const snap = job.docToSnapshot(store);
    if (!snap) return '';
    const adapter = new (Adapter as typeof MarkdownAdapter)(job, store.provider);
    const res = await adapter.fromDocSnapshot({ snapshot: snap, assets: job.assetsManager });
    return res.file;
  };

  const views = new Set<FxEditorView>();

  const ws: FxWorkspace = {
    id: WORKSPACE_ID,
    docs: () =>
      collection.meta.docMetas.map(m => ({
        id: m.id,
        title: m.title ?? '',
        createDate: m.createDate,
        updatedDate: m.updatedDate,
      })),
    hasDoc: id => !!collection.meta.getDocMeta(id),
    createDoc,
    renameDoc(id, title) {
      const d = bc(id);
      if (!d) return;
      if (!d.loaded || !d.ready) d.load();
      const t = pageBlock(d.spaceDoc)?.get('prop:title');
      if (t instanceof Y.Text) {
        d.spaceDoc.transact(() => {
          t.delete(0, t.length);
          t.insert(0, title);
        });
      }
      collection.meta.setDocMeta(id, { title });
    },
    removeDoc(id) {
      watched.get(id)?.();
      watched.delete(id);
      if (collection.meta.getDocMeta(id)) collection.removeDoc(id);
    },
    folders: () => [...folderMap().values()].map(r => ({ ...r })),
    updateFolders({ set = [], remove = [] }) {
      const m = folderMap();
      collection.doc.transact(() => {
        for (const id of remove) m.delete(id);
        for (const row of set) m.set(row.id, { ...row });
      });
    },
    onChange(cb) {
      changeCbs.add(cb);
      return () => changeCbs.delete(cb);
    },
    onDocsChanged(cb) {
      docsCbs.add(cb);
      return () => docsCbs.delete(cb);
    },
    onOpenDoc(cb) {
      openCbs.add(cb);
      return () => openCbs.delete(cb);
    },
    async snapshot() {
      const docs = new Map<string, Uint8Array>();
      const keys = new Set<string>();
      for (const m of collection.meta.docMetas) {
        const d = bc(m.id);
        if (!d) continue;
        docs.set(m.id, Y.encodeStateAsUpdate(d.spaceDoc));
        for (const k of blobKeysOf(d.spaceDoc)) keys.add(k);
      }
      const blobs = new Map<string, { type: string; bytes: Uint8Array }>();
      for (const key of keys) {
        const blob = await collection.blobSync.get(key);
        if (!blob) continue;
        blobs.set(key, { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      return { root: Y.encodeStateAsUpdate(collection.doc), docs, blobs };
    },
    exportMarkdown: id => exportWith(id, MarkdownAdapter),
    exportText: id => exportWith(id, PlainTextAdapter),
    async importMarkdown(markdown, title) {
      const job = transformer([fileNameMiddleware(title)] as never);
      const adapter = new MarkdownAdapter(job, provider());
      const page = await adapter.toDoc({ file: markdown, assets: job.assetsManager });
      if (!page) throw new Error('markdown import failed');
      if (title && !titleOf((bc(page.id) as TestDocLike).spaceDoc)) ws.renameDoc(page.id, title);
      syncTitle(page.id);
      watch(page.id);
      changed(page.id);
      return page.id;
    },
    importText: (text, title) => createDoc(title ?? '', text),
    mount(el) {
      const editor = document.createElement('fxtxt-editor') as FxtxtEditorElement;
      editor.specs = [...view.get('page'), SurfaceVoidView];
      el.append(editor);
      let current: string | null = null;
      let sub: { unsubscribe(): void } | null = null;
      const v: FxEditorView = {
        open(docId) {
          const store = storeOf(docId);
          if (!store) return false;
          current = docId;
          editor.doc = store;
          sub?.unsubscribe();
          sub = null;
          // Clicking a link to another page asks the app to open it.
          queueMicrotask(() => {
            const std = editor.std;
            const slots = std?.getOptional(RefNodeSlotsProvider);
            if (slots) {
              sub = slots.docLinkClicked.subscribe(e => {
                for (const cb of openCbs) cb(e.pageId);
              });
            }
          });
          return true;
        },
        current: () => current,
        focus() {
          const rich = editor.querySelector('rich-text') as unknown as {
            inlineEditor?: { focusEnd(): void };
          } | null;
          rich?.inlineEditor?.focusEnd();
        },
        destroy() {
          sub?.unsubscribe();
          editor.remove();
          views.delete(v);
        },
      };
      views.add(v);
      return v;
    },
    setTheme(theme) {
      document.documentElement.dataset.theme = theme;
    },
    destroy() {
      for (const v of [...views]) v.destroy();
      for (const off of watched.values()) off();
      watched.clear();
      collection.dispose();
    },
  };
  return ws;
}
