// Sandbox compatibility probe for the BlockSuite editor bundle. Loaded inside
// the sandboxed iframe by dev/serve.mjs; reports to the parent frame.
const t0 = performance.now();
const report: Record<string, unknown> = { csp: [] as string[], errors: [] as string[], steps: {} };
const steps = report.steps as Record<string, unknown>;
const mark = (k: string) => (steps[k] = Math.round(performance.now() - t0));

document.addEventListener('securitypolicyviolation', (e) => {
  (report.csp as string[]).push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
});
window.addEventListener('error', (e) => (report.errors as string[]).push('error: ' + (e.message || String(e.error))));
window.addEventListener('unhandledrejection', (e) => (report.errors as string[]).push('rejection: ' + String(e.reason?.stack || e.reason)));
const origErr = console.error.bind(console);
console.error = (...a: unknown[]) => { (report.errors as string[]).push('console: ' + a.map(String).join(' ').slice(0, 400)); origErr(...a); };

function env() {
  const r: Record<string, unknown> = {};
  r.origin = self.origin; r.url = location.origin;
  r.isSecureContext = window.isSecureContext;
  r.subtle = typeof crypto?.subtle?.importKey === 'function';
  for (const k of ['localStorage', 'sessionStorage', 'indexedDB'] as const) {
    try { const v = (window as any)[k]; r[k] = v ? 'available' : 'undefined'; } catch (e) { r[k] = 'throws ' + (e as Error).name; }
  }
  try { new Function('return 1')(); r.eval = 'allowed'; } catch (e) { r.eval = 'blocked ' + (e as Error).name; }
  try { const b = new Blob(['self.postMessage(1)'], { type: 'text/javascript' }); const w = new Worker(URL.createObjectURL(b)); r.blobWorker = 'constructed'; w.terminate(); } catch (e) { r.blobWorker = 'throws ' + (e as Error).name; }
  return r;
}

async function webcrypto() {
  const r: Record<string, unknown> = {};
  try {
    const t = performance.now();
    const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode('correct horse'), 'PBKDF2', false, ['deriveKey']);
    const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: new Uint8Array(16), iterations: 600000, hash: 'SHA-256' }, mat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    r.pbkdf2_600k_ms = Math.round(performance.now() - t);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, new TextEncoder().encode('x'));
    r.aesgcm = ct.byteLength === 17 ? 'ok' : 'bad';
    const h = await crypto.subtle.importKey('raw', new Uint8Array(20), 'HKDF', false, ['deriveKey']);
    await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(16), info: new Uint8Array(1) }, h, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    r.hkdf = 'ok';
  } catch (e) { r.error = String(e); }
  return r;
}

(async () => {
  report.envBefore = env();
  report.crypto = await webcrypto();
  mark('crypto');
  const tImport = performance.now();
  const mod = await import('../../vendor/blocksuite/fxtxt-editor.js');
  await import('../../vendor/blocksuite/fxtxt-editor.css');
  steps.importMs = Math.round(performance.now() - tImport);
  report.replacedStorage = mod.replacedStorage;
  const ws = mod.createWorkspace();
  mark('workspace');
  const id = ws.createDoc('Probe page', 'first line');
  const view = ws.mount(document.getElementById('ed')!);
  view.open(id);
  const waitFor = async (sel: string, ms = 20000) => { const t = performance.now(); while (performance.now() - t < ms) { if (document.querySelector(sel)) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };
  report.rendered = await waitFor('affine-paragraph');
  mark('firstParagraph');
  report.titleRendered = !!document.querySelector('doc-title');
  let changes = 0; ws.onChange(() => changes++);
  // edit through the model (the same path typing takes)
  const store = (document.querySelector('fxtxt-editor') as any).doc;
  const para = store.getModelsByFlavour('affine:paragraph')[0];
  para.text.insert(' + edited', para.text.length);
  report.changesAfterEdit = changes;
  const md = await ws.exportMarkdown(id);
  report.markdown = md;
  report.text = await ws.exportText(id);
  const id2 = await ws.importMarkdown('# Imported\n\n- a\n- b\n\n```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', 'Imported');
  report.importedDocs = ws.docs().map((d: any) => d.title);
  view.open(id2);
  report.codeRendered = await waitFor('affine-code', 10000);
  report.tableRendered = await waitFor('affine-table', 10000);
  await new Promise((r) => setTimeout(r, 1500));
  report.highlightedTokens = document.querySelectorAll('affine-code v-text span[style*="color"], affine-code span[style*="color"]').length;
  const snap = await ws.snapshot();
  report.snapshot = { root: snap.root.byteLength, docs: [...snap.docs.values()].map((u: Uint8Array) => u.byteLength), blobs: snap.blobs.size };
  const ws2 = mod.createWorkspace(snap);
  report.reloaded = { titles: ws2.docs().map((d: any) => d.title), md: await ws2.exportMarkdown(id) };
  report.envAfter = env();
  mark('done');
  parent.postMessage({ type: 'probe:done', report }, '*');
})().catch((e) => { (report.errors as string[]).push('fatal: ' + (e?.stack || e)); parent.postMessage({ type: 'probe:done', report }, '*'); });
