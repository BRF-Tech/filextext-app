// The screens before the workspace: create, recovery key (shown once),
// unlock (password or recovery key), mandatory new password after a
// recovery-key unlock, and plain messages.

import { MIN_PASSWORD_LEN } from '../crypto/fxtxt';
import { t } from '../i18n';
import { copyNative, h, icon, selectContents } from './dom';

function root(): HTMLElement {
  return document.getElementById('app')!;
}

function card(testid: string, ...children: (Node | null | false)[]): HTMLElement {
  const el = h(
    'div',
    { class: 'screen' },
    h('div', { class: 'card', 'data-testid': testid }, h('div', { class: 'card-brand' }, icon('shield'), h('span', {}, t('e2eBadge'))), ...children),
  );
  root().replaceChildren(el);
  return el;
}

export function showMessage(text: string, testid = 'message'): void {
  card(testid, h('p', { class: 'message' }, text));
}

export function showLoading(): void {
  card('loading', h('p', { class: 'message muted' }, t('loading')));
}

function passwordField(label: string, testid: string, autocomplete: string): HTMLInputElement {
  return h('input', {
    type: 'password',
    class: 'input',
    autocomplete,
    'aria-label': label,
    'data-testid': testid,
    spellcheck: 'false',
  }) as HTMLInputElement;
}

function field(label: string, input: HTMLElement) {
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

/** Two new-password fields + validation. */
function newPasswordPair(l1: string, l2: string) {
  const a = passwordField(l1, 'new-password', 'new-password');
  const b = passwordField(l2, 'new-password-2', 'new-password');
  const hint = h('p', { class: 'hint' }, t('pwTooShort', { n: MIN_PASSWORD_LEN }));
  const check = (): string | null => {
    if (a.value.length < MIN_PASSWORD_LEN) return t('pwTooShort', { n: MIN_PASSWORD_LEN });
    if (a.value !== b.value) return t('pwMismatch');
    return null;
  };
  return { a, b, nodes: [field(l1, a), field(l2, b), hint], check, clear: () => ((a.value = ''), (b.value = '')) };
}

/**
 * A "form" without <form>: the frame is sandboxed without allow-forms, and
 * there a form submission is blocked BEFORE its submit event fires — Enter
 * and a submit button would silently do nothing. Enter in a field and a
 * click on the primary button call `onSubmit` instead.
 */
function formWith(testid: string, onSubmit: () => void, ...children: (Node | null | false)[]) {
  const f = h('div', { class: 'form', role: 'form', 'data-testid': testid }, ...children);
  f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      onSubmit();
    }
  });
  f.querySelector<HTMLButtonElement>('button[data-submit]')?.addEventListener('click', () => onSubmit());
  return f;
}

function busyButton(label: string, testid: string) {
  return h('button', { type: 'button', class: 'btn btn-primary btn-wide', 'data-testid': testid, 'data-submit': true }, label) as HTMLButtonElement;
}

/**
 * New workspace. `create` derives the keys and saves; it throws on failure
 * (the message is shown), resolves when done.
 */
export function showCreate(fileName: string, create: (password: string) => Promise<void>): void {
  const pw = newPasswordPair(t('password'), t('password2'));
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = busyButton(t('create'), 'create-submit');
  const submit = async () => {
    const problem = pw.check();
    err.hidden = !problem;
    err.textContent = problem ?? '';
    if (problem) return;
    btn.disabled = true;
    btn.textContent = t('deriving');
    try {
      await create(pw.a.value);
    } catch (e) {
      err.hidden = false;
      err.textContent = String((e as Error)?.message ?? e);
      btn.disabled = false;
      btn.textContent = t('create');
    }
  };
  card(
    'create-screen',
    h('h1', {}, t('createTitle')),
    h('p', { class: 'lead' }, t('createLead', { name: fileName })),
    h('p', { class: 'warn' }, t('createWarn')),
    formWith('create-form', () => void submit(), ...pw.nodes, err, btn),
  );
  pw.a.focus();
}

/**
 * The pieces of the "recovery key, shown once" panel: the key in two rows of
 * four groups (textContent stays exactly the key), Select / Copy (the frame's
 * own clipboard only — the key never goes through filex), the storage advice,
 * the "I have saved it" tick and the Continue button it unlocks.
 */
function recoveryKeyPanel(key: string, done: () => void): Node[] {
  const groups = key.split('-');
  const keyEl = h(
    'code',
    { class: 'recovery-key', 'data-testid': 'recovery-key', tabindex: '0' },
    ...groups.flatMap((g, i) => [h('span', { class: 'g' }, i < groups.length - 1 ? `${g}-` : g), i === 3 ? h('br') : null]),
  );
  const note = h('p', { class: 'hint', 'aria-live': 'polite' });
  const ack = h('input', { type: 'checkbox', 'data-testid': 'recovery-ack' }) as HTMLInputElement;
  const go = h('button', { type: 'button', class: 'btn btn-primary btn-wide', disabled: true, 'data-testid': 'recovery-continue' }, t('continue')) as HTMLButtonElement;
  ack.addEventListener('change', () => (go.disabled = !ack.checked));
  go.addEventListener('click', () => {
    if (!ack.checked) return;
    keyEl.textContent = '';
    done();
  });
  const copyBtn = h('button', { type: 'button', class: 'btn' }, t('copy'));
  copyBtn.addEventListener('click', async () => {
    const ok = await copyNative(key);
    if (!ok) selectContents(keyEl);
    note.textContent = ok ? t('copied') : t('copyFailed');
  });
  const selBtn = h('button', { type: 'button', class: 'btn' }, t('select'));
  selBtn.addEventListener('click', () => selectContents(keyEl));
  return [
    h('p', { class: 'lead' }, t('rkLead')),
    keyEl,
    h('div', { class: 'row' }, selBtn, copyBtn),
    note,
    h('p', { class: 'warn' }, t('rkStore')),
    h('label', { class: 'check' }, ack, h('span', {}, t('rkAck'))),
    go,
  ];
}

