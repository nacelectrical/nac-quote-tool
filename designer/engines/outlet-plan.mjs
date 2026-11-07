// ─────────────────────────────────────────────────────────────────────────────
// HOW MANY OUTLETS, AND WHICH ZONE EACH ONE IS IN
//
// Nick, 7 November 2026: "Hasn't calculated how many outlets per zone."
//
// The scope asked for ONE number — the outlet count for the whole job — and
// the rooms each carried a box to type a count into. Nothing worked either out
// and nothing added them up per zone, so a six-zone house meant typing eight
// numbers and then a ninth that had to agree with them.
//
// WHERE THESE NUMBERS COME FROM
//
// NAC's own published rules, in nac-standard.mjs, written down long before
// this file: one outlet per room, a second once the room is bigger than the
// split area for its type, and a hard ceiling per type and per room. A living
// room splits over 20 m²; a study never splits at all. None of that is decided
// here — this applies it and says which rule it used.
//
// WHAT IT WILL NOT DO
//
// Guess at a room it cannot size. A room with no area gets its type's
// preferred count and is REPORTED as unsized, because one outlet in a room
// that needed three is a quote that loses money and a quote that cannot be
// checked. The estimator overrides any room by typing a number, and a typed
// number always wins — the same rule as everywhere else in this application.
//
// This is a proposal, not a duct design. It sizes nothing, and it is not a
// substitute for the airflow calculation that a designed job gets.
// ─────────────────────────────────────────────────────────────────────────────

import { OUTLET_RULES } from './nac-standard.mjs';
import { classifyRoomLabel } from './classify.mjs';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ruleFor = (type) =>
  OUTLET_RULES.byRoomType[type] || OUTLET_RULES.byRoomType.other;

/**
 * The outlets one room takes.
 *
 * @param {object} room  { label, areaSqM?, longestWallM?, outlets? }
 * @returns {{outlets:number, source:string, why:string, roomType:string,
 *            sized:boolean, entered:boolean}}
 */
export function outletsForRoom(room = {}) {
  const label = String(room.label || '').trim();
  const roomType = classifyRoomLabel(label).roomType || 'other';
  const rule = ruleFor(roomType);

  // ── A TYPED NUMBER IS THE ANSWER ──────────────────────────────────────
  //
  // Not a starting point to be improved on. The estimator stood in the room.
  const typed = num(room.outlets);
  if (typed !== null && typed >= 0) {
    return { outlets: Math.round(typed), source: 'entered', roomType, sized: true,
             entered: true, why: 'Entered for this job.' };
  }

  const area = num(room.areaSqM);
  const longest = num(room.longestWallM);

  if (area === null && longest === null) {
    return { outlets: rule.preferred, source: 'rule_unsized', roomType,
             sized: false, entered: false,
             why: 'No size on file for this room, so it is counted at '
               + rule.preferred + '. Check it.' };
  }

  // The split tests, exactly as NAC states them: either one can trip.
  let outlets = rule.preferred;
  const reasons = [];
  if (area !== null && area > rule.splitOverSqM) {
    // How many times over the split area, rather than a flat "add one": a
    // 44 m² living area is not a 21 m² living area with one more outlet.
    outlets = Math.max(outlets, Math.ceil(area / rule.splitOverSqM));
    reasons.push(Math.round(area * 10) / 10 + ' m², over the '
      + rule.splitOverSqM + ' m² a ' + roomType + ' takes on one outlet');
  }
  if (longest !== null && longest > rule.splitOverM) {
    outlets = Math.max(outlets, 2);
    reasons.push(longest + ' m long, over the ' + rule.splitOverM + ' m a '
      + roomType + ' covers from one outlet');
  }

  // Two ceilings, and the tighter one wins: the type's own, and the hard
  // per-room limit that applies whatever the airflow wants.
  const ceiling = Math.min(rule.maxAuto, OUTLET_RULES.maxPerRoom);
  const capped = outlets > ceiling;
  outlets = Math.min(outlets, ceiling);

  return {
    outlets, roomType, sized: true, entered: false,
    source: reasons.length ? 'rule_split' : 'rule_preferred',
    why: reasons.length
      ? reasons.join(', and ') + (capped ? ', capped at ' + ceiling : '')
      : 'One outlet covers a ' + roomType + ' of this size.'
  };
}

/**
 * Every room, grouped by the zone it is in.
 *
 * Rooms are matched to zones by NAME, case-insensitively, the same way the
 * quote source builds the zone schedule. A room in no zone is returned under
 * `unzoned` rather than dropped: it still gets outlets, and the estimator can
 * see it is outside the zoning.
 *
 * @returns {{zones:Array, unzoned:object, total:number, unsized:number}}
 */
export function outletsByZone(rooms = [], zoneNames = []) {
  const list = Array.isArray(rooms) ? rooms.filter(Boolean) : [];
  const counted = list.map(r => ({ ...outletsForRoom(r), label: String(r.label || '').trim(),
                                   zone: String(r.zone || '').trim() }));

  const key = (s) => String(s || '').trim().toLowerCase();
  const group = (name) => {
    const inZone = counted.filter(r => key(r.zone) === key(name));
    return {
      zone: name,
      rooms: inZone,
      outlets: inZone.reduce((n, r) => n + r.outlets, 0),
      unsized: inZone.filter(r => !r.sized).length
    };
  };

  const names = Array.isArray(zoneNames) ? zoneNames.filter(Boolean) : [];
  const zones = names.map(group);

  const loose = counted.filter(r => !r.zone
    || !names.some(n => key(n) === key(r.zone)));

  return {
    zones,
    unzoned: { zone: null, rooms: loose,
               outlets: loose.reduce((n, r) => n + r.outlets, 0),
               unsized: loose.filter(r => !r.sized).length },
    total: counted.reduce((n, r) => n + r.outlets, 0),
    unsized: counted.filter(r => !r.sized).length
  };
}

export default { outletsForRoom, outletsByZone };
