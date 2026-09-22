// ─────────────────────────────────────────────────────────────────────────────
// ONE OUTLET, ONE RECORD
//
// The plan drew outlets, the schedule listed outlets, and the bill of materials
// bought outlets — and all three worked it out separately.
//
// That is not a tidiness problem. The BOM priced a round diffuser off
// `branchDiameterByRoom`, which is the BRANCH duct feeding the room, while the
// schedule printed `neckMm`, which is the outlet's own neck. On a room with a
// ø250 branch and a ø200 neck the two are different numbers for the same
// fitting, so the sheet said ø200 and the order bought a ø250. Nobody finds
// that out until a box is opened in a roof.
//
// Nick: "There must be one authoritative outlet object carrying ID, room, type,
// airflow, neck diameter, final-duct diameter, catalogue item, SKU and price.
// The plan, the schedule and the bill of materials must all read it."
//
// So they do. This module builds the register and then CHECKS it against the
// three surfaces, because a single source of truth that nothing verifies is
// just a fourth place to be wrong.
// ─────────────────────────────────────────────────────────────────────────────

import { round } from './units.mjs';
import { resolveCost, OUTLET_MATERIAL_KEY, MATERIAL_CATALOGUE } from './materials.mjs';

const rows = (v) => Array.isArray(v) ? v : [];

/**
 * The final duct that actually reaches each outlet of a room.
 *
 * Two network shapes have to be read. The routed tree records a `final` section
 * per outlet with a `roomId`; the flat model only creates finals when a room has
 * more than one outlet, and a single-outlet room is reached by its branch. Both
 * describe the same metal, so both are read into the same field rather than
 * leaving the caller to know which model it is looking at.
 */
export function finalDuctsByRoom(network) {
  const sections = rows(network?.sections);
  const byRoom = new Map();

  for (const s of sections) {
    if (s.role !== 'final') continue;
    const roomId = s.roomId || (/^final_(.+)_\d+$/.exec(s.id || '') || [])[1] || null;
    if (!roomId) continue;
    if (!byRoom.has(roomId)) byRoom.set(roomId, []);
    byRoom.get(roomId).push(s);
  }

  // A room with no final of its own is fed straight off its branch.
  for (const s of sections) {
    const m = /^branch_(.+)$/.exec(s.id || '');
    if (!m) continue;
    if (byRoom.has(m[1])) continue;
    byRoom.set(m[1], [s]);
  }
  return byRoom;
}

/**
 * Build the register.
 *
 * One entry per PHYSICAL OUTLET, not per room: a living room with three
 * diffusers is three records, because three boxes get ordered and three holes
 * get cut.
 */
export function buildOutletRegister(design, opts = {}) {
  const nacRates = opts.nacRates || null;
  const finals = finalDuctsByRoom(design?.network);
  const out = [];

  for (const row of rows(design?.outlets?.rows)) {
    const runs = finals.get(row.roomId) || [];
    const qty = Math.max(1, Math.round(Number(row.quantity) || 1));
    const materialKey = OUTLET_MATERIAL_KEY[row.type] || null;
    const def = materialKey ? MATERIAL_CATALOGUE[materialKey] : null;

    for (let i = 0; i < qty; i++) {
      // The run that reaches THIS outlet. Where the router produced one final
      // per outlet they line up in order; where it produced one shared run,
      // every outlet on the room is on it.
      const run = runs[i] || runs[0] || null;

      // ── WHICH DIAMETER THE OUTLET IS BOUGHT BY ──────────────────────────
      //
      // Its NECK: the hole in the back of the diffuser, and the size the
      // catalogue is indexed by. The final duct clamps onto it, so on a real
      // outlet the two ARE the same number.
      //
      // They were not. The outlet engine sizes a neck from NAC's airflow
      // bands; the router sizes the final duct from the same bands UNLESS the
      // estimator has declared one. On the approved Dungannon job installer
      // area A is fixed at ø250 outlet duct, so the router fitted ø250 flex
      // while the outlet engine went on calling it a ø300 neck at 113 L/s —
      // one outlet, two sizes, and the order would have bought the ø300 box.
      //
      // A DECLARED DUCT WINS. The estimator fixing the outlet duct at ø250 has
      // specified a ø250 outlet; the neck follows the metal, not the band
      // table. Where that leaves the outlet below what the bands would fit, it
      // is recorded (`neckBelowBandMm`) so the throttling is visible — but it
      // is the estimator's call on their own job, not an error.
      const finalDuctMm = run ? (Number(run.diameterMm) || null) : null;
      const ductDeclared = !!(run && run.selection && run.selection.manual === true);
      const bandNeckMm = Number(row.neckMm) || null;
      const neckMm = (ductDeclared && finalDuctMm) ? finalDuctMm : bandNeckMm;
      const neckBelowBandMm = (bandNeckMm && neckMm && neckMm < bandNeckMm)
        ? bandNeckMm : null;

      const priced = (def?.byDiameter && neckMm)
        ? resolveCost(materialKey, { diameterMm: neckMm, nacRates })
        : materialKey ? resolveCost(materialKey, { nacRates }) : null;

      out.push({
        id: 'outlet_' + row.roomId + '_' + (i + 1),
        index: i + 1,
        roomId: row.roomId,
        room: row.label,
        type: row.type,
        typeLabel: row.typeLabel,
        airflowLs: round(Number(row.perOutletLs) || 0, 0),
        neckMm,
        /** What NAC's airflow bands would have fitted, kept beside what was. */
        neckByBandMm: bandNeckMm,
        neckFollowsDeclaredDuct: ductDeclared && !!finalDuctMm,
        neckBelowBandMm,
        faceSizeMm: row.faceSizeMm ?? null,
        finalDuctMm,
        finalSectionId: run?.id || null,
        zone: run?.zone || null,
        catalogueKey: materialKey,
        catalogueLabel: priced?.label || null,
        // A supplier code is a real part number or it is null. An empty string
        // reads as "we have one" to anything that puts it on an order.
        sku: priced?.supplierCode || null,
        unitCost: priced && priced.cost !== null && priced.cost !== undefined
          ? priced.cost : null,
        priceSource: priced?.source || null,
        priced: !!(priced && priced.cost !== null && priced.cost !== undefined)
      });
    }
  }
  return out;
}

