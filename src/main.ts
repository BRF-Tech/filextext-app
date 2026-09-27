// filextext: an end-to-end encrypted text workspace for filex.
//
// Flow: connect to filex → read the opened file (encrypted bytes) →
//   empty file   → create: password → keys → save at once → recovery key once
//   .fxtxt       → unlock: password, or recovery key → mandatory new password
// → workspace (BlockSuite) → every save: snapshot → zip → encrypt → filex.
// The password, the recovery key, the keys and the plaintext stay in this
// frame; filex only ever receives encrypted bytes (see host.ts).

import './styles.css';

import {
  FxtxtError,
  createKeyBlock,
  decodeContainer,
  openBody,
  rekey,
  unlock,
  type Credential,
  type KeyBlock,
} from './crypto/fxtxt';
import { connectHost, type Host } from './host';
import { setLocale, t } from './i18n';
import { PayloadError } from './model/payload';
import { WorkspaceSession, loadEditor } from './session';
import { copyNative, h } from './ui/dom';
import { modal } from './ui/modal';
import {
  field,
  newPasswordPair,
  passwordField,
  showCreate,
  showLoading,
  showMessage,
  showRecoveryKey,
  showRecoveryKeyDialog,
  showReset,
  showUnlock,
} from './ui/screens';
import { WorkspaceUI } from './ui/workspace';

let host: Host;
let session: WorkspaceSession | null = null;
let ui: WorkspaceUI | null = null;
/** The bytes last read from or saved to filex (encrypted). */
let lastBytes: Uint8Array = new Uint8Array();
/** Re-draws the current pre-workspace screen (after a language change). */
let redraw: (() => void) | null = null;
let saving: Promise<void> | null = null;

function describe(e: unknown): string {
  if (e instanceof FxtxtError || e instanceof PayloadError) {
    if (e.code === 'not_fxtxt') return t('notFxtxt');
    if (e.code === 'unsupported') return t('unsupported');
    if (e.code === 'too_large') return t('tooLarge');
    if (e.code === 'damaged') return t('damaged');
  }
  return String((e as Error)?.message ?? e);
}

function screen(draw: () => void) {
  redraw = draw;
  draw();
}

async function boot() {
  setLocale(navigator.language);
  showLoading();
  try {
    host = await connectHost();
  } catch {
    screen(() => showMessage(t('notInFilex'), 'not-in-filex'));
    return;
  }
  setLocale(host.info.locale);
  host.on('locale', (d) => {
    setLocale((d as { locale?: string })?.locale);
    if (ui) ui.relabel();
    else redraw?.();
  });
  host.onSaveRequest(() => saveNow());
  host.on('file.changed', () => void fileChanged());
  host.title(host.info.fileName);
  void loadEditor(); // download the editor while the person types a password
  let bytes: Uint8Array;
  try {
    bytes = await host.read();
  } catch (e) {
    screen(() => showMessage(t('readError', { msg: String((e as Error)?.message ?? e) }), 'read-error'));
    return;
  }
  lastBytes = bytes;
  if (bytes.length === 0) startCreate();
  else openExisting(bytes);
}

function startCreate() {
  if (host.info.readOnly) {
    screen(() => showMessage(t('readOnlyNew'), 'read-only-new'));
    return;
  }
  screen(() =>
    showCreate(host.info.fileName, async (password) => {
      const made = await createKeyBlock(password);
      const s = await WorkspaceSession.create(made.block, made.fmk, '');
      // Written at once: from now on the file is an encrypted workspace, and
      // the recovery key about to be shown opens what is on the server.
      const file = await s.toFile();
      await host.save(file);
      lastBytes = file;
      redraw = null;
      await showRecoveryKey(made.recoveryKey);
      enter(s);
    }),
  );
}

