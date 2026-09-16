// WHAT THE INSTALLER CHANGED ON SITE, AND WHAT IT CHANGED IT TO.
//
// Site Adjust does not edit the design. It appends EDITS, and the edits are
// folded into the design's existing override records and the whole pipeline is
// re-run. That matters for three reasons:
//
//   1. Every number downstream — lengths, velocities, static pressure, the
//      damper schedule, the BOM, the job cost — is recalculated rather than
//      patched, so nothing can go stale.
//   2. Undo and redo are a cursor on a list, not a pile of inverse operations
//      that have to be written correctly for twenty-odd edit types.
//   3. The log IS the as-installed record. Who, when, what component, from
//      what, to what, why. Nick: "Do not overwrite the quoted design or
//      approved design."
//
// Nothing here writes to the quoted or approved design. A site session produces
// a SITE-ADJUSTED DRAFT; saving it produces an AS-INSTALLED revision alongside
// the others.

/** Every edit Site Adjust can make. */
export const SITE_EDIT = Object.freeze({
  MOVE_OUTLET: 'move_outlet',
  ADD_OUTLET: 'add_outlet',
  REMOVE_OUTLET: 'remove_outlet',
  SET_OUTLET_TYPE: 'set_outlet_type',
  MOVE_EQUIPMENT: 'move_equipment',
  SET_FCU_ORIENTATION: 'set_fcu_orientation',
  MOVE_BTO: 'move_bto',
  ADD_BTO: 'add_bto',
  REMOVE_BTO: 'remove_bto',
  ADD_BTO_PORT: 'add_bto_port',
  REMOVE_BTO_PORT: 'remove_bto_port',
  SET_BTO_INLET: 'set_bto_inlet',
  SET_BTO_PORT_SIZE: 'set_bto_port_size',
  SET_BTO_PORT_DESTINATION: 'set_bto_port_destination',
  SET_BTO_BODY: 'set_bto_body',
  SET_BTO_PRICE: 'set_bto_price',
  MOVE_DAMPER: 'move_damper',
  ADD_DAMPER: 'add_damper',
  REMOVE_DAMPER: 'remove_damper',
  SET_DAMPER_ZONE: 'set_damper_zone',
  SET_DUCT_DIAMETER: 'set_duct_diameter',
  SET_ROUTE: 'set_route',
  LOCK_ROUTE: 'lock_route',
  UNLOCK_ROUTE: 'unlock_route',
  MOVE_RETURN: 'move_return',
  ADD_RETURN: 'add_return',
  REMOVE_RETURN: 'remove_return',
  ADD_NOTE: 'add_note',
  ADD_PHOTO: 'add_photo'
});

/** Deletions that need a confirmation before they happen. */
export const CONFIRM_BEFORE = Object.freeze([
  SITE_EDIT.REMOVE_BTO, SITE_EDIT.REMOVE_RETURN, SITE_EDIT.MOVE_EQUIPMENT,
  SITE_EDIT.REMOVE_DAMPER, SITE_EDIT.REMOVE_OUTLET
]);

let seq = 0;
const nextId = () => 'edit_' + Date.now().toString(36) + '_' + (++seq).toString(36);

/** One recorded change. `before` and `after` are what the revision shows. */
export function siteEdit({ type, target, label = null, before = null, after = null,
                           by = null, reason = '', note = '', photoId = null,
                           at = null }) {
  return {
    id: nextId(),
    type,
    target,
    label: label || target,
    before, after,
    by: by || null,
    reason: reason || '',
    note: note || '',
    photoId: photoId || null,
    at: at || new Date().toISOString()
  };
}

/** A fresh session: no edits, cursor at the start, nothing to sync. */
export function newSiteSession({ baseRevision = null, by = null } = {}) {
  return { edits: [], cursor: 0, baseRevision, by, notes: [], photos: [],
           syncState: 'synced', lastSavedAt: null };
}

/** The edits that are actually in force — everything before the cursor. */
export function activeEdits(session) {
  return (session?.edits || []).slice(0, session?.cursor ?? 0);
}

/** Append an edit. Anything that had been undone is discarded, as usual. */
export function pushEdit(session, edit) {
  const kept = activeEdits(session);
  return { ...session, edits: [...kept, edit], cursor: kept.length + 1,
           syncState: 'pending' };
}

