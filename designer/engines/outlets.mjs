// NAC AI HVAC DESIGNER — PART 15: outlet design.
// Quantity and type follow the room's airflow, geometry and throw requirement,
// against outlet capacity tables held in HVAC Design Settings.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round, mmToM } from './units.mjs';

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
  // Enough outlets to stay under the type's maximum capacity.
  let qty = Math.max(1, Math.ceil(flow / type.maxLs));

  const longest = longestDimM(room);
  const reasons = [];
  reasons.push('Room airflow ' + round(flow, 0) + ' L/s ÷ ' + type.maxLs + ' L/s maximum per ' + type.label.toLowerCase() + '.');

  if (longest && longest > O.splitIfLongestDimM && qty < 2) {
    qty = 2;
    reasons.push('Longest dimension ' + round(longest, 1) + ' m exceeds the ' + O.splitIfLongestDimM +
      ' m single-outlet throw limit — split into two outlets.');
  }
  if (qty > O.maxOutletsPerRoom) {
    qty = O.maxOutletsPerRoom;
    reasons.push('Capped at the configured maximum of ' + O.maxOutletsPerRoom + ' outlets per room.');
  }

  const perOutlet = qty > 0 ? flow / qty : 0;
  const warnings = [];
  if (perOutlet > type.maxLs) warnings.push({ code: 'OUTLET_OVER_CAPACITY', severity: 'WARNING',
    message: room.label + ': ' + round(perOutlet, 0) + ' L/s per outlet exceeds the ' + type.maxLs + ' L/s limit for a ' + type.label.toLowerCase() + '.' });
  if (perOutlet < type.minLs && flow > 0) warnings.push({ code: 'OUTLET_UNDER_CAPACITY', severity: 'CHECK',
    message: room.label + ': ' + round(perOutlet, 0) + ' L/s per outlet is below the ' + type.minLs + ' L/s minimum — throw and mixing will be poor.' });
  if (!room.widthMm || !room.lengthMm) warnings.push({ code: 'OUTLET_GEOMETRY_ASSUMED', severity: 'INFO',
    message: room.label + ': room has no width/length, so throw distance was assumed from floor area.' });

  return {
    roomId: room.id,
    label: room.label,
    airflowLs: round(flow, 0),
    type: typeKey,
    typeLabel: type.label,
    quantity: qty,
    perOutletLs: round(perOutlet, 0),
    throwRatingM: type.throwM,
    faceVelocityMs: type.faceVelocityMs,
    longestDimM: longest !== null ? round(longest, 2) : null,
    reasons,
    warnings,
    overridden: false
  };
}

export function designOutlets(rooms, airflowRows, opts = {}) {
  const byId = new Map((rooms || []).map(r => [r.id, r]));
  const overrides = opts.overridesByRoomId || {};
  const results = (airflowRows || []).map(a => {
    const room = byId.get(a.roomId) || { id: a.roomId, label: a.label };
    const ov = overrides[a.roomId] || {};
    const base = designRoomOutlets(room, a.adjustedLs, { ...opts, type: ov.type });
    if (ov.quantity) {
      const qty = Number(ov.quantity);
      return {
        ...base,
        quantity: qty,
        perOutletLs: round(base.airflowLs / qty, 0),
        overridden: true,
        reasons: [...base.reasons, 'Quantity manually set to ' + qty + ' by the estimator.'],
        warnings: [...base.warnings, { code: 'MANUAL_OVERRIDE', severity: 'INFO',
          message: base.label + ': outlet quantity manually overridden.' }]
      };
    }
    return base;
  });

  const totals = results.reduce((acc, r) => {
    acc.total += r.quantity;
    acc.byType[r.type] = (acc.byType[r.type] || 0) + r.quantity;
    return acc;
  }, { total: 0, byType: {} });

  return { rows: results, totals, warnings: results.flatMap(r => r.warnings) };
}
