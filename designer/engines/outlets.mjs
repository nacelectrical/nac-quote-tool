// NAC AI HVAC DESIGNER — PART 15: outlet design.
// Quantity and type follow the room's airflow, geometry and throw requirement,
// against outlet capacity tables held in HVAC Design Settings.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round, mmToM } from './units.mjs';
import { selectDiameter, ductAreaM2, velocity } from './ducts.mjs';
import { FINAL_FLEX, maxAirflowPerOutletLs } from './nac-standard.mjs';

/**
 * THE THREE SIZES, WHICH ARE NOT THE SAME NUMBER.
 *
 *   room airflow -> BRANCH DUCT diameter   the run from the trunk to the room
 *                -> OUTLET NECK size       what the flex connects to at the ceiling
 *                -> DIFFUSER FACE size     the visible fitting, set by the model
 *
 * Collapsing these into one figure is how a diffuser came to be labelled
 * "150" on a drawing: that was the smallest duct the velocity maths allowed,
 * it was never the neck NAC installs, and it was never the face size at all.
 *
 * The neck is what NAC orders by — a "250 diffuser" means a 250 neck — so it is
 * derived here from the per-outlet airflow under NAC's final-duct rules. The
 * face is a property of the chosen diffuser model and cannot be calculated from
 * airflow, so it is reported as coming from the model rather than invented.
 */
export function outletSizing(perOutletLs, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const O = settings.outlets;
  const flow = Number(perOutletLs) || 0;

  // The neck follows NAC's final-branch rules: 200 minimum, 300 maximum, never
  // a 150 automatically.
  const pick = selectDiameter(flow, 'final', { settings });
  const allowed = O.neckSizesMm || settings.duct.finalBranch.autoLadderMm;

  // NAC's own airflow bands come first, because NAC fits a size up from what
  // the velocity maths alone would choose. Where the velocity calculation wants
  // something LARGER than the band (a lot of air through one outlet), the
  // larger of the two wins — practice is a floor, not a licence to undersize.
  const band = (O.neckByAirflowLs || []).find(b => flow <= b.upToLs);
  const byPractice = band ? band.neckMm : Math.max(...allowed);
  const byVelocity = allowed.includes(pick.diameterMm)
    ? pick.diameterMm
    : allowed.reduce((best, d) => (d >= pick.diameterMm && (best === null || d < best) ? d : best), null)
      ?? Math.max(...allowed);
  const neckMm = Math.min(Math.max(byPractice, byVelocity), Math.max(...allowed));

  const faceMm = O.faceSizeByNeckMm?.[neckMm] ?? null;

  return {
    perOutletLs: round(flow, 0),
    // What the flex connects to. This is the number NAC orders by.
    neckMm,
    neckVelocityMs: round(velocity(neckMm, flow), 2),
    // The visible fitting. Not calculable from airflow.
    faceSizeMm: faceMm,
    faceSizeKnown: faceMm !== null,
    faceSizeNote: faceMm !== null ? null : (O.faceSizeNote || 'Face size comes from the selected diffuser model.'),
    // Why this neck, in NAC's own terms.
    neckReason: band
      ? 'NAC fits a ' + neckMm + ' mm neck up to ' + band.upToLs + ' L/s per outlet' +
        (byVelocity > byPractice ? ', raised to ' + neckMm + ' mm by the velocity check' : '') + '.'
      : pick.reason,
    neckByPracticeMm: byPractice,
    neckByVelocityMm: byVelocity,
    atNeckMaximum: neckMm === Math.max(...allowed),
    overCapacity: pick.overCapacity,
    carryLimitLs: pick.carryLimitLs
  };
}

/** Longest plan dimension of a room, in metres. */
function longestDimM(room) {
  if (!room) return null;
  if (room.widthMm && room.lengthMm) return mmToM(Math.max(room.widthMm, room.lengthMm));
  if (room.areaSqM) return Math.sqrt(room.areaSqM) * 1.2;   // square-ish assumption, flagged by caller
  return null;
}

/**
 * Recommend outlets for one room.
 * @param {Object} room      DesignRoom
 * @param {Number} airflowLs design airflow for that room
 */
