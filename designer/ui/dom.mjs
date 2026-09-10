// Small DOM helpers. No framework — the designer is loaded as plain ES modules
// straight from the static site, exactly like the rest of the NAC tool.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// `remove()` rather than `removeChild()`: a re-render triggered from a blur or
// change handler can run while the browser has already moved the node, and
// removeChild throws in that case where remove() simply does nothing.
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
export const mount = (el, ...children) => { clear(el); children.flat(4).filter(Boolean).forEach(c => el.appendChild(c)); return el; };

export const money = (n) => n === null || n === undefined
  ? '—' : '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const num = (n, dp = 1) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(dp);
export const int = (n) => n === null || n === undefined || !isFinite(n) ? '—' : String(Math.round(n));

/** A labelled card — the standard container across the designer. */
export function card(title, subtitle, ...body) {
  return h('section', { class: 'card' },
    title ? h('div', { class: 'card-head' },
      h('h3', {}, title),
      subtitle ? h('p', { class: 'card-sub' }, subtitle) : null) : null,
    h('div', { class: 'card-body' }, ...body));
}

/** An editable table. `cols` = [{ key, label, align, edit, format, width }]. */
export function table(cols, rows, opts = {}) {
  const t = h('table', { class: 'tbl' + (opts.compact ? ' compact' : '') },
    h('thead', {}, h('tr', {}, cols.map(c =>
      h('th', { style: { textAlign: c.align || 'left', width: c.width || '' } }, c.label)))),
    h('tbody', {}, rows.map((row, i) =>
      h('tr', {
        class: (opts.rowClass ? opts.rowClass(row) : '') + (opts.selectedId === row.id ? ' sel' : ''),
        onclick: opts.onRowClick ? () => opts.onRowClick(row, i) : null
      }, cols.map(c => {
        const raw = row[c.key];
        const value = c.format ? c.format(raw, row, i) : (raw === null || raw === undefined ? '—' : raw);
        if (c.edit) {
          return h('td', { style: { textAlign: c.align || 'left' } },
            h('input', {
              class: 'cell-input', type: c.inputType || 'text', value: raw ?? '',
              placeholder: c.placeholder || '',
              onchange: (e) => c.edit(row, e.target.value, i),
              onclick: (e) => e.stopPropagation()
            }));
        }
        if (c.render) return h('td', { style: { textAlign: c.align || 'left' } }, c.render(row, i));
        return h('td', { style: { textAlign: c.align || 'left' } }, value);
      })))));
  return h('div', { class: 'tbl-wrap' }, t);
}

export function badge(text, kind = '') {
  return h('span', { class: 'badge ' + kind }, text);
}

export function confidenceBadge(score, band) {
  const kind = band === 'HIGH' ? 'ok' : band === 'MEDIUM' ? 'warn' : 'bad';
  return badge((score === null || score === undefined ? '—' : Math.round(score) + '%') + ' ' + (band || ''), kind);
}

export function severityBadge(sev) {
  const kind = sev === 'CRITICAL' ? 'bad' : sev === 'WARNING' ? 'warn' : sev === 'CHECK' ? 'check' : 'info';
  return badge(sev, kind);
}

export function field(label, control, hint) {
  return h('div', { class: 'field' },
    h('label', {}, label),
    control,
    hint ? h('div', { class: 'hint' }, hint) : null);
}

export function input(value, onchange, opts = {}) {
  const el = h('input', {
    class: 'inp', type: opts.type || 'text', value: value ?? '', placeholder: opts.placeholder || '',
    step: opts.step, min: opts.min, max: opts.max, inputmode: opts.inputmode,
    onchange: (e) => onchange(e.target.value)
  });
  // `change` only fires on blur. Where the very next tap acts on the value
  // (iPad Safari does not always blur a text field before a button's click
  // handler runs) the field must report every keystroke instead.
  if (opts.live) el.addEventListener('input', (e) => onchange(e.target.value));
  return el;
}

export function select(value, options, onchange) {
  return h('select', { class: 'inp', onchange: (e) => onchange(e.target.value) },
    options.map(o => {
      const val = typeof o === 'string' ? o : o.value;
      const lab = typeof o === 'string' ? o : o.label;
      return h('option', { value: val, selected: String(val) === String(value) }, lab);
    }));
}

export function checkbox(checked, label, onchange) {
  return h('label', { class: 'chk' },
    h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) }),
    h('span', {}, label));
}

export function button(label, onclick, kind = '') {
  return h('button', { class: 'btn ' + kind, onclick, type: 'button' }, label);
}

/** Progressive disclosure: a collapsed panel of engineering detail. */
export function expandable(summaryText, buildBody, open = false) {
  const det = h('details', { class: 'exp', open });
  det.appendChild(h('summary', {}, summaryText));
  let built = false;
  const body = h('div', { class: 'exp-body' });
  det.appendChild(body);
  const build = () => { if (!built) { built = true; mount(body, buildBody()); } };
  if (open) build();
  det.addEventListener('toggle', () => { if (det.open) build(); });
  return det;
}

export function banner(kind, text, actions) {
  return h('div', { class: 'banner ' + kind },
    h('div', { class: 'banner-text' }, text),
    actions ? h('div', { class: 'banner-actions' }, actions) : null);
}

export function empty(text) { return h('div', { class: 'empty' }, text); }

export function toast(text, kind = '') {
  let host = document.querySelector('.toast-host');
  if (!host) { host = h('div', { class: 'toast-host' }); document.body.appendChild(host); }
  const t = h('div', { class: 'toast ' + kind }, text);
  host.appendChild(t);
  // Keep the stack short — an estimator does not need a wall of them.
  while (host.children.length > 4) host.removeChild(host.firstChild);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3200);
}