/**
 * Do the plan, the schedule and the order describe the same outlets?
 *
 * Counts first, because that is the one that reached the Kauri proposal: a
 * room count, an outlet count and a coverage claim that did not agree with one
 * another on the same page.
 */
export function checkOutletConsistency({ register = [], design = null,
                                         scheduleRooms = null } = {}) {
  const failures = [];
  const reg = rows(register);

  // ── 1. THE ORDER BUYS WHAT THE REGISTER LISTS ────────────────────────────
  const bomOutletQty = rows(design?.bom?.items)
    .filter(i => i.category === 'outlets')
    .reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const registerQty = reg.filter(o => o.catalogueKey).length;
  if (bomOutletQty && registerQty && Math.abs(bomOutletQty - registerQty) > 0.01) {
    failures.push({
      code: 'BOM_OUTLET_COUNT_DISAGREES',
      severity: 'CRITICAL',
      message: 'The bill of materials buys ' + bomOutletQty + ' outlet(s) for the '
        + registerQty + ' outlet(s) on the design. The order and the drawing must be the '
        + 'same design.'
    });
  }

  // ── 2. THE ORDER BUYS THE SIZE THE DRAWING FITS ──────────────────────────
  // With the neck following a declared duct, a narrower duct than neck can now
  // only mean the two AUTO answers disagree — which is the bug this register
  // exists to catch, not a decision anybody made.
  const mismatched = reg.filter(o =>
    o.neckMm && o.finalDuctMm && o.finalDuctMm < o.neckMm);
  if (mismatched.length) {
    failures.push({
      code: 'FINAL_DUCT_SMALLER_THAN_NECK',
      severity: 'CRITICAL',
      message: mismatched.length + ' outlet(s) have a final duct narrower than the neck they '
        + 'connect to: ' + mismatched.map(o => o.room + ' ø' + o.finalDuctMm + ' into ø'
        + o.neckMm).join('; ') + '. Nobody chose that — the duct engine and the outlet '
        + 'engine have sized the same outlet differently.',
      outlets: mismatched.map(o => o.id)
    });
  }

  // ── 3. EVERY OUTLET IS A PART SOMEBODY CAN BUY ───────────────────────────
  const unpriceable = reg.filter(o => !o.catalogueKey);
  if (unpriceable.length) {
    failures.push({
      code: 'OUTLET_NOT_IN_CATALOGUE',
      severity: 'CRITICAL',
      message: unpriceable.length + ' outlet(s) are of a type with no catalogue item: '
        + [...new Set(unpriceable.map(o => o.typeLabel || o.type))].join(', ')
        + '. An outlet that cannot be bought cannot be quoted.',
      outlets: unpriceable.map(o => o.id)
    });
  }

  // ── 4. THE SCHEDULE COUNTS WHAT THE REGISTER COUNTS ──────────────────────
  if (Array.isArray(scheduleRooms) && scheduleRooms.length) {
    const scheduled = scheduleRooms.reduce((n, r) => n + (Number(r.outletCount) || 0), 0);
    const byRoomInRegister = reg.filter(o =>
      scheduleRooms.some(r => r.room === o.room)).length;
    if (scheduled !== byRoomInRegister) {
      failures.push({
        code: 'SCHEDULE_OUTLET_COUNT_DISAGREES',
        severity: 'CRITICAL',
        message: 'The outlet schedule lists ' + scheduled + ' outlet(s) against '
          + byRoomInRegister + ' on the design.'
      });
    }
  }

  // Not a failure — a consequence the estimator owns, stated out loud.
  const throttled = reg.filter(o => o.neckBelowBandMm);
  const notes = throttled.length ? [{
    code: 'OUTLET_NECK_BELOW_AIRFLOW_BAND',
    severity: 'CHECK',
    message: throttled.length + ' outlet(s) carry a declared duct below the size NAC\'s '
      + 'airflow bands would fit: ' + throttled.map(o => o.room + ' ø' + o.neckMm
      + ' at ' + o.airflowLs + ' L/s (bands fit ø' + o.neckBelowBandMm + ')').join('; ')
      + '. Expect a higher face velocity and less air than the calculation allocates.',
    outlets: throttled.map(o => o.id)
  }] : [];

  return {
    ok: failures.length === 0,
    failures,
    notes,
    outletCount: reg.length,
    roomCount: new Set(reg.map(o => o.roomId)).size
  };
}

/** The register as BOM lines, so the order is the register in another shape. */
export function outletBomLines(register, ctx = {}) {
  const buckets = new Map();
  for (const o of rows(register)) {
    if (!o.catalogueKey) continue;
    const key = o.catalogueKey + '|' + (o.neckMm || '');
    if (!buckets.has(key)) buckets.set(key, { key: o.catalogueKey, diameterMm: o.neckMm || null,
                                              quantity: 0, outletIds: [] });
    const b = buckets.get(key);
    b.quantity += 1;
    b.outletIds.push(o.id);
  }
  return [...buckets.values()];
}

export default { buildOutletRegister, checkOutletConsistency, outletBomLines, finalDuctsByRoom };
