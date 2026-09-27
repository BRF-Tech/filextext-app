// Replaces the bare `shiki` package for the BlockSuite code block.
//
// Two reasons, both about where the app runs:
//
// 1. No WebAssembly. BlockSuite's code block builds its highlighter with
//    `createOnigurumaEngine(() => import('shiki/wasm'))`, which compiles a
//    WebAssembly module and therefore needs 'wasm-unsafe-eval' in the CSP.
//    Here `createOnigurumaEngine` returns shiki's JavaScript regex engine
//    instead (TextMate grammars translated to native RegExp, no eval), so the
//    app's CSP needs no eval exception at all.
// 2. Size. shiki's index lists ~350 languages and ~60 themes, each a lazy
//    chunk. Only the short list below is bundled; any other language renders
//    as plain text.

import {
  createBundledHighlighter,
  createSingletonShorthands,
  guessEmbeddedLanguages,
} from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';

export * from '@shikijs/core';

/** Always the JavaScript engine; the WebAssembly getter is ignored. */
export function createOnigurumaEngine(_wasm?: unknown) {
  return createJavaScriptRegexEngine({ forgiving: true });
}

/** Nothing to load: there is no WebAssembly engine in this build. */
export async function loadWasm(_wasm?: unknown): Promise<void> {}

type LangImport = () => Promise<unknown>;
type LangInfo = { id: string; name: string; aliases?: string[]; import: LangImport };

export const bundledLanguagesInfo: LangInfo[] = [
  { id: 'javascript', name: 'JavaScript', aliases: ['js'], import: () => import('@shikijs/langs/javascript') },
  { id: 'typescript', name: 'TypeScript', aliases: ['ts'], import: () => import('@shikijs/langs/typescript') },
  { id: 'json', name: 'JSON', import: () => import('@shikijs/langs/json') },
  { id: 'html', name: 'HTML', import: () => import('@shikijs/langs/html') },
  { id: 'css', name: 'CSS', import: () => import('@shikijs/langs/css') },
  { id: 'markdown', name: 'Markdown', aliases: ['md'], import: () => import('@shikijs/langs/markdown') },
  { id: 'python', name: 'Python', aliases: ['py'], import: () => import('@shikijs/langs/python') },
  { id: 'go', name: 'Go', import: () => import('@shikijs/langs/go') },
  { id: 'sql', name: 'SQL', import: () => import('@shikijs/langs/sql') },
  { id: 'yaml', name: 'YAML', aliases: ['yml'], import: () => import('@shikijs/langs/yaml') },
  { id: 'bash', name: 'Bash', aliases: ['sh', 'shell', 'shellscript', 'zsh'], import: () => import('@shikijs/langs/bash') },
];

export const bundledLanguagesBase: Record<string, LangImport> = Object.fromEntries(
  bundledLanguagesInfo.map(i => [i.id, i.import]),
);

export const bundledLanguagesAlias: Record<string, LangImport> = Object.fromEntries(
  bundledLanguagesInfo.flatMap(i => i.aliases?.map(a => [a, i.import] as const) ?? []),
);

export const bundledLanguages: Record<string, LangImport> = {
  ...bundledLanguagesBase,
  ...bundledLanguagesAlias,
};

export const bundledThemes: Record<string, () => Promise<unknown>> = {
  'dark-plus': () => import('@shikijs/themes/dark-plus'),
  'light-plus': () => import('@shikijs/themes/light-plus'),
};

const createHighlighter = /* @__PURE__ */ createBundledHighlighter({
  langs: bundledLanguages as never,
  themes: bundledThemes as never,
  engine: () => createJavaScriptRegexEngine({ forgiving: true }),
});

const shorthands = /* @__PURE__ */ createSingletonShorthands(createHighlighter, {
  guessEmbeddedLanguages,
});

export const codeToHtml = shorthands.codeToHtml;
export const codeToHast = shorthands.codeToHast;
export const codeToTokens = shorthands.codeToTokens;
export const codeToTokensBase = shorthands.codeToTokensBase;
export const codeToTokensWithThemes = shorthands.codeToTokensWithThemes;
export const getSingletonHighlighter = shorthands.getSingletonHighlighter;
export const getLastGrammarState = shorthands.getLastGrammarState;
export { createHighlighter };