function openExisting(bytes: Uint8Array) {
  let block: KeyBlock;
  let body: Uint8Array;
  try {
    ({ block, body } = decodeContainer(bytes));
  } catch (e) {
    screen(() => showMessage(describe(e), 'open-error'));
    return;
  }
  const wrong = (e: unknown) => e instanceof FxtxtError && e.code === 'wrong_credential';
  const tryPassword = async (password: string) => {
    let fmk: CryptoKey;
    try {
      fmk = await unlock(block, { password });
    } catch (e) {
      if (wrong(e)) return false;
      throw e;
    }
    const s = await openSession(block, fmk, body);
    if (s) enter(s);
    return true;
  };
  const tryKey = async (recoveryKey: string) => {
    let fmk: CryptoKey;
    try {
      fmk = await unlock(block, { recoveryKey });
    } catch (e) {
      if (wrong(e)) return false;
      throw e;
    }
    const s = await openSession(block, fmk, body);
    if (!s) return true;
    if (host.info.readOnly) {
      enter(s);
      host.toast(t('resetReadOnly'), 'warning');
      return true;
    }
    // Opened with the recovery key: a new password (and with it a new key
    // and a new recovery key) is not optional.
    screen(() =>
      showReset(async (newPassword) => {
        const fresh = await rekeyAndSave(s, { recoveryKey }, newPassword);
        redraw = null;
        await showRecoveryKey(fresh, true);
        enter(s);
        host.toast(t('changeDone'), 'success');
      }),
    );
    return true;
  };
  screen(() => showUnlock(host.info.fileName, tryPassword, tryKey));
}

/**
 * A password change: a new FMK, password slot and recovery key (fxtxt.rekey),
 * the workspace re-encrypted under them and saved at once — so the recovery
 * key about to be shown opens what is stored. On a failed save everything is
 * put back and nothing was shown. Answers the new recovery key.
 */
async function rekeyAndSave(s: WorkspaceSession, cred: Credential, newPassword: string): Promise<string> {
  const next = await rekey(s.block, cred, newPassword);
  const old = { block: s.block, fmk: s.fmk };
  s.block = next.block;
  s.fmk = next.fmk;
  try {
    const file = await s.toFile();
    await host.save(file);
    lastBytes = file;
  } catch (e) {
    s.block = old.block;
    s.fmk = old.fmk;
    throw new Error(t('saveFailed', { msg: describe(e) }));
  }
  return next.recoveryKey;
}

/** Decrypt + load; on a broken payload shows the error and answers null. */
async function openSession(block: KeyBlock, fmk: CryptoKey, body: Uint8Array): Promise<WorkspaceSession | null> {
  try {
    return await WorkspaceSession.open(block, fmk, body);
  } catch (e) {
    screen(() => showMessage(describe(e), 'open-error'));
    return null;
  }
}

function enter(s: WorkspaceSession) {
  redraw = null;
  session = s;
  const root = document.getElementById('app')!;
  ui = new WorkspaceUI(root, s, host.info.fileName, host.info.readOnly, {
    save: () => saveNow(),
    dirty: (on) => host.dirty(on),
    lock: () => void lockNow(),
    changePassword: () => changePasswordDialog(),
    copyOut: async (text) => {
      if (await copyNative(text)) return true;
      try {
        // The person asked for the plaintext on the clipboard; Chrome refuses
        // a sandboxed frame's own clipboard, so filex writes it (in the page,
        // never to the server).
        await host.hostCopy(text);
        return true;
      } catch {
        return false;
      }
    },
    // filex ≥ 0.48.0 with `ui:download` granted: the export dialog offers
    // Download (the person's click), otherwise only Copy.
    download: host.info.canDownload ? (name, text, mime) => host.download(name, text, mime) : null,
    toast: (text, tone) => host.toast(text, tone),
    title: (text) => host.title(text),
  });
  ui.mount();
}

async function saveNow(): Promise<void> {
  if (!session || !ui || host.info.readOnly) return;
  if (saving) return saving;
  const s = session;
  const view = ui;
  saving = (async () => {
    view.setSaving(true);
    const gen = view.changeCount();
    try {
      const file = await s.toFile();
      await host.save(file);
      lastBytes = file;
      view.markSaved(gen);
    } catch (e) {
      host.toast(t('saveFailed', { msg: describe(e) }), 'error');
      throw e;
    } finally {
      view.setSaving(false);
      saving = null;
    }
  })();
  return saving;
}

