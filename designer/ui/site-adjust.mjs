// SITE ADJUST — the iPad mode, for a roof space and a driveway.
//
// Nick: "Add a large, touch-friendly SITE ADJUST mode intended for use on an
// iPad in the roof or at the property. It must work without opening the full
// advanced-design interface." And then, when the first cut turned out to be an
// edit API with buttons around it: "Do not mark any of these complete until
// they can be performed through visible iPad controls."
//
// So every action in here is reachable with a finger. The plan is a real canvas
// with real grab targets on it, and the sheets are for the things a drawing
// cannot show — a part number, a price, a zone name.
//
// Four things shape every decision:
//
//   TOUCH TARGETS ARE BIG. 56 px controls and a 60 px grab circle on the plan,
//   because the person using this is wearing gloves, standing on a joist,
//   holding a torch. A 24 px handle three pixels from another one is a design
//   for a mouse.
//
//   A MODE IS ALWAYS EXPLICIT. Pan, Select, Move, Route, Add, Delete — shown,
//   named and one tap away. Nick: "Prevent dragging the drawing when the
//   installer intends to move a component." The only way to guarantee that is
//   to make the two different MODES rather than different gestures.
//
//   ONE RECALCULATION, ON RELEASE. Nick: "After a move or route edit,
//   recalculate once when the installer releases the item — not continuously
//   while dragging." The engine sizes the whole system; running it on every
//   pointermove would make an iPad crawl. A ghost follows the finger; nothing
//   else happens until it lifts.
//
//   NOTHING IS LOST. Every completed edit is written to the device before
//   anything is sent anywhere, and the sync state is on screen at all times.

import { h, mount, money, num } from './dom.mjs';
import { confirmDialog, alertDialog, formDialog, pickDialog } from './modal.mjs';
import { SITE_GESTURE } from './plan-viewer.mjs';
import { SITE_EDIT, CONFIRM_BEFORE, siteEdit, newSiteSession, activeEdits,
         pushEdit, canUndo, canRedo, undo, redo, applySiteEdits,
         siteEditSummary, DESIGN_STAGE } from '../engines/site-edit.mjs';
import { SYNC, saveSessionLocally, loadSessionLocally, clearSessionLocally,
         detectConflict, syncSession } from '../engines/site-store.mjs';
import { DAMPER_DIAMETERS_MM } from '../engines/zone-dampers.mjs';
import { RETURN_AIR } from '../engines/nac-standard.mjs';

/** The operating modes. One is always on, and it is always visible. */
export const SITE_MODE = Object.freeze({
  PAN: SITE_GESTURE.PAN, SELECT: SITE_GESTURE.SELECT, MOVE: SITE_GESTURE.MOVE,
  ROUTE: SITE_GESTURE.ROUTE, ADD: SITE_GESTURE.ADD, DELETE: SITE_GESTURE.DELETE
});

const MODE_LABEL = {
  [SITE_MODE.PAN]: 'Pan', [SITE_MODE.SELECT]: 'Select', [SITE_MODE.MOVE]: 'Move',
  [SITE_MODE.ROUTE]: 'Route', [SITE_MODE.ADD]: 'Add', [SITE_MODE.DELETE]: 'Delete'
};
const MODE_HINT = {
  [SITE_MODE.PAN]: 'Drag to move the plan. Pinch to zoom. Nothing can be moved by accident.',
  [SITE_MODE.SELECT]: 'Tap a fitting to open it.',
  [SITE_MODE.MOVE]: 'Drag a fitting to reposition it. Everything recalculates when you let go.',
  [SITE_MODE.ROUTE]: 'Tap a duct to open its route. Drag a point to move it, tap the line to ' +
                     'add one, press and hold a point to take it out.',
  [SITE_MODE.ADD]: 'Tap a duct to add a BTO or a damper. Tap inside a room to add an outlet.',
  [SITE_MODE.DELETE]: 'Tap a component to remove it. Anything major asks first.'
};

/** What each kind of thing is called when it is being moved or deleted. */
const KIND_NAME = {
  outlet: 'outlet', bto: 'BTO', damper: 'zone damper', fcu: 'fan coil',
  plenum: 'supply plenum', returnPlenum: 'return plenum', returnGrille: 'return grille'
};

const dist = (a, b) => Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));

/** Distance from a point to a line segment — how a tap finds a duct. */
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The points on a run worth putting a handle on.
 *
 * A routed run is a swept curve of a dozen-odd points. A handle on every one is
 * a chain of circles no finger can pick apart, so only the CORNERS get one —
 * the places the duct actually changes direction, which are the places somebody
 * wants to move.
 */
