// The workspace: folder tree on the left, tabs on top, the BlockSuite page
// editor in the middle — the AFFiNE layout, kept small.

import { lang, t } from '../i18n';
import {
  type FolderRow,
  type NodeRef,
  type TreeNode,
  addFolder,
  buildTree,
  move,
  placePage,
  remove,
  renameFolder,
} from '../model/tree';
import { splitTitle } from '../model/markdown';
import type { WorkspaceSession } from '../session';
import type { FxEditorView } from '../../vendor/blocksuite/fxtxt-editor.js';
import { h, icon } from './dom';
import { confirmDialog, modal, promptDialog } from './modal';

export interface WorkspaceCallbacks {
  save(): Promise<void>;
  dirty(on: boolean): void;
  lock(): void;
  changePassword(): void;
  /** Copy plaintext the person asked to export; says how it went. */
  copyOut(text: string): Promise<boolean>;
  /** Hand plaintext the person asked to export to their disk; null when filex cannot. */
  download: ((name: string, text: string, mime: string) => Promise<void>) | null;
  toast(text: string, tone?: 'info' | 'success' | 'warning' | 'error'): void;
  title(text: string): void;
}

interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
  testid?: string;
}

const newId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

const IMPORTABLE = /\.(md|markdown|txt)$/i;

/** A page title as a file name any OS takes. */
function fileSafe(title: string): string {
  const s = title
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return s || 'page';
}

export class WorkspaceUI {
  private readonly ws;
  private tabs: string[] = [];
  private active: string | null = null;
  private readonly expanded = new Set<string>();
  private selectedFolder: string | null = null;
  private view: FxEditorView | null = null;
  private dirty = false;
  private changes = 0;
  private saving = false;
  private lastSaved: Date | null = null;
  private readonly offs: (() => void)[] = [];
  private menuEl: HTMLElement | null = null;
  private els!: {
    tree: HTMLElement;
    tabs: HTMLElement;
    status: HTMLElement;
    saveBtn: HTMLButtonElement;
    editor: HTMLElement;
    empty: HTMLElement;
    side: HTMLElement;
    fileInput: HTMLInputElement;
  };

  constructor(
    private readonly root: HTMLElement,
    session: WorkspaceSession,
    private readonly fileName: string,
    private readonly readOnly: boolean,
    private readonly cb: WorkspaceCallbacks,
  ) {
    this.ws = session.ws;
  }

  mount() {
    this.build();
    this.view = this.ws.mount(this.els.editor);
    this.offs.push(this.ws.onDocsChanged(() => this.refresh()));
    this.offs.push(
      this.ws.onChange((docId) => {
        this.changes++;
        if (docId === null) this.renderTree();
        this.setDirty(true);
      }),
    );
    this.offs.push(this.ws.onOpenDoc((id) => this.openPage(id)));
    const first = this.firstPage();
    if (first) this.openPage(first);
    this.refresh();
    this.setDirty(false);
  }

  destroy() {
    for (const off of this.offs) off();
    this.closeMenu();
    this.view?.destroy();
    this.root.replaceChildren();
  }

  isDirty() {
    return this.dirty;
  }

  /** How many edits so far; a save passes the count it started with. */
  changeCount() {
    return this.changes;
  }

  /** Saved what existed at `gen`: clean only if nothing changed since. */
  markSaved(gen: number) {
    this.lastSaved = new Date();
    this.setDirty(this.changes !== gen);
  }

  setSaving(on: boolean) {
    this.saving = on;
    this.renderStatus();
  }

  /** Re-render the chrome (after a language change). */
  relabel() {
    const tabId = this.active;
    this.build();
    this.view?.destroy();
    this.view = this.ws.mount(this.els.editor);
    if (tabId) this.openPage(tabId);
    this.refresh();
  }

  // ── layout ────────────────────────────────────────────────────────────────

