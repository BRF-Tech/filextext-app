const j = 1, S = "filex:hello", M = "filex:port", E = [
  "session.get",
  "file.read",
  "file.save",
  "file.saveAs",
  "ui.dirty",
  "ui.title",
  "ui.toast",
  "ui.confirm",
  "ui.close",
  "clipboard.write",
  "ui.download",
  "engine.call",
  "job.submit",
  "state.get",
  "state.set",
  "license.get",
  "ui.print",
  "coedit.join",
  "coedit.subscribe",
  "coedit.append",
  "coedit.lease",
  "coedit.cursor",
  "coedit.blob.put",
  "coedit.blob.get",
  "coedit.leave"
], x = {
  /** `file.read({as: 'text'})` refuses a file larger than this; read a stream. */
  maxTextBytes: 33554432,
  /** One `state.set` value, as JSON. */
  maxStateBytes: 8192,
  /** A `ui.toast` / `ui.title` text, in characters. */
  maxLineChars: 300,
  /** How long the SDK waits for the host's port. */
  connectTimeoutMs: 1e4,
  /** The largest file `ui.download` hands the person (streamed or not). */
  maxDownloadBytes: 268435456,
  /**
   * The largest PDF `ui.print` prints (filex 0.55). Lower than a download:
   * a download can stream to disk, a print is held whole in the page (one
   * Blob) until the print dialog has read it, and a document worth printing
   * is far smaller.
   */
  maxPrintBytes: 67108864,
  /**
   * The largest file of an encrypted folder filex hands an app in the clear
   * or takes back from it (filex 0.56, `FileInfo.plaintext`): it is
   * decrypted and encrypted whole in the page, as filex's own explorer does
   * for a file of this size.
   */
  maxEncryptedBytes: 209715200
};
function k(n) {
  return !!n && typeof n == "object" && n.type === S && typeof n.v == "number";
}
function L(n) {
  return !!n && typeof n == "object" && n.type === M;
}
function A(n) {
  return !!n && typeof n == "object" && typeof n.id == "number" && typeof n.method == "string";
}
function I(n) {
  return E.includes(n);
}
class m extends Error {
  constructor(u) {
    super(u.message || u.code), this.name = "FilexError", this.code = u.code;
  }
}
let h = null;
function P(n = {}) {
  return h || (h = O(n)), h;
}
function O(n) {
  return new Promise((u, p) => {
    if (typeof window > "u" || window.parent === window) {
      p(new m({ code: "unavailable", message: "not running inside filex" }));
      return;
    }
    const o = window.parent, l = R(), a = setTimeout(() => {
      window.removeEventListener("message", g), p(new m({ code: "unavailable", message: "filex did not answer" }));
    }, n.timeoutMs ?? x.connectTimeoutMs);
    function g(y) {
      if (y.source !== o || !L(y.data) || !y.ports[0] || l && y.origin !== l) return;
      window.removeEventListener("message", g), clearTimeout(a);
      const r = y.ports[0], c = T(r, n);
      c.request("session.get").then((f) => {
        c.session = f, n.applyTheme !== !1 && (v(f.theme, f.locale, f.dir), c.on("theme", (d) => v(d)), c.on("locale", (d) => {
          const e = d;
          v(void 0, e.locale, e.dir);
        })), u(c);
      }).catch(p);
    }
    window.addEventListener("message", g), o.postMessage({ type: S, v: 1 }, "*");
  });
}
function R() {
  try {
    const n = window.location.ancestorOrigins;
    if (n && n.length > 0 && n[0] !== "null") return n[0];
  } catch {
  }
  return "";
}
function T(n, u) {
  let p = 0;
  const o = /* @__PURE__ */ new Map(), l = /* @__PURE__ */ new Map();
  let a = null;
  n.onmessage = (e) => {
    const t = e.data;
    if (!(!t || typeof t != "object")) {
      if (typeof t.id == "number") {
        const s = o.get(t.id);
        if (!s) return;
        o.delete(t.id), t.error ? s.reject(new m(t.error)) : s.resolve(t.result);
        return;
      }
      if (typeof t.hid == "number") {
        g(t);
        return;
      }
      if (typeof t.event == "string")
        for (const s of l.get(t.event) ?? [])
          try {
            s(t.data);
          } catch (i) {
            console.error("[filex-app-ui] listener failed", i);
          }
    }
  };
  async function g(e) {
    if (e.request === "save") {
      if (!a) {
        n.postMessage({ hid: e.hid, error: { code: "unavailable", message: "this app has no save handler" } });
        return;
      }
      try {
        const t = await y();
        n.postMessage({ hid: e.hid, result: t ?? { saved: !0 } });
      } catch (t) {
        const s = t instanceof m ? { code: t.code, message: t.message } : { code: "failed", message: String(t?.message ?? t) };
        n.postMessage({ hid: e.hid, error: s });
      }
      return;
    }
    n.postMessage({ hid: e.hid, error: { code: "unknown_method" } });
  }
  async function y() {
    if (!a) return null;
    const e = await a();
    return e == null ? null : d.save(e);
  }
  function r(e, t, s = []) {
    const i = ++p;
    return new Promise((b, w) => {
      o.set(i, { resolve: b, reject: w });
      try {
        n.postMessage({ id: i, method: e, params: t }, s);
      } catch (B) {
        o.delete(i), w(B);
      }
    });
  }
  function c(e, t) {
    r(e, t).catch((s) => console.warn("[filex-app-ui]", e, s));
  }
  async function f(e) {
    if (typeof e == "string") return { data: e, transfer: [] };
    if (e instanceof ArrayBuffer) return { data: e, transfer: [e] };
    if (ArrayBuffer.isView(e)) {
      const t = e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength);
      return { data: t, transfer: [t] };
    }
    if (typeof Blob < "u" && e instanceof Blob) {
      const t = await e.arrayBuffer();
      return { data: t, transfer: [t] };
    }
    if (typeof ReadableStream < "u" && e instanceof ReadableStream)
      return { data: e, transfer: [e] };
    throw new m({ code: "invalid", message: "save takes a string, a Blob, bytes or a ReadableStream" });
  }
  const d = {
    session: void 0,
    async open(e = 0) {
      const t = d.session?.files?.[e];
      if (!t) throw new m({ code: "not_found", message: `no file at ${e}` });
      const s = (i, b) => r("file.read", { index: e, as: i }).then((w) => w[b]);
      return {
        ...t,
        text: () => s("text", "text"),
        bytes: () => s("bytes", "bytes"),
        stream: () => s("stream", "stream"),
        read: (i = "bytes") => r("file.read", { index: e, as: i }),
        save: (i, b) => d.save(i, { index: e, mime: b })
      };
    },
    async save(e, t = {}) {
      const s = await f(e), i = { index: t.index ?? 0, data: s.data, mime: t.mime };
      return typeof t.through == "number" && (i.through = t.through), t.csv && (i.csv = { ...t.csv }), t.beside && (i.beside = t.beside), t.conflict && (i.conflict = t.conflict), r("file.save", i, s.transfer);
    },
    async saveAs(e, t, s) {
      const i = await f(t);
      return r("file.saveAs", { name: e, data: i.data, mime: s }, i.transfer);
    },
    async download(e, t, s) {
      const i = await f(t);
      return r("ui.download", { name: e, data: i.data, mime: s }, i.transfer);
    },
    async print(e, t) {
      const s = await f(t);
      return r("ui.print", { name: e, data: s.data, mime: "application/pdf" }, s.transfer);
    },
    coedit: {
      join(e = 0) {
        return r("coedit.join", { index: e });
      },
      subscribe(e) {
        return r("coedit.subscribe", { from: e });
      },
      append(e, t) {
        return r("coedit.append", { kind: e, body: t });
      },
      async lease(e, t) {
        return !!(await r("coedit.lease", { op: e, changesSeen: t }))?.granted;
      },
      cursor(e) {
        c("coedit.cursor", { cursor: e });
      },
      async putBlob(e, t) {
        const s = await f(t);
        if (!(s.data instanceof ArrayBuffer)) throw new m({ code: "invalid", message: "a blob is bytes" });
        await r("coedit.blob.put", { name: e, data: s.data }, s.transfer);
      },
      async getBlob(e) {
        return (await r("coedit.blob.get", { name: e })).bytes;
      },
      async leave() {
        await r("coedit.leave");
      }
    },
    dirty(e) {
      c("ui.dirty", { dirty: !!e });
    },
    title(e) {
      c("ui.title", { text: String(e).slice(0, x.maxLineChars) });
    },
    toast(e, t) {
      c("ui.toast", { text: String(e).slice(0, x.maxLineChars), tone: t });
    },
    confirm(e) {
      return r("ui.confirm", typeof e == "string" ? { text: e } : e);
    },
    close() {
      c("ui.close");
    },
    copy(e) {
      return r("clipboard.write", { text: String(e) });
    },
    call(e, t) {
      return r("engine.call", { method: e, params: t });
    },
    submit(e, t) {
      return r("job.submit", { action: e, params: t });
    },
    state: {
      get(e) {
        return r("state.get", { key: e });
      },
      set(e, t) {
        return r("state.set", { key: e, value: t });
      }
    },
    license: {
      get() {
        return r("license.get");
      }
    },
    on(e, t) {
      let s = l.get(e);
      return s || l.set(e, s = /* @__PURE__ */ new Set()), s.add(t), () => s.delete(t);
    },
    onSave(e) {
      return a = e, () => {
        a === e && (a = null);
      };
    },
    request: r
  };
  return u.saveShortcut !== !1 && typeof document < "u" && document.addEventListener(
    "keydown",
    (e) => {
      (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "S") && a && (e.preventDefault(), y().catch((t) => d.toast(String(t?.message ?? t), "error")));
    },
    !0
  ), d;
}
function v(n, u, p) {
  if (typeof document > "u") return;
  const o = document.documentElement;
  if (n) {
    o.dataset.theme = n.mode, o.style.colorScheme = n.mode;
    for (const [l, a] of Object.entries(n.tokens ?? {}))
      /^--fe-[a-z0-9-]+$/.test(l) && typeof a == "string" && o.style.setProperty(l, a);
  }
  u && (o.lang = u), p && (o.dir = p);
}
export {
  j as BRIDGE_VERSION,
  m as FilexError,
  S as HELLO,
  x as LIMITS,
  E as METHODS,
  M as PORT,
  P as connect,
  k as isHello,
  I as isKnownMethod,
  L as isPortMessage,
  A as isRequest
};
//# sourceMappingURL=filex-app-ui.js.map