/** The recovery key, once, as a screen. Resolves after "saved" + Continue. */
export function showRecoveryKey(key: string, fresh = false): Promise<void> {
  return new Promise((resolve) => {
    card('recovery-screen', h('h1', {}, fresh ? t('rkNewTitle') : t('rkTitle')), ...recoveryKeyPanel(key, resolve));
  });
}

/**
 * The NEW recovery key after a password change, over the workspace: a dialog
 * that Escape and the backdrop do not close — there is no second showing.
 */
export function showRecoveryKeyDialog(key: string): Promise<void> {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root') ?? document.body;
    const box = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('rkNewTitle'), 'data-testid': 'recovery-dialog' },
      h('h2', { class: 'modal-title' }, t('rkNewTitle')),
    );
    const backdrop = h('div', { class: 'modal-backdrop' }, box);
    box.append(
      ...recoveryKeyPanel(key, () => {
        backdrop.remove();
        resolve();
      }),
    );
    root.append(backdrop);
  });
}

/**
 * Unlock. `tryPassword` / `tryKey` resolve true when the credential opened
 * the workspace, false when it was wrong; they throw for anything else.
 */
export function showUnlock(
  fileName: string,
  tryPassword: (password: string) => Promise<boolean>,
  tryKey: (key: string) => Promise<boolean>,
  mode: 'password' | 'key' = 'password',
): void {
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const fail = (msg: string) => {
    err.hidden = false;
    err.textContent = msg;
  };
  if (mode === 'password') {
    const pw = passwordField(t('password'), 'unlock-password', 'current-password');
    const btn = busyButton(t('open'), 'unlock-submit');
    const submit = async () => {
      if (!pw.value) return;
      btn.disabled = true;
      err.hidden = true;
      try {
        if (!(await tryPassword(pw.value))) {
          fail(t('wrongPassword'));
          pw.select();
        }
      } catch (e) {
        fail(String((e as Error)?.message ?? e));
      } finally {
        btn.disabled = false;
      }
    };
    const toKey = h('button', { type: 'button', class: 'link', 'data-testid': 'use-recovery-key' }, t('useKey'));
    toKey.addEventListener('click', () => showUnlock(fileName, tryPassword, tryKey, 'key'));
    card(
      'unlock-screen',
      h('h1', {}, icon('lock', 'ico ico-lg'), t('unlockTitle', { name: fileName })),
      h('p', { class: 'lead' }, t('unlockLead')),
      formWith('unlock-form', () => void submit(), field(t('password'), pw), err, btn),
      toKey,
    );
    pw.focus();
    return;
  }
  const key = h('input', {
    type: 'text',
    class: 'input mono',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
    'aria-label': t('recoveryKey'),
    'data-testid': 'unlock-recovery-key',
  }) as HTMLInputElement;
  const btn = busyButton(t('open'), 'unlock-key-submit');
  const submit = async () => {
    if (!key.value.trim()) return;
    btn.disabled = true;
    err.hidden = true;
    try {
      if (!(await tryKey(key.value))) fail(t('wrongKey'));
    } catch (e) {
      fail(String((e as Error)?.message ?? e));
    } finally {
      btn.disabled = false;
    }
  };
  const toPw = h('button', { type: 'button', class: 'link', 'data-testid': 'use-password' }, t('usePassword'));
  toPw.addEventListener('click', () => showUnlock(fileName, tryPassword, tryKey, 'password'));
  card(
    'unlock-key-screen',
    h('h1', {}, icon('key', 'ico ico-lg'), t('keyTitle')),
    h('p', { class: 'lead' }, t('keyLead')),
    formWith('unlock-key-form', () => void submit(), field(t('recoveryKey'), key), err, btn),
    toPw,
  );
  key.focus();
}

/** The mandatory new password after a recovery-key unlock. */
export function showReset(save: (password: string) => Promise<void>): void {
  const pw = newPasswordPair(t('newPassword'), t('newPassword2'));
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const btn = busyButton(t('saveNewPassword'), 'reset-submit');
  const submit = async () => {
    const problem = pw.check();
    err.hidden = !problem;
    err.textContent = problem ?? '';
    if (problem) return;
    btn.disabled = true;
    btn.textContent = t('deriving');
    try {
      await save(pw.a.value);
    } catch (e) {
      err.hidden = false;
      err.textContent = String((e as Error)?.message ?? e);
      btn.disabled = false;
      btn.textContent = t('saveNewPassword');
    }
  };
  card(
    'reset-screen',
    h('h1', {}, t('resetTitle')),
    h('p', { class: 'lead' }, t('resetLead')),
    formWith('reset-form', () => void submit(), ...pw.nodes, err, btn),
  );
  pw.a.focus();
}

export { newPasswordPair, passwordField, field };