async function lockNow() {
  if (ui?.isDirty() && !host.info.readOnly) {
    try {
      await saveNow();
    } catch {
      return; // keep it open: the changes are not on the server yet
    }
  }
  ui?.destroy();
  session?.dispose();
  ui = null;
  session = null;
  host.title(host.info.fileName);
  openExisting(lastBytes);
}

function changePasswordDialog() {
  const s = session;
  if (!s || host.info.readOnly) return;
  let mode: 'password' | 'key' = 'password';
  const cur = passwordField(t('currentPassword'), 'current-password', 'current-password');
  const key = h('input', {
    type: 'text',
    class: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
    'aria-label': t('recoveryKey'),
    'data-testid': 'change-recovery-key',
  }) as HTMLInputElement;
  const curField = field(t('currentPassword'), cur);
  const keyField = field(t('recoveryKey'), key);
  keyField.hidden = true;
  const pick = (m: 'password' | 'key') => {
    mode = m;
    curField.hidden = m !== 'password';
    keyField.hidden = m !== 'key';
    pwTab.classList.toggle('on', m === 'password');
    keyTab.classList.toggle('on', m === 'key');
  };
  const pwTab = h('button', { type: 'button', class: 'seg on', 'data-testid': 'change-with-password' }, t('currentPassword'));
  const keyTab = h('button', { type: 'button', class: 'seg', 'data-testid': 'change-with-key' }, t('recoveryKey'));
  pwTab.addEventListener('click', () => pick('password'));
  keyTab.addEventListener('click', () => pick('key'));
  const pair = newPasswordPair(t('newPassword'), t('newPassword2'));
  modal({
    title: t('changePassword'),
    testid: 'change-password-dialog',
    body: [
      h('p', { class: 'hint' }, t('changeLead')),
      h('div', { class: 'segmented' }, pwTab, keyTab),
      curField,
      keyField,
      ...pair.nodes,
      h('p', { class: 'hint' }, t('changeNote')),
    ],
    actions: [
      { label: t('cancel') },
      {
        label: t('changePassword'),
        primary: true,
        testid: 'change-submit',
        run: async () => {
          const problem = pair.check();
          if (problem) throw new Error(problem);
          const cred: Credential = mode === 'password' ? { password: cur.value } : { recoveryKey: key.value };
          const gen = ui?.changeCount() ?? 0;
          let fresh: string;
          try {
            fresh = await rekeyAndSave(s, cred, pair.a.value);
          } catch (e) {
            if (e instanceof FxtxtError && e.code === 'wrong_credential') {
              throw new Error(mode === 'password' ? t('wrongPassword') : t('wrongKey'));
            }
            throw e;
          }
          ui?.markSaved(gen);
          // After this dialog closes: the new recovery key, once.
          queueMicrotask(() =>
            void showRecoveryKeyDialog(fresh).then(() => host.toast(t('changeDone'), 'success')),
          );
        },
      },
    ],
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function fileChanged() {
  if (!session || !ui) return;
  const s = session;
  let bytes: Uint8Array;
  try {
    bytes = await host.read();
  } catch {
    return;
  }
  // Our own save coming back is not a change.
  if (sameBytes(bytes, lastBytes)) return;
  host.toast(t('fileChanged'), 'warning');
  if (ui.isDirty()) return; // the person's unsaved work wins; filex keeps both versions
  try {
    const { block, body } = decodeContainer(bytes);
    // Same master key unless it was re-keyed elsewhere.
    await openBody(s.fmk, body);
    const next = await WorkspaceSession.open(block, s.fmk, body);
    ui.destroy();
    s.dispose();
    lastBytes = bytes;
    enter(next);
  } catch {
    /* keep what is open; the next save writes a new version */
  }
}

void boot();