  private build() {
    const tree = h('nav', { class: 'tree', role: 'tree', 'aria-label': t('pages'), 'data-testid': 'tree' });
    const fileInput = h('input', {
      type: 'file',
      multiple: true,
      accept: '.md,.markdown,.txt,text/markdown,text/plain',
      hidden: true,
      'data-testid': 'import-input',
    }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const files = [...(fileInput.files ?? [])];
      fileInput.value = '';
      void this.importFiles(files);
    });
    const actions = h(
      'div',
      { class: 'side-actions' },
      this.iconButton('plusPage', t('newPage'), () => void this.newPage(this.selectedFolder), 'new-page', this.readOnly),
      this.iconButton('plusFolder', t('newFolder'), () => void this.newFolder(this.selectedFolder), 'new-folder', this.readOnly),
      this.iconButton('upload', t('importFiles'), () => fileInput.click(), 'import', this.readOnly),
    );
    const side = h(
      'aside',
      { class: 'side', 'data-testid': 'sidebar' },
      h(
        'div',
        { class: 'side-head' },
        icon('lock'),
        h('span', { class: 'file-name', title: this.fileName }, this.fileName),
      ),
      h('div', { class: 'side-badge' }, icon('shield'), t('e2eBadge')),
      h('div', { class: 'side-section' }, h('span', {}, t('pages')), actions),
      tree,
      h('div', { class: 'drop-hint' }, t('dropHint')),
      fileInput,
    );
    this.wireSideDrop(side, tree);