export function designRoomOutlets(room, airflowLs, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const O = settings.outlets;
  const typeKey = opts.type || room.preferredOutletType || O.defaultType;
  const type = O.types[typeKey] || O.types[O.defaultType];

  const flow = Number(airflowLs) || 0;

  // NAC's practice for this kind of room, not just whatever the capacity table
  // divides into. A bedroom gets one outlet; a long living area gets the air
  // spread across the space instead of blown from one corner.
  const roomType = room.roomType || 'other';
  const practice = (O.byRoomType && (O.byRoomType[roomType] || O.byRoomType.other)) ||
                   { preferred: 1, maxAuto: O.maxOutletsPerRoom,
                     splitOverM: O.splitIfLongestDimM, splitOverSqM: Infinity };

  const reasons = [];
  let qty = Math.max(1, practice.preferred || 1);
  reasons.push('NAC fits ' + qty + ' outlet' + (qty > 1 ? 's' : '') + ' in a ' + roomType +
               ' as standard' + (practice.note ? ' — ' + practice.note : '') + '.');

  // Capacity of the fitting NAC is using.
  const byCapacity = Math.max(1, Math.ceil(flow / type.maxLs));
  if (byCapacity > qty) {
    qty = byCapacity;
    reasons.push(round(flow, 0) + ' L/s needs ' + qty + ' at ' + type.maxLs + ' L/s per ' +
                 type.label.toLowerCase() + '.');
  }

  // NAC's final-duct ceiling: a room wanting more air than one 300 should carry
  // gets ANOTHER OUTLET, never a bigger final. This is the rule that keeps 350
  // and 400 off outlet connections.
  // THE NAC DUCT DESIGN STANDARD: a room wanting more air than one final should
  // carry gets ANOTHER OUTLET, never a bigger duct.
  const maxNeck = settings.duct.finalBranch?.maxMm ?? FINAL_FLEX.maxMm;
  const perOutletCeilingLs = maxNeck === FINAL_FLEX.maxMm
    ? maxAirflowPerOutletLs(settings.duct.velocity.final.max)
    : ductAreaM2(maxNeck) * settings.duct.velocity.final.max * 1000;
  const byDuctLimit = Math.max(1, Math.ceil(flow / perOutletCeilingLs));
  if (byDuctLimit > qty) {
    qty = byDuctLimit;
    reasons.push(round(flow, 0) + ' L/s is more than a ' + maxNeck + ' mm final should carry (' +
                 round(perOutletCeilingLs, 0) + ' L/s) — split across ' + qty + ' outlets rather than ' +
                 'fitting a larger duct.');
  }

  // Throw and distribution: a long or large room needs the air spread.
  const longest = longestDimM(room);
  if (longest && practice.splitOverM && longest > practice.splitOverM && qty < 2) {
    qty = 2;
    reasons.push('Longest dimension ' + round(longest, 1) + ' m exceeds the ' + practice.splitOverM +
      ' m single-outlet throw limit for a ' + roomType + ' — split into two.');
  }
  if (room.areaSqM && practice.splitOverSqM && room.areaSqM > practice.splitOverSqM && qty < 2) {
    qty = 2;
    reasons.push(round(room.areaSqM, 1) + ' m² is over the ' + practice.splitOverSqM +
      ' m² single-outlet limit for a ' + roomType + ' — split into two.');
  }

  // Two different ceilings, and they are not the same kind of rule.
  //
  // `maxAuto` is NAC's PRACTICE for this kind of room — how many outlets are
  // normally fitted. Airflow that genuinely needs more overrules it, because
  // fitting fewer would run every outlet over its limit.
  //
  // `maxOutletsPerRoom` is a configured HARD ceiling. It is respected even when
  // the airflow wants more, and the shortfall is reported rather than silently
  // exceeded — that is the estimator's call, not the engine's.
  const practiceCap = practice.maxAuto ?? O.maxOutletsPerRoom;
  if (qty > practiceCap) {
    if (Math.max(byCapacity, byDuctLimit) > practiceCap) {
      reasons.push('More than the usual ' + practiceCap + ' outlets for a ' + roomType +
                   ', because the airflow needs them.');
    } else {
      qty = practiceCap;
      reasons.push('Held at ' + practiceCap + ' outlets — the most NAC normally fits in a ' + roomType + '.');
    }
  }
  if (qty > O.maxOutletsPerRoom) {
    qty = O.maxOutletsPerRoom;
    reasons.push('Capped at the configured maximum of ' + O.maxOutletsPerRoom + ' outlets per room.');
  }

  // ── THE OVERRIDE LANDS HERE, BEFORE ANYTHING IS CHECKED ──────────────────
  //
  // It used to land after: the row's quantity and per-outlet airflow were
  // replaced by the estimator's number, but the capacity check, the neck, the
  // duct and the reasoning text were all still the ones worked out for the
  // AUTOMATIC quantity. So an open-plan area cut from three outlets to two ran
  // at 175 L/s through a diffuser configured for 130 and said nothing at all —
  // the one case where the warning matters most is the one case it was silent.
  //
  // Everything below this line is computed from `qty`, whatever set it.
  const recommendedQuantity = qty;
  const overrideQty = opts.quantity;
  const hasOverride = overrideQty !== undefined && overrideQty !== null && overrideQty !== '';
  if (hasOverride) {
    qty = Math.max(0, Number(overrideQty) || 0);
    reasons.push('Quantity manually set to ' + qty + ' by the estimator' +
      (qty === recommendedQuantity ? ' (the same as the calculated quantity).'
        : ', against a calculated ' + recommendedQuantity + '.'));
  }

  const perOutlet = qty > 0 ? flow / qty : 0;
  const warnings = [];
  if (hasOverride) warnings.push({ code: 'MANUAL_OVERRIDE', severity: 'INFO',
    message: room.label + ': outlet quantity manually set to ' + qty +
      ' (calculated ' + recommendedQuantity + ').' });
  if (hasOverride && qty === 0) warnings.push({ code: 'ROOM_HAS_NO_OUTLET', severity: 'WARNING',
    message: room.label + ' has been set to NO outlet while it still carries ' +
      round(flow, 0) + ' L/s of design airflow. Either it is on spill air and ' +
      'should be recorded as such, or it needs an outlet.' });
  if (perOutlet > type.maxLs) warnings.push({ code: 'OUTLET_OVER_CAPACITY', severity: 'WARNING',
    message: room.label + ': ' + round(perOutlet, 0) + ' L/s per outlet exceeds the ' + type.maxLs +
      ' L/s limit for a ' + type.label.toLowerCase() + '. ' + round(flow, 0) + ' L/s needs ' +
      Math.ceil(flow / type.maxLs) + ' of them, or an outlet type rated for ' +
      round(perOutlet, 0) + ' L/s.' });
  if (perOutlet < type.minLs && flow > 0) warnings.push({ code: 'OUTLET_UNDER_CAPACITY', severity: 'CHECK',
    message: room.label + ': ' + round(perOutlet, 0) + ' L/s per outlet is below the ' + type.minLs + ' L/s minimum — throw and mixing will be poor.' });
  if (!room.widthMm || !room.lengthMm) warnings.push({ code: 'OUTLET_GEOMETRY_ASSUMED', severity: 'INFO',
    message: room.label + ': room has no width/length, so throw distance was assumed from floor area.' });

  // The three sizes, worked out separately and reported separately.
  const sizing = outletSizing(perOutlet, { settings });
  const branch = selectDiameter(flow, 'branch', { settings });
  if (sizing.overCapacity) warnings.push({ code: 'OUTLET_NECK_OVER_CAPACITY', severity: 'WARNING',
    message: room.label + ': ' + sizing.perOutletLs + ' L/s is more than a ' + sizing.neckMm +
             ' mm neck should carry. Add an outlet.' });

  return {
    roomId: room.id,
    label: room.label,
    roomType,
    airflowLs: round(flow, 0),
    type: typeKey,
    typeLabel: type.label,
    quantity: qty,
    /** What the engine would have fitted — kept beside what was fitted. */
    recommendedQuantity,
    perOutletLs: round(perOutlet, 0),
    // ROOM AIRFLOW -> BRANCH DUCT -> OUTLET NECK -> DIFFUSER FACE.
    branchDiameterMm: branch.diameterMm,
    branchVelocityMs: branch.velocityMs,
    neckMm: sizing.neckMm,
    neckVelocityMs: sizing.neckVelocityMs,
    faceSizeMm: sizing.faceSizeMm,
    faceSizeKnown: sizing.faceSizeKnown,
    faceSizeNote: sizing.faceSizeNote,
    neckReason: sizing.neckReason,
    throwRatingM: type.throwM,
    faceVelocityMs: type.faceVelocityMs,
    longestDimM: longest !== null ? round(longest, 2) : null,
    reasons,
    warnings,
    overridden: hasOverride,
    quantityOverridden: hasOverride
  };
}

