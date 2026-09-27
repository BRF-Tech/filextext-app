// Development server: a stand-in for filex's app-interface hosting (filex
// docs/APP-PLUGINS-API.md → "An app's own interface": the /_appui route, its
// CSP and headers) plus a fake host page that speaks the bridge protocol v1.
//
//   node dev/serve.mjs [--port 7201] [--dir dist] [--same-origin]
//
// Host page:  http://127.0.0.1:<port>/            (dev/host.html)
// App UI:     http://localhost:<port>/_appui/filextext/<ver>/index.html
//
// The app is served from a DIFFERENT origin than the host by default
// (localhost vs 127.0.0.1, one listener), like filex's optional separate
// sandbox domain; --same-origin serves both from 127.0.0.1, like filex's
// default. Either way every HTML response carries the CSP filex would
// generate from the grant: no 'self', sources scoped to the version path,
// connect-src 'none', no eval, and `sandbox allow-scripts` so the page is an
// opaque origin even when opened directly in a tab.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(opt('--port', process.env.FXTXT_PORT || '7201'));
const SAME = args.includes('--same-origin') || process.env.FXTXT_SAME_ORIGIN === '1';
const DIRS = {
  app: resolve(here, '..', opt('--dir', 'dist')),
  probe: resolve(here, 'out', 'probe'),
};
const VERSION = 'dev';
const HOST_ORIGIN = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = SAME ? HOST_ORIGIN : `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The CSP filex generates for an app's HTML (report §3.2, no extra grants). */
export function appCsp(base) {
  return [
    "default-src 'none'",
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base}`,
    `media-src ${base} blob:`,
    "connect-src 'none'",
    'worker-src blob:',
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    'sandbox allow-scripts',
  ].join('; ');
}

function appHeaders(kind, base) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'Cache-Control': 'no-store',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), clipboard-read=(), usb=(), serial=(), hid=(), payment=()',
  };
  if (kind === 'html') {
    h['Content-Security-Policy'] = appCsp(base);
    h['Connection-Allowlist'] = '(response-origin)';
  } else {
    h['Content-Security-Policy'] = "default-src 'none'; sandbox";
    // Module scripts (and `crossorigin` stylesheets) are fetched in CORS
    // mode, and a sandboxed page's origin is "null": without this header
    // every <script type="module"> and dynamic import() of the app is
    // refused ("blocked by CORS policy"). The bundle is public code fetched
    // without credentials, so `*` exposes nothing.
    h['Access-Control-Allow-Origin'] = '*';
  }
  return h;
}

async function sendFile(res, file, headers) {
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', ...headers });
  res.end(body);
}

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const origin = `http://${req.headers.host}`;
    const m = url.pathname.match(/^\/_appui\/(filextext|probe)\/([^/]+)\/(.*)$/);
    if (m) {
      // The app UI must come from the app origin only.
      if (origin !== APP_ORIGIN) {
        res.writeHead(404).end();
        return;
      }
      const [, which, , rest] = m;
      const root = which === 'probe' ? DIRS.probe : DIRS.app;
      // Normalise first, then check containment (VS Code CVE-2022-41042).
      // URL paths are POSIX: path.normalize would turn `/` into `\` on Windows.
      const raw = rest || 'index.html';
      if (/%2f|%5c|\\/i.test(raw)) {
        res.writeHead(400).end();
        return;
      }
      const rel = posix.normalize(decodeURIComponent(raw));
      if (rel.startsWith('/') || rel.split('/').includes('..')) {
        res.writeHead(400).end();
        return;
      }
      const file = resolve(root, rel);
      if (!file.startsWith(root + sep)) {
        res.writeHead(400).end();
        return;
      }
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const base = `${APP_ORIGIN}/_appui/${which}/${m[2]}/`;
      await sendFile(res, file, appHeaders(extname(file) === '.html' ? 'html' : 'other', base));
      return;
    }
    if (origin !== HOST_ORIGIN) {
      res.writeHead(404).end();
      return;
    }
    if (url.pathname === '/' || url.pathname === '/host.html') {
      const html = (await readFile(join(here, 'host.html'), 'utf8'))
        .replace('__APP_BASE__', `${APP_ORIGIN}/_appui/filextext/${VERSION}/`)
        .replace('__PROBE_BASE__', `${APP_ORIGIN}/_appui/probe/${VERSION}/`);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // The host page's own CSP: the app frame may load only from the app
        // path (this is what closes the frame's self-navigation channel).
        'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src ${APP_ORIGIN}/_appui/`,
      });
      res.end(html);
      return;
    }
    res.writeHead(404).end();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(e));
  }
};

// Loopback only, both families: browsers may resolve `localhost` to ::1.
createServer(handler).listen(PORT, '127.0.0.1', () => {
  console.log(`fxtxt dev host: ${HOST_ORIGIN}/   app origin: ${APP_ORIGIN}${SAME ? ' (same origin)' : ''}`);
});
createServer(handler)
  .on('error', () => {})
  .listen(PORT, '::1');
