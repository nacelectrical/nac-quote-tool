// ═══════════════════════════════════════════════════════════════════════════
// ONE MAIN PER INSTALLER AREA — the Dungannon supply structure
// ═══════════════════════════════════════════════════════════════════════════
//
//   FAN COIL
//     -> N DIRECT SUPPLY MAINS, one per area, all the same size, no reduction
//        before the area is reached
//          -> PRIMARY BTO for that area
//               -> SECONDARY BTO only where the three-port limit needs one
//                    -> INDIVIDUAL OUTLET DUCTS
//
// The spine router that came before it ran two long mains across the house and
// chained fittings along them, which is the "one long main with multiple BTOs
// across unrelated areas" this replaces. Here a main goes to ONE area and stops
// at the fitting that serves it.
//
// Nothing is specific to any address. The areas come from the outlets' own
// positions and types; the number of them comes from the installer's configured
// spigot count, or the recommendation when there is none.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { isConditionedRoom } from './classify.mjs';
import { selectDiameter } from './ducts.mjs';
import { finalSizeForAirflow, mainFloorForFinals, ROUTING } from './nac-standard.mjs';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const centroid = (pts) => ({
  x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
  y: pts.reduce((n, p) => n + p.y, 0) / pts.length
});

/** A gentle bow, because this is flex duct and it never runs dead straight. */
function sweep(from, to, bow = 0.12, samples = 12) {
  const len = dist(from, to);
  if (!(len > 0.5)) return [{ ...from }, { ...to }];
  const mid = lerp(from, to, 0.5);
  const nx = -(to.y - from.y) / len, ny = (to.x - from.x) / len;
  const ctrl = { x: mid.x + nx * len * bow, y: mid.y + ny * len * bow };
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples, u = 1 - t;
    pts.push({ x: round(u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, 2),
               y: round(u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y, 2) });
  }
  return pts;
}

/** Split a set of points in two, on the line they actually spread along. */
export function splitInTwo(items) {
  if (items.length < 2) return [items, []];
  let far = { d: -1, a: items[0], b: items[0] };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = dist(items[i], items[j]);
      if (d > far.d) far = { d, a: items[i], b: items[j] };
    }
  }
  const A = [], B = [];
  for (const it of items) (dist(it, far.a) <= dist(it, far.b) ? A : B).push(it);
  return A.length && B.length ? [A, B] : [items.slice(0, 1), items.slice(1)];
}

/**
 * PRACTICAL GEOGRAPHICAL INSTALLER AREAS.
 *
 * Seeded on what the rooms ARE — the open-plan side, the sleeping side — and
 * then the biggest area is subdivided on position until there are as many areas
 * as there are mains. Subdividing the biggest is what turns one 566 L/s
 * open-plan main into a kitchen/meals/family main and a living/lounge main
 * instead of one duct trying to serve the lot.
 */