    const status = h('span', { class: 'status', 'aria-live': 'polite', 'data-testid': 'save-status' });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'save' }, icon('save'), t('save')) as HTMLButtonElement;
    saveBtn.addEventListener('click', () => void this.cb.save());
    const more = this.iconButton('more', t('menu'), (e) => this.openMenu((e.currentTarget as HTMLElement), this.moreItems()), 'more');
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'data-testid': 'tabs' });
    const top = h('header', { class: 'topbar' }, tabs, h('div', { class: 'top-tools' }, status, saveBtn, more));
    const editor = h('div', { class: 'editor-host', 'data-testid': 'editor-host' });
    const empty = h('div', { class: 'empty', hidden: true }, t('emptyEditor'));
    const banner = this.readOnly ? h('div', { class: 'banner', role: 'status' }, t('readOnly')) : null;
    const main = h('main', { class: 'main' }, top, banner, editor, empty);
    this.root.replaceChildren(h('div', { class: 'app', 'data-lang': lang() }, side, main));
    this.els = { tree, tabs, status, saveBtn, editor, empty, side, fileInput };
  }

  private iconButton(name: Parameters<typeof icon>[0], label: string, onClick: (e: MouseEvent) => void, testid: string, disabled = false) {
    const b = h('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, 'data-testid': testid, disabled }, icon(name));
    b.addEventListener('click', onClick as EventListener);
    return b;
  }

  private refresh() {
    this.renderTree();
    this.renderTabs();
    this.renderStatus();
  }

  private pageTitle(id: string): string {
    const d = this.ws.docs().find((x) => x.id === id);
    return d?.title?.trim() || t('untitled');
  }

  private firstPage(): string | null {
    const nodes = buildTree(this.ws.folders(), this.ws.docs());
    const walk = (list: TreeNode[]): string | null => {
      for (const n of list) {
        if (n.kind === 'page') return n.id;
        const c = walk(n.children);
        if (c) return c;
      }
      return null;
    };
    return walk(nodes);
  }

  // ── tree ──────────────────────────────────────────────────────────────────

  private renderTree() {
    const nodes = buildTree(this.ws.folders(), this.ws.docs());
    const frag = document.createDocumentFragment();
    const draw = (list: TreeNode[], parent: HTMLElement | DocumentFragment) => {
      for (const n of list) {
        const open = n.kind === 'folder' && this.expanded.has(n.id);
        const row = h(
          'div',
          {
            class: `node node-${n.kind}${n.kind === 'page' && n.id === this.active ? ' active' : ''}${n.kind === 'folder' && n.id === this.selectedFolder ? ' selected' : ''}`,
            role: 'treeitem',
            tabindex: '0',
            'aria-expanded': n.kind === 'folder' ? String(open) : null,
            'aria-selected': n.kind === 'page' ? String(n.id === this.active) : null,
            'data-key': n.key,
            'data-testid': n.kind === 'folder' ? 'tree-folder' : 'tree-page',
            'data-name': n.name,
            draggable: this.readOnly ? null : 'true',
            style: `--depth:${n.depth}`,
          },
          n.kind === 'folder'
            ? h('span', { class: `twisty${open ? ' open' : ''}`, html: '' }, icon('chevron'))
            : h('span', { class: 'twisty' }),
          icon(n.kind === 'folder' ? (open ? 'folderOpen' : 'folder') : 'page'),
          h('span', { class: 'node-name' }, n.name?.trim() || t('untitled')),
          this.readOnly ? null : this.nodeMore(n),
        );
        row.addEventListener('click', () => {
          if (n.kind === 'page') this.openPage(n.id);
          else {
            if (this.expanded.has(n.id)) this.expanded.delete(n.id);
            else this.expanded.add(n.id);
            this.selectedFolder = n.id;
            this.renderTree();
          }
        });
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            row.click();
          }
        });
        row.addEventListener('contextmenu', (e) => {
          if (this.readOnly) return;
          e.preventDefault();
          this.openMenu(row, this.nodeItems(n), e.clientX, e.clientY);
        });
        this.wireNodeDrag(row, n);
        parent.append(row);
        if (n.kind === 'folder' && open && n.children.length) {
          const g = h('div', { role: 'group' });
          draw(n.children, g);
          parent.append(g);
        }
      }
    };
    draw(nodes, frag);
    this.els.tree.replaceChildren(frag);
  }

  private nodeMore(n: TreeNode) {
    const b = h('button', { type: 'button', class: 'node-more', 'aria-label': t('menu'), title: t('menu'), 'data-testid': 'node-more' }, icon('more'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMenu(b, this.nodeItems(n));
    });
    return b;
  }

  private refOf(n: TreeNode): NodeRef {
    return n.kind === 'folder' ? { kind: 'folder', id: n.id } : { kind: 'page', docId: n.id };
  }

  private nodeItems(n: TreeNode): MenuItem[] {
    const items: MenuItem[] = [];
    if (n.kind === 'folder') {
      items.push({ label: t('newPageHere'), run: () => void this.newPage(n.id), testid: 'menu-new-page-here' });
      items.push({ label: t('newFolderHere'), run: () => void this.newFolder(n.id), testid: 'menu-new-folder-here' });
    }
    items.push({ label: t('rename'), run: () => void this.rename(n), testid: 'menu-rename' });
    items.push({ label: t('moveTo'), run: () => this.moveDialog(n), testid: 'menu-move' });
    items.push({ label: t('delete'), run: () => void this.deleteNode(n), danger: true, testid: 'menu-delete' });
    return items;
  }

  private apply(change: { set: FolderRow[]; remove: string[] }) {
    this.ws.updateFolders(change);
    this.renderTree();
  }

  private async newPage(folderId: string | null) {
    const id = this.ws.createDoc('');
    if (folderId) {
      this.apply(placePage(this.ws.folders(), id, folderId, newId));
      this.expanded.add(folderId);
    }
    this.openPage(id);
    queueMicrotask(() => {
      const title = this.els.editor.querySelector<HTMLElement>('doc-title .inline-editor, doc-title [contenteditable="true"]');
      title?.focus();
    });
  }

  private async newFolder(parentId: string | null) {
    const name = await promptDialog(t('newFolder'), t('folderName'), t('newFolder'), 'new-folder-dialog');
    if (!name) return;
    const change = addFolder(this.ws.folders(), parentId, name, newId);
    this.apply(change);
    if (parentId) this.expanded.add(parentId);
    this.selectedFolder = change.set[0].id;
    this.renderTree();
  }

  private async rename(n: TreeNode) {
    const label = n.kind === 'folder' ? t('folderName') : t('pageTitle');
    const name = await promptDialog(t('rename'), label, n.name, 'rename-dialog');
    if (!name) return;
    if (n.kind === 'folder') this.apply(renameFolder(this.ws.folders(), n.id, name));
    else this.ws.renameDoc(n.id, name);
    this.refresh();
  }

  private moveDialog(n: TreeNode) {
    const rows = this.ws.folders();
    const nodes = buildTree(rows, []);
    const forbidden = new Set<string>();
    if (n.kind === 'folder') {
      const mark = (list: TreeNode[], inside: boolean) => {
        for (const x of list) {
          const now = inside || x.id === n.id;
          if (now) forbidden.add(x.id);
          mark(x.children, now);
        }
      };
      mark(nodes, false);
    }
    const options: HTMLElement[] = [];
    const radio = (value: string, label: string, depth: number, disabled: boolean) => {
      const input = h('input', { type: 'radio', name: 'dest', value, disabled, 'data-testid': `move-dest` }) as HTMLInputElement;
      options.push(h('label', { class: `dest${disabled ? ' disabled' : ''}`, style: `--depth:${depth}`, 'data-name': label }, input, icon(value ? 'folder' : 'lock'), h('span', {}, label)));
    };
    radio('', t('topLevel'), 0, false);
    const walk = (list: TreeNode[]) => {
      for (const x of list) {
        if (x.kind !== 'folder') continue;
        radio(x.id, x.name, x.depth + 1, forbidden.has(x.id));
        walk(x.children);
      }
    };
    walk(nodes);
    modal({
      title: `${t('moveTo')} — ${n.name || t('untitled')}`,
      testid: 'move-dialog',
      body: [h('div', { class: 'dest-list' }, ...options)],
      actions: [
        { label: t('cancel') },
        {
          label: t('ok'),
          primary: true,
          testid: 'move-ok',
          run: () => {
            const picked = options.map((o) => o.querySelector('input') as HTMLInputElement).find((i) => i.checked);
            if (!picked) return false;
            const dest = picked.value || null;
            try {
              this.apply(move(this.ws.folders(), this.refOf(n), dest, newId));
            } catch {
              throw new Error(t('cantMoveHere'));
            }
            if (dest) this.expanded.add(dest);
            this.renderTree();
          },
        },
      ],
    });
  }

  private async deleteNode(n: TreeNode) {
    const out = remove(this.ws.folders(), this.refOf(n));
    const question =
      n.kind === 'folder'
        ? t('deleteFolder', { name: n.name, n: out.docIds.length })
        : t('deletePage', { name: n.name || t('untitled') });
    if (!(await confirmDialog(question, { danger: true, confirm: t('delete') }))) return;
    this.ws.updateFolders(out.change);
    for (const id of out.docIds) {
      this.closeTab(id, false);
      this.ws.removeDoc(id);
    }
    if (n.kind === 'folder' && this.selectedFolder === n.id) this.selectedFolder = null;
    if (!this.active) {
      const next = this.tabs[0] ?? this.firstPage();
      if (next) this.openPage(next);
      else this.showEmpty();
    }
    this.refresh();
  }

  // ── drag and drop ─────────────────────────────────────────────────────────

  private wireNodeDrag(row: HTMLElement, n: TreeNode) {
    if (this.readOnly) return;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/x-fxtxt-node', n.key);
      e.dataTransfer!.effectAllowed = 'move';
    });
    if (n.kind !== 'folder') return;
    row.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-fxtxt-node')) {
        e.preventDefault();
        row.classList.add('drop-target');
      }
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('drop-target');
      const key = e.dataTransfer?.getData('application/x-fxtxt-node');
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      this.dropOn(key, n.id);
    });
  }

  private dropOn(key: string, folderId: string | null) {
    const ref: NodeRef = key.startsWith('f:') ? { kind: 'folder', id: key.slice(2) } : { kind: 'page', docId: key.slice(2) };
    try {
      this.apply(move(this.ws.folders(), ref, folderId, newId));
      if (folderId) this.expanded.add(folderId);
      this.renderTree();
    } catch {
      this.cb.toast(t('cantMoveHere'), 'warning');
    }
  }

  private wireSideDrop(side: HTMLElement, tree: HTMLElement) {
    if (this.readOnly) return;
    side.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (types.includes('Files') || types.includes('application/x-fxtxt-node')) {
        e.preventDefault();
        side.classList.add('dropping');
      }
    });
    side.addEventListener('dragleave', (e) => {
      if (!side.contains(e.relatedTarget as Node)) side.classList.remove('dropping');
    });
    side.addEventListener('drop', (e) => {
      side.classList.remove('dropping');
      const key = e.dataTransfer?.getData('application/x-fxtxt-node');
      if (key) {
        e.preventDefault();
        this.dropOn(key, null);
        return;
      }
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void this.importFiles(files);
      }
    });
    void tree;
  }

  // ── import ────────────────────────────────────────────────────────────────

  private async importFiles(files: File[]) {
    let n = 0;
    let last: string | null = null;
    for (const f of files) {
      if (!IMPORTABLE.test(f.name)) {
        this.cb.toast(`${f.name}: ${t('notAPage')}`, 'warning');
        continue;
      }
      try {
        const text = await f.text();
        const name = f.name.replace(IMPORTABLE, '');
        let id: string;
        if (/\.txt$/i.test(f.name)) id = this.ws.importText(text, name);
        else {
          const { title, body } = splitTitle(text, name);
          id = await this.ws.importMarkdown(body, title);
        }
        if (this.selectedFolder) this.ws.updateFolders(placePage(this.ws.folders(), id, this.selectedFolder, newId));
        last = id;
        n++;
      } catch (e) {
        this.cb.toast(t('importFailed', { name: f.name, msg: String((e as Error)?.message ?? e) }), 'error');
      }
    }
    if (n) this.cb.toast(t('imported', { n }), 'success');
    if (last) this.openPage(last);
    this.refresh();
  }

  // ── tabs & editor ─────────────────────────────────────────────────────────

  openPage(id: string) {
    if (!this.ws.hasDoc(id)) return;
    if (!this.tabs.includes(id)) this.tabs.push(id);
    this.active = id;
    this.els.empty.hidden = true;
    this.els.editor.hidden = false;
    this.view?.open(id);
    this.renderTabs();
    this.renderTree();
    this.cb.title(`${this.fileName} — ${this.pageTitle(id)}`);
  }

  private closeTab(id: string, reopen = true) {
    const i = this.tabs.indexOf(id);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.active === id) {
      this.active = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next && reopen) this.openPage(next);
      else if (reopen) this.showEmpty();
    }
    this.renderTabs();
    this.renderTree();
  }

  private showEmpty() {
    this.active = null;
    this.els.editor.hidden = true;
    this.els.empty.hidden = false;
    this.cb.title(this.fileName);
  }

  private renderTabs() {
    this.tabs = this.tabs.filter((id) => this.ws.hasDoc(id));
    const items = this.tabs.map((id) => {
      const close = h('button', { type: 'button', class: 'tab-close', 'aria-label': t('closeTab'), title: t('closeTab'), 'data-testid': 'tab-close' }, icon('close'));
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(id);
      });
      const tab = h(
        'div',
        {
          class: `tab${id === this.active ? ' active' : ''}`,
          role: 'tab',
          tabindex: '0',
          'aria-selected': String(id === this.active),
          'data-testid': 'tab',
          'data-doc': id,
        },
        icon('page'),
        h('span', { class: 'tab-title' }, this.pageTitle(id)),
        close,
      );
      tab.addEventListener('click', () => this.openPage(id));
      tab.addEventListener('auxclick', (e) => {
        if (e.button === 1) this.closeTab(id);
      });
      return tab;
    });
    this.els.tabs.replaceChildren(...items);
    if (this.active) this.cb.title(`${this.fileName} — ${this.pageTitle(this.active)}`);
  }

  // ── status & menus ────────────────────────────────────────────────────────

  private setDirty(on: boolean) {
    if (this.readOnly) on = false;
    if (this.dirty !== on) {
      this.dirty = on;
      this.cb.dirty(on);
    }
    this.renderStatus();
  }

  private renderStatus() {
    if (!this.els) return;
    const s = this.els.status;
    if (this.readOnly) s.textContent = t('readOnly');
    else if (this.saving) s.textContent = t('saving');
    else if (this.dirty) s.textContent = t('unsaved');
    else s.textContent = this.lastSaved ? t('allSaved') : '';
    s.dataset.state = this.saving ? 'saving' : this.dirty ? 'dirty' : 'clean';
    this.els.saveBtn.disabled = this.readOnly || this.saving || !this.dirty;
  }

  private moreItems(): MenuItem[] {
    const id = this.active;
    return [
      { label: t('exportMd'), run: () => id && void this.exportPage(id, 'md'), disabled: !id, testid: 'menu-export-md' },
      { label: t('exportTxt'), run: () => id && void this.exportPage(id, 'txt'), disabled: !id, testid: 'menu-export-txt' },
      { label: t('changePassword'), run: () => this.cb.changePassword(), disabled: this.readOnly, testid: 'menu-change-password' },
      { label: t('lock'), run: () => this.cb.lock(), testid: 'menu-lock' },
    ];
  }

  private async exportPage(id: string, kind: 'md' | 'txt') {
    const text = kind === 'md' ? await this.ws.exportMarkdown(id) : await this.ws.exportText(id);
    const area = h('textarea', { class: 'input mono export-text', readonly: true, rows: 14, 'data-testid': 'export-text' }) as HTMLTextAreaElement;
    area.value = text;
    const download = this.cb.download;
    const fileName = `${fileSafe(this.pageTitle(id))}.${kind}`;
    modal({
      title: t('exportTitle', { name: this.pageTitle(id) }),
      testid: 'export-dialog',
      body: [h('p', { class: 'hint' }, t('exportLead')), area],
      actions: [
        { label: t('close') },
        ...(download
          ? [
              {
                label: t('download'),
                testid: 'export-download',
                // The person's click is the gesture filex asks for.
                run: async () => {
                  try {
                    await download(fileName, text, kind === 'md' ? 'text/markdown' : 'text/plain');
                  } catch (e) {
                    if ((e as { code?: string })?.code === 'cancelled') return false;
                    throw e;
                  }
                  this.cb.toast(t('downloaded'), 'success');
                },
              },
            ]
          : []),
        {
          label: t('copy'),
          primary: true,
          testid: 'export-copy',
          run: async () => {
            const ok = await this.cb.copyOut(text);
            if (ok) this.cb.toast(t('copied'), 'success');
            else {
              area.focus();
              area.select();
              throw new Error(t('copyFailed'));
            }
          },
        },
      ],
    });
    queueMicrotask(() => area.select());
  }

  private openMenu(anchor: HTMLElement, items: MenuItem[], x?: number, y?: number) {
    this.closeMenu();
    const menu = h('div', { class: 'menu', role: 'menu', 'data-testid': 'menu' });
    for (const it of items) {
      const b = h('button', { type: 'button', role: 'menuitem', class: `menu-item${it.danger ? ' danger' : ''}`, disabled: it.disabled, 'data-testid': it.testid }, it.label);
      b.addEventListener('click', () => {
        this.closeMenu();
        it.run();
      });
      menu.append(b);
    }
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = x ?? r.left;
    let top = y ?? r.bottom + 4;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, (x ?? r.right) - mw);
    if (top + mh > window.innerHeight - 8) top = Math.max(8, (y ?? r.top) - mh - 4);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.menuEl = menu;
    const onDown = (e: Event) => {
      if (!menu.contains(e.target as Node)) this.closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closeMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
    });
    (menu as HTMLElement & { _off?: () => void })._off = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
    (menu.querySelector('button:not([disabled])') as HTMLElement | null)?.focus();
  }

  private closeMenu() {
    const m = this.menuEl as (HTMLElement & { _off?: () => void }) | null;
    if (!m) return;
    m._off?.();
    m.remove();
    this.menuEl = null;
  }
}
