# Changelog

## Unreleased

- vite 8.3.7 (was 8.3.6).
- vite 8.3.8 (was 8.3.7).

## 0.1.2 - 2026-11-08

- The interface is built with Vite 8.3.6 (was 7.3.6) and carries the filex interface SDK of filex 0.59.0 (`@brftech/filex-app-ui`, was 0.48.1). Nothing the app does changes, and it still needs only filex 0.48.0 or later: the SDK only adds methods this app does not call. `ui.zip` is 1.50 MiB (was 1.55 MiB). The BlockSuite editor is unchanged (AFFiNE v0.27.4, still its latest stable release).
- Development tools: TypeScript 7.0.2 (`tsconfig.json` no longer sets `baseUrl`, which TypeScript 7 removed), Vitest 5.1.0, Playwright 1.65.0, `@types/node` 22.20.5. `npm audit` reports nothing (Vite 7.3.6's development server and Vitest 5.0.2 had advisories; neither is in `ui.zip`).
- The workflows pin every action by commit SHA, with its version beside it: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2, `softprops/action-gh-release` v3.0.4.
- A release's notes on GitHub are its `CHANGELOG.md` section, so filex's "Review update" says what the version changes (it showed only GitHub's "Full Changelog" line). A version with no section is not released.

## 0.1.1 - 2026-09-28

- The install review gives a reason for every permission, in English and Turkish: the interface (`ui`), Download (`ui:download`), opening `.fxtxt` files (`ui-viewer:.fxtxt`) and the New document row (`ui-new:.fxtxt`) no longer say "The app gives no reason". The first release built and published by the Release workflow: `ui.zip` now hashes the same in every time zone.

## 0.1.0 - 2026-09-28

- First release: an end-to-end encrypted text workspace (`.fxtxt`) for filex 0.48.0 and later, edited with AFFiNE's BlockSuite editor.
