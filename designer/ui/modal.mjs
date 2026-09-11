// NAC AI HVAC DESIGNER — dialogs.
//
// WHY THIS EXISTS
//
// The designer used the browser's own prompt() and confirm(). On an iPad those
// are a single cramped line with no room for the list of rooms, revisions or
// unconfirmed prices the estimator has to read before answering — and Safari
// suppresses repeated ones entirely, so the second question in a chain can go
// unasked and the code carries on with a blank answer. Three chained prompts
// (name, then quantity, then cost) is three chances to lose the whole entry.
//
// These replace them: one sheet, everything visible, touch targets that a
// thumb can hit, Escape and a Cancel button that both mean cancel, and a real
// Promise so the calling code reads the same way it did before.
//
// Every one of them resolves — with null or false on cancel — so no caller can
// be left waiting. That matters more here than anywhere: the estimator must
// never be blocked.

import { h } from './dom.mjs';

const focusable = 'button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * The shell every dialog is built on.
 *
 * @param {Object}   opts
 * @param {string}   opts.title
 * @param {Node[]}   opts.body      rendered content
 * @param {Function} opts.buttons   (close) => Node[]  — close(value) resolves
 * @param {*}        opts.cancelValue what Escape / backdrop / Cancel resolve to
 * @returns {Promise}
 */
export function openDialog({ title, subtitle = null, body = [], buttons, cancelValue = null,
                             wide = false, onReady = null }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    let done = false;

    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      try { previouslyFocused?.focus?.(); } catch (e) { /* the node may be gone */ }
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelValue); return; }
      if (e.key !== 'Tab') return;
      // Keep the keyboard inside the dialog.
      const items = [...panel.querySelectorAll(focusable)].filter(el => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    const panel = h('div', { class: 'dlg-panel' + (wide ? ' wide' : ''), role: 'document' },
      h('div', { class: 'dlg-head' },
        h('h3', { id: 'dlg-title' }, title),
        subtitle ? h('p', { class: 'dlg-sub' }, subtitle) : null),
      h('div', { class: 'dlg-body' }, ...[body].flat(4).filter(Boolean)),
      h('div', { class: 'dlg-foot' }, ...buttons(close)));

    const host = h('div', {
      class: 'dlg-host', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title',
      // A tap on the backdrop cancels; a tap inside must not.
      onclick: (e) => { if (e.target === host) close(cancelValue); }
    }, panel);

    document.body.appendChild(host);
    document.addEventListener('keydown', onKey, true);

    const auto = panel.querySelector('input,select,textarea,button.primary') || panel.querySelector('button');
    try { auto?.focus?.(); if (auto?.select) auto.select(); } catch (e) { /* ignore */ }
    if (onReady) onReady({ panel, close });
  });
}

const btn = (label, kind, onclick) =>
  h('button', { type: 'button', class: 'dlg-btn ' + kind, onclick }, label);

/** Yes/no. Resolves true or false — never undefined. */
export function confirmDialog({ title, message = null, lines = [], confirmLabel = 'Continue',
                                cancelLabel = 'Cancel', danger = false, subtitle = null }) {
  return openDialog({
    title, subtitle, cancelValue: false,
    body: [
      message ? h('p', { class: 'dlg-text' }, message) : null,
      lines.length ? h('ul', { class: 'dlg-list' }, lines.map(l => h('li', {}, l))) : null
    ],
    buttons: (close) => [
      btn(cancelLabel, 'ghost', () => close(false)),
      btn(confirmLabel, danger ? 'danger primary' : 'primary', () => close(true))
    ]
  });
}

/** Something the estimator only has to read. Resolves when dismissed. */
export function alertDialog({ title, message = null, lines = [], okLabel = 'OK', subtitle = null }) {
  return openDialog({
    title, subtitle, cancelValue: true,
    body: [
      message ? h('p', { class: 'dlg-text' }, message) : null,
      lines.length ? h('ul', { class: 'dlg-list' }, lines.map(l => h('li', {}, l))) : null
    ],
    buttons: (close) => [btn(okLabel, 'primary', () => close(true))]
  });
}

/**
 * One form, every field at once — not a chain of prompts that can be cut short.
 *
 * fields: [{ key, label, type, value, hint, placeholder, min, step, required,
 *            options:[{value,label}] }]
 * Resolves an object of values, or null if cancelled.
 */
