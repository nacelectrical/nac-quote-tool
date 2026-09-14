// NAC AI HVAC DESIGNER — WHICH ROOMS SHARE A ZONE.
//
// The failure this exists to stop: every conditioned room became its own zone,
// because `suggestZones` keys on `room.openPlanGroup || room.id` and nothing on
// a real uploaded plan ever set `openPlanGroup` — it was only ever typed by
// hand on the Sizing tab or hardcoded into the sample-plan fixture.
//
// On a four-bedroom house that produced ELEVEN zones. Eleven zones is not a
// cosmetic problem:
//
//   - it blows past the eight the manufacturer's included controller handles,
//     so the job buys a zone controller kit it does not need;
//   - it buys eleven zone motors and eleven cable runs instead of four or five;
//   - and with eleven individually damped zones shut, the airflow left open
//     falls to about 5% of design against a 40% minimum, which is a CRITICAL
//     warning that stops the quote.
//
// WHAT IS A FACT AND WHAT IS A PROPOSAL
//
// Rooms that are open to one another cannot be dampered apart. That is physics,
// and grouping them is not a preference. Whether NAC puts three bedrooms on one
// zone or three is a DESIGN DECISION, and this engine never makes it silently.
//
// So: open-plan areas are grouped automatically, everything else is left alone,
// and where the zoning then fails the controller limit or the minimum-airflow
// rule the engine names the exact merge that would fix it and leaves it to the
// estimator.
//
// HOW SURE IT IS
//
// Two rooms are open to one another if the drawing says so. Where the plan
// reader returned walls and openings, that is read directly and the grouping is
// HIGH confidence. Where it did not, adjacency falls back to the room
// rectangles — which on a brochure plan are placed from a printed size centred
// on a label, so they are approximate. That grouping is reported at MEDIUM and
// the review screen asks for a glance. It is never presented as surveyed fact.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { isConditionedRoom } from './classify.mjs';

/**
 * Room types that form a single open-plan living area. A kitchen, the meals
 * area and the family room in a modern Australian house are one volume of air
 * with no door anywhere in it.
 */
export const OPEN_PLAN_TYPES = new Set(['kitchen', 'dining', 'living']);

/**
 * Circulation. A hallway or entry is open to whatever it runs into, so it can
 * join a group — but it never STARTS one, or two bedrooms either side of a
 * passage would be pulled into the same zone.
 */
export const CIRCULATION_TYPES = new Set(['hallway']);

/** How close two room rectangles must be to count as touching: one wall. */
export const ADJACENCY_TOLERANCE_MM = 400;

const rect = (r) => {
  const b = r?.boundaryPx;
  if (!b) return null;
  const x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
  if (![x, y, w, h].every(n => isFinite(n)) || w <= 0 || h <= 0) return null;
  return { x0: x, y0: y, x1: x + w, y1: y + h };
};

/** Overlap of two 1-D spans, negative when they are apart. */
const spanOverlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * Are these two rooms touching on the drawing?
 *
 * Rectangles that overlap count as touching. On a plan whose boundaries were
 * placed from a printed size centred on a label, an overlap does not mean the
 * rooms are literally on top of each other — it means the placement is
 * approximate and they are in the same part of the house. Treating that as
 * "apart" would leave a genuine open-plan area ungrouped, which is the failure
 * this engine exists to fix.
 */
export function roomsTouch(a, b, calibration, tolMm = ADJACENCY_TOLERANCE_MM) {
  const ra = rect(a), rb = rect(b);
  if (!ra || !rb) return { touching: false, reason: 'One of the rooms has no boundary on the plan.' };

  const ppm = calibration?.pixelsPerMm;
  const tolPx = ppm ? tolMm * ppm : 0;

  const dx = spanOverlap(ra.x0, ra.x1, rb.x0, rb.x1);
  const dy = spanOverlap(ra.y0, ra.y1, rb.y0, rb.y1);

  // Overlapping in both directions: the same region of the plan.
  if (dx > 0 && dy > 0) {
    return { touching: true, overlapping: true, gapMm: 0,
             reason: 'The two rooms occupy the same part of the plan.' };
  }
  // Touching along one edge, within a wall's thickness.
  if (dx > -tolPx && dy > -tolPx) {
    const gapPx = Math.max(-dx, -dy, 0);
    return { touching: true, overlapping: false,
             gapMm: ppm ? round(gapPx / ppm, 0) : null,
             reason: 'The two rooms meet along an edge.' };
  }
  const gapPx = Math.max(-dx, -dy);
  return { touching: false, gapMm: ppm ? round(gapPx / ppm, 0) : null,
           reason: 'The two rooms are ' + (ppm ? round(gapPx / ppm / 1000, 1) + ' m' : 'some way') + ' apart.' };
}