export function designOutlets(rooms, airflowRows, opts = {}) {
  const byId = new Map((rooms || []).map(r => [r.id, r]));
  const overrides = opts.overridesByRoomId || {};
  // WHERE AN OUTLET POSITION CAME FROM, kept for the audit trail. A mark read
  // off the uploaded sheet and a position an estimator typed are both valid and
  // are NOT the same thing: one is evidence, the other is a decision. Reporting
  // a typed position as a detected mark would be the tool claiming it saw
  // something it did not.
  const placedBy = opts.outletPositionSourceByRoomId || {};
  const results = (airflowRows || []).map(a => {
    const room = byId.get(a.roomId) || { id: a.roomId, label: a.label };
    const ov = overrides[a.roomId] || {};
    const positionSource = placedBy[a.roomId]
      || (room.outletPositionSource || (room.manualOutlets ? 'estimator_placed' : 'auto_derived'));
    // BOTH OVERRIDES GO IN AS INPUTS. The type always did; the quantity used to
    // be stitched on afterwards, which left every check describing a design
    // nobody had asked for. ZERO IS A NUMBER SOMEBODY CHOSE, and it still is —
    // a room set to no outlet keeps its load and its air and says so loudly.
    return { ...designRoomOutlets(room, a.adjustedLs,
                                  { ...opts, type: ov.type, quantity: ov.quantity }),
             positionSource,
             positionIsManual: positionSource === 'estimator_placed' };
  });

  const totals = results.reduce((acc, r) => {
    acc.total += r.quantity;
    acc.byType[r.type] = (acc.byType[r.type] || 0) + r.quantity;
    return acc;
  }, { total: 0, byType: {} });

  return { rows: results, totals, warnings: results.flatMap(r => r.warnings) };
}