export function routeCorners(points) {
  const pts = (points || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
  if (pts.length <= 2) return pts.map(p => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.30) out.push({ x: b.x, y: b.y });
  }
  const last = pts[pts.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * The Site Adjust screen.
 *
 * `host` is the app: it owns the design, the plan viewer and the recalculation,
 * because Site Adjust must produce the same design object the office screen
 * does. Nothing is modelled twice.
 */
export function createSiteAdjust(host) {
  let mode = SITE_MODE.SELECT;
  let selected = null;                            // { kind, component, target }
  let routeEdit = null;                           // { sectionId, points, locked }
  let session = newSiteSession({ by: host.userName?.() || null });
  let syncState = SYNC.SYNCED;
  let syncNote = '';
  let conflict = null;
  let busy = '';
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
    // A route being edited has to be re-read off the recalculated design, or
    // the handles carry on showing where the duct used to be.
    if (routeEdit) openRoute(routeEdit.sectionId, { keepSelection: true });
    render();
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE CANVAS
  // ════════════════════════════════════════════════════════════════════════
  //
  // The viewer owns the gestures and the coordinates. Everything below is what
  // the things under the finger MEAN: what can be grabbed, what a tap on one
  // does, and which edit comes out of a drag.

  /** Everything a finger can grab, in image coordinates. */
  function targets() {
    const d = host.design || {};
    const L = d.layout || {};
    const out = [];

    for (const o of (host.outletPoints?.() || [])) {
      out.push({ id: 'outlet:' + (o.sectionId || o.roomId), kind: 'outlet',
                 x: o.x, y: o.y, badge: 'O' + o.number, ref: o });
    }
    for (const b of (d.btos || [])) {
      if (b.x === null || b.x === undefined) continue;
      out.push({ id: 'bto:' + b.id, kind: 'bto', x: b.x, y: b.y,
                 badge: b.label || b.id, ref: b });
    }
    for (const z of (d.zoneDampers || [])) {
      if (z.x === null || z.x === undefined) continue;
      out.push({ id: 'damper:' + z.id, kind: 'damper', x: z.x, y: z.y,
                 badge: 'ZM-' + z.motorNumber, ref: z });
    }
    // The return grilles, by the layout key they are stored under — which is
    // also the key a move writes back to.
    for (const key of Object.keys(L)) {
      if (!/^returnGrille(_\d+)?$/.test(key)) continue;
      const n = key === 'returnGrille' ? 1 : Number(key.split('_')[1]);
      out.push({ id: 'return:' + key, kind: 'returnGrille', x: L[key].x, y: L[key].y,
                 badge: 'R' + n, layoutKey: key, index: n });
    }
    const fcu = L.indoorUnit || d.autoRoute?.plenum || null;
    if (fcu) out.push({ id: 'fcu', kind: 'fcu', x: fcu.x, y: fcu.y, badge: 'FCU',
                        layoutKey: 'indoorUnit' });
    // The supply plenum is bolted to the fan coil, so on most jobs the two sit
    // on the same point. A second grab target on top of the first is a target
    // nobody can hit, so it only appears when it has somewhere of its own.
    const sp = L.plenum || null;
    if (sp && (!fcu || dist(sp, fcu) > 2)) {
      out.push({ id: 'plenum', kind: 'plenum', x: sp.x, y: sp.y,
                 badge: 'SUPPLY PLENUM', layoutKey: 'plenum' });
    }
    const rp = L.returnPlenum ||
      (d.returnComponents?.plenum ? { x: d.returnComponents.plenum.x,
                                      y: d.returnComponents.plenum.y } : null);
    if (rp && rp.x !== null && rp.x !== undefined && (!fcu || dist(rp, fcu) > 2)) {
      out.push({ id: 'returnPlenum', kind: 'returnPlenum', x: rp.x, y: rp.y,
                 badge: 'RETURN PLENUM', layoutKey: 'returnPlenum' });
    }
    return out;
  }

  /** What is under the finger. The radius arrives already in image pixels. */
  function hitTest(at, radius) {
    let best = null, bestD = radius;
    for (const t of targets()) {
      const d = dist(at, t);
      if (d <= bestD) { best = t; bestD = d; }
    }
    return best;
  }

  /** The supply run nearest a tap, for adding a fitting or opening a route. */
  function sectionAt(at, radius) {
    let best = null, bestD = radius;
    for (const s of (host.siteSections?.() || [])) {
      for (let i = 0; i < s.points.length - 1; i++) {
        const d = distToSegment(at, s.points[i], s.points[i + 1]);
        if (d <= bestD) { best = s; bestD = d; }
      }
    }
    return best;
  }

  /** The points of the run open for editing: an earlier edit, or its corners. */
  function editablePoints(sectionId) {
    const d = host.design || {};
    const stored = d.routeEdits?.[sectionId]?.points || d.lockedRoutes?.[sectionId]?.points;
    if (stored?.length >= 2) return stored.map(p => ({ x: p.x, y: p.y }));
    const sec = (host.siteSections?.() || []).find(s => s.id === sectionId);
    return routeCorners(sec?.points || []);
  }

  function openRoute(sectionId, { keepSelection = false } = {}) {
    const sec = (host.siteSections?.() || []).find(s => s.id === sectionId);
    if (!sec) { routeEdit = null; return; }
    routeEdit = {
      sectionId,
      points: editablePoints(sectionId),
      locked: !!host.design?.lockedRoutes?.[sectionId],
      label: sec.destination || sec.serves?.join(' / ') || sectionId,
      diameterMm: sec.diameterMm ?? null,
      airflowLs: sec.airflowLs ?? null,
      lengthM: sec.lengthM ?? null
    };
    if (!keepSelection) selected = { kind: 'duct', component: sec, target: null };
  }

  /** Route hit testing: a handle first, then the line, then any other duct. */
  function routeHit(at, radius) {
    if (routeEdit) {
      for (let i = 0; i < routeEdit.points.length; i++) {
        if (dist(at, routeEdit.points[i]) <= radius) {
          return { sectionId: routeEdit.sectionId, pointIndex: i };
        }
      }
      for (let i = 0; i < routeEdit.points.length - 1; i++) {
        if (distToSegment(at, routeEdit.points[i], routeEdit.points[i + 1]) <= radius) {
          return { sectionId: routeEdit.sectionId, pointIndex: null, insertAfter: i };
        }
      }
    }
    const sec = sectionAt(at, radius);
    return sec ? { sectionId: sec.id, pointIndex: null, insertAfter: null, open: true } : null;
  }

  // ── WHAT A GESTURE DOES ────────────────────────────────────────────────

  function onCanvasSelect(target) {
    if (!target) { selected = null; render(); return; }
    selected = { kind: target.kind, component: target.ref || null, target };
    host.setSiteSelected?.(target.id);
    render();
  }

  /** A drag finished. ONE edit, ONE recalculation. */
  function onCanvasMoveEnd(target, at) {
    if (!target) return;
    const before = { x: target.x, y: target.y };
    const after = { x: Math.round(at.x), y: Math.round(at.y) };
    const common = { before, after, by: by(), reason: 'Site adjust — moved on the plan' };
    switch (target.kind) {
      case 'outlet':
        commit(siteEdit({ type: SITE_EDIT.MOVE_OUTLET, target: target.ref.roomId,
          label: target.ref.label || target.badge, before,
          after: { ...after, index: outletIndex(target.ref) },
          by: by(), reason: common.reason }));
        break;
      case 'bto':
        commit(siteEdit({ type: SITE_EDIT.MOVE_BTO, target: target.ref.id,
          label: target.ref.label, ...common }));
        break;
      case 'damper':
        commit(siteEdit({ type: SITE_EDIT.MOVE_DAMPER, target: target.ref.id,
          label: 'ZM-' + target.ref.motorNumber, ...common }));
        break;
      case 'returnGrille':
        commit(siteEdit({ type: SITE_EDIT.MOVE_RETURN, target: target.layoutKey,
          label: 'Return grille ' + target.badge, ...common }));
        break;
      case 'fcu': case 'plenum': case 'returnPlenum':
        commit(siteEdit({ type: SITE_EDIT.MOVE_EQUIPMENT, target: target.layoutKey,
          label: KIND_NAME[target.kind], ...common }));
        break;
      default: break;
    }
  }

  /**
   * ADD mode: everything that can go where the finger is, in one picker.
   *
   * A finger is a wide thing. Zoomed out to see the whole house it covers a
   * duct AND the room the duct runs through, and picking one of them for the
   * installer means picking wrong about half the time. So both are offered,
   * named, and the installer says which — one tap more, and never the wrong
   * fitting in the wrong place.
   */
  async function onCanvasAdd(at, target) {
    const radius = host.siteTouchRadius?.() ?? 24;
    const sec = sectionAt(at, radius * 1.4);
    const room = host.siteRoomAt?.(at) || null;
    const bto = target?.kind === 'bto' ? target.ref : null;
    if (!bto && !sec && !room) {
      await alertDialog({ title: 'Nothing to add there',
        message: 'Tap a supply duct to add a BTO or a motorised zone damper, or tap inside ' +
                 'a room to add an outlet. To add a return, use ADD RETURN in the tool bar.' });
      return;
    }
    const options = [];
    if (bto) options.push(
      { value: 'collar', label: 'Collar on ' + (bto.label || bto.id),
        sub: 'A new outlet spigot on the fitting your finger is on.' });
    if (sec) options.push(
      { value: 'damper', label: 'Motorised zone damper',
        sub: 'In ' + (sec.destination || sec.id) + ' — ø' + (sec.diameterMm ?? '?') +
             ', ' + (sec.airflowLs ?? '?') + ' L/s. The damper is the size of the duct.' },
      { value: 'bto', label: 'Fabricated BTO branch take-off',
        sub: 'On ' + (sec.destination || sec.id) + ' — ø' + (sec.diameterMm ?? '?') +
             ' inlet, no collars yet. The route is NOT redrawn for you.' });
    if (room) options.push(
      { value: 'outlet', label: 'Outlet in ' + room.label,
        sub: 'Splits this room’s air across one more outlet; ducts, order and price follow.' });
    const what = options.length === 1 ? options[0].value
      : await pickDialog({ title: 'What goes here?',
          message: 'Your finger is over ' +
            [bto ? (bto.label || 'a fitting') : null, sec ? 'a duct' : null,
             room ? room.label : null].filter(Boolean).join(' and ') + '.',
          submitLabel: 'Add', options });
    if (!what) return;
    if (what === 'collar') return void addPortAt(bto, at);
    if (what === 'outlet') return void addOutletIn(room, at);
    return void addOnDuct(sec, at, what);
  }

  /** DELETE mode: a tap on a component, with a confirmation for anything major. */
  async function onCanvasDelete(target) {
    if (!target) {
      await alertDialog({ title: 'Nothing under your finger',
        message: 'Tap the component you want to remove. The grab circles show what can ' +
                 'be picked up.' });
      return;
    }
    switch (target.kind) {
      case 'outlet': return void deleteOutlet(target.ref);
      case 'bto': return void deleteBto(specFor(target.ref));
      case 'damper': return void deleteDamper(target.ref);
      case 'returnGrille': return void deleteReturn(target);
      default:
        await alertDialog({ title: 'That cannot be deleted',
          message: 'The ' + (KIND_NAME[target.kind] || 'component') + ' is part of the ' +
                   'equipment and cannot be removed on site. Move it instead.' });
    }
  }

  function onCanvasRouteTap(hit) {
    if (!hit) return;
    if (hit.open || !routeEdit || hit.sectionId !== routeEdit.sectionId) {
      openRoute(hit.sectionId);
      render();
      return;
    }
    if (hit.insertAfter === null || hit.insertAfter === undefined) return;
    if (routeEdit.locked) return void warnLocked();
    const a = routeEdit.points[hit.insertAfter], b = routeEdit.points[hit.insertAfter + 1];
    const pts = routeEdit.points.slice();
    pts.splice(hit.insertAfter + 1, 0, { x: Math.round((a.x + b.x) / 2),
                                         y: Math.round((a.y + b.y) / 2) });
    commitRoute(pts, 'Point added on site');
  }

  function onCanvasRoutePointEnd(hit, at) {
    if (!routeEdit || hit.pointIndex === null) return;
    if (routeEdit.locked) return void warnLocked();
    const pts = routeEdit.points.map((p, i) =>
      i === hit.pointIndex ? { x: Math.round(at.x), y: Math.round(at.y) } : p);
    commitRoute(pts, 'Route point moved on site');
  }

  async function onCanvasRoutePointHold(hit) {
    if (!routeEdit || hit.pointIndex === null) return;
    if (routeEdit.locked) return void warnLocked();
    if (routeEdit.points.length <= 2) {
      await alertDialog({ title: 'A duct needs two ends',
        message: 'This run is already down to its two ends. Move them instead of taking ' +
                 'one out.' });
      return;
    }
    if (hit.pointIndex === 0 || hit.pointIndex === routeEdit.points.length - 1) {
      await alertDialog({ title: 'That is the end of the run',
        message: 'The two ends are where the duct connects. Move the end rather than ' +
                 'deleting it, or delete the fitting it connects to.' });
      return;
    }
    const pts = routeEdit.points.filter((p, i) => i !== hit.pointIndex);
    commitRoute(pts, 'Route point removed on site');
  }

  function commitRoute(points, reason) {
    const before = routeEdit.points.map(p => ({ ...p }));
    routeEdit = { ...routeEdit, points };
    commit(siteEdit({ type: SITE_EDIT.SET_ROUTE, target: routeEdit.sectionId,
      label: routeEdit.label, before: { points: before }, after: { points },
      by: by(), reason }));
  }

  async function warnLocked() {
    await alertDialog({ title: 'That route is locked',
      message: 'It was confirmed on site, so it is held exactly where it is and the ' +
               'router will not move it. Unlock it first if it really has to change.' });
  }

  /** Push the canvas state at the viewer. Called from every render. */
  function syncCanvas() {
    host.setSiteGesture?.(mode);
    host.setSiteTargets?.(targets());
    host.setSiteSelected?.(selected?.target?.id ?? null);
    host.setSiteRoute?.(mode === SITE_MODE.ROUTE ? routeEdit : null);
  }

  // ════════════════════════════════════════════════════════════════════════
  // THE BARS
  // ════════════════════════════════════════════════════════════════════════

  function modeBar() {
    return h('div', { class: 'sa-modes' },
      Object.values(SITE_MODE).map(m =>
        h('button', {
          class: 'sa-mode' + (m === mode ? ' on' : ''),
          type: 'button',
          'data-mode': m,
          onclick: () => setMode(m)
        }, MODE_LABEL[m])));
  }

  function historyBar() {
    return h('div', { class: 'sa-history' },
      h('button', { class: 'sa-btn', type: 'button', 'data-act': 'undo',
        disabled: !canUndo(session),
        onclick: () => { session = undo(session); persist(); recalc();
                         if (routeEdit) openRoute(routeEdit.sectionId, { keepSelection: true });
                         render(); } }, '↶ Undo'),
      h('button', { class: 'sa-btn', type: 'button', 'data-act': 'redo',
        disabled: !canRedo(session),
        onclick: () => { session = redo(session); persist(); recalc();
                         if (routeEdit) openRoute(routeEdit.sectionId, { keepSelection: true });
                         render(); } }, '↷ Redo'),
      h('span', { class: 'sa-count' },
        activeEdits(session).length + ' site edit' +
        (activeEdits(session).length === 1 ? '' : 's')));
  }

  /**
   * The things that are not on the plan.
   *
   * A note, a photo and a new return have nowhere on the drawing to be tapped,
   * so they get buttons. Everything else in here is a shortcut to a gesture.
   */
  function toolBar() {
    return h('div', { class: 'sa-tools' },
      h('button', { class: 'sa-tool', type: 'button', 'data-act': 'note',
                    onclick: addNote }, '✎ Add note'),
      h('button', { class: 'sa-tool', type: 'button', 'data-act': 'photo',
                    onclick: addPhoto }, '⬚ Attach photo'),
      h('button', { class: 'sa-tool', type: 'button', 'data-act': 'add-return',
                    onclick: addReturn }, '+ Add return'),
      routeEdit
        ? h('button', { class: 'sa-tool' + (routeEdit.locked ? ' on' : ''), type: 'button',
                        'data-act': 'lock',
                        onclick: () => routeEdit.locked ? unlockRoute() : lockRoute() },
            routeEdit.locked ? '🔒 Unlock route' : '🔓 Lock route')
        : null,
      h('span', { class: 'sa-tool-note' },
        (host.design?.sitePhotos || []).length + ' photo(s) · ' +
        (host.design?.siteNotes || []).length + ' note(s)'));
  }

  function syncBar() {
    const cls = syncState === SYNC.SYNCED ? 'ok'
      : syncState === SYNC.FAILED || syncState === SYNC.CONFLICT ? 'bad' : 'warn';
    return h('div', { class: 'sa-sync ' + cls },
      h('strong', { 'data-sync': syncState }, syncState),
      syncNote ? h('span', {}, syncNote) : null,
      h('button', { class: 'sa-btn', type: 'button', 'data-act': 'sync',
                    onclick: doSync }, 'Sync now'));
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

  // ════════════════════════════════════════════════════════════════════════
  // THE BOTTOM SHEET
  // ════════════════════════════════════════════════════════════════════════
  //
  // Everything an installer can change about the thing they just tapped, with
  // every number they need to decide, on one screen they do not have to scroll
  // sideways. A row is a 56 px target.

  const sheetRow = (label, value) =>
    h('div', { class: 'sa-row' }, h('span', { class: 'k' }, label),
      h('span', { class: 'v' }, value === null || value === undefined ? '—' : String(value)));

  const action = (label, onclick, kind = '', act = '') =>
    h('button', { class: 'sa-action ' + kind, type: 'button',
                  ...(act ? { 'data-act': act } : {}), onclick }, label);

  const sheetHead = (title, chip) =>
    h('div', { class: 'sa-sheet-head' },
      h('h2', {}, title), chip ? h('span', { class: 'sa-chip' }, chip) : null,
      h('button', { class: 'sa-close', type: 'button', 'data-act': 'close-sheet',
                    onclick: () => { selected = null; render(); } }, '✕'));

  /** The one spec object the plan, the schedule, the order and this all read. */
  function specFor(bto) {
    const rows = host.design?.schedules?.bto || [];
    const row = rows.find(r => r.componentId === bto.id) || null;
    return row ? { ...row, id: bto.id, label: row.id,
                   ports: (bto.ports || []).map(p => ({
                     index: p.index, diameterMm: p.diameterMm, airflowLs: p.airflowLs,
                     destination: p.servesLabel ||
                       (p.feedsBtoId ? p.feedsBtoId + ' (distribution arm)' : null),
                     zone: p.zone || null })),
                   fedBy: bto.fedBy, inletDiameterMm: bto.inletDiameterMm,
                   inletAirflowLs: bto.inletAirflowLs,
                   price: row.cost === null ? null : { cost: row.cost, quoteRef: row.quoteRef },
                   priceStatus: row.priceStatus }
                : null;
  }

  function btoSheet(bto) {
    const spec = specFor(bto);
    if (!spec) return null;
    const ports = spec.ports || [];
    return h('div', { class: 'sa-sheet', 'data-sheet': 'bto' },
      sheetHead(spec.label, spec.shapeText),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Inlet duct', spec.fedBy || '—'),
        sheetRow('Inlet diameter', 'ø' + spec.inletDiameterMm),
        sheetRow('Inlet airflow', spec.inletAirflowLs + ' L/s'),
        sheetRow('Body', spec.bodyText || '—'),
        sheetRow('Collar faces', (spec.facesUsed || []).join(', ') || '—'),
        sheetRow('Layout', spec.fabricationReady ? 'VALIDATED — collars fit this body'
          : spec.layoutPass === false ? 'FAILS — the collars do not fit'
          : 'PROPOSED — fabrication review required'),
        sheetRow('Fabrication', spec.fabricationStatus),
        sheetRow('Configuration key', spec.configKey),
        sheetRow('Price', spec.priceStatus === 'VERIFIED'
          ? money(spec.price?.cost) + (spec.price?.quoteRef ? ' · ' + spec.price.quoteRef : '')
          : spec.priceStatus),
        (spec.unplacedCollars || []).length
          ? h('p', { class: 'sa-bad' }, spec.unplacedCollars
              .map(u => 'ø' + u.nominalDiameterMm + ': ' + u.reason).join(' ')) : null,
        h('h3', {}, 'Collar layout'),
        h('div', { class: 'sa-layout' },
          (spec.collarFaceLines || []).map(l => h('div', { class: 'sa-layout-line' }, l))),
        h('h3', {}, 'Outlet collars'),
        h('div', { class: 'sa-ports' }, ports.map(p =>
          h('div', { class: 'sa-port' },
            h('div', { class: 'sa-port-head' }, 'Port ' + p.index + ' · ø' + p.diameterMm),
            h('div', { class: 'sa-port-sub' },
              (p.destination || 'NOT CONNECTED') + ' · ' + (p.airflowLs ?? '—') + ' L/s' +
              (p.zone ? ' · ' + p.zone : '')),
            h('div', { class: 'sa-port-actions' },
              action('Change size', () => changePortSize(spec, p), '', 'port-size'),
              action('Connect to', () => changePortDestination(spec, p), '', 'port-dest'),
              action('Remove port', () => removePort(spec, p), 'danger', 'port-remove'))))),
        h('div', { class: 'sa-actions' },
          action('Move fitting', () => setMode(SITE_MODE.MOVE), '', 'move-bto'),
          action('Add port', () => addPort(spec), '', 'add-port'),
          action('Enter confirmed body', () => editBody(spec), '', 'edit-body'),
          action('Mark for fabrication review', () => markForReview(spec), '', 'review'),
          action('Enter fabricator price', () => enterPrice(spec), '', 'price'),
          action('Delete fitting', () => deleteBto(spec), 'danger', 'delete-bto'))));
  }

  function damperSheet(d) {
    return h('div', { class: 'sa-sheet', 'data-sheet': 'damper' },
      sheetHead('ZM-' + d.motorNumber, 'ø' + d.diameterMm + ' · ' + d.actuator),
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
        d.sizeMismatch ? h('p', { class: 'sa-bad' }, d.mismatchMessage) : null,
        h('p', { class: 'sa-note' },
          'The damper is the size of the duct it is fitted in. Change the duct size and ' +
          'the damper, its symbol, this schedule, its part number and its price all follow.'),
        h('div', { class: 'sa-actions' },
          action('Move damper', () => setMode(SITE_MODE.MOVE), '', 'move-damper'),
          action('Change zone', () => changeDamperZone(d), '', 'damper-zone'),
          action('Change duct size', () => changeDuctSize(d), '', 'duct-size'),
          action('Delete damper', () => deleteDamper(d), 'danger', 'delete-damper'))));
  }

  function outletSheet(o) {
    return h('div', { class: 'sa-sheet', 'data-sheet': 'outlet' },
      sheetHead(o.label || ('Outlet ' + o.number), 'ø' + (o.neckMm ?? '?') + ' neck'),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Room', o.label || '—'),
        sheetRow('Airflow', (o.airflowLs ?? '—') + ' L/s'),
        sheetRow('Neck', 'ø' + (o.neckMm ?? '?')),
        sheetRow('Type', o.outletType || '—'),
        sheetRow('Duct section', o.sectionId),
        h('div', { class: 'sa-actions' },
          action('Move outlet', () => setMode(SITE_MODE.MOVE), '', 'move-outlet'),
          action('Change outlet type', () => changeOutletType(o), '', 'outlet-type'),
          action('Edit this duct route', () => { openRoute(o.sectionId);
                                                 setMode(SITE_MODE.ROUTE); }, '', 'edit-route'),
          action('Remove outlet', () => deleteOutlet(o), 'danger', 'delete-outlet'))));
  }

  function equipmentSheet(target) {
    const d = host.design || {};
    const u = d.selectedUnit;
    const angle = d.layout?.fanCoilAngle ?? 0;
    return h('div', { class: 'sa-sheet', 'data-sheet': 'equipment' },
      sheetHead(KIND_NAME[target.kind].toUpperCase(), u?.model || ''),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Unit', u ? u.brandName + ' ' + u.model : '—'),
        sheetRow('Capacity', u ? u.capacityKw + ' kW' : '—'),
        sheetRow('Discharge flange', u?.supplyFlangeText || 'UNVERIFIED'),
        sheetRow('Supply plenum', d.supplyPlenum
          ? d.supplyPlenum.bodyWidthMm + ' mm collar face, ' +
            d.supplyPlenum.collarCount + ' × ø' + d.supplyPlenum.collarDiameterMm : '—'),
        sheetRow('Orientation', angle + '°'),
        h('div', { class: 'sa-actions' },
          action('Move ' + KIND_NAME[target.kind], () => setMode(SITE_MODE.MOVE), '', 'move-fcu'),
          action('Rotate 90°', () => rotateFcu(90), '', 'rotate-fcu'),
          action('Rotate −90°', () => rotateFcu(-90), '', 'rotate-fcu-back'),
          action('Set exact angle', () => setFcuAngle(), '', 'fcu-angle'),
          target.kind === 'fcu' && d.layout?.plenum
            ? action('Move the supply plenum instead', () => {
                selected = { kind: 'plenum', component: null,
                             target: { id: 'plenum', kind: 'plenum', layoutKey: 'plenum',
                                       x: d.layout.plenum.x, y: d.layout.plenum.y } };
                setMode(SITE_MODE.MOVE);
              }, '', 'move-plenum')
            : null,
          target.kind === 'fcu' && d.layout?.returnPlenum
            ? action('Move the return plenum instead', () => {
                selected = { kind: 'returnPlenum', component: null,
                             target: { id: 'returnPlenum', kind: 'returnPlenum',
                                       layoutKey: 'returnPlenum',
                                       x: d.layout.returnPlenum.x,
                                       y: d.layout.returnPlenum.y } };
                setMode(SITE_MODE.MOVE);
              }, '', 'move-return-plenum')
            : null)));
  }

  function returnSheet(target) {
    const d = host.design || {};
    const r = (d.returnDesign?.returns || [])[target.index - 1] || null;
    return h('div', { class: 'sa-sheet', 'data-sheet': 'return' },
      sheetHead('Return ' + target.badge, r?.grilleSize || ''),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Grille', r?.grilleSize || '—'),
        sheetRow('Airflow', (r?.airflowLs ?? d.returnDesign?.perReturnLs ?? '—') + ' L/s'),
        sheetRow('Face velocity', r?.faceVelocityMs ? num(r.faceVelocityMs, 2) + ' m/s' : '—'),
        sheetRow('Duct', r?.ductDiameterMm ? 'ø' + r.ductDiameterMm : '—'),
        sheetRow('Returns on this job', d.returnDesign?.returnCount ?? '—'),
        h('p', { class: 'sa-note' },
          'Each return runs its own duct to its own collar on the return plenum. They are ' +
          'never joined to each other and never to a supply duct.'),
        h('div', { class: 'sa-actions' },
          action('Move this return', () => setMode(SITE_MODE.MOVE), '', 'move-return'),
          action('Add another return', () => addReturn(), '', 'add-return-2'),
          action('Remove this return', () => deleteReturn(target), 'danger', 'delete-return'))));
  }

  function ductSheet(sec) {
    const locked = !!host.design?.lockedRoutes?.[sec.id];
    return h('div', { class: 'sa-sheet', 'data-sheet': 'duct' },
      sheetHead(sec.destination || sec.id, 'ø' + (sec.diameterMm ?? '?')),
      h('div', { class: 'sa-sheet-body' },
        sheetRow('Section', sec.id),
        sheetRow('Diameter', 'ø' + (sec.diameterMm ?? '?')),
        sheetRow('Airflow', (sec.airflowLs ?? '—') + ' L/s'),
        sheetRow('Velocity', sec.velocityMs ? num(sec.velocityMs, 2) + ' m/s' : '—'),
        sheetRow('Routed length', sec.lengthM ? num(sec.lengthM, 2) + ' m' : '—'),
        sheetRow('Route', locked ? 'LOCKED — confirmed on site' : 'editable'),
        sheetRow('Points', routeEdit?.sectionId === sec.id
          ? routeEdit.points.length : editablePoints(sec.id).length),
        h('p', { class: 'sa-note' },
          'Drag a point to move the run. Tap the line between two points to add one. ' +
          'Press and hold a point to take it out. Nothing recalculates until you let go.'),
        h('div', { class: 'sa-actions' },
          action('Edit this route', () => { openRoute(sec.id); setMode(SITE_MODE.ROUTE); },
                 '', 'edit-route'),
          action('Change duct size', () => changeSectionSize(sec), '', 'duct-size'),
          locked ? action('Unlock route', () => unlockRoute(sec.id), '', 'unlock')
                 : action('Lock this route', () => lockRoute(sec.id), '', 'lock'),
          action('Add a BTO here', () => addOnDuct(sec, midPoint(sec), 'bto'), '', 'add-bto'),
          action('Add a damper here', () => addOnDuct(sec, midPoint(sec), 'damper'),
                 '', 'add-damper'))));
  }

  const midPoint = (sec) => sec.points[Math.floor(sec.points.length / 2)];

  /**
   * Which outlet of its room this is, 0-based.
   *
   * The routers store a manual position under `outlet_<roomId>_<index>` and the
   * second outlet of a room carries `_2` on its node and section id. So the
   * index is that number minus one, and no suffix means the first.
   */
  function outletIndex(o) {
    const m = /_(\d+)$/.exec(String(o?.sectionId || ''));
    return m ? Math.max(0, Number(m[1]) - 1) : 0;
  }

  // ════════════════════════════════════════════════════════════════════════
  // EDIT ACTIONS
  // ════════════════════════════════════════════════════════════════════════

  function setMode(m) {
    mode = m;
    // Leaving ROUTE closes the run being edited unless its sheet is open, so a
    // dozen cyan handles are not left sitting over a plan nobody is editing.
    if (m !== SITE_MODE.ROUTE && selected?.kind !== 'duct') routeEdit = null;
    render();
  }

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

  async function changeSectionSize(sec) {
    const picked = await pickDialog({
      title: 'Duct size for ' + (sec.destination || sec.id),
      message: 'Any motorised damper in this run follows the duct, and so do its part ' +
               'number, its schedule row and its price.',
      submitLabel: 'Change duct size',
      options: DAMPER_DIAMETERS_MM.map(mm => ({ value: mm, label: 'ø' + mm + ' duct' }))
    });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.SET_DUCT_DIAMETER, target: sec.id,
      label: sec.destination || sec.id,
      before: { diameterMm: sec.diameterMm }, after: { diameterMm: Number(picked) },
      by: by(), reason: 'Site adjust — duct size' }));
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
    const choices = host.outletChoices?.() || [];
    const picked = await pickDialog({ title: 'Destination for port ' + p.index,
      message: 'Connecting a collar does not redraw the duct on its own — route it in ' +
               'ROUTE mode once it is connected.',
      submitLabel: 'Connect', options: choices.map(o => ({ value: o.id, label: o.label })) });
    if (!picked) return;
    const label = choices.find(o => o.id === picked)?.label || picked;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_PORT_DESTINATION, target: spec.id,
      label: spec.label + ' port ' + p.index,
      before: { portIndex: p.index, destination: p.destination },
      after: { portIndex: p.index, destination: picked, destinationLabel: label },
      by: by() }));
  }

  async function addPort(spec) {
    const min = host.design?.designRules?.minimumSupplyBranchDiameterMm || 250;
    const picked = await pickDialog({
      title: 'New collar on ' + spec.label,
      message: 'The collar is added unconnected. Point it at a room, then route the duct.',
      submitLabel: 'Add collar',
      options: DAMPER_DIAMETERS_MM.filter(mm => mm >= min && mm <= spec.inletDiameterMm)
        .map(mm => ({ value: mm, label: 'ø' + mm + ' collar' })) });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.ADD_BTO_PORT, target: spec.id, label: spec.label,
      before: { portCount: spec.outletCollarCount },
      after: { portCount: spec.outletCollarCount + 1, diameterMm: Number(picked) },
      by: by(), reason: 'Collar added on site' }));
  }

  /** ADD mode, finger on a BTO: the same thing, without opening the sheet. */
  const addPortAt = (bto) => { const s = specFor(bto); if (s) addPort(s); };

  async function removePort(spec, p) {
    if (!await confirmDialog({ title: 'Remove port ' + p.index + '?',
      message: 'It serves ' + (p.destination || 'nothing') + '. That outlet will need ' +
               'another feed before the design can be approved.', confirmLabel: 'Remove' })) return;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_BTO_PORT, target: spec.id, label: spec.label,
      before: { portCount: spec.outletCollarCount, port: p },
      after: { portCount: spec.outletCollarCount - 1, portIndex: p.index }, by: by() }));
  }

  async function editBody(spec) {
    const got = await formDialog({
      title: spec.label + ' — fabricator’s confirmed body',
      message: 'Three dimensions, because the collars are laid out on named faces and a ' +
               'face needs a width and a height. Entering a real body IS the verification: ' +
               'the proposal is replaced everywhere, and the collar layout is then checked ' +
               'against the real box — which can fail, and will say so.',
      submitLabel: 'Save confirmed body',
      fields: [{ key: 'len', label: 'Body length (mm)', type: 'number',
                 value: spec.bodyLengthMm || '' },
               { key: 'wid', label: 'Body width (mm)', type: 'number',
                 value: spec.bodyWidthMm || spec.bodyDepthMm || '' },
               { key: 'hei', label: 'Body height (mm)', type: 'number',
                 value: spec.bodyHeightMm || spec.bodyDepthMm || '' }] });
    if (!got) return;
    if (!got.len || !got.wid || !got.hei) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_BODY, target: spec.id, label: spec.label,
      before: { bodyLengthMm: spec.bodyLengthMm, bodyWidthMm: spec.bodyWidthMm,
                bodyHeightMm: spec.bodyHeightMm },
      after: { bodyLengthMm: Number(got.len), bodyWidthMm: Number(got.wid),
               bodyHeightMm: Number(got.hei), bodyDepthMm: Number(got.wid) },
      by: by(), reason: 'Confirmed against the fabricator’s body' }));
  }

  async function markForReview(spec) {
    const got = await formDialog({
      title: 'Mark ' + spec.label + ' for fabrication review',
      message: 'What does the shop need to look at?',
      submitLabel: 'Mark for review',
      fields: [{ key: 'why', label: 'Note for the fabricator', type: 'textarea' }] });
    if (!got) return;
    commit(siteEdit({ type: SITE_EDIT.ADD_NOTE, target: spec.id, label: spec.label,
      after: { text: 'FABRICATION REVIEW — ' + (got.why || 'confirm body and collar layout') },
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
    if (!got || !got.cost) return;
    commit(siteEdit({ type: SITE_EDIT.SET_BTO_PRICE, target: spec.id, label: spec.label,
      before: { cost: spec.price?.cost ?? null },
      after: { configKey: spec.configKey,
               rate: { cost: Number(got.cost), quoteRef: got.ref || null,
                       supplier: got.supplier || null, verified: !!got.ref,
                       effectiveDate: new Date().toISOString().slice(0, 10) } },
      by: by(), reason: 'Fabricator quote' }));
  }

  async function deleteBto(spec) {
    if (!spec) return;
    if (!await confirmDialog({ title: 'Delete ' + spec.label + '?',
      message: 'Every duct it feeds loses its connection and the design cannot be approved ' +
               'until they are re-routed.', confirmLabel: 'Delete fitting' })) return;
    selected = null;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_BTO, target: spec.id, label: spec.label,
      before: { shapeText: spec.shapeText }, after: { removed: true }, by: by() }));
  }

  // ── OUTLETS ────────────────────────────────────────────────────────────

  async function changeOutletType(o) {
    const picked = await pickDialog({
      title: 'Outlet type for ' + (o.label || 'this outlet'),
      message: 'The type changes what is ordered for it and how it is drawn.',
      submitLabel: 'Change type',
      options: [
        { value: 'round_diffuser', label: 'Round ceiling diffuser' },
        { value: 'square_diffuser', label: 'Square ceiling diffuser' },
        { value: 'linear_slot', label: 'Linear slot diffuser' },
        { value: 'sidewall_grille', label: 'Sidewall grille' }
      ] });
    if (!picked) return;
    commit(siteEdit({ type: SITE_EDIT.SET_OUTLET_TYPE, target: o.roomId,
      label: o.label || o.sectionId, before: { type: o.outletType },
      after: { type: picked }, by: by(), reason: 'Site adjust — outlet type' }));
  }

  async function addOutletIn(room, at) {
    const row = (host.design?.outlets?.rows || []).find(r => r.roomId === room.id);
    const now = row?.quantity ?? 0;
    if (!await confirmDialog({ title: 'Add an outlet to ' + room.label + '?',
      message: room.label + ' has ' + now + ' outlet(s) and ' + (row?.airflowLs ?? '?') +
               ' L/s. Adding one splits that air across ' + (now + 1) + ', and the duct ' +
               'sizes, the order and the price all follow.',
      confirmLabel: 'Add outlet' })) return;
    commit(siteEdit({ type: SITE_EDIT.ADD_OUTLET, target: room.id, label: room.label,
      before: { quantity: now },
      after: { quantity: now + 1, index: now, x: Math.round(at.x), y: Math.round(at.y) },
      by: by(), reason: 'Outlet added on site' }));
  }

  async function deleteOutlet(o) {
    const row = (host.design?.outlets?.rows || []).find(r => r.roomId === o.roomId);
    const now = row?.quantity ?? 1;
    if (!await confirmDialog({ title: 'Remove this outlet?',
      message: (o.label || 'This room') + ' has ' + now + ' outlet(s). Removing one leaves ' +
               (now - 1) + '. If that is none, the room keeps its load and its air ' +
               'allocation and the sheet will say so.',
      confirmLabel: 'Remove outlet' })) return;
    selected = null;
    const idx = outletIndex(o);
    commit(siteEdit({ type: SITE_EDIT.REMOVE_OUTLET, target: o.roomId,
      label: o.label || o.sectionId, before: { quantity: now },
      after: { quantity: Math.max(0, now - 1), index: idx },
      by: by(), reason: 'Outlet removed on site' }));
  }

  // ── FITTINGS ADDED ON A DUCT ───────────────────────────────────────────

  async function addOnDuct(sec, at, forced = null) {
    const what = forced || await pickDialog({
      title: 'Add to ' + (sec.destination || sec.id),
      message: 'ø' + (sec.diameterMm ?? '?') + ', ' + (sec.airflowLs ?? '?') + ' L/s. A ' +
               'damper is the size of this duct. A BTO is added with this duct’s inlet and ' +
               'no collars yet — the route is NOT redrawn for you.',
      submitLabel: 'Add',
      options: [{ value: 'damper', label: 'Motorised zone damper' },
                { value: 'bto', label: 'Fabricated BTO branch take-off' }] });
    if (!what) return;
    const point = at || midPoint(sec);
    if (what === 'damper') {
      const id = 'damper_' + sec.id;
      if ((host.design?.zoneDampers || []).some(z => z.sectionId === sec.id)) {
        return void alertDialog({ title: 'There is already a damper in this duct',
          message: 'One motor per zone. Move or delete the one that is there.' });
      }
      commit(siteEdit({ type: SITE_EDIT.ADD_DAMPER, target: id,
        label: 'Damper on ' + (sec.destination || sec.id),
        after: { sectionId: sec.id, zone: sec.zone || null,
                 x: Math.round(point.x), y: Math.round(point.y) },
        by: by(), reason: 'Damper added on site' }));
      return;
    }
    const id = 'bto_site_' + sec.id;
    commit(siteEdit({ type: SITE_EDIT.ADD_BTO, target: id,
      label: 'BTO on ' + (sec.destination || sec.id),
      after: { sectionId: sec.id, inletDiameterMm: sec.diameterMm,
               inletAirflowLs: sec.airflowLs, label: 'BTO-S' + ((host.design?.btos || []).length + 1),
               x: Math.round(point.x), y: Math.round(point.y) },
      by: by(), reason: 'BTO added on site' }));
  }

  // ── THE RETURN ─────────────────────────────────────────────────────────

  async function addReturn() {
    const d = host.design || {};
    const count = d.returnDesign?.returnCount ?? d.returnCount ?? 1;
    // NAC FITS ONE OR TWO. The return designer caps at two, so a button that
    // appeared to add a third would record an edit and change nothing — which
    // is worse than a control that says no.
    if (count >= RETURN_AIR.maxReturns) {
      await alertDialog({ title: 'Two returns is the most NAC fits',
        message: 'This job already has ' + count + '. A third would not be built, so it is ' +
                 'not recorded. Move the two that are there, or change the return standard ' +
                 'in HVAC Design Settings if a third is genuinely wanted.' });
      return;
    }
    const key = 'returnGrille_' + (count + 1);
    const fcu = d.layout?.indoorUnit || d.autoRoute?.plenum || { x: 100, y: 100 };
    if (!await confirmDialog({ title: 'Add a return grille and duct?',
      message: 'It is placed beside the fan coil and runs its OWN duct to its OWN collar on ' +
               'the return plenum — never joined to another return and never to a supply ' +
               'duct. Drag it where it goes once it is there.',
      confirmLabel: 'Add return' })) return;
    commit(siteEdit({ type: SITE_EDIT.ADD_RETURN, target: key,
      label: 'Return ' + (count + 1),
      before: { count }, after: { count: count + 1, x: Math.round(fcu.x + 90),
                                  y: Math.round(fcu.y + 40), grilleSize: [600, 400] },
      by: by(), reason: 'Return added on site' }));
  }

  async function deleteReturn(target) {
    const d = host.design || {};
    const count = d.returnDesign?.returnCount ?? d.returnCount ?? 1;
    if (count <= 1) {
      await alertDialog({ title: 'A system needs a return',
        message: 'This is the only return on the job. Move it rather than removing it.' });
      return;
    }
    if (!await confirmDialog({ title: 'Remove return ' + target.badge + '?',
      message: 'The remaining return(s) carry the whole ' +
               (d.returnDesign?.totalLs ?? d.airflow?.allocatedAirflowLs ?? '?') +
               ' L/s. The grille size, the face velocity and the duct all resize.',
      confirmLabel: 'Remove return' })) return;
    selected = null;
    commit(siteEdit({ type: SITE_EDIT.REMOVE_RETURN, target: target.layoutKey,
      label: 'Return ' + target.badge, before: { count },
      after: { count: count - 1 }, by: by(), reason: 'Return removed on site' }));
  }

  // ── ROUTES ─────────────────────────────────────────────────────────────

  function lockRoute(sectionId) {
    const id = sectionId || routeEdit?.sectionId;
    if (!id) return;
    const points = routeEdit?.sectionId === id ? routeEdit.points : editablePoints(id);
    commit(siteEdit({ type: SITE_EDIT.LOCK_ROUTE, target: id,
      label: routeEdit?.label || id, after: { points },
      by: by(), reason: 'Route confirmed on site' }));
  }

  async function unlockRoute(sectionId) {
    const id = sectionId || routeEdit?.sectionId;
    if (!id) return;
    if (!await confirmDialog({ title: 'Unlock this route?',
      message: 'It was confirmed on site and is being held exactly where it is. Unlocking ' +
               'lets the router move it the next time the design is recalculated.',
      confirmLabel: 'Unlock' })) return;
    commit(siteEdit({ type: SITE_EDIT.UNLOCK_ROUTE, target: id,
      label: routeEdit?.label || id, after: { unlocked: true },
      by: by(), reason: 'Unlocked on site' }));
  }

  // ── FAN COIL ───────────────────────────────────────────────────────────

  function rotateFcu(delta) {
    const now = host.design?.layout?.fanCoilAngle ?? 0;
    const next = ((now + delta) % 360 + 360) % 360;
    commit(siteEdit({ type: SITE_EDIT.SET_FCU_ORIENTATION, target: 'indoorUnit',
      label: 'Fan coil', before: { angle: now }, after: { angle: next },
      by: by(), reason: 'Rotated on site' }));
  }

  async function setFcuAngle() {
    const now = host.design?.layout?.fanCoilAngle ?? 0;
    const got = await formDialog({ title: 'Fan coil orientation',
      message: 'Degrees clockwise from the plan’s horizontal.',
      submitLabel: 'Set angle',
      fields: [{ key: 'angle', label: 'Angle (°)', type: 'number', value: now }] });
    if (!got || got.angle === '' || got.angle === null) return;
    commit(siteEdit({ type: SITE_EDIT.SET_FCU_ORIENTATION, target: 'indoorUnit',
      label: 'Fan coil', before: { angle: now },
      after: { angle: ((Number(got.angle) % 360) + 360) % 360 },
      by: by(), reason: 'Angle set on site' }));
  }

  // ── NOTES AND PHOTOS ───────────────────────────────────────────────────

  async function addNote() {
    const got = await formDialog({ title: 'Site note',
      message: 'It goes on the as-installed record against whatever is selected, or ' +
               'against the job if nothing is.',
      submitLabel: 'Save note',
      fields: [{ key: 'text', label: 'What happened on site?', type: 'textarea' }] });
    if (!got || !got.text) return;
    const t = selected?.target;
    commit(siteEdit({ type: SITE_EDIT.ADD_NOTE, target: t?.id || 'job',
      label: t?.badge || 'Job', after: { text: got.text }, by: by() }));
  }

  /**
   * A photo off the iPad's camera.
   *
   * Scaled down before it goes anywhere: a 12 megapixel photo in a design
   * record is a design record that will not sync over a phone in a roof.
   */
  function addPhoto() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      busy = 'Reading the photo…'; render();
      try {
        const dataUrl = await shrinkImage(file, 1280);
        const t = selected?.target;
        const got = await formDialog({ title: 'Photo caption',
          message: 'One line, so somebody reading the record knows what they are looking at.',
          submitLabel: 'Attach photo',
          fields: [{ key: 'caption', label: 'Caption' }] });
        busy = '';
        commit(siteEdit({ type: SITE_EDIT.ADD_PHOTO, target: t?.id || 'job',
          label: t?.badge || 'Job',
          after: { dataUrl, caption: got?.caption || '' }, by: by() }));
      } catch (e) {
        busy = '';
        await alertDialog({ title: 'The photo could not be read',
          message: String(e?.message || e) });
        render();
      }
    };
    document.body.appendChild(input);
    input.click();
  }

  function shrinkImage(file, maxPx) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('This iPad would not read the file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not an image this browser reads.'));
        img.onload = () => {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * scale));
          cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.72));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
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
    host.saveAsInstalled({
      by: by(), reason: got.reason || '',
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
        h('button', { class: 'sa-btn big', type: 'button', 'data-act': 'done',
                      onclick: () => host.closeSiteAdjust() }, 'Done')),
      modeBar(),
      h('p', { class: 'sa-hint' }, MODE_HINT[mode]),
      syncBar(),
      conflict ? h('div', { class: 'sa-conflict' },
        h('strong', {}, 'Conflict'), h('span', {}, conflict.message),
        h('button', { class: 'sa-btn', type: 'button',
          onclick: () => { conflict = null; syncState = SYNC.LOCAL; render(); } },
          'Keep my site edits')) : null,
      // ONE ROW, NOT TWO. Seven stacked bars on an 820 px iPad left the plan a
      // 320 px band. Undo, redo and the tools are all secondary controls, and
      // they fit side by side at full size.
      h('div', { class: 'sa-bar' }, historyBar(), toolBar()),
      busy ? h('div', { class: 'sa-busy' }, busy) : null,
      h('div', { class: 'sa-canvas' }, host.viewerHost?.() || h('div')),
      h('div', { class: 'sa-foot' },
        h('button', { class: 'sa-btn big primary', type: 'button', 'data-act': 'save-revision',
                      onclick: saveRevision },
          'SAVE AS-INSTALLED REVISION'),
        gate && !gate.ok
          ? h('span', { class: 'sa-bad' }, gate.summary)
          : h('span', { class: 'sa-ok' }, 'Pricing complete')),
      selected?.kind === 'bto' ? btoSheet(selected.component) : null,
      selected?.kind === 'damper' ? damperSheet(selected.component) : null,
      selected?.kind === 'outlet' ? outletSheet(selected.component) : null,
      selected?.kind === 'duct' ? ductSheet(selected.component) : null,
      selected?.kind === 'returnGrille' ? returnSheet(selected.target) : null,
      (selected?.kind === 'fcu' || selected?.kind === 'plenum' ||
       selected?.kind === 'returnPlenum') ? equipmentSheet(selected.target) : null);
    // The viewer is inside the layout by now, so it can be told what to draw.
    syncCanvas();
    return root;
  }

  return {
    el: root,
    render,
    mode: () => mode,
    setMode,
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
    select(kind, component) { selected = { kind, component, target: null }; render(); },
    selected: () => selected,
    syncNow: doSync,

    // ── What the canvas calls ─────────────────────────────────────────────
    hitTest, routeHit, targets,
    onCanvasSelect, onCanvasMoveEnd, onCanvasAdd, onCanvasDelete,
    onCanvasRouteTap, onCanvasRoutePointEnd, onCanvasRoutePointHold,
    openRoute, routeEdit: () => routeEdit,

    state: () => ({ mode, syncState, edits: activeEdits(session).length,
                    canUndo: canUndo(session), canRedo: canRedo(session),
                    targets: targets().length,
                    routeSection: routeEdit?.sectionId || null,
                    routePoints: routeEdit?.points?.length || 0,
                    selected: selected ? { kind: selected.kind, id: selected.target?.id || null }
                                       : null })
  };
}

export default { createSiteAdjust, SITE_MODE, routeCorners };