/**
 * The strip of plan between two rooms — where a dividing wall would sit.
 *
 * Two rooms side by side share a vertical strip: a narrow band of x around the
 * edge where they meet, spanning the y they have in common. Stacked rooms are
 * the same the other way round. Rooms whose rectangles overlap — the
 * approximate placements a brochure plan produces — share the overlap itself.
 *
 * @param {number} bandPx how far either side of the meeting edge to look
 */
function seam(a, b, bandPx = 6) {
  const ra = rect(a), rb = rect(b);
  if (!ra || !rb) return null;

  const xLo = Math.max(ra.x0, rb.x0), xHi = Math.min(ra.x1, rb.x1);
  const yLo = Math.max(ra.y0, rb.y0), yHi = Math.min(ra.y1, rb.y1);
  const xOverlap = xHi - xLo, yOverlap = yHi - yLo;

  // Overlapping both ways: the shared region IS the seam.
  if (xOverlap > 0 && yOverlap > 0) {
    return { x0: xLo, x1: xHi, y0: yLo, y1: yHi };
  }
  // Side by side — a vertical seam at the meeting edge, over the shared height.
  if (yOverlap > 0) {
    const edge = ra.x1 <= rb.x0 ? (ra.x1 + rb.x0) / 2 : (rb.x1 + ra.x0) / 2;
    return { x0: edge - bandPx, x1: edge + bandPx, y0: yLo, y1: yHi };
  }
  // Stacked — a horizontal seam, over the shared width.
  if (xOverlap > 0) {
    const edge = ra.y1 <= rb.y0 ? (ra.y1 + rb.y0) / 2 : (rb.y1 + ra.y0) / 2;
    return { x0: xLo, x1: xHi, y0: edge - bandPx, y1: edge + bandPx };
  }
  // Diagonally apart — they share no edge at all.
  return null;
}

const boxCentre = (o) => ({ x: Number(o.box.x) + Number(o.box.w) / 2,
                            y: Number(o.box.y) + Number(o.box.h) / 2 });

const inside = (pt, x0, y0, x1, y1) => pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1;

/**
 * Does the drawing show these two rooms open to one another?
 *
 *   'open'      — nothing solid between them, or a doorless opening in the seam
 *   'separated' — a wall across the seam with no door in it
 *   'unknown'   — the reader gave no walls or openings, so the drawing is silent
 *
 * A plain door still counts as SEPARATED for zoning: a door can be shut, so the
 * two rooms can be dampered apart. Only a doorless opening — the wide square
 * gap between a kitchen and a meals area — makes them one zone.
 */
export function opennessBetween(a, b, { walls = [], openings = [] } = {}) {
  if (!walls.length && !openings.length) {
    return { state: 'unknown', reason: 'The plan reader returned no walls or openings.' };
  }
  const s = seam(a, b);
  if (!s) return { state: 'unknown', reason: 'One of the rooms has no boundary on the plan.' };

  const wallInSeam = walls.filter(w => w?.box && inside(boxCentre(w), s.x0, s.y0, s.x1, s.y1));
  // A door is a closable separation. Only a doorless opening joins two rooms
  // into one zone, so a plain "door" is deliberately not in this list.
  const openInSeam = openings.filter(o => o?.box &&
    /opening|archway|arch|cased|square set|sliding/i.test(String(o.type || '')) &&
    inside(boxCentre(o), s.x0, s.y0, s.x1, s.y1));

  if (openInSeam.length) {
    return { state: 'open', reason: 'The plan shows a doorless opening between them.',
             evidence: openInSeam.map(o => o.id) };
  }
  if (wallInSeam.length) {
    return { state: 'separated', reason: 'The plan shows a wall between them with no opening in it.',
             evidence: wallInSeam.map(w => w.id) };
  }
  return { state: 'open', reason: 'No wall is drawn between them.' };
}

/**
 * Work out which conditioned rooms share a zone because they share an air
 * space.
 *
 * Grows outward from the kitchen — an open-plan living area in an Australian
 * house is built around one — through directly touching rooms of an open-plan
 * type, then lets circulation (an entry or a passage) join what it runs into.
 *
 * @returns {{groups, assignments, confidence, method, notes, warnings}}
 */