export function canUndo(session) { return (session?.cursor ?? 0) > 0; }
export function canRedo(session) { return (session?.cursor ?? 0) < (session?.edits?.length ?? 0); }
export function undo(session) {
  return canUndo(session)
    ? { ...session, cursor: session.cursor - 1, syncState: 'pending' } : session;
}
export function redo(session) {
  return canRedo(session)
    ? { ...session, cursor: session.cursor + 1, syncState: 'pending' } : session;
}

const put = (obj, k, v) => ({ ...(obj || {}), [k]: v });
const drop = (obj, k) => { const o = { ...(obj || {}) }; delete o[k]; return o; };

/**
 * Fold the edits into the design's override records.
 *
 * The result is a DESIGN, ready to hand straight back to `runPipeline`. It
 * never mutates its input and never touches `revisions`, so the approved design
 * this was opened from is exactly where it was.
 */
export function applySiteEdits(design, edits) {
  let d = { ...design };
  const notes = [...(d.siteNotes || [])];
  const photos = [...(d.sitePhotos || [])];

  for (const e of edits || []) {
    switch (e.type) {
      case SITE_EDIT.MOVE_OUTLET:
        d.outletOverrides = put(d.outletOverrides, e.target,
          { ...(d.outletOverrides?.[e.target] || {}), x: e.after.x, y: e.after.y });
        break;
      case SITE_EDIT.SET_OUTLET_TYPE:
        d.outletOverrides = put(d.outletOverrides, e.target,
          { ...(d.outletOverrides?.[e.target] || {}), type: e.after.type });
        break;
      case SITE_EDIT.ADD_OUTLET:
        d.outletOverrides = put(d.outletOverrides, e.target,
          { ...(e.after || {}), added: true });
        break;
      case SITE_EDIT.REMOVE_OUTLET:
        d.outletOverrides = put(d.outletOverrides, e.target, { removed: true });
        break;

      case SITE_EDIT.MOVE_EQUIPMENT:
        d.layout = { ...(d.layout || {}), [e.target]: { x: e.after.x, y: e.after.y } };
        break;
      case SITE_EDIT.SET_FCU_ORIENTATION:
        d.layout = { ...(d.layout || {}), fanCoilAngle: e.after.angle };
        break;

      // ── BTOs ───────────────────────────────────────────────────────────
      // A BTO is DERIVED from the routed network, so a site edit to one is
      // recorded as an override against its id and re-applied after the
      // derivation — never by editing the derived object, which the next
      // recalculation would throw away.
      case SITE_EDIT.MOVE_BTO:
        d.btoOverrides = put(d.btoOverrides, e.target,
          { ...(d.btoOverrides?.[e.target] || {}), x: e.after.x, y: e.after.y });
        break;
      case SITE_EDIT.SET_BTO_INLET:
        d.btoOverrides = put(d.btoOverrides, e.target,
          { ...(d.btoOverrides?.[e.target] || {}), inletDiameterMm: e.after.diameterMm });
        break;
      case SITE_EDIT.SET_BTO_PORT_SIZE: {
        const cur = d.btoOverrides?.[e.target] || {};
        const ports = { ...(cur.portDiametersMm || {}), [e.after.portIndex]: e.after.diameterMm };
        d.btoOverrides = put(d.btoOverrides, e.target, { ...cur, portDiametersMm: ports });
        break;
      }
      case SITE_EDIT.SET_BTO_PORT_DESTINATION: {
        const cur = d.btoOverrides?.[e.target] || {};
        const dest = { ...(cur.portDestinations || {}), [e.after.portIndex]: e.after.destination };
        d.btoOverrides = put(d.btoOverrides, e.target, { ...cur, portDestinations: dest });
        break;
      }
      case SITE_EDIT.ADD_BTO_PORT:
      case SITE_EDIT.REMOVE_BTO_PORT: {
        const cur = d.btoOverrides?.[e.target] || {};
        d.btoOverrides = put(d.btoOverrides, e.target,
          { ...cur, portCount: e.after.portCount });
        break;
      }
      case SITE_EDIT.SET_BTO_BODY:
        d.btoOverrides = put(d.btoOverrides, e.target,
          { ...(d.btoOverrides?.[e.target] || {}),
            bodyLengthMm: e.after.bodyLengthMm, bodyDepthMm: e.after.bodyDepthMm,
            // Entering a real body IS the verification. It stops being derived.
            dimensionsVerified: true });
        break;
      case SITE_EDIT.SET_BTO_PRICE:
        d.btoRates = put(d.btoRates, e.after.configKey, e.after.rate);
        break;
      case SITE_EDIT.ADD_BTO:
        d.btoOverrides = put(d.btoOverrides, e.target, { ...(e.after || {}), added: true });
        break;
      case SITE_EDIT.REMOVE_BTO:
        d.btoOverrides = put(d.btoOverrides, e.target, { removed: true });
        break;

      // ── Dampers ────────────────────────────────────────────────────────
      case SITE_EDIT.MOVE_DAMPER:
        d.zoneDamperOverrides = put(d.zoneDamperOverrides, e.target,
          { ...(d.zoneDamperOverrides?.[e.target] || {}), x: e.after.x, y: e.after.y });
        break;
      case SITE_EDIT.SET_DAMPER_ZONE:
        d.zoneDamperOverrides = put(d.zoneDamperOverrides, e.target,
          { ...(d.zoneDamperOverrides?.[e.target] || {}), zone: e.after.zone });
        break;
      case SITE_EDIT.ADD_DAMPER:
        d.zoneDamperOverrides = put(d.zoneDamperOverrides, e.target,
          { ...(e.after || {}), added: true });
        break;
      case SITE_EDIT.REMOVE_DAMPER:
        d.zoneDamperOverrides = put(d.zoneDamperOverrides, e.target, { removed: true });
        break;

      // ── THE DUCT OWNS THE DAMPER'S SIZE ────────────────────────────────
      // Which is why there is no "set damper diameter" edit. Changing the duct
      // is the edit; the damper, its symbol, its schedule row, its SKU and its
      // price all follow when the pipeline re-runs.
      case SITE_EDIT.SET_DUCT_DIAMETER:
        d.ductDiameterOverrides = put(d.ductDiameterOverrides, e.target, e.after.diameterMm);
        break;

      case SITE_EDIT.SET_ROUTE:
        d.routeOverrides = put(d.routeOverrides, e.target, e.after.points);
        break;
      case SITE_EDIT.LOCK_ROUTE:
        d.lockedRoutes = [...new Set([...(d.lockedRoutes || []), e.target])];
        break;
      case SITE_EDIT.UNLOCK_ROUTE:
        d.lockedRoutes = (d.lockedRoutes || []).filter(k => k !== e.target);
        break;

      case SITE_EDIT.MOVE_RETURN:
        d.returnOverrides = put(d.returnOverrides, e.target,
          { ...(d.returnOverrides?.[e.target] || {}), x: e.after.x, y: e.after.y });
        break;
      case SITE_EDIT.ADD_RETURN:
        d.returnCountOverride = e.after.count;
        break;
      case SITE_EDIT.REMOVE_RETURN:
        d.returnCountOverride = e.after.count;
        d.returnOverrides = drop(d.returnOverrides, e.target);
        break;

      case SITE_EDIT.ADD_NOTE:
        notes.push({ id: e.id, at: e.at, by: e.by, target: e.target, text: e.after.text });
        break;
      case SITE_EDIT.ADD_PHOTO:
        photos.push({ id: e.id, at: e.at, by: e.by, target: e.target,
                      dataUrl: e.after.dataUrl || null, caption: e.after.caption || '' });
        break;
      default:
        break;                                   // an edit type this build does not know
    }
  }
  d.siteNotes = notes;
  d.sitePhotos = photos;
  return d;
}

