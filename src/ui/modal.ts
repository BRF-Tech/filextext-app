// In-frame dialogs. Drawn by the app itself (not filex's ui.confirm) because
// several of them hold passwords, which must never leave the frame.

import { t } from '../i18n';
import { h } from './dom';

export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Return false (or a promise of false) to keep the dialog open. */
  run?: () => boolean | void | Promise<boolean | void>;
  testid?: string;
}

export interface ModalHandle {
  close(): void;
  el: HTMLElement;
  setBusy(busy: boolean): void;
  setError(msg: string | null): void;
}

export function modal(opts: {
  title: string;
  body: (Node | string)[];
  actions: ModalAction[];
  dismissible?: boolean;
  testid?: string;
  onClose?: () => void;
}): ModalHandle {
  const root = document.getElementById('modal-root') ?? document.body;
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const buttons = opts.actions.map((a) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn${a.primary ? ' btn-primary' : ''}${a.danger ? ' btn-danger' : ''}`,
        'data-testid': a.testid,
      },
      a.label,
    ),
  );
  // Not a <form>: a sandboxed frame without allow-forms blocks a form
  // submission before its submit event fires (see screens.ts formWith).
  const form = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title, 'data-testid': opts.testid },
    h('h2', { class: 'modal-title' }, opts.title),
    h('div', { class: 'modal-body' }, ...opts.body),
    err,
    h('div', { class: 'modal-actions' }, ...buttons),
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, form);
  let closed = false;
  const handle: ModalHandle = {
    el: form,
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      opts.onClose?.();
    },
    setBusy(busy) {
      for (const b of buttons) b.disabled = busy;
      form.classList.toggle('busy', busy);
    },
    setError(msg) {
      err.textContent = msg ?? '';
      err.hidden = !msg;
    },
  };
  const runAction = async (a: ModalAction) => {
    handle.setError(null);
    if (!a.run) {
      handle.close();
      return;
    }
    handle.setBusy(true);
    try {
      const keep = await a.run();
      if (keep !== false) handle.close();
    } catch (e) {
      handle.setError(String((e as Error)?.message ?? e));
    } finally {
      if (!closed) handle.setBusy(false);
    }
  };
  opts.actions.forEach((a, i) => buttons[i].addEventListener('click', () => void runAction(a)));
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || (e.target as HTMLElement).tagName !== 'INPUT') return;
    const a = opts.actions.find((x) => x.primary);
    if (!a) return;
    e.preventDefault();
    void runAction(a);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissible !== false) {
      e.stopPropagation();
      handle.close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  if (opts.dismissible !== false) {
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) handle.close();
    });
  }
  root.append(backdrop);
  queueMicrotask(() => {
    const first = form.querySelector<HTMLElement>('input, textarea, select, button.btn-primary, button');
    first?.focus();
  });
  return handle;
}

export function confirmDialog(text: string, opts: { danger?: boolean; confirm?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title: text,
      body: [],
      testid: 'confirm-dialog',
      actions: [
        { label: t('cancel'), run: () => void (answered = true, resolve(false)) },
        {
          label: opts.confirm ?? t('ok'),
          primary: true,
          danger: opts.danger,
          testid: 'confirm-ok',
          run: () => void (answered = true, resolve(true)),
        },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

export function promptDialog(title: string, label: string, value: string, testid = 'prompt-dialog'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', class: 'input', value, 'aria-label': label, 'data-testid': 'prompt-input', maxlength: 200 });
    let answered = false;
    const m = modal({
      title,
      testid,
      body: [h('label', { class: 'field' }, h('span', {}, label), input)],
      actions: [
        { label: t('cancel'), run: () => void (answered = true, resolve(null)) },
        {
          label: t('ok'),
          primary: true,
          testid: 'prompt-ok',
          run: () => {
            const v = (input as HTMLInputElement).value.trim();
            if (!v) return false;
            answered = true;
            resolve(v);
          },
        },
      ],
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    queueMicrotask(() => {
      (input as HTMLInputElement).focus();
      (input as HTMLInputElement).select();
    });
    void m;
  });
}