export function formDialog({ title, subtitle = null, message = null, fields,
                             submitLabel = 'Save', cancelLabel = 'Cancel' }) {
  const els = {};
  const body = [
    message ? h('p', { class: 'dlg-text' }, message) : null,
    ...fields.map(f => {
      let control;
      if (f.type === 'select') {
        control = h('select', { class: 'dlg-input', id: 'dlgf-' + f.key },
          (f.options || []).map(o => h('option',
            { value: o.value, selected: String(o.value) === String(f.value ?? '') }, o.label)));
      } else if (f.type === 'textarea') {
        control = h('textarea', { class: 'dlg-input dlg-ta', id: 'dlgf-' + f.key, rows: f.rows || 3,
          placeholder: f.placeholder || '' });
        control.value = f.value ?? '';
      } else {
        control = h('input', { class: 'dlg-input', id: 'dlgf-' + f.key,
          type: f.type || 'text', placeholder: f.placeholder || '',
          // A number field on iPad gets the number pad; `decimal` keeps the
          // decimal point, which `numeric` does not.
          inputmode: f.type === 'number' ? 'decimal' : (f.inputmode || null),
          min: f.min ?? null, max: f.max ?? null, step: f.step ?? null,
          autocapitalize: f.type === 'number' ? 'none' : null });
        control.value = f.value ?? '';
      }
      els[f.key] = control;
      return h('label', { class: 'dlg-field', for: 'dlgf-' + f.key },
        h('span', { class: 'dlg-label' }, f.label),
        control,
        f.hint ? h('span', { class: 'dlg-hint' }, f.hint) : null);
    })
  ];

  const read = () => Object.fromEntries(fields.map(f => {
    const raw = els[f.key].value;
    return [f.key, f.type === 'number' ? (raw === '' ? null : Number(raw)) : raw];
  }));

  return openDialog({
    title, subtitle, body, cancelValue: null,
    onReady: ({ panel, close }) => {
      // Enter submits from any single-line field, as a form would.
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); close(read()); }
      });
    },
    buttons: (close) => [
      btn(cancelLabel, 'ghost', () => close(null)),
      btn(submitLabel, 'primary', () => close(read()))
    ]
  });
}

/**
 * Choose from a list. The whole list is on screen — the point of replacing
 * "enter a number" prompts is that nobody has to count.
 *
 * options: [{ value, label, sub, meta, disabled }]
 * Resolves the chosen `value`, or null. With `multi`, an array of values.
 */
export function pickDialog({ title, subtitle = null, message = null, options,
                             multi = false, submitLabel = 'Open', cancelLabel = 'Cancel',
                             emptyText = 'Nothing to choose from.' }) {
  const chosen = new Set();

  return openDialog({
    title, subtitle, wide: true, cancelValue: null,
    body: [
      message ? h('p', { class: 'dlg-text' }, message) : null,
      options.length
        ? h('div', { class: 'dlg-options', role: multi ? 'group' : 'listbox' },
            options.map((o) => {
              const row = h('button', {
                type: 'button',
                class: 'dlg-option' + (o.disabled ? ' disabled' : ''),
                disabled: o.disabled || false,
                role: multi ? 'checkbox' : 'option',
                'aria-checked': 'false',
                onclick: () => {
                  if (multi) {
                    if (chosen.has(o.value)) { chosen.delete(o.value); row.classList.remove('on'); row.setAttribute('aria-checked', 'false'); }
                    else { chosen.add(o.value); row.classList.add('on'); row.setAttribute('aria-checked', 'true'); }
                  } else {
                    row.dispatchEvent(new CustomEvent('dlg-pick', { bubbles: true, detail: o.value }));
                  }
                }
              },
                h('span', { class: 'dlg-option-main' },
                  h('span', { class: 'dlg-option-label' }, o.label),
                  o.sub ? h('span', { class: 'dlg-option-sub' }, o.sub) : null),
                o.meta ? h('span', { class: 'dlg-option-meta' }, o.meta) : null);
              return row;
            }))
        : h('p', { class: 'dlg-text' }, emptyText)
    ],
    onReady: ({ panel, close }) => {
      if (!multi) panel.addEventListener('dlg-pick', (e) => close(e.detail));
    },
    buttons: (close) => multi
      ? [btn(cancelLabel, 'ghost', () => close(null)),
         btn(submitLabel, 'primary', () => close([...chosen]))]
      : [btn(cancelLabel, 'ghost', () => close(null))]
  });
}

/**
 * A link the estimator has to send on. prompt() was used for this so the text
 * could be selected; that is a misuse of a question box, and on iPad the text
 * is truncated. This shows it in full with a Copy button, and still allows a
 * manual select-and-copy when the clipboard API is unavailable.
 */
export function linkDialog({ title, message = null, url, okLabel = 'Done' }) {
  const field = h('input', { class: 'dlg-input dlg-link', type: 'text', readonly: true, value: url });
  const status = h('span', { class: 'dlg-hint' }, '');
  const copy = h('button', { type: 'button', class: 'dlg-btn ghost', onclick: async () => {
    field.select();
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; }
    catch (e) { try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } }
    status.textContent = ok ? 'Copied.' : 'Could not copy — the link is selected, copy it by hand.';
  } }, 'Copy link');

  return openDialog({
    title, wide: true, cancelValue: true,
    body: [
      message ? h('p', { class: 'dlg-text' }, message) : null,
      field, h('div', { class: 'dlg-linkrow' }, copy, status)
    ],
    buttons: (close) => [btn(okLabel, 'primary', () => close(true))]
  });
}
