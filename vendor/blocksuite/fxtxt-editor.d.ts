// Types of the vendored editor library (blocksuite/editor/src/index.ts).
// Copied next to the built fxtxt-editor.js by scripts/3-build-editor.sh.

export declare const EDITOR_VERSION: string;
export declare const replacedStorage: string[];

export interface DocInfo {
  id: string;
  title: string;
  createDate: number;
  updatedDate?: number;
}

export interface FolderRow {
  id: string;
  parentId: string | null;
  type: 'folder' | 'doc';
  data: string;
  index: string;
}

export interface EditorSnapshot {
  root: Uint8Array;
  docs: Map<string, Uint8Array>;
  blobs: Map<string, { type: string; bytes: Uint8Array }>;
}

export interface FxEditorView {
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
  updateFolders(change: { set?: FolderRow[]; remove?: string[] }): void;
  onChange(cb: (docId: string | null) => void): () => void;
  onDocsChanged(cb: () => void): () => void;
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

export declare function createWorkspace(snapshot?: EditorSnapshot): FxWorkspace;