export function formInstallerAreas(outletPoints, wantAreas) {
  const open = outletPoints.filter(o => o.openPlan);
  const sleep = outletPoints.filter(o => !o.openPlan && o.roomType === 'bedroom');
  const other = outletPoints.filter(o => !o.openPlan && o.roomType !== 'bedroom');

  let areas = [open, sleep].filter(a => a.length);
  if (!areas.length) areas = [outletPoints.slice()];
  // Rooms that could go either way join the area they sit nearest, by ROOM so
  // one room is never split across two mains.
  for (const roomId of [...new Set(other.map(o => o.roomId))]) {
    const mine = other.filter(o => o.roomId === roomId);
    const c = centroid(mine);
    const best = areas.reduce((a, g) =>
      dist(centroid(g), c) < dist(centroid(a), c) ? g : a, areas[0]);
    best.push(...mine);
  }

  // Too few areas for the mains configured: split the biggest by air, not by
  // headcount — the point is to stop one duct carrying most of the house.
  let guard = 0;
  while (areas.length < wantAreas && guard++ < 12) {
    const flows = areas.map(a => a.reduce((n, o) => n + o.airflowLs, 0));
    const idx = flows.indexOf(Math.max(...flows));
    if (areas[idx].length < 2) break;
    const [A, B] = splitInTwo(areas[idx]);
    areas.splice(idx, 1, A, B);
  }
  // More areas than mains: fold the lightest into its nearest neighbour.
  while (areas.length > wantAreas && areas.length > 1) {
    const flows = areas.map(a => a.reduce((n, o) => n + o.airflowLs, 0));
    const idx = flows.indexOf(Math.min(...flows));
    const c = centroid(areas[idx]);
    let best = -1, bestD = Infinity;
    areas.forEach((a, i) => {
      if (i === idx) return;
      const d = dist(centroid(a), c);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) break;
    areas[best].push(...areas[idx]);
    areas.splice(idx, 1);
  }
  // Heaviest area first, so Main A is the one an installer runs first.
  return areas.sort((a, b) =>
    b.reduce((n, o) => n + o.airflowLs, 0) - a.reduce((n, o) => n + o.airflowLs, 0));
}

/**
 * WHERE THE ONE FITTING FOR THIS AREA GOES.
 *
 * There is exactly one BTO per installer area, and every outlet in the area
 * hangs off it. No chain, no secondary body, no "onward" port. Nick, after
 * seeing five fittings where he wanted three:
 *
 *   FAN COIL -> ø400 MAIN -> ONE AREA BTO -> INDIVIDUAL OUTLET DUCTS
 *
 * The only question left is WHERE to set it, and the brief is explicit: the
 * position must minimise total flex length without crossovers or backtracking.
 * That is the geometric median of the outlets AND the plenum — the point whose
 * summed distance to everything it connects is smallest, which is precisely the
 * total length of the main plus all the finals. The centroid this used to
 * return minimises the sum of SQUARED distances, which is a different and
 * slightly wrong answer that lets one far outlet drag the fitting toward it.
 *
 * Weiszfeld's iteration, which converges quickly for a dozen points. Including
 * the plenum in the set is what keeps the fitting from drifting to the far side
 * of its area and making the main reach past outlets it then has to come back
 * to — the backtracking rule, enforced by geometry rather than by a check.
 */
export function geometricMedian(points, iterations = 128) {
  const pts = points
    .filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))
    .map(p => ({ x: p.x, y: p.y, w: p.w > 0 ? p.w : 1 }));
  if (!pts.length) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };
  const wSum = pts.reduce((n, p) => n + p.w, 0);
  let cx = pts.reduce((n, p) => n + p.x * p.w, 0) / wSum;
  let cy = pts.reduce((n, p) => n + p.y * p.w, 0) / wSum;
  for (let i = 0; i < iterations; i++) {
    let sx = 0, sy = 0, sw = 0;
    for (const p of pts) {
      // Guarded so sitting exactly on a point does not divide by zero.
      const d = Math.max(1e-6, Math.hypot(p.x - cx, p.y - cy));
      sx += p.w * p.x / d; sy += p.w * p.y / d; sw += p.w / d;
    }
    const nx = sx / sw, ny = sy / sw;
    if (Math.hypot(nx - cx, ny - cy) < 0.01) { cx = nx; cy = ny; break; }
    cx = nx; cy = ny;
  }
  return { x: cx, y: cy };
}

/**
 * A FITTING NEVER SITS ON AN OUTLET.
 *
 * The median can converge onto one of its own points, and on this job it did:
 * BTO-A landed exactly on the second Family outlet and emitted a final run of
 * ZERO length. There is no such duct. A body in the ceiling still needs a drop
 * to the diffuser below it, so the fitting is pushed clear of the nearest
 * outlet, along the line between them so nothing else about the layout moves.
 */
function clearOfOutlets(at, outlets, minPx) {
  let p = { ...at };
  for (let pass = 0; pass < 8; pass++) {
    let worst = null, worstD = Infinity;
    for (const o of outlets) {
      const d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < worstD) { worstD = d; worst = o; }
    }
    if (!worst || worstD >= minPx) break;
    // Directly away from it; if we are exactly on top, pick a direction.
    const dx = worstD > 0.5 ? (p.x - worst.x) / worstD : 0;
    const dy = worstD > 0.5 ? (p.y - worst.y) / worstD : -1;
    p = { x: worst.x + dx * minPx, y: worst.y + dy * minPx };
  }
  return p;
}

/**
 * How far a fitting must stay from any outlet it serves, in plan pixels.
 * Small — this only has to stop a zero-length run, not push the metal about.
 */
export const MIN_FITTING_TO_OUTLET_PX = 26;

/**
 * HOW SHORT A MAIN IS ALLOWED TO BE BEFORE IT IS NOT A MAIN.
 *
 * A main that measures nothing is not a duct — it means the fitting is bolted
 * straight onto the supply plenum, and the schedule then has to print "not
 * measured" against a run somebody still has to install. On the approved job
 * Main C came out at 0.1 px: BTO-C landed exactly on the plenum.
 *
 * WHY IT LANDED THERE, because the cause is not obvious. The fitting position
 * is a weighted geometric median of the plenum and the area's branch targets.
 * Main C's two ø350 arms leave in nearly OPPOSITE directions — the Foyer/Master
 * arm north-east, the bedroom arm south-west — so their pull very nearly
 * cancels, and once the remaining pull is smaller than the plenum's own weight
 * the median sits exactly on the plenum. That is Weiszfeld's degenerate case,
 * and it is a correct answer to the wrong question: minimising total duct says
 * put the fitting on the plenum, but a fitting on the plenum is not a design.
 *
 * So a main has a minimum run, the same way a final run already has a minimum
 * clearance from its outlet. In millimetres, because a pixel means a different
 * distance on every plan.
 */