export function suggestOpenPlanGroups(rooms, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const calibration = opts.calibration || null;
  const walls = opts.walls || [];
  const openings = opts.openings || [];
  const tolMm = opts.toleranceMm ?? ADJACENCY_TOLERANCE_MM;

  const conditioned = (rooms || []).filter(isConditionedRoom);
  const placed = conditioned.filter(r => rect(r));
  const notes = [], warnings = [];

  if (placed.length < 2) {
    return { groups: [], assignments: {}, confidence: 'LOW', method: 'none',
             openPlanRoomCount: 0,
             notes: ['Not enough rooms are placed on the plan to work out what is open to what.'],
             warnings: [] };
  }
  if (placed.length < conditioned.length) {
    notes.push((conditioned.length - placed.length) + ' conditioned room(s) have no boundary on ' +
               'the plan and were left on their own zone.');
  }

  const haveWallData = !!(walls.length || openings.length);
  const method = haveWallData ? 'walls_and_openings' : 'room_adjacency';

  // A room placed from a printed size centred on its label is an approximate
  // rectangle, not a survey. Say so rather than letting the grouping read as
  // measured fact.
  const derivedCount = placed.filter(r => r.boundaryDerived).length;

  const seeds = placed.filter(r => OPEN_PLAN_TYPES.has(r.roomType));
  if (!seeds.length) {
    return { groups: [], assignments: {}, confidence: 'LOW', method,
             openPlanRoomCount: 0,
             notes: [...notes, 'No kitchen, dining or living room was found, so no open-plan area was grouped.'],
             warnings: [] };
  }

  // ── Grow the open-plan area ───────────────────────────────────────────────
  const joinable = (a, b) => {
    const t = roomsTouch(a, b, calibration, tolMm);
    if (!t.touching) return { join: false, why: t.reason };
    const o = opennessBetween(a, b, { walls, openings });
    if (o.state === 'separated') return { join: false, why: o.reason };
    return { join: true, why: t.reason + (o.state === 'open' ? ' ' + o.reason : ''),
             certain: o.state === 'open' };
  };

  // Anchored on the kitchen where there is one; otherwise the biggest open-plan
  // room. Starting anywhere would let two unrelated living spaces chain
  // together through whatever happens to sit between them.
  const areaOf = (r) => { const x = rect(r); return x ? (x.x1 - x.x0) * (x.y1 - x.y0) : 0; };
  const anchor = seeds.find(r => r.roomType === 'kitchen')
    || [...seeds].sort((a, b) => areaOf(b) - areaOf(a))[0];

  const group = [anchor];
  const evidence = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const cand of seeds) {
      if (group.includes(cand)) continue;
      for (const member of group) {
        const j = joinable(member, cand);
        if (j.join) {
          group.push(cand);
          evidence.push(cand.label + ' joins ' + member.label + ' — ' + j.why);
          grew = true;
          break;
        }
      }
    }
  }

  // Circulation joins what it opens onto, but never starts a group.
  for (const hall of placed.filter(r => CIRCULATION_TYPES.has(r.roomType))) {
    if (group.includes(hall)) continue;
    for (const member of group) {
      const j = joinable(member, hall);
      if (j.join) {
        group.push(hall);
        evidence.push(hall.label + ' opens onto ' + member.label + ' — ' + j.why);
        break;
      }
    }
  }

  const groups = [];
  const assignments = {};
  if (group.length >= 2) {
    const key = 'open-plan';
    groups.push({
      key,
      name: 'Open plan — ' + group.map(r => r.label).join(' + '),
      roomIds: group.map(r => r.id),
      rooms: group.map(r => r.label),
      evidence
    });
    for (const r of group) assignments[r.id] = key;
  } else {
    notes.push('No two rooms were found open to one another, so every room is on its own zone.');
  }

  // ── How sure is this? ─────────────────────────────────────────────────────
  let confidence = 'LOW';
  if (haveWallData) confidence = 'HIGH';
  else if (derivedCount === 0) confidence = 'MEDIUM';
  else confidence = 'MEDIUM';

  if (!haveWallData) {
    notes.push('The plan reader returned no walls or openings, so rooms were grouped by where ' +
               'they sit on the drawing. Check the zone list before this goes out — a room ' +
               'behind a door may have been grouped with the space it opens onto.');
  }
  if (derivedCount) {
    notes.push(derivedCount + ' room(s) were placed from their printed size rather than a traced ' +
               'boundary, so the grouping is a proposal, not a measurement.');
  }

  return { groups, assignments, confidence, method, notes, warnings,
           openPlanRoomCount: group.length >= 2 ? group.length : 0 };
}

