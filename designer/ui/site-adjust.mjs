// SITE ADJUST — the iPad mode, for a roof space and a driveway.
//
// Nick: "Add a large, touch-friendly SITE ADJUST mode intended for use on an
// iPad in the roof or at the property. It must work without opening the full
// advanced-design interface."
//
// Three things shape every decision in here:
//
//   TOUCH TARGETS ARE BIG. 56 px minimum, 12 px apart, because the person using
//   this is wearing gloves, standing on a joist, holding a torch. A 24 px
//   handle three pixels from another one is a design for a mouse.
//
//   A MODE IS ALWAYS EXPLICIT. Pan, Select, Move, Route, Add, Delete — shown,
//   named and one-tap. Dragging the plan must never move a fitting, and the
//   only reliable way to guarantee that is to make the two different modes
//   rather than different gestures.
//
//   NOTHING IS LOST. Every completed edit is written to the device before
//   anything is sent anywhere, and the sync state is on screen at all times.
//
// Recalculation happens on RELEASE, never during a drag: the engine sizes the
// whole system, and running it on every pointermove would make an iPad crawl.

import { h, mount, money, num } from './dom.mjs';
import { confirmDialog, alertDialog, formDialog, pickDialog } from './modal.mjs';
import { SITE_EDIT, CONFIRM_BEFORE, siteEdit, newSiteSession, activeEdits,
         pushEdit, canUndo, canRedo, undo, redo, applySiteEdits,
         siteEditSummary, DESIGN_STAGE } from '../engines/site-edit.mjs';
import { SYNC, saveSessionLocally, loadSessionLocally, clearSessionLocally,
         detectConflict, syncSession } from '../engines/site-store.mjs';
import { DAMPER_DIAMETERS_MM } from '../engines/zone-dampers.mjs';

/** The operating modes. One is always on, and it is always visible. */
export const SITE_MODE = Object.freeze({
  PAN: 'pan', SELECT: 'select', MOVE: 'move', ROUTE: 'route',
  ADD: 'add', DELETE: 'delete'
});

const MODE_LABEL = {
  [SITE_MODE.PAN]: 'Pan', [SITE_MODE.SELECT]: 'Select', [SITE_MODE.MOVE]: 'Move',
  [SITE_MODE.ROUTE]: 'Route', [SITE_MODE.ADD]: 'Add', [SITE_MODE.DELETE]: 'Delete'
};
const MODE_HINT = {
  [SITE_MODE.PAN]: 'Drag to move the plan. Pinch to zoom. Nothing can be moved by accident.',
  [SITE_MODE.SELECT]: 'Tap a fitting to open it.',
  [SITE_MODE.MOVE]: 'Drag a fitting to reposition it. Everything recalculates when you let go.',
  [SITE_MODE.ROUTE]: 'Tap a duct to edit its route, then drag its points.',
  [SITE_MODE.ADD]: 'Tap a duct to add a BTO or a damper; tap a room to add an outlet.',
  [SITE_MODE.DELETE]: 'Tap a component to remove it. Anything major asks first.'
};

/**
 * The Site Adjust screen.
 *
 * `host` is the app: it owns the design, the plan viewer and the recalculation,
 * because Site Adjust must produce the same design object the office screen
 * does. Nothing is modelled twice.
 */
