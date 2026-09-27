// Stands in for `shiki/wasm` (the inlined Oniguruma binary). The fxtxt editor
// highlights code with shiki's JavaScript regex engine, so the binary is never
// needed and the app's CSP carries no 'wasm-unsafe-eval'.
export default undefined;
export const wasmBinary = undefined;