/**
 * Put the suggested groups onto the rooms.
 *
 * An estimator's own grouping is never overwritten: once a room has been put
 * on a zone by hand, that is the answer, on this job and every re-run of it.
 */
export function applyOpenPlanGroups(rooms, suggestion) {
  const a = suggestion?.assignments || {};
  return (rooms || []).map(r => {
    // Zoning that someone already decided is never re-derived. That covers the
    // estimator's own split or merge, a grouping typed on the Sizing tab, and a
    // saved design being reopened — overwriting any of them would silently
    // re-zone a job that had already been signed off, and change its load with
    // it, because grouped rooms are diversified together.
    if (r.zoneGroupSource && r.zoneGroupSource !== 'auto') return r;
    const key = a[r.id] || null;
    if ((r.openPlanGroup || null) === key) return r;
    return { ...r, openPlanGroup: key, zoneGroupSource: key ? 'auto' : null };
  });
}

/**
 * Has this design already had its zoning decided by someone?
 *
 * A room carrying an openPlanGroup with no `zoneGroupSource` was grouped before
 * this engine existed — by hand on the Sizing tab, or in a design saved
 * earlier. Re-deriving over the top of it would change the zoning and the load
 * of a job that was already settled.
 */
export function zoningAlreadySet(rooms) {
  return (rooms || []).some(r =>
    r.openPlanGroup && (!r.zoneGroupSource || r.zoneGroupSource === 'estimator'));
}

/**
 * When the zoning does not work, say exactly what would fix it.
 *
 * "Only 5% stays open" tells the estimator there is a problem. "Put BED 2,
 * BED 3 and BED 4 on one zone" tells him what to do about it, and that is the
 * difference between a warning he acts on and one he learns to scroll past.
 */
export function zoneRemedies(zoneAnalysis, rooms, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const controllerMaxZones = opts.controllerMaxZones ?? settings.zoning.maxZones;
  const out = [];
  if (!zoneAnalysis?.zones?.length) return out;

  const zones = zoneAnalysis.zones;
  const byId = new Map((rooms || []).map(r => [r.id, r]));
  const closable = zones.filter(z => !z.alwaysOpen);

  // Too many zones for the controller in the box.
  if (zones.length > controllerMaxZones) {
    const surplus = zones.length - controllerMaxZones;
    // Merge the smallest same-type zones first — that is the merge that costs
    // the least control and saves the most hardware.
    const mergeable = [...closable]
      .filter(z => z.roomIds.length === 1)
      .map(z => ({ zone: z, room: byId.get(z.roomIds[0]) }))
      .filter(x => x.room)
      .sort((a, b) => a.zone.airflowLs - b.zone.airflowLs);
    const bedrooms = mergeable.filter(x => x.room.roomType === 'bedroom');
    if (bedrooms.length >= 2) {
      out.push({
        code: 'MERGE_BEDROOM_ZONES',
        title: 'Put ' + bedrooms.slice(0, Math.max(2, surplus + 1)).map(x => x.room.label).join(', ') +
               ' on one zone',
        detail: zones.length + ' zones needs a controller that handles ' + zones.length +
                '. Grouping the minor bedrooms brings it to ' +
                (zones.length - Math.max(2, surplus + 1) + 1) + '.',
        roomIds: bedrooms.slice(0, Math.max(2, surplus + 1)).map(x => x.room.id),
        groupKey: 'bedrooms'
      });
    }
  }

  // Not enough air left open with everything shut.
  if (zoneAnalysis.meetsMinimum === false) {
    const biggest = [...zones].sort((a, b) => b.airflowLs - a.airflowLs)[0];
    if (biggest && !biggest.alwaysOpen) {
      out.push({
        code: 'NOMINATE_CONSTANT_ZONE',
        title: 'Make ' + biggest.name + ' a constant zone',
        detail: 'It carries ' + biggest.airflowLs + ' L/s (' + biggest.systemSharePct +
                '% of the system). Leaving it always open gives the air somewhere to go.',
        zoneId: biggest.id
      });
    }
  }
  return out;
}