export function createSiteAdjust(host) {
  let mode = SITE_MODE.SELECT;
  let selected = null;                            // { kind, id, component }
  let session = newSiteSession({ by: host.userName?.() || null });
  let syncState = SYNC.SYNCED;
  let syncNote = '';
  let conflict = null;
  const root = h('div', { class: 'site-adjust' });

  const designId = () => host.design?.id || null;
  const by = () => host.userName?.() || 'site';

  // ── PERSISTENCE ─────────────────────────────────────────────────────────
  //
  // After EVERY completed edit, and before anything is sent. The banner tells
  // the truth about what actually landed — "Saved locally" is never shown for a
  // write that failed.
  function persist() {
    const r = saveSessionLocally(designId(), session,
      { baseUpdatedAt: host.design?.updatedAt || null });
    if (!r.ok) {
      syncState = SYNC.FAILED;
      syncNote = 'This iPad would not accept a local save (private browsing, or ' +
                 'storage is full). Do not close this tab — sync now.';
    } else if (syncState !== SYNC.SYNCING) {
      syncState = SYNC.LOCAL;
      syncNote = activeEdits(session).length + ' edit(s) held on this iPad.';
    }
    return r;
  }

  /** Re-apply the whole edit log to the approved design and recalculate. */
  function recalc() {
    const base = host.baseDesign ? host.baseDesign() : host.design;
    const patched = applySiteEdits(base, activeEdits(session));
    host.applySiteDesign(patched);
  }

  /** One completed edit: record it, save it, recalculate, redraw. */
  function commit(edit) {
    session = pushEdit(session, edit);
    persist();
    recalc();
    render();
  }

  // ── THE MODE BAR ────────────────────────────────────────────────────────
  function modeBar() {
    return h('div', { class: 'sa-modes' },
      Object.values(SITE_MODE).map(m =>
        h('button', {
          class: 'sa-mode' + (m === mode ? ' on' : ''),
          type: 'button',
          onclick: () => { mode = m; selected = null; host.setSiteMode?.(m); render(); }
        }, MODE_LABEL[m])));
  }

  function historyBar() {
    return h('div', { class: 'sa-history' },
      h('button', { class: 'sa-btn', type: 'button', disabled: !canUndo(session),
        onclick: () => { session = undo(session); persist(); recalc(); render(); } }, '↶ Undo'),
      h('button', { class: 'sa-btn', type: 'button', disabled: !canRedo(session),
        onclick: () => { session = redo(session); persist(); recalc(); render(); } }, '↷ Redo'),
      h('span', { class: 'sa-count' },
        activeEdits(session).length + ' site edit' +
        (activeEdits(session).length === 1 ? '' : 's')));
  }

  function syncBar() {
    const cls = syncState === SYNC.SYNCED ? 'ok'
      : syncState === SYNC.FAILED || syncState === SYNC.CONFLICT ? 'bad' : 'warn';
    return h('div', { class: 'sa-sync ' + cls },
      h('strong', {}, syncState),
      syncNote ? h('span', {}, syncNote) : null,
      h('button', { class: 'sa-btn', type: 'button', onclick: doSync }, 'Sync now'));
  }

  async function doSync() {
    const record = loadSessionLocally(designId()) ||
      saveSessionLocally(designId(), session,
        { baseUpdatedAt: host.design?.updatedAt || null }).record;
    const c = detectConflict(record, host.serverUpdatedAt?.() || null);
    if (c.conflict) {
      conflict = c;
      syncState = SYNC.CONFLICT;
      syncNote = c.message;
      render();
      return;
    }
    syncState = SYNC.SYNCING; syncNote = ''; render();
    const r = await syncSession(designId(), record, (rec) => host.pushSiteSession(rec));
    syncState = r.state;
    syncNote = r.message || (r.state === SYNC.SYNCED ? r.edits + ' edit(s) sent.' : '');
    if (r.state === SYNC.SYNCED) session = { ...session, syncState: 'synced' };
    render();
  }

  // ── THE BOTTOM SHEET ────────────────────────────────────────────────────
  //
  // Everything an installer can change about the thing they just tapped, with
  // every number they need to decide, on one screen they do not have to scroll
  // sideways. A row is a 56 px target.
  const sheetRow = (label, value) =>
    h('div', { class: 'sa-row' }, h('span', { class: 'k' }, label),
      h('span', { class: 'v' }, value === null || value === undefined ? '—' : String(value)));

  const action = (label, onclick, kind = '') =>
    h('button', { class: 'sa-action ' + kind, type: 'button', onclick }, label);

  function btoSheet(spec) {
    const ports = spec.ports || [];
    return h('div', { class: 'sa-sheet' },
      h('div', { class: 'sa-sheet-head' },
        h('h2', {}, spec.label), h('span', { class: 'sa-chip' }, spec.shapeText),
        h('button', { class: 'sa-close', type: 'button',
                      onclick: () => { selected = null; render(); } }, '✕')),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Inlet duct', spec.fedBy || '—'),
        sheetRow('Inlet diameter', 'ø' + spec.inletDiameterMm),
        sheetRow('Inlet airflow', spec.inletAirflowLs + ' L/s'),
        sheetRow('Body', spec.bodyText || '—'),
        sheetRow('Dimensions', spec.dimensionsVerified ? 'Verified' : 'DERIVED — review required'),
        sheetRow('Fabrication', spec.fabricationStatus),
        sheetRow('Configuration key', spec.configKey),
        sheetRow('Price', spec.priceStatus === 'VERIFIED'
          ? money(spec.price?.cost) + (spec.price?.quoteRef ? ' · ' + spec.price.quoteRef : '')
          : spec.priceStatus),
        sheetRow('Fabricator quote', spec.price?.quoteRef || '—'),
        h('h3', {}, 'Outlet collars'),
        h('div', { class: 'sa-ports' }, ports.map(p =>
          h('div', { class: 'sa-port' },
            h('div', { class: 'sa-port-head' }, 'Port ' + p.index + ' · ø' + p.diameterMm),
            h('div', { class: 'sa-port-sub' },
              (p.destination || 'NOT CONNECTED') + ' · ' + (p.airflowLs ?? '—') + ' L/s' +
              (p.zone ? ' · ' + p.zone : '')),
            h('div', { class: 'sa-port-actions' },
              action('Change size', () => changePortSize(spec, p)),
              action('Change destination', () => changePortDestination(spec, p)),
              action('Remove port', () => removePort(spec, p), 'danger'))))),
        h('div', { class: 'sa-actions' },
          action('Move fitting', () => { mode = SITE_MODE.MOVE; render(); }),
          action('Add port', () => addPort(spec)),
          action('Edit body dimensions', () => editBody(spec)),
          action('Mark for fabrication review', () => markForReview(spec)),
          action('Enter fabricator price', () => enterPrice(spec)),
          action('Delete fitting', () => deleteBto(spec), 'danger'))));
  }

  function damperSheet(d) {
    return h('div', { class: 'sa-sheet' },
      h('div', { class: 'sa-sheet-head' },
        h('h2', {}, 'ZM-' + d.motorNumber),
        h('span', { class: 'sa-chip' }, 'ø' + d.diameterMm + ' · ' + d.actuator),
        h('button', { class: 'sa-close', type: 'button',
                      onclick: () => { selected = null; render(); } }, '✕')),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Zone controlled', d.zone),
        sheetRow('Duct section', d.sectionLabel || d.sectionId),
        sheetRow('Connected duct', 'ø' + d.ductDiameterMm),
        sheetRow('Damper diameter', 'ø' + d.diameterMm +
          (d.sizeLockedToDuct ? ' (locked to the duct)' : ' (overridden)')),
        sheetRow('Airflow', d.airflowLs + ' L/s'),
        sheetRow('Velocity', num(d.velocityMs, 2) + ' m/s'),
        sheetRow('Actuator', d.actuator),
        sheetRow('SKU', d.supplierCode || '—'),
        sheetRow('Supplier', d.supplier || '—'),
        sheetRow('Supplier cost', money(d.unitCost)),
        sheetRow('Effective date', d.effectiveDate || '—'),
        sheetRow('Price status', d.priceStatus),
        d.sizeMismatch
          ? h('p', { class: 'sa-bad' }, d.mismatchMessage) : null,
        h('p', { class: 'sa-note' },
          'The damper is the size of the duct it is fitted in. Change the duct size and ' +
          'the damper, its symbol, this schedule, its part number and its price all follow.'),
        h('div', { class: 'sa-actions' },
          action('Move damper', () => { mode = SITE_MODE.MOVE; render(); }),
          action('Change zone', () => changeDamperZone(d)),
          action('Change duct size', () => changeDuctSize(d)),
          action('Delete damper', () => deleteDamper(d), 'danger'))));
  }

  // ── EDIT ACTIONS ────────────────────────────────────────────────────────
  async function changeDuctSize(d) {
    const picked = await pickDialog({
      title: 'Duct size for ' + (d.sectionLabel || d.sectionId),
      message: 'The motorised damper follows the duct. Changing this changes the damper, ' +
               'its part number, the schedule, the bill of materials and the price.',
      submitLabel: 'Change duct size',
      options: DAMPER_DIAMETERS_MM.map(mm => ({ value: mm, label: 'ø' + mm + ' duct' }))
    });
    if (!picked) return;
    commit(siteEdit({
      type: SITE_EDIT.SET_DUCT_DIAMETER, target: d.sectionId,
      label: d.sectionLabel || d.sectionId,
      before: { diameterMm: d.ductDiameterMm }, after: { diameterMm: Number(picked) },
      by: by(), reason: 'Site adjust — duct size'
    }));
  }

  async function changeDamperZone(d) {
    const zones = (host.design?.zones?.zones || []).map(z => ({ value: z.name, label: z.name }));
    const picked = await pickDialog({ title: 'Zone for ZM-' + d.motorNumber,
                                      submitLabel: 'Assign zone', options: zones });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.SET_DAMPER_ZONE, target: d.id, label: 'ZM-' + d.motorNumber,
      before: { zone: d.zone }, after: { zone: picked }, by: by() }));
  }

  async function deleteDamper(d) {
    if (!await confirmDialog({ title: 'Remove ZM-' + d.motorNumber + '?',
      message: 'The zone it controls will have no motorised damper. The BOM and the price ' +
               'change with it.', confirmLabel: 'Remove' })) return;
    selected = null;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_DAMPER, target: d.id,
      label: 'ZM-' + d.motorNumber, before: { zone: d.zone, diameterMm: d.diameterMm },
      after: { removed: true }, by: by() }));
  }

  async function changePortSize(spec, p) {
    const min = host.design?.designRules?.minimumSupplyBranchDiameterMm || 0;
    const options = DAMPER_DIAMETERS_MM.filter(mm => mm >= min && mm <= spec.inletDiameterMm)
      .map(mm => ({ value: mm, label: 'ø' + mm }));
    const picked = await pickDialog({
      title: spec.label + ' · port ' + p.index,
      message: 'This job’s minimum supply branch is ø' + min + '. A collar cannot be ' +
               'larger than the ø' + spec.inletDiameterMm + ' inlet feeding it.',
      submitLabel: 'Change collar size', options });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_PORT_SIZE, target: spec.id,
      label: spec.label + ' port ' + p.index,
      before: { portIndex: p.index, diameterMm: p.diameterMm },
      after: { portIndex: p.index, diameterMm: Number(picked) }, by: by() }));
  }

  async function changePortDestination(spec, p) {
    const options = (host.outletChoices?.() || []).map(o => ({ value: o.id, label: o.label }));
    const picked = await pickDialog({ title: 'Destination for port ' + p.index,
                                      submitLabel: 'Connect', options });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_PORT_DESTINATION, target: spec.id,
      label: spec.label + ' port ' + p.index,
      before: { portIndex: p.index, destination: p.destination },
      after: { portIndex: p.index, destination: picked }, by: by() }));
  }

  async function addPort(spec) {
    commit(siteEdit({ type: SITE_EDIT.ADD_BTO_PORT, target: spec.id, label: spec.label,
      before: { portCount: spec.outletCollarCount },
      after: { portCount: spec.outletCollarCount + 1 }, by: by() }));
  }

  async function removePort(spec, p) {
    if (!await confirmDialog({ title: 'Remove port ' + p.index + '?',
      message: 'It serves ' + (p.destination || 'nothing') + '. That outlet will need ' +
               'another feed before the design can be approved.', confirmLabel: 'Remove' })) return;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_BTO_PORT, target: spec.id, label: spec.label,
      before: { portCount: spec.outletCollarCount, port: p },
      after: { portCount: spec.outletCollarCount - 1 }, by: by() }));
  }

  async function editBody(spec) {
    const got = await formDialog({
      title: spec.label + ' \u2014 fabricated body',
      message: 'Entering a real body IS the verification: it stops being derived and stops ' +
               'needing a fabrication review.',
      submitLabel: 'Save body size',
      fields: [{ key: 'len', label: 'Body length (mm)', type: 'number',
                 value: spec.bodyLengthMm || '' },
               { key: 'dep', label: 'Body depth (mm)', type: 'number',
                 value: spec.bodyDepthMm || '' }] });
    if (!got) return;
    const len = got.len, dep = got.dep;
    if (!len || !dep) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_BODY, target: spec.id, label: spec.label,
      before: { bodyLengthMm: spec.bodyLengthMm, bodyDepthMm: spec.bodyDepthMm },
      after: { bodyLengthMm: Number(len), bodyDepthMm: Number(dep) },
      by: by(), reason: 'Confirmed against the fabricator’s body' }));
  }

  async function markForReview(spec) {
    const got = await formDialog({
      title: 'Mark ' + spec.label + ' for fabrication review',
      message: 'What does the shop need to look at?',
      submitLabel: 'Mark for review',
      fields: [{ key: 'why', label: 'Note for the fabricator', type: 'textarea' }] });
    if (!got) return;
    const why = got.why;
    commit(siteEdit({ type: SITE_EDIT.ADD_NOTE, target: spec.id, label: spec.label,
      after: { text: 'FABRICATION REVIEW — ' + (why || 'confirm body and collar layout') },
      by: by() }));
  }

  async function enterPrice(spec) {
    const got = await formDialog({
      title: 'Fabricator price — ' + spec.configKey,
      message: 'This price applies to this EXACT configuration only. It is never used for ' +
               'another one, however similar it looks.',
      submitLabel: 'Save price',
      fields: [{ key: 'cost', label: 'Cost (ex GST)', type: 'number' },
               { key: 'ref', label: 'Fabricator quote reference' },
               { key: 'supplier', label: 'Fabricator' }] });
    if (!got) return;
    const cost = got.cost, ref = got.ref;
    if (!cost) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_PRICE, target: spec.id, label: spec.label,
      before: { cost: spec.price?.cost ?? null },
      after: { configKey: spec.configKey,
               rate: { cost: Number(cost), quoteRef: ref || null,
                       supplier: got.supplier || null, verified: !!ref,
                       effectiveDate: new Date().toISOString().slice(0, 10) } },
      by: by(), reason: 'Fabricator quote' }));
  }

  async function deleteBto(spec) {
    if (!await confirmDialog({ title: 'Delete ' + spec.label + '?',
      message: 'Every duct it feeds loses its connection and the design cannot be approved ' +
               'until they are re-routed.', confirmLabel: 'Delete fitting' })) return;
    selected = null;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_BTO, target: spec.id, label: spec.label,
      before: { shapeText: spec.shapeText }, after: { removed: true }, by: by() }));
  }

  // ── AS-INSTALLED REVISION ───────────────────────────────────────────────
  async function saveRevision() {
    const edits = activeEdits(session);
    if (!edits.length) {
      await alertDialog({ title: 'Nothing to save',
                          message: 'No site edits have been made yet.' });
      return;
    }
    const got = await formDialog({
      title: 'Save as-installed revision',
      message: 'The approved design is not touched. This is saved beside it, so the two can ' +
               'be compared component by component.',
      submitLabel: 'Save revision',
      fields: [{ key: 'reason', label: 'Why did the installation differ?', type: 'textarea' }] });
    if (!got) return;
    const reason = got.reason;
    host.saveAsInstalled({
      by: by(), reason: reason || '',
      changes: siteEditSummary(edits),
      stage: DESIGN_STAGE.AS_INSTALLED
    });
    session = { ...session, syncState: 'pending' };
    persist();
    render();
  }

  // ── RENDER ──────────────────────────────────────────────────────────────
  function render() {
    const d = host.design || {};
    const gate = d.quoteGate;
    // The canvas gives the sheet its room through this class, so the plan is
    // never simply hidden behind whatever the installer just tapped.
    root.className = 'site-adjust' + (selected ? ' has-sheet' : '');
    mount(root,
      h('div', { class: 'sa-top' },
        h('div', { class: 'sa-title' },
          h('strong', {}, 'SITE ADJUST'),
          h('span', {}, d.customer?.address || d.job?.description || 'Current design')),
        h('button', { class: 'sa-btn big', type: 'button',
                      onclick: () => host.closeSiteAdjust() }, 'Done')),
      modeBar(),
      h('p', { class: 'sa-hint' }, MODE_HINT[mode]),
      syncBar(),
      conflict ? h('div', { class: 'sa-conflict' },
        h('strong', {}, 'Conflict'), h('span', {}, conflict.message),
        h('button', { class: 'sa-btn', type: 'button',
          onclick: () => { conflict = null; syncState = SYNC.LOCAL; render(); } },
          'Keep my site edits')) : null,
      historyBar(),
      h('div', { class: 'sa-canvas' }, host.viewerHost?.() || h('div')),
      h('div', { class: 'sa-foot' },
        h('button', { class: 'sa-btn big primary', type: 'button', onclick: saveRevision },
          'SAVE AS-INSTALLED REVISION'),
        gate && !gate.ok
          ? h('span', { class: 'sa-bad' }, gate.summary)
          : h('span', { class: 'sa-ok' }, 'Pricing complete')),
      selected?.kind === 'bto' ? btoSheet(selected.component) : null,
      selected?.kind === 'damper' ? damperSheet(selected.component) : null);
    return root;
  }

  return {
    el: root,
    render,
    mode: () => mode,
    setMode(m) { mode = m; render(); },
    session: () => session,
    /** Restore whatever survived a reload, before the installer notices. */
    resume() {
      const rec = loadSessionLocally(designId());
      if (!rec?.session?.edits?.length) return false;
      session = rec.session;
      syncState = SYNC.LOCAL;
      syncNote = rec.session.edits.length + ' edit(s) recovered from this iPad.';
      recalc();
      render();
      return true;
    },
    select(kind, component) { selected = { kind, component }; render(); },
    selected: () => selected,
    syncNow: doSync,
    state: () => ({ mode, syncState, edits: activeEdits(session).length,
                    canUndo: canUndo(session), canRedo: canRedo(session) })
  };
}

export default { createSiteAdjust, SITE_MODE };