/**
 * The as-installed record: one row per component that actually changed.
 *
 * Several edits to the same component collapse to one row — its ORIGINAL value
 * and its FINAL value — because that is the comparison somebody wants when they
 * are looking at what changed on site, not a keystroke log.
 */
export function siteEditSummary(edits) {
  const byTarget = new Map();
  for (const e of edits || []) {
    const key = e.type + ':' + e.target;
    const row = byTarget.get(key);
    if (row) { row.after = e.after; row.at = e.at; row.count += 1; }
    else byTarget.set(key, { type: e.type, target: e.target, label: e.label,
                             before: e.before, after: e.after, by: e.by,
                             reason: e.reason, note: e.note, photoId: e.photoId,
                             at: e.at, count: 1 });
  }
  return [...byTarget.values()];
}

/** Which named design this is: quoted, approved, site-adjusted or as-installed. */
export const DESIGN_STAGE = Object.freeze({
  QUOTED: 'quoted design',
  APPROVED: 'approved design',
  SITE_DRAFT: 'site-adjusted draft',
  AS_INSTALLED: 'as-installed design'
});

export default { SITE_EDIT, CONFIRM_BEFORE, DESIGN_STAGE, siteEdit, newSiteSession,
                 activeEdits, pushEdit, canUndo, canRedo, undo, redo,
                 applySiteEdits, siteEditSummary };