export const MIN_MAIN_RUN_MM = 1500;

/**
 * Push a fitting off the plenum, along the line toward the air it serves.
 *
 * The direction is the airflow-weighted centre of what the main feeds, so the
 * fitting moves out into the circulation space between the unit and its area —
 * where an installer would actually set the branch point — rather than being
 * shoved in an arbitrary direction to satisfy a number.
 */
export function clearOfPlenum(at, plenum, target, minPx) {
  if (!plenum || !(minPx > 0)) return at;
  const d = Math.hypot(at.x - plenum.x, at.y - plenum.y);
  if (d >= minPx) return at;
  // Prefer the direction the fitting already wanted; fall back to the air it
  // serves when it is sitting on top of the plenum and has no direction at all.
  let dx, dy;
  if (d > 0.5) { dx = (at.x - plenum.x) / d; dy = (at.y - plenum.y) / d; }
  else {
    const tx = (target?.x ?? plenum.x) - plenum.x;
    const ty = (target?.y ?? plenum.y) - plenum.y;
    const td = Math.hypot(tx, ty);
    if (td < 0.5) return at;          // nothing to aim at; leave it alone
    dx = tx / td; dy = ty / td;
  }
  return { x: plenum.x + dx * minPx, y: plenum.y + dy * minPx };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE MINIMUM MEASURED DUCT BETWEEN A FITTING AND THE OUTLET IT FEEDS
// ═══════════════════════════════════════════════════════════════════════════
//
// Nick: "A BTO must never sit directly on top of or immediately beside an
// outlet. Every final duct from a BTO collar to an outlet must have a measured
// routed length of at least 2.0 metres. This is an engineering/layout rule, not
// just a drawing offset."
//
// It is a layout rule because of what a flex final actually is. A take-off
// collar discharges into the duct as a jet; a diffuser hung 400 mm below it
// gets that jet straight down its neck, which is noise, draught and a pattern
// nobody can balance. The two metres is the run in which the air settles.
//
// MIN_FITTING_TO_OUTLET_PX did not do this job and was never meant to. It is a
// drawing guard — it exists so the schedule cannot print a zero-length run —
// and at 26 px on this plan it is 460 mm. Two outlets on the approved job (the
// Foyer and Bedroom 4) sat at exactly that guard, which is the tell: the median
// had converged onto them and the guard was all that moved the fitting.
//
// So the rule is measured, in metres, off the CALIBRATED plan, against the
// routed polyline the router will actually emit — not the straight line between
// the two, because the run that gets installed is the one that gets drawn.
export const MIN_BTO_TO_OUTLET_DUCT_LENGTH_M = 2.0;

/** The bow a final run is drawn with. One constant, so measuring and emitting
 *  cannot drift apart: `finalRunLengthPx` measures the very polyline that
 *  `emitFinal` later pushes into the segment. */
const FINAL_BOW = 0.16;

const polylineLengthPx = (pts) => {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
};

/** The exact points of the final run from a fitting to an outlet. */
export function finalRunPoints(from, to) { return sweep(from, to, FINAL_BOW); }

/** Its measured routed length, in plan pixels. */
export function finalRunLengthPx(from, to) {
  return polylineLengthPx(finalRunPoints(from, to));
}

/** Inside a rectangle, with a margin. Negative margin grows the rectangle. */
function insideRect(p, r, margin = 0) {
  if (!r) return true;
  return p.x >= r.x + margin && p.x <= r.x + r.w - margin
      && p.y >= r.y + margin && p.y <= r.y + r.h - margin;
}

/**
 * MOVE THE FITTING UNTIL EVERY RUN OFF IT IS A REAL DUCT.
 *
 * The wanted position is the weighted median — the cheapest place for the
 * metal. When it leaves a final under the minimum, the fitting moves to the
 * nearest position that is both PRACTICAL and COMPLIANT, and "practical" is
 * four separate constraints, all of them Nick's:
 *
 *   • inside the conditioned footprint — never in or through an external wall;
 *   • not inside an excluded room — not over a bathroom, ensuite, laundry or
 *     garage, which is where the wet areas and the un-boarded ceiling are;
 *   • far enough off the supply plenum that its main is still a main;
 *   • every final it feeds at or over the minimum measured length.
 *
 * Among the positions that satisfy all four it takes the CHEAPEST — the one
 * with the smallest size-weighted total of main plus finals — so the rule buys
 * clearance without quietly buying duct. Nick: "Minimise the combined
 * final-duct lengths only after satisfying the 2.0 m minimum."
 *
 * THE FITTING MOVES; THE RUN IS NEVER PADDED. There is no loop, no dog-leg and
 * no detour inserted to make a number — the final is the same gentle bow it was
 * before, measured honestly, and if it is short the METAL goes somewhere else.
 * A run that reads 2.0 m is 2.0 m of duct somebody pulls.
 */
export function placeFittingClear(want, members, opts = {}) {
  const minFinalPx = opts.minFinalPx > 0 ? opts.minFinalPx : 0;
  const footprint = opts.footprint || null;
  const avoid = opts.avoid || [];
  const plenum = opts.plenum || null;
  const minMainPx = opts.minMainPx > 0 ? opts.minMainPx : 0;
  const weightOf = opts.weightOf || (() => 1);
  const mainWeight = opts.mainWeight > 0 ? opts.mainWeight : 1;
  const margin = opts.margin ?? 6;

  const practical = (p) => {
    if (footprint && !insideRect(p, footprint, margin)) return false;
    if (plenum && minMainPx > 0 && dist(p, plenum) < minMainPx - 1e-6) return false;
    for (const r of avoid) if (insideRect(p, r, -margin)) return false;
    return true;
  };
  const compliant = (p) => members.every(o => finalRunLengthPx(p, o) >= minFinalPx - 1e-6);
  const cost = (p) => {
    let n = plenum ? mainWeight * dist(plenum, p) : 0;
    for (const o of members) n += weightOf(o) * finalRunLengthPx(p, o);
    return n;
  };
  const shortfalls = (p) => members
    .map(o => ({ id: o.id, label: o.roomLabel, lengthPx: finalRunLengthPx(p, o) }))
    .filter(r => r.lengthPx < minFinalPx - 1e-6);

  if (!members.length || minFinalPx <= 0) {
    return { at: want, moved: false, compliant: true, shortfalls: [] };
  }
  if (practical(want) && compliant(want)) {
    return { at: want, moved: false, compliant: true, shortfalls: [] };
  }

  // A polar sweep around the wanted point. Rings rather than a grid because the
  // answer is nearly always just outside the disc of one offending outlet, and
  // rings find that first and cheaply. The radius runs out to three times the
  // minimum, which is past the far side of any outlet that could be forcing the
  // move.
  const spread = members.reduce((n, o) => Math.max(n, dist(want, o)), 0);
  const maxR = Math.max(minFinalPx * 3, spread * 1.6, 40);
  const step = Math.max(2, minFinalPx / 12);
  const BEARINGS = 96;
  let best = null, bestCost = Infinity;
  const consider = (p) => {
    if (!practical(p) || !compliant(p)) return;
    const c = cost(p);
    if (c < bestCost) { bestCost = c; best = p; }
  };
  for (let r = step; r <= maxR; r += step) {
    for (let i = 0; i < BEARINGS; i++) {
      const a = (i / BEARINGS) * Math.PI * 2;
      consider({ x: want.x + Math.cos(a) * r, y: want.y + Math.sin(a) * r });
    }
    // Stop as soon as a ring has produced something: any further ring is
    // strictly further from the cheapest place the metal wanted to be.
    if (best) break;
  }
  // One ring further out, finely, in case the cheapest point on the shell sits
  // between two bearings of the ring that found it.
  if (best) {
    const r0 = dist(want, best);
    for (let r = Math.max(step, r0 - step); r <= r0 + step; r += step / 4) {
      for (let i = 0; i < BEARINGS * 2; i++) {
        const a = (i / (BEARINGS * 2)) * Math.PI * 2;
        consider({ x: want.x + Math.cos(a) * r, y: want.y + Math.sin(a) * r });
      }
    }
    return { at: best, moved: true, compliant: true, shortfalls: [],
             movedPx: round(dist(want, best), 1) };
  }

  // NOTHING PRACTICAL AND COMPLIANT EXISTS. The fitting is left at the best
  // position it can legally occupy and the caller raises the review — the
  // estimator is told, not quietly given a number that is not true.
  let fallback = want, fallbackCost = Infinity;
  for (let r = 0; r <= maxR; r += step) {
    for (let i = 0; i < BEARINGS; i++) {
      const a = (i / BEARINGS) * Math.PI * 2;
      const p = r === 0 ? want : { x: want.x + Math.cos(a) * r, y: want.y + Math.sin(a) * r };
      if (!practical(p)) continue;
      // Rank by how far short the worst run still is, then by cost.
      const worst = Math.min(...members.map(o => finalRunLengthPx(p, o)));
      const c = (minFinalPx - worst) * 1000 + cost(p);
      if (c < fallbackCost) { fallbackCost = c; fallback = p; }
      if (r === 0) break;
    }
  }
  return { at: fallback, moved: fallback !== want, compliant: false,
           shortfalls: shortfalls(fallback) };
}

/** Airflow-weighted centre of a set of outlets — where a main is really going. */
function airflowCentroid(items) {
  const w = items.reduce((n, o) => n + (o.airflowLs || 0), 0);
  if (!w) return centroid(items);
  return {
    x: items.reduce((n, o) => n + o.x * (o.airflowLs || 0), 0) / w,
    y: items.reduce((n, o) => n + o.y * (o.airflowLs || 0), 0) / w
  };
}

/** Keep a point inside a rectangle, with a margin so it is not on the line. */
function clampInto(p, box, margin = 6) {
  if (!box) return p;
  return {
    x: Math.min(Math.max(p.x, box.x + margin), box.x + box.w - margin),
    y: Math.min(Math.max(p.y, box.y + margin), box.y + box.h - margin)
  };
}

/**
 * One area, one fitting, every outlet direct off it.
 *
 * `footprint` is the conditioned envelope. A fitting is clamped into it so a
 * median pulled toward an outlying room cannot land outside the building and
 * put the main through an external wall to get back in.
 */
export function planAreaFittings(outlets, plenum, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  // WEIGHTED BY DUCT SIZE, AND THAT IS A DELIBERATE READING OF "TOTAL FLEX".
  //
  // Unweighted, every metre counts the same, so the fitting drifts toward the
  // outlets and drags the ø400 main out behind it. On the bedroom side that put
  // BTO-C well south of the hallway, spent 4.04 m of ø400 getting there, and
  // left an 8.65 m ø250 reaching back up to the Master.
  //
  // Weighting each leg by its diameter says what an installer already knows: a
  // metre of ø400 is not a metre of ø250 — it costs more, it is harder to pull
  // and it is the duct you want short. The weighted answer costs about a metre
  // more raw flex across this job and buys 1.6 m less ø400 and a shorter worst
  // run, and it lands the bedroom fitting in the hallway where it belongs.
  const weightOf = (o) => (selectDiameter(o.airflowLs, 'final', { settings }).diameterMm || 250) / 250;
  const mainWeight = (opts.mainDiameterMm || 400) / 250;
  const pts = outlets.map(o => ({ x: o.x, y: o.y, w: weightOf(o) }));
  if (plenum) pts.push({ x: plenum.x, y: plenum.y, w: mainWeight });

  const minSep = opts.minOutletClearancePx ?? MIN_FITTING_TO_OUTLET_PX;
  const at = clampInto(
    clearOfOutlets(geometricMedian(pts), outlets, minSep),
    opts.footprint);
  return { at, direct: outlets.slice(), onward: null };
}

/**
 * Build the whole supply topology: N mains, one per area, each ending at its
 * area's primary fitting.
 */
export function buildAreaTopology({ rooms = [], airflow, outlets, layout = {}, zones = null,
                                    mainConfig = null, avoidRooms = [] } = {}, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const warnings = [];
  const roomsById = new Map((rooms || []).map(r => [r.id, r]));
  const outletsByRoom = new Map((outlets?.rows || []).map(o => [o.roomId, o]));
  const zoneByRoom = new Map();
  for (const z of (zones?.zones || [])) {
    for (const rid of (z.roomIds || [])) zoneByRoom.set(rid, z.name || z.id);
  }
  const openPlanRooms = new Set((zones?.zones || [])
    .filter(z => z.alwaysOpen || z.kind === 'common')
    .flatMap(z => z.roomIds || [])
    .filter(id => roomsById.get(id)?.roomType !== 'hallway'));

  const placed = (rooms || []).filter(r => isConditionedRoom(r) && r.boundaryPx);
  if (!placed.length) {
    return { generated: false, segments: [], nodes: [], warnings: [{
      code: 'NO_ROOM_GEOMETRY', severity: 'CHECK',
      message: 'No conditioned room has a boundary on the plan.' }] };
  }
  const bounds = placed.reduce((b, r) => ({
    x0: Math.min(b.x0, r.boundaryPx.x), y0: Math.min(b.y0, r.boundaryPx.y),
    x1: Math.max(b.x1, r.boundaryPx.x + r.boundaryPx.w),
    y1: Math.max(b.y1, r.boundaryPx.y + r.boundaryPx.h)
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const footprint = { x: bounds.x0, y: bounds.y0, w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 };

  const plenum = layout.plenum?.x !== undefined ? { x: layout.plenum.x, y: layout.plenum.y }
               : layout.indoorUnit?.x !== undefined ? { x: layout.indoorUnit.x, y: layout.indoorUnit.y }
               : { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
  const plenumSource = (layout.plenum?.x !== undefined || layout.indoorUnit?.x !== undefined)
    ? 'placed' : 'assumed_centre';

  // ── every outlet that has to be reached ─────────────────────────────────
  const outletPoints = [];
  for (const row of (airflow?.rows || [])) {
    const room = roomsById.get(row.roomId);
    if (!room?.boundaryPx) continue;
    const qty = outletsByRoom.get(row.roomId)?.quantity ?? 0;
    if (!qty || row.spillOnly || !(row.adjustedLs > 0)) continue;
    const b = room.boundaryPx;
    // A ROOM'S AIR IS SPLIT EXACTLY, NOT DIVIDED AND ROUNDED TWICE. 121 L/s
    // over two outlets is 61 and 60, not 60.5 rounded to 61 twice — which put
    // a litre into the job that the room never had and left the fitting
    // reading 302 L/s against a 301 L/s main.
    const whole = Math.round(row.adjustedLs || 0);
    const share = Math.floor(whole / qty);
    const spare = whole - share * qty;
    for (let i = 0; i < qty; i++) {
      const manual = layout['outlet_' + row.roomId + '_' + i];
      const frac = (i + 1) / (qty + 1);
      outletPoints.push({
        id: 'outlet_' + row.roomId + (qty > 1 ? '_' + (i + 1) : ''),
        roomId: row.roomId, roomLabel: row.label, index: i + 1, of: qty,
        airflowLs: share + (i < spare ? 1 : 0),
        zone: zoneByRoom.get(row.roomId) || null,
        roomType: room.roomType || null,
        openPlan: openPlanRooms.has(row.roomId),
        x: manual?.x !== undefined ? manual.x : b.x + b.w * frac,
        y: manual?.y !== undefined ? manual.y : b.y + b.h / 2
      });
    }
  }
  if (!outletPoints.length) {
    return { generated: false, segments: [], nodes: [], footprint, warnings: warnings.concat([{
      code: 'NOTHING_TO_ROUTE', severity: 'CHECK',
      message: 'No conditioned room has both airflow and a boundary on the plan.' }]) };
  }

  const normal = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const wantMains = Math.max(1, mainConfig?.count || 2);
  const mainMm = mainConfig?.diameterMm || 400;
  let areas;
  if (mainConfig?.areas?.length) {
    const assigned = new Set();
    areas = mainConfig.areas.map((spec, i) => {
      const labels = new Set((spec.roomLabels || []).map(normal));
      const members = outletPoints.filter(o => labels.has(normal(o.roomLabel)));
      members.forEach(o => assigned.add(o.id));
      return { spec: { ...spec, key: spec.key || String.fromCharCode(65 + i) }, members };
    }).filter(a => a.members.length);
    const unassigned = outletPoints.filter(o => !assigned.has(o.id));
    for (const o of unassigned) {
      const nearest = areas.reduce((best, a) =>
        dist(centroid(a.members), o) < dist(centroid(best.members), o) ? a : best, areas[0]);
      nearest.members.push(o);
      warnings.push({ code: 'OUTLET_ASSIGNED_TO_NEAREST_AREA', severity: 'CHECK',
        message: o.roomLabel + ' was not named in the installer area configuration and was assigned to Main ' + nearest.spec.key + '.' });
    }
  } else {
    areas = formInstallerAreas(outletPoints, wantMains)
      .map((members, i) => ({ spec: { key: String.fromCharCode(65 + i) }, members }));
  }

  const segments = [];
  const nodes = [{ id: 'plenum', type: 'plenum', x: plenum.x, y: plenum.y,
                   source: plenumSource, label: 'Supply plenum' }];
  const letters = 'ABCDEFGH';

  // ── THE 2.0 m RULE, IN THIS PLAN'S OWN PIXELS ───────────────────────────
  //
  // Measured, so it needs the scale. On an uncalibrated plan there is no
  // measured length to test — the rule falls back to the old drawing guard and
  // says so rather than pretending a pixel is a millimetre.
  const pxPerMmGlobal = opts.calibration?.pixelsPerMm || 0;
  const minFinalM = opts.minBtoToOutletDuctLengthM
    ?? settings.duct?.minimumBtoToOutletDuctLengthM
    ?? MIN_BTO_TO_OUTLET_DUCT_LENGTH_M;
  const minFinalPx = pxPerMmGlobal ? minFinalM * 1000 * pxPerMmGlobal : 0;
  // Where a fitting must not be set: the wet areas and the garage. They are
  // excluded from conditioning, so they never reach the router as rooms — the
  // caller hands them over separately precisely so the placement can avoid
  // them. An un-boarded roof section is not on any plan we are given; a
  // fitting that has to go somewhere awkward raises the review instead.
  const avoidBoxes = (avoidRooms || [])
    .map(r => r?.boundaryPx).filter(b => b && b.w > 0 && b.h > 0);
  // The same size weighting the median uses, so the search and the target it
  // refines agree about what a metre of duct costs.
  const finalWeight = (o) =>
    (selectDiameter(o.airflowLs, 'final', { settings }).diameterMm || 250) / 250;
  const clearanceReviews = [];

  areas.forEach(({ spec, members }, ai) => {
    const letter = spec.key || letters[ai];
    const areaLs = members.reduce((n, o) => n + o.airflowLs, 0);
    const arms = (spec.distributionArms || []).map((arm, i) => {
      const labels = new Set((arm.roomLabels || []).map(normal));
      return { ...arm, key: arm.key || letter + (i + 1),
        members: members.filter(o => labels.has(normal(o.roomLabel))) };
    }).filter(a => a.members.length);
    const staged = arms.length > 1;
    // A main has to be a duct somebody can measure and install. See
    // MIN_MAIN_RUN_MM: when an area's arms leave in opposing directions their
    // pull cancels and the median settles onto the plenum itself, which is a
    // fitting bolted to the unit rather than a main.
    const pxPerMm = opts.calibration?.pixelsPerMm || 0;
    const minMainPx = pxPerMm
      ? (opts.minMainRunMm ?? MIN_MAIN_RUN_MM) * pxPerMm
      : (opts.minMainRunPx ?? 0);
    const plan = staged
      ? { at: clampInto(clearOfPlenum(clearOfOutlets(geometricMedian([
          { ...plenum, w: mainMm / 250 },
          ...arms.map(a => ({ ...centroid(a.members),
            w: a.members.reduce((n, o) => n + o.airflowLs, 0) / 100 }))
        ]), members, MIN_FITTING_TO_OUTLET_PX),
          plenum, airflowCentroid(members), minMainPx), footprint), direct: [] }
      : { ...planAreaFittings(members, plenum, { footprint, settings, mainDiameterMm: mainMm }),
          at: undefined };
    if (!staged) {
      const base = planAreaFittings(members, plenum, { footprint, settings, mainDiameterMm: mainMm });
      const want = clampInto(clearOfPlenum(base.at, plenum, airflowCentroid(members), minMainPx),
                             footprint);
      // EVERY FINAL OFF THIS FITTING IS A REAL DUCT, OR THE FITTING MOVES.
      const set = placeFittingClear(want, members, {
        minFinalPx, footprint, avoid: avoidBoxes, plenum, minMainPx,
        weightOf: finalWeight, mainWeight: mainMm / 250 });
      plan.at = set.at;
      plan.direct = base.direct;
      if (!set.compliant) clearanceReviews.push({ key: letter, set });
    }

    // THE MAIN. Straight from the plenum to the area's one fitting, at the
    // configured size, and NOT reduced on the way — it has nothing to shed
    // until it gets there.
    const mainId = 'main_' + letter;
    segments.push({
      id: mainId, parentId: null, role: 'main', nacRole: 'MAIN', mainKey: letter,
      plenumOutlet: true, flex: true, airSide: 'supply',
      destination: 'Supply plenum → Main ' + letter,
      serves: [...new Set(members.map(m => m.roomLabel))],
      airflowLs: round(areaLs, 0),
      diameterMm: mainMm,
      points: sweep(plenum, plan.at, 0.08),
      rigid: false,
      /** Exactly one BTO terminates this main. Asserted by the regression tests. */
      terminatesAtBto: true,
      fittings: ai === 0 ? ['supply_plenum'] : []
    });

    const emitFinal = (o, parentId, at, fixedMm = null) => {
      segments.push({
        id: 'final_' + o.id, parentId, role: 'final', nacRole: 'FINAL_FLEX',
        bto: true,
        mainKey: letter, flex: true, airSide: 'supply', roomId: o.roomId, outletId: o.id,
        destination: o.of > 1 ? o.roomLabel + ' outlet ' + o.index : o.roomLabel,
        airflowLs: round(o.airflowLs, 0),
        diameterMm: fixedMm || undefined,
        zone: o.zone,
        // ONE FUNCTION DRAWS IT AND ONE FUNCTION MEASURES IT. The minimum-length
        // rule tests `finalRunPoints`, so the emitted run has to BE that
        // polyline — a second `sweep` call with its own bow constant would let
        // the measured figure and the installed duct drift apart.
        points: finalRunPoints(at, { x: o.x, y: o.y }),
        fittings: ['damper_open']
      });
      nodes.push({ id: o.id, type: 'outlet', x: o.x, y: o.y,
                   label: o.roomLabel, zone: o.zone });
    };

    if (staged) {
      for (const arm of arms) {
        const armLs = arm.members.reduce((n, o) => n + o.airflowLs, 0);
        const armMm = arm.diameterMm || 350;
        const base = planAreaFittings(arm.members, plan.at,
          { footprint, settings, mainDiameterMm: armMm });
        // The arm's own fitting is where the outlets hang, so this is where the
        // 2.0 m rule bites hardest: on the approved job BTO-C1 sat 0.46 m off
        // the Foyer diffuser and BTO-C2 0.46 m off Bedroom 4.
        const set = placeFittingClear(base.at, arm.members, {
          minFinalPx, footprint, avoid: avoidBoxes,
          plenum: plan.at, minMainPx: 0,
          weightOf: finalWeight, mainWeight: armMm / 250 });
        const local = { ...base, at: set.at };
        if (!set.compliant) clearanceReviews.push({ key: arm.key, set });
        const branchId = 'branch_' + arm.key;
        segments.push({
          id: branchId, parentId: mainId, role: 'branch', nacRole: 'DISTRIBUTION_ARM',
          mainKey: letter, flex: true, airSide: 'supply', distributionArm: true,
          destination: 'Main ' + letter + ' → ' + (arm.label || arm.key),
          serves: [...new Set(arm.members.map(m => m.roomLabel))],
          airflowLs: round(armLs, 0), diameterMm: armMm,
          points: sweep(plan.at, local.at, 0.1), fittings: []
        });
        for (const o of arm.members) emitFinal(o, branchId, local.at, arm.outletDiameterMm || null);
        nodes.push({ id: 'bto_' + arm.key, type: 'bto', airSide: 'supply',
          x: local.at.x, y: local.at.y, mainKey: letter,
          label: 'BTO-' + arm.key, ports: arm.members.length });
      }
    } else {
      for (const o of plan.direct) emitFinal(o, mainId, plan.at, spec.outletDiameterMm || null);
    }
    nodes.push({ id: 'bto_' + letter, type: 'bto', airSide: 'supply',
                 x: plan.at.x, y: plan.at.y, mainKey: letter,
                 label: 'BTO-' + letter, ports: staged ? arms.length : plan.direct.length });
  });

  // ── WHEN NO PRACTICAL COMPLIANT POSITION EXISTS ─────────────────────────
  //
  // Nick: "If no practical compliant location exists, raise
  // BTO_TO_OUTLET_CLEARANCE_REVIEW and block final approval until the installer
  // confirms the location." CRITICAL, so it reaches the approval gate; the
  // message names the fitting and every run still short, with the figure it
  // actually measured — never rounded up to look compliant.
  const mmPerPx = pxPerMmGlobal ? 1 / pxPerMmGlobal : 0;
  for (const { key, set } of clearanceReviews) {
    const short = set.shortfalls
      .map(s => s.label + ' ' + (mmPerPx ? (s.lengthPx * mmPerPx / 1000).toFixed(2) + ' m' : 'not measured'))
      .join(', ');
    warnings.push({
      code: 'BTO_TO_OUTLET_CLEARANCE_REVIEW', severity: 'CRITICAL',
      blocksFinalApproval: true,
      btoKey: key,
      minimumM: minFinalM,
      shortfalls: set.shortfalls.map(s => ({ ...s,
        lengthM: mmPerPx ? round(s.lengthPx * mmPerPx / 1000, 2) : null })),
      message: 'BTO-' + key + ': no practical position keeps every final duct at or above the ' +
        minFinalM + ' m minimum without putting the fitting outside the conditioned ' +
        'envelope or into a wet area or garage. Still short: ' + short +
        '. The installer must confirm the fitting location before this design is approved.'
    });
  }

  return {
    generated: true,
    model: 'nac_area',
    /** What the 2.0 m rule was measured against, so a report can state it. */
    minBtoToOutletDuctLengthM: minFinalM,
    minBtoToOutletDuctLengthPx: round(minFinalPx, 1),
    btoClearanceReviews: clearanceReviews.map(({ key, set }) => ({
      key, shortfalls: set.shortfalls })),
    segments, nodes, footprint,
    plenum: { ...plenum, source: plenumSource },
    mainCount: areas.length,
    mainDiameterMm: mainMm,
    supplyMains: areas.map(({ spec, members }, ai) => ({
      key: spec.key || letters[ai],
      segmentId: 'main_' + (spec.key || letters[ai]),
      name: [...new Set(members.map(m => m.roomLabel))].join(' / '),
      airflowLs: round(members.reduce((n, o) => n + o.airflowLs, 0), 0),
      diameterMm: mainMm,
      serves: [...new Set(members.map(m => m.roomLabel))],
      outlets: members.length
    })),
    warnings,
    notice: ROUTING.notice
  };
}

export default { buildAreaTopology, formInstallerAreas, planAreaFittings, splitInTwo,
                 placeFittingClear, finalRunPoints, finalRunLengthPx };
