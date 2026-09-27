// Runs the sandbox probe (dev/probe) in Chrome, Firefox and WebKit against
// dev/serve.mjs and prints what the editor could and could not do.
//   node dev/probe-run.mjs [chromium|firefox|webkit ...] [--same-origin]
import { spawn } from 'node:child_process';
import { chromium, firefox, webkit } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const same = args.includes('--same-origin');
const names = args.filter((a) => !a.startsWith('--'));
const list = names.length ? names : ['chromium', 'firefox', 'webkit'];
const PORT = 7299;
const srv = spawn(process.execPath, ['dev/serve.mjs', '--port', String(PORT), ...(same ? ['--same-origin'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
mkdirSync('dev/out', { recursive: true });
const out = {};
try {
  for (const name of list) {
    const type = { chromium, firefox, webkit }[name];
    const browser = await type.launch(name === 'chromium' ? { channel: 'chrome' } : {});
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const consoleLines = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    const t = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/?probe=1`);
    await page.waitForFunction(() => window.fxhost && window.fxhost.probe, null, { timeout: 90000 }).catch(() => {});
    const report = await page.evaluate(() => window.fxhost && window.fxhost.probe);
    out[name] = { version: browser.version(), wallMs: Date.now() - t, report, console: consoleLines.slice(0, 40) };
    await page.screenshot({ path: `dev/out/probe-${name}${same ? '-same' : ''}.png` });
    await browser.close();
  }
} finally {
  srv.kill();
}
writeFileSync(`dev/out/probe${same ? '-same' : ''}.json`, JSON.stringify(out, null, 2));
for (const [n, r] of Object.entries(out)) {
  const rep = r.report || {};
  console.log(`\n=== ${n} ${r.version}  wall=${r.wallMs}ms`);
  console.log(JSON.stringify({ env: rep.envBefore, crypto: rep.crypto, steps: rep.steps, rendered: rep.rendered, code: rep.codeRendered, table: rep.tableRendered, hl: rep.highlightedTokens, changes: rep.changesAfterEdit, snapshot: rep.snapshot, reloaded: rep.reloaded, replaced: rep.replacedStorage }, null, 1));
  console.log('markdown:', JSON.stringify(rep.markdown));
  console.log('csp:', (rep.csp || []).slice(0, 15));
  console.log('errors:', (rep.errors || []).slice(0, 15));
  console.log('console:', r.console.slice(0, 15));
}
