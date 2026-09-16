// ═══════════════════════════════════════════════════════════════════════════
// THE NAC FLEX DUCT ROUTING MODEL
// ═══════════════════════════════════════════════════════════════════════════
//
// A REPLACEMENT for the old trunk-and-spine router, not a patch to it.
//
// The old one grew a graph: a spine through the house, rooms projected onto it,
// branches at right angles, junctions wherever two lines met. Every correction
// to it produced a slightly tidier graph, and a graph is not what NAC installs.
//
// THE TOPOLOGY THIS PRODUCES, AND THE ONLY ONE IT PRODUCES:
//
//     SUPPLY PLENUM
//       → MAIN A ─────────────── (may step down as air comes off it)
//           → BTO ──→ final flex ──→ outlet
//           → BTO ──→ final flex ──→ outlet
//           → MAJOR BRANCH ────── (a group of outlets away from the main)
//               → BTO ──→ final flex ──→ outlet
//               → BTO ──→ final flex ──→ outlet
//       → MAIN B ───────────────
//           → …
//      (→ MAIN C)
//
//     RETURN 1  (→ RETURN 2)
//
// WHAT IS DIFFERENT, AND WHY IT MATTERS
//
// 1. TWO OR THREE MAINS leave the plenum. Never one. A plenum with one duct on
//    it is a tee, and the whole house hanging off a single run is why every
//    earlier drawing had an explosion of branches in the middle of the plan.
//
// 2. EACH MAIN SERVES A SPATIAL GROUP — the open-plan area, the bedroom wing,
//    the master and study. The groups are found by clustering the OUTLETS, not
//    by the compass, because an installer groups by what is near what.
//
// 3. AN OUTLET IS REACHED BY EXACTLY ONE FINAL FLEX RUN, straight off a BTO.
//    Not a chain of contrived segments, and never through a reducer: the BTO is
//    what takes the branch down to final size. A reducer before an outlet is a
//    design failure and the validator says so.
//
// 4. THE GEOMETRY IS SWEPT, NOT SQUARE. This is flexible duct in a roof space.
//    Every run is generated as a curve — a main bows toward its group, a final
//    arcs off its BTO — so what is drawn is what somebody would actually pull.
//    There are no 90° corners in here to remove later.
//
// The output feeds pressure, BOM, costing and the drawing unchanged: it is the
// same `segments` shape the rest of the pipeline already consumes, so there is
// still exactly one duct model.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { isConditionedRoom } from './classify.mjs';
import { selectDiameter } from './ducts.mjs';
import {
  mainSupplyCount, returnCountFor, FINAL_FLEX, SUPPLY_PLENUM, RETURN_AIR,
  BTO as BTO_RULES, ROUTING, MAIN_REDUCTIONS, MIN_MAIN_DIAMETER_MM, LOCAL_BRANCH,
  finalSizeForAirflow, mainFloorForFinals, choosePlenumMains,
  takeOffAllowedOn, STOCKED_DIAMETERS_MM, capBranchToParent
} from './nac-standard.mjs';

/** The smallest take-off that may legally come off this duct. */
function smallestTakeOffOn(parentMm) {
  return STOCKED_DIAMETERS_MM.find(mm => takeOffAllowedOn(mm, parentMm)) ?? parentMm;
}

// ── Geometry: flexible duct sweeps ───────────────────────────────────────────

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * A quadratic sweep from A to B, bowed sideways.
 *
 * Flex duct pulled between two points in a roof space takes a lazy curve, not
 * two straight legs and a corner. `bow` is how far the middle is pushed
 * perpendicular to the straight line, as a fraction of its length.
 */
export function sweep(from, to, bow = 0.18, samples = 10) {
  const len = dist(from, to);
  if (!(len > 0.5)) return [{ ...from }];
  const mid = lerp(from, to, 0.5);
  // Perpendicular to the run.
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  const ctrl = { x: mid.x + nx * len * bow, y: mid.y + ny * len * bow };

  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    pts.push({
      x: round(u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, 2),
      y: round(u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y, 2)
    });
  }
  return pts;
}

/**
 * A smooth run through a series of anchors — how a main travels across a house.
 *
 * Catmull-Rom through the anchors, so the duct passes through each one instead
 * of being pulled off course by it, and comes out as a single sweeping line
 * rather than a chain of straight legs.
 */
export function sweepThrough(anchors, samplesPerLeg = 8) {
  const a = anchors.filter(Boolean);
  if (a.length < 2) return a.map(p => ({ ...p }));
  if (a.length === 2) return sweep(a[0], a[1], 0.10, samplesPerLeg * 2);

  const pad = [a[0], ...a, a[a.length - 1]];
  const out = [];
  for (let i = 1; i < pad.length - 2; i++) {
    const p0 = pad[i - 1], p1 = pad[i], p2 = pad[i + 1], p3 = pad[i + 2];
    for (let s = 0; s < samplesPerLeg; s++) {
      const t = s / samplesPerLeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: round(0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
             (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
             (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3), 2),
        y: round(0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
             (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
             (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3), 2)
      });
    }
  }
  out.push({ ...a[a.length - 1] });
  return out;
}

/** The point on a sampled run closest to p, and how far along it sits. */
function nearestOnRun(runPts, p) {
  let best = null;
  for (let i = 0; i < runPts.length; i++) {
    const d = dist(runPts[i], p);
    if (!best || d < best.d) best = { d, i, pt: runPts[i] };
  }
  return best;
}

// ── Spatial grouping — how an installer divides a house ─────────────────────

/**
 * Split the outlets into the 2 or 3 areas the mains will serve.
 *
 * k-means on outlet position, because an installer groups by what is near what
 * — the open-plan end, the bedroom wing, the master and study — not by which
 * compass direction a room happens to lie in. Seeded deterministically (the
 * two furthest-apart outlets, then the one furthest from both) so the same
 * plan always produces the same design.
 */
/**
 * WHICH PART OF THE HOUSE AN OUTLET BELONGS TO.
 *
 * An installer does not divide a house with a compass, they divide it by what
 * it is: the open-plan living side, the bedroom wing, and whatever is left.
 * Clustering on position alone put the lounge on the living main and the foyer
 * on the bedroom main, because those happen to be the nearest points — which
 * is a division nobody could explain standing in the roof.
 */
function areaOf(outlet) {
  if (outlet.openPlan) return 'living';
  if (outlet.roomType === 'bedroom') return 'sleep';
  return 'other';
}

/**
 * Seed the mains on the AREAS, then let position sort out what is left.
 *
 * Two mains: living side, and everything else. Three: living, bedroom wing,
 * and the remainder. 'other' rooms — a formal lounge, a foyer, a study — join
 * whichever seed they actually sit nearest, because they are the rooms that
 * genuinely could go either way.
 */
export function groupByArea(outletPoints, k) {
  const byArea = { living: [], sleep: [], other: [] };
  for (const o of outletPoints) byArea[areaOf(o)].push(o);

  const centroid = (g) => g.length
    ? { x: g.reduce((n, o) => n + o.x, 0) / g.length,
        y: g.reduce((n, o) => n + o.y, 0) / g.length }
    : null;

  // The seeds that actually have rooms behind them, biggest area first.
  const seeds = [];
  if (byArea.living.length) seeds.push({ key: 'living', members: [...byArea.living] });
  if (byArea.sleep.length) seeds.push({ key: 'sleep', members: [...byArea.sleep] });
  if (!seeds.length) return null;

  // A third main only when there is a genuine third area to give it.
  if (k >= 3 && byArea.other.length >= 2) {
    seeds.push({ key: 'other', members: [...byArea.other] });
  } else if (byArea.other.length) {
    // Otherwise every leftover room joins the seed it sits nearest — by ROOM,
    // so one room never ends up split across two mains.
    const rooms = [...new Set(byArea.other.map(o => o.roomId))];
    for (const roomId of rooms) {
      const mine = byArea.other.filter(o => o.roomId === roomId);
      const c = centroid(mine);
      const best = seeds.reduce((a, sd) =>
        dist(centroid(sd.members), c) < dist(centroid(a.members), c) ? sd : a, seeds[0]);
      best.members.push(...mine);
    }
  }

  if (seeds.length < 2) return null;          // one area only — fall back
  return seeds.slice(0, k).map(sd => sd.members);
}

export function groupOutlets(outletPoints, k, opts = {}) {
  const pts = outletPoints.filter(o => o && isFinite(o.x) && isFinite(o.y));
  if (pts.length <= k) return pts.map(p => [p]);

  // AREA FIRST. Geometry is the fallback for a plan whose rooms carry nothing
  // to group on.
  if (opts.byArea !== false) {
    const areas = groupByArea(pts, k);
    if (areas && areas.length >= 2) return balanceGroups(areas);
  }

  // Deterministic seeds: furthest pair, then furthest from what is chosen.
  let seeds = [];
  let far = { d: -1 };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = dist(pts[i], pts[j]);
      if (d > far.d) far = { d, a: pts[i], b: pts[j] };
    }
  }
  seeds = [far.a, far.b];
  while (seeds.length < k) {
    let best = null;
    for (const p of pts) {
      if (seeds.includes(p)) continue;
      const d = Math.min(...seeds.map(s => dist(s, p)));
      if (!best || d > best.d) best = { d, p };
    }
    if (!best) break;
    seeds.push(best.p);
  }

  let centres = seeds.map(s => ({ x: s.x, y: s.y }));
  let groups = [];
  for (let pass = 0; pass < 24; pass++) {
    groups = centres.map(() => []);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      centres.forEach((c, i) => { const d = dist(c, p); if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    }
    const moved = centres.map((c, i) => {
      if (!groups[i].length) return c;
      return {
        x: groups[i].reduce((s, p) => s + p.x, 0) / groups[i].length,
        y: groups[i].reduce((s, p) => s + p.y, 0) / groups[i].length
      };
    });
    const shift = moved.reduce((s, c, i) => s + dist(c, centres[i]), 0);
    centres = moved;
    if (shift < 0.5) break;
  }

  // An empty group would leave the plenum with fewer mains than the standard
  // requires, so the biggest group lends it its furthest outlet.
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].length) continue;
    const biggest = groups.reduce((a, g) => (g.length > a.length ? g : a), groups[0]);
    if (biggest.length < 2) continue;
    const c = centres[i];
    const take = biggest.reduce((a, p) => (dist(c, p) < dist(c, a) ? p : a), biggest[0]);
    groups[i].push(take);
    biggest.splice(biggest.indexOf(take), 1);
  }
  return balanceGroups(groups.filter(g => g.length));
}

/**
 * Even the air out across the groups.
 *
 * THE NAC PLENUM RULE: two or three ducts of ONE size, carrying roughly the
 * same air each. Clustering on position alone gave 702 / 208 / 292 L/s off one
 * plenum — three identical spigots feeding wildly different loads, which is
 * neither how a plenum is made nor something anyone can balance on site.
 *
 * So after the spatial pass, outlets move from the heaviest group to the
 * lightest, and the one that moves is always the outlet SITTING NEAREST the
 * lightest group — the division stays a division of the house, not a
 * spreadsheet. A move is only taken if it actually improves the worst
 * deviation, which is what stops it oscillating.
 *
 * Outlets in the same room move together: one room's two diffusers fed off
 * two different mains is not a design, it is an accident.
 */
export function balanceGroups(groups, opts = {}) {
  if (groups.length < 2) return groups;
  const tolerance = opts.tolerancePct ?? SUPPLY_PLENUM.balanceTolerancePct;
  const flowOf = (g) => g.reduce((n, o) => n + (o.airflowLs || 0), 0);
  const centroid = (g) => ({
    x: g.reduce((n, o) => n + o.x, 0) / g.length,
    y: g.reduce((n, o) => n + o.y, 0) / g.length
  });
  const worst = (gs) => {
    const flows = gs.map(flowOf);
    const mean = flows.reduce((a, b) => a + b, 0) / flows.length;
    return mean > 0 ? Math.max(...flows.map(f => Math.abs(f - mean) / mean * 100)) : 0;
  };

  const work = groups.map(g => [...g]);
  // THE OPEN PLAN IS NEVER DIVIDED. Nick: "think in installer areas, not
  // geometry." A main serves a PART OF THE HOUSE — the living side, the bedroom
  // wing — and splitting the open plan across two mains to even the numbers up
  // produces a division nobody can explain standing in the roof. Where the
  // areas will not balance, the schedule says so; it does not quietly redraw
  // the house to make a number come out.
  for (let pass = 0; pass < 40; pass++) {
    if (worst(work) <= tolerance) break;
    const flows = work.map(flowOf);
    const heavy = flows.indexOf(Math.max(...flows));
    const light = flows.indexOf(Math.min(...flows));
    if (heavy === light) break;
    const target = centroid(work[light]);

    // Candidates are whole ROOMS in the heaviest group, nearest the lightest
    // group first. A room never splits across two mains.
    const rooms = [...new Set(work[heavy].map(o => o.roomId))]
      .map(roomId => {
        const members = work[heavy].filter(o => o.roomId === roomId);
        return {
          roomId, members,
          ls: members.reduce((n, o) => n + o.airflowLs, 0),
          d: Math.min(...members.map(o => dist(target, o)))
        };
      })
      .sort((a, b) => a.d - b.d);

    const heavyCentre = centroid(work[heavy]);
    let moved = false;
    for (const room of rooms) {
      // Never empty a main: the plenum has to keep all of its ducts.
      if (room.members.length >= work[heavy].length) continue;
      // ONLY A ROOM THAT GENUINELY SITS BETWEEN THE TWO MAY MOVE.
      //
      // Balancing on airflow alone walked a family room out of the open-plan
      // side and onto the bedroom main, purely because the numbers came out
      // evener — a division nobody could explain standing in the roof. A room
      // moves only when it is about as close to the lighter main's area as to
      // its own.
      const mine = Math.min(...room.members.map(o => dist(heavyCentre, o)));
      if (room.d > mine * (opts.boundaryRatio ?? 1.3)) continue;
      // AND THE OPEN PLAN IS NOT DIVIDED. Rooms that share one air space share
      // one main: taking the family room off the living main to even the
      // numbers up is the thing that stops a drawing being explainable.
      if (room.members.some(o => o.openPlan) &&
          work[heavy].some(o => o.openPlan && o.roomId !== room.roomId)) continue;
      const trial = work.map((g, i) =>
        i === heavy ? g.filter(o => o.roomId !== room.roomId)
        : i === light ? [...g, ...room.members] : g);
      if (worst(trial) < worst(work) - 0.01) {
        work[heavy] = trial[heavy];
        work[light] = trial[light];
        moved = true;
        break;
      }
    }
    if (!moved) break;   // this is as even as this house gets without splitting it
  }
  return work.filter(g => g.length);
}

/**
 * THE LINE AN AREA RUNS ALONG.
 *
 * The principal axis of a set of outlets: the direction they actually spread
 * in. A bedroom wing down one side of a house has an axis down that side; an
 * open plan across the front has one across the front. It is the line an
 * installer would pull one duct along and then take off left and right, which
 * is why the main is put on it rather than bowed through the middle of the
 * group.
 */
function principalAxis(points, centre) {
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    const dx = p.x - centre.x, dy = p.y - centre.y;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const n = points.length || 1;
  sxx /= n; sxy /= n; syy /= n;
  // Larger eigenvector of the 2x2 covariance matrix.
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  let vx = sxy, vy = l1 - sxx;
  if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) { vx = 1; vy = 0; }
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}

/** Which way a run is travelling at one of its points. */
function runAngleAt(pts, i) {
  const a = pts[Math.max(0, Math.min(i, pts.length - 2))];
  const b = pts[Math.max(1, Math.min(i + 1, pts.length - 1))];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** A readable name for a group, from the rooms in it. */
function groupName(members) {
  const rooms = [...new Set(members.map(m => m.roomLabel))];
  if (rooms.length <= 3) return rooms.join(' / ');
  return rooms.slice(0, 2).join(' / ') + ' + ' + (rooms.length - 2) + ' more';
}

// ── The topology ─────────────────────────────────────────────────────────────

/**
 * Build the NAC topology for a design.
 *
 * Returns the plenum, the mains, every BTO, every final flex run and the
 * returns, as `segments` the rest of the pipeline sizes and consumes.
 */
export function buildNacTopology({ rooms = [], airflow, outlets, layout = {}, zones = null,
                                   returnDesign = null } = {}, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const warnings = [];
  const roomsById = new Map((rooms || []).map(r => [r.id, r]));
  const outletsByRoom = new Map((outlets?.rows || []).map(o => [o.roomId, o]));
  const zoneByRoom = new Map();
  for (const z of (zones?.zones || [])) {
    for (const rid of (z.roomIds || [])) zoneByRoom.set(rid, z.name || z.id);
  }

  // ── Where the air starts ──────────────────────────────────────────────────
  const placed = (rooms || []).filter(r => isConditionedRoom(r) && r.boundaryPx);
  if (!placed.length) {
    return { generated: false, segments: [], nodes: [], warnings: [{
      code: 'NO_ROOM_GEOMETRY', severity: 'CHECK',
      message: 'No conditioned room has a boundary on the plan, so there is nothing to route to.' }] };
  }
  const bounds = placed.reduce((b, r) => ({
    x0: Math.min(b.x0, r.boundaryPx.x), y0: Math.min(b.y0, r.boundaryPx.y),
    x1: Math.max(b.x1, r.boundaryPx.x + r.boundaryPx.w),
    y1: Math.max(b.y1, r.boundaryPx.y + r.boundaryPx.h)
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const footprint = { x: bounds.x0, y: bounds.y0, w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 };

  let plenum = layout.plenum?.x !== undefined ? { x: layout.plenum.x, y: layout.plenum.y }
             : layout.indoorUnit?.x !== undefined ? { x: layout.indoorUnit.x, y: layout.indoorUnit.y }
             : null;
  let plenumSource = plenum ? 'placed' : null;
  if (!plenum) {
    // A FAN COIL GOES OVER THE HALLWAY. That is where NAC puts it: central,
    // reachable through a manhole, next to where the return comes back. The
    // middle of the FOOTPRINT is a different point — often the middle of a
    // living room — and putting it there is what made every run appear to
    // explode out of one spot in the centre of the plan.
    const hall = placed.filter(r => r.roomType === 'hallway')
      .sort((a, b) => (b.boundaryPx.w * b.boundaryPx.h) - (a.boundaryPx.w * a.boundaryPx.h))[0];
    if (hall) {
      plenum = { x: hall.boundaryPx.x + hall.boundaryPx.w / 2,
                 y: hall.boundaryPx.y + hall.boundaryPx.h / 2 };
      plenumSource = 'assumed_hallway';
      warnings.push({ code: 'PLENUM_POSITION_ASSUMED', severity: 'CHECK',
        message: 'No supply plenum has been placed, so it was assumed over ' + hall.label +
                 ' — where NAC normally sits the fan coil. Place it and re-route for real lengths.' });
    } else {
      plenum = { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
      plenumSource = 'assumed_centre';
      warnings.push({ code: 'PLENUM_POSITION_ASSUMED', severity: 'CHECK',
        message: 'No supply plenum has been placed and this plan has no hallway, so it was ' +
                 'assumed at the middle of the house. Place it and re-route for real lengths.' });
    }
  }

  // HOW FAR A DUCT HAS TO GET AWAY FROM THE PLENUM before anything comes off
  // it — the same length a reducer needs to be worth fitting. Without a scale
  // yet it falls back to a fraction of the house.
  const plenumClearPx = opts.calibration?.mmPerPixel
    ? MAIN_REDUCTIONS.minStretchM * 1000 / opts.calibration.mmPerPixel
    : Math.max(footprint.w, footprint.h) * 0.12;

  // Rooms in the always-open zone ARE the open-plan living side — the zoning
  // engine has already worked out which rooms share an air space, so the duct
  // grouping does not have to guess at it a second time.
  // A HALLWAY IS NOT THE OPEN PLAN. Zoning puts the foyer in the common zone
  // because it opens onto the living area and never closes — which is right for
  // a damper and wrong for a duct. Treated as open plan it was pulled onto the
  // living main with the kitchen, when what it needs is a short local branch off
  // whatever main goes past it.
  const openPlanRooms = new Set((zones?.zones || [])
    .filter(z => z.alwaysOpen || z.kind === 'common')
    .flatMap(z => z.roomIds || [])
    .filter(id => roomsById.get(id)?.roomType !== 'hallway'));

  // ── Every outlet that has to be reached ───────────────────────────────────
  const outletPoints = [];
  for (const row of (airflow?.rows || [])) {
    const room = roomsById.get(row.roomId);
    if (!room?.boundaryPx) {
      warnings.push({ code: 'ROOM_NOT_ON_PLAN', severity: 'CHECK',
        message: row.label + ' has no boundary on the plan, so it could not be routed to.' });
      continue;
    }
    // A ROOM ON SPILL AIR GETS NO DUCT. It keeps its load and its floor area —
    // it is conditioned — but the outlet design gave it no outlet, so routing
    // to it would put a duct in the roof that nobody asked for and nobody
    // installs. Defaulting the quantity to 1 for a room with no outlet row was
    // running a flex to the study at zero litres a second.
    const qty = outletsByRoom.get(row.roomId)?.quantity ?? (outlets ? 0 : 1);
    if (!qty || row.spillOnly || !(row.adjustedLs > 0)) continue;
    const b = room.boundaryPx;
    for (let i = 0; i < qty; i++) {
      const manual = layout['outlet_' + row.roomId + '_' + i];
      const frac = (i + 1) / (qty + 1);
      outletPoints.push({
        id: 'outlet_' + row.roomId + (qty > 1 ? '_' + (i + 1) : ''),
        roomId: row.roomId,
        roomLabel: row.label,
        index: i + 1,
        of: qty,
        airflowLs: (row.adjustedLs || 0) / qty,
        zone: zoneByRoom.get(row.roomId) || null,
        // What KIND of space this is, which is how the house gets divided into
        // mains. The open-plan zone is the living side; a bedroom is the wing.
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

  // ── HARD RULE 1: two or three mains, each serving a spatial group ─────────
  // HOW MANY DUCTS LEAVE THE PLENUM, AND WHAT SIZE THEY ALL ARE — one
  // decision, not two. 1202 L/s is 2 x 400 at 4.78 m/s or 3 x 400 at 3.19,
  // and only the first is a duct moving air, so the count cannot be settled
  // before the size.
  const systemLs = outletPoints.reduce((s, o) => s + o.airflowLs, 0);
  const plenumChoice = choosePlenumMains(systemLs, settings.duct?.velocity?.main);
  const wantMains = Math.min(
    Math.max(opts.mainCount || plenumChoice.count, SUPPLY_PLENUM.minMains),
    Math.min(SUPPLY_PLENUM.maxMains, outletPoints.length));
  const groups = groupOutlets(outletPoints, wantMains);
  if (!plenumChoice.inBand) {
    warnings.push({ code: 'PLENUM_OUT_OF_BAND', severity: 'CHECK',
      message: 'No 2 or 3 duct plenum keeps the mains inside the velocity band at ' +
               Math.round(systemLs) + ' L/s. Closest is ' + plenumChoice.reason });
  }

  // ── THE NAC PLENUM RULE: every duct off it is the same size ──────────────
  // A plenum is a box with identical spigots. Sizing each main on its own
  // airflow gave a 400, a 250 and a 250 off one box. They are all one size,
  // chosen for the HEAVIEST group so none of them is over-velocity, and the
  // groups have already been evened out above so that one size suits them all.
  // A MAIN IS NEVER A 250. Velocity will happily pick one for a light group;
  // NAC does not run one, because the 250 finals coming off it would be
  // full-bore take-offs with air still to carry past them.
  const sizeForMain = (ls) => Math.max(MIN_MAIN_DIAMETER_MM,
    selectDiameter(ls, 'main', { settings }).diameterMm);
  const groupFlows = groups.map(g => g.reduce((n, o) => n + o.airflowLs, 0));
  // The plenum's own choice decides it. The groups came out balanced, so the
  // size that suits the average suits all of them; the per-group fallback is
  // only there for a plenum the estimator has forced to a count of its own.
  const commonMainMm = !SUPPLY_PLENUM.sameSizeMains ? null
    : wantMains === plenumChoice.count ? plenumChoice.diameterMm
    : Math.max(...groupFlows.map(sizeForMain));

  const segments = [];
  const nodes = [{ id: 'plenum', type: 'plenum', x: plenum.x, y: plenum.y,
                   source: plenumSource, label: 'Supply plenum' }];
  const btos = [];
  const letters = 'ABCDEFG';
  let btoNo = 0;

  groups.forEach((members, gi) => {
    const letter = letters[gi];
    const mainId = 'main_' + letter;
    const groupLs = members.reduce((s, o) => s + o.airflowLs, 0);

    // ── A MAIN RUNS ON A SPINE ─────────────────────────────────────────────
    //
    // Nick: "Do not make the bedroom wing look like one long wandering run."
    // Bowing the main out to the group's CENTRE and on to its furthest outlet
    // is what made it wander — the centre of a scattered group is a point in
    // the middle of nothing, and the run went there on its way to somewhere
    // else.
    //
    // An installer does not do that. They pick the LINE the area runs along —
    // down the hall, along the back of the living space — and pull one duct
    // down it, then take off it left and right. So the spine is the group's
    // own principal axis: the direction the outlets actually spread in. The
    // main enters the area from the plenum and runs that axis to the far end,
    // and every final is then a short drop off it.
    const centre = {
      x: members.reduce((s, o) => s + o.x, 0) / members.length,
      y: members.reduce((s, o) => s + o.y, 0) / members.length
    };
    const axis = principalAxis(members, centre);
    const proj = members.map(o => (o.x - centre.x) * axis.x + (o.y - centre.y) * axis.y);
    const lo = Math.min(...proj), hi = Math.max(...proj);
    const at = (t) => ({ x: centre.x + axis.x * t, y: centre.y + axis.y * t });

    // WHERE THE MAIN JOINS THE SPINE, AND WHICH WAY IT GOES.
    //
    // It joins BESIDE THE PLENUM and runs to the far end. Starting at the near
    // end of the axis instead sent the bedroom main east to the master first
    // and then back south-west past the plenum to the wing — a duct that leaves
    // the box, goes the wrong way, and comes back. Anything on the short side
    // of the plenum is picked up by the local branch, which is what it is for.
    const plenumT = Math.max(lo, Math.min(hi,
      (plenum.x - centre.x) * axis.x + (plenum.y - centre.y) * axis.y));
    const far = Math.abs(hi - plenumT) >= Math.abs(lo - plenumT) ? hi : lo;
    const entry = at(plenumT + (far - plenumT) * 0.12);
    const end = at(plenumT + (far - plenumT) * 0.88);
    const runPts = sweepThrough([plenum, lerp(plenum, entry, 0.6), entry,
                                 lerp(entry, end, 0.5), end]);

    // ── Where each outlet leaves the main ───────────────────────────────────
    // A BTO sits on the main at the point nearest the outlet it feeds, so the
    // final flex is the short run it should be.
    // ── NOTHING COMES OFF A MAIN IN ITS FIRST FEW METRES ───────────────────
    // Nick, on the foyer: it "should NOT come straight off a 400 main — it must
    // be served more sensibly from an appropriate branch / major run." The
    // plenum sits over the hallway, so the foyer's own take-off landed ON the
    // plenum, and so did the master's, and the branch to the family room. Five
    // ducts leaving one point is the "messy central cluster where everything
    // appears to explode off the plenum".
    //
    // A main leaves the box and GETS CLEAR before anything comes off it — the
    // same length a reducer needs to be worth fitting. A take-off that wants to
    // sit inside that is slid along the run to where the main actually is, and
    // its flex covers the rest. Nothing is added to the job: it is the same
    // duct, tapped where an installer would tap it.
    const deadZonePx = plenumClearPx;
    let clearIndex = 0;
    for (let k = 1, run = 0; k < runPts.length; k++) {
      run += dist(runPts[k - 1], runPts[k]);
      if (run >= deadZonePx) { clearIndex = k; break; }
      clearIndex = k;
    }

    const taps = members.map(o => {
      const near = nearestOnRun(runPts, o);
      const i = Math.max(near.i, clearIndex);
      const at = runPts[i];
      return { outlet: o, at, alongIndex: i, run: dist(at, o),
               slidOffPlenum: i > near.i };
    }).sort((a, b) => a.alongIndex - b.alongIndex);

    // ── HARD RULE 5: outlets far from the main share a major branch ─────────
    // Two or more outlets sitting well off the main get ONE major branch out to
    // them, and each then comes off it through its own BTO. Pulling each of
    // them individually back to the main is the "explosion of branches" this
    // model exists to stop.
    //
    // AND A SLEEPING WING GETS ITS OWN, whether or not it happens to sit far
    // from the main. Two or more bedrooms grouped together down one end of the
    // house is a WING, and an installer runs one duct down it and takes off it
    // — they do not pull four separate runs back past each other to a main.
    // That is the difference between a layout somebody designed and a layout a
    // clustering algorithm produced.
    const farThreshold = Math.max(footprint.w, footprint.h) * 0.16;

    const wingRoomIds = new Set();
    const beds = taps.filter(t => t.outlet.roomType === 'bedroom');
    if (beds.length >= BTO_RULES.minRoomsForMajorBranch + 1) {
      // Split the bedrooms into the wing and any lone bedroom sitting apart
      // from it — a master off the living end is not part of the wing.
      const bedGroups = groupOutlets(beds.map(t => t.outlet), 2, { byArea: false });
      const wing = (bedGroups || []).sort((a, b) => b.length - a.length)[0] || [];
      if (wing.length >= BTO_RULES.minRoomsForMajorBranch) {
        for (const o of wing) wingRoomIds.add(o.roomId);
      }
    }

    const clusters = [];
    const wingTaps = taps.filter(t => wingRoomIds.has(t.outlet.roomId));
    if (wingTaps.length >= BTO_RULES.minRoomsForMajorBranch) {
      clusters.push({ direct: false, wing: true, taps: wingTaps });
    }
    for (const t of taps) {
      if (wingRoomIds.has(t.outlet.roomId)) continue;
      if (t.run < farThreshold) { clusters.push({ direct: true, taps: [t] }); continue; }
      const open = clusters.find(c => !c.direct && !c.wing &&
        dist(c.taps[0].outlet, t.outlet) < farThreshold &&
        Math.abs(c.taps[0].alongIndex - t.alongIndex) < runPts.length * 0.3);
      if (open) open.taps.push(t);
      else clusters.push({ direct: false, taps: [t] });
    }
    clusters.sort((a, b) => a.taps[0].alongIndex - b.taps[0].alongIndex);

    // ── A LOCAL BRANCH NEAR THE PLENUM ─────────────────────────────────────
    //
    // Nick, on the foyer: "Do not hang it directly off a large main unless that
    // is truly practical. Feed it from an appropriate local branch/BTO."
    //
    // The rooms nearest the plenum are the ones that make a main look like the
    // centre of a spiderweb: four saddles on the biggest duct in the house
    // inside the first few metres, each heading off at its own angle. Where two
    // or more of those rooms sit near ONE ANOTHER, they get one local branch
    // instead — the main carries on to the area it is for, and the branch picks
    // up the rooms beside it.
    const nearCut = runPts.length * LOCAL_BRANCH.nearZoneFraction;
    const localRadius = farThreshold * LOCAL_BRANCH.radiusFactor;
    // A room sitting a little further off the main is still one of the rooms
    // by the plenum: it is exactly the one whose flex was crossing the others
    // to reach a saddle on the big duct. Anything that is not already a shared
    // branch is a candidate.
    const nearDirect = clusters.filter(c =>
      !c.wing && !c.local && c.taps.length <= 2 && c.taps[0].alongIndex <= nearCut);
    if (nearDirect.length >= 2 && nearDirect.length < clusters.length) {
      const pools = [];
      for (const c of nearDirect) {
        const pool = pools.find(pl => pl.some(o =>
          dist(o.taps[0].outlet, c.taps[0].outlet) < localRadius));
        if (pool) pool.push(c); else pools.push([c]);
      }
      for (const pool of pools) {
        const rooms = new Set(pool.flatMap(c => c.taps.map(t => t.outlet.roomId)));
        if (rooms.size < BTO_RULES.minRoomsForMajorBranch) continue;
        const taps = pool.flatMap(c => c.taps).sort((a, b) => a.alongIndex - b.alongIndex);
        for (const c of pool) clusters.splice(clusters.indexOf(c), 1);
        clusters.push({ direct: false, local: true, taps });
      }
      clusters.sort((a, b) => a.taps[0].alongIndex - b.taps[0].alongIndex);
    }

    // ── The main, split ONLY where its size actually changes ───────────────
    // A main is one continuous flex duct. It gets reduced when enough air has
    // come off it to warrant a smaller size, and NOWHERE ELSE. Emitting a
    // segment per take-off produced a chain of eight contrived "trunk" runs to
    // reach one bedroom, which is the artificial-segment failure the NAC rules
    // name — and it put seven imaginary joins into the pressure calculation.
    //
    // So the airflow is walked down the run, the size NAC would fit is asked
    // for at each point, and a new segment starts only when that answer
    // changes. Each break is a real reducer somebody buys and fits.
    const sizeFor = (ls) => Math.max(MIN_MAIN_DIAMETER_MM,
      selectDiameter(ls, 'main', { settings }).diameterMm);

    // Walk the air down the run and note every point where the size NAC would
    // fit changes. Those are the CANDIDATE reductions.
    // A main may not be reduced past a FINAL that still has to come off it: a
    // 250 take-off cannot be fitted to a 200 main, and capping it would give
    // one room two different final sizes for the same airflow. So each
    // candidate reduction is floored at the largest final still downstream.
    const largestFinalAfter = clusters.map((_, ci) =>
      Math.max(0, ...clusters.slice(ci + 1).flatMap(c =>
        c.taps.map(t => finalSizeForAirflow(t.outlet.airflowLs)))));

    // The run STARTS at the plenum's common size, not at whatever this group's
    // own airflow would pick on its own: what leaves a plenum is decided by the
    // plenum, and all of its ducts are the same.
    let carried = groupLs;
    const startSize = commonMainMm || sizeFor(carried);
    const candidates = [];
    clusters.forEach((cluster, ci) => {
      const taken = cluster.taps.reduce((sum, t) => sum + t.outlet.airflowLs, 0);
      carried -= taken;
      if (ci >= clusters.length - 1 || carried <= 1) return;
      // A MAIN IS ONLY REDUCED IF IT STILL HAS WORK TO DO. A 300 reducer was
      // bought so 56 L/s could crawl the last 4.8 m to ONE outlet at 0.79 m/s.
      // Nobody fits a reducer to reach the last room — they run the duct out.
      // Two or more outlets still to come and it is a main worth necking down;
      // one and it is the end of the run.
      const outletsAfter = clusters.slice(ci + 1)
        .reduce((n, c) => n + c.taps.length, 0);
      if (outletsAfter < MAIN_REDUCTIONS.minOutletsAfter) return;
      candidates.push({
        afterCluster: ci,
        atIndex: cluster.taps[cluster.taps.length - 1].alongIndex,
        airflowLs: carried,
        // A size ABOVE the largest final still downstream — level with it is a
        // full-bore take-off.
        size: Math.max(MIN_MAIN_DIAMETER_MM,
          mainFloorForFinals(sizeFor(carried), [largestFinalAfter[ci]]))
      });
    });

    // THE NAC MAIN REDUCTION RULE: a main is reduced once or twice, at the
    // biggest drops — not at every size on the ladder. Five reducers on one run
    // is money and resistance nobody buys, and it turns one duct into five
    // segments the pressure calculation then has to pretend are real.
    //
    // And a reduction has to be far enough along the run to be a real fitting.
    // The balanced plenum put a take-off 130 mm off the box on one main, and
    // the planner reduced there: 130 mm of 350 flex and then a reducer. So a
    // stretch has to earn its length before the next one starts.
    const mPerPx = opts.calibration?.mmPerPixel ? opts.calibration.mmPerPixel / 1000 : null;
    const alongM = (i) => {
      if (!mPerPx) return Infinity;   // no scale yet: do not block on length
      let n = 0;
      for (let k = 1; k <= Math.min(i, runPts.length - 1); k++) n += dist(runPts[k - 1], runPts[k]);
      return n * mPerPx;
    };

    // Both sides of a reducer have to be a real length of duct: enough run
    // before it to be worth starting at the bigger size, and enough after it to
    // be worth necking down at all. A reducer with 140 mm of duct on the far
    // side of it is a fitting bought for nothing.
    const totalM = alongM(runPts.length - 1);
    const steps = [];
    let running = startSize;
    let lastBreakM = 0;
    for (const c of candidates) {
      if (running - c.size < MAIN_REDUCTIONS.minStepMm) continue;
      const atM = alongM(c.atIndex);
      if (atM - lastBreakM < MAIN_REDUCTIONS.minStretchM) continue;
      if (totalM - atM < MAIN_REDUCTIONS.minStretchM) continue;
      steps.push({ ...c, from: running, drop: running - c.size, atM });
      running = c.size;
      lastBreakM = atM;
    }
    const kept = steps
      .sort((a, b) => b.drop - a.drop)
      .slice(0, MAIN_REDUCTIONS.maxPerMain)
      .sort((a, b) => a.afterCluster - b.afterCluster);

    // Now cut the run into one stretch per KEPT reduction.
    const stretches = [];
    let cur = { from: 0, airflowLs: groupLs, sizeMm: startSize, clusters: [] };
    clusters.forEach((cluster, ci) => {
      cur.clusters.push({ cluster, ci });
      const step = kept.find(k => k.afterCluster === ci);
      cur.to = cluster.taps[cluster.taps.length - 1].alongIndex;
      if (step) {
        stretches.push(cur);
        cur = { from: step.atIndex, airflowLs: step.airflowLs, sizeMm: step.size, clusters: [] };
      }
    });
    if (cur.clusters.length) { cur.to = runPts.length - 1; stretches.push(cur); }

    // ── THE END OF A MAIN IS THE WING MAIN ─────────────────────────────────
    //
    // Nick draws the bedroom wing as "BEDROOM WING MAIN -> BTO -> flex ->
    // outlet". Where the LAST stretch of a main has nothing left on it but the
    // wing, that stretch IS the wing main: running a separate 250 branch off
    // the end of it puts two ducts down one hallway and buys a fitting to join
    // a duct to itself. The take-offs go on the stretch, and the drawing shows
    // one line down the wing with three drops off it.
    //
    // Only the LAST stretch, and only where the take-offs are legal on it — the
    // local branch by the plenum is not the end of anything, and collapsing it
    // would put a 200 saddle back on the 350.
    const tail = stretches[stretches.length - 1];
    if (tail && tail.clusters.length === 1) {
      const only = tail.clusters[0].cluster;
      const legal = only.taps.every(t =>
        takeOffAllowedOn(finalSizeForAirflow(t.outlet.airflowLs), tail.sizeMm));
      if (!only.direct && legal) {
        // ONE MANIFOLD ON THE MAIN, NOT THREE SADDLES.
        //
        // The wing's runs stop being a separate branch duct, but they do NOT
        // become three unrelated take-offs strung along the main: an installer
        // sets one multi-spigot BTO and runs three flexes off it. So every tap
        // moves to the SAME point on the stretch, which is what makes the BTO
        // layer see one fitting with three ports instead of three collars.
        const at = only.taps[Math.floor(only.taps.length / 2)];
        for (const t of only.taps) { t.alongIndex = at.alongIndex; t.at = at.at;
                                     t.run = dist(t.at, t.outlet); }
        tail.clusters = only.taps.map(t => ({ cluster: { direct: true, taps: [t] },
                                              ci: tail.clusters[0].ci }));
      }
    }

    // ── ONE MANIFOLD, NOT A ROW OF SADDLES ─────────────────────────────────
    //
    // Nick: "Avoid long mains with fake sequential BTO points." Take-offs that
    // land within a couple of metres of one another on the same stretch are ONE
    // fabricated body with several spigots — that is what a BTO is. So their
    // tap points are brought together, up to the number of spigots a body
    // carries; past that the next group is a second fitting further along.
    //
    // Nothing is moved across the house to achieve it: the span is a real
    // distance along the duct, and outlets further apart than that stay on
    // their own collars.
    for (const stretch of stretches) {
      const singles = stretch.clusters.filter(c => c.cluster.direct);
      if (singles.length < 2) continue;
      const taps = singles.map(c => c.cluster.taps[0]).sort((a, b) => a.alongIndex - b.alongIndex);
      const spanPx = opts.calibration?.mmPerPixel
        ? BTO_RULES.sharedTakeOffSpanM * 1000 / opts.calibration.mmPerPixel
        : Math.max(footprint.w, footprint.h) * 0.14;
      let group = [];
      const flush = () => {
        if (group.length < 2) { group = []; return; }
        const at = group[Math.floor(group.length / 2)];
        for (const t of group) { t.alongIndex = at.alongIndex; t.at = at.at;
                                 t.run = dist(t.at, t.outlet); }
        group = [];
      };
      for (const t of taps) {
        if (group.length && (group.length >= BTO_RULES.maxPortsPerFitting ||
            dist(group[0].at, t.at) > spanPx)) flush();
        group.push(t);
      }
      flush();
    }

    let prevId = null;
    stretches.forEach((stretch, si) => {
      const from = Math.min(stretch.from, runPts.length - 2);
      const to = Math.min(Math.max(stretch.to + 1, from + 2), runPts.length);
      const segId = si === 0 ? mainId : mainId + '_' + (si + 1);

      // EVERY TAKE-OFF SITS ON THE STRETCH IT COMES OFF.
      //
      // A cluster is placed in a stretch by its FIRST tap, but a shared branch
      // spans several, so a reduction cut on the last of them could land after
      // the next cluster's tap — and that take-off was then drawn at a point on
      // the stretch BEFORE it. The duct came off a run it was not attached to,
      // which the route editor sees as a broken joint and an installer would
      // see as a branch hanging in the air.
      for (const { cluster } of stretch.clusters) {
        for (const t of cluster.taps) {
          const i = Math.max(from, Math.min(t.alongIndex, to - 1));
          if (i === t.alongIndex) continue;
          t.alongIndex = i;
          t.at = runPts[i];
          t.run = dist(t.at, t.outlet);
        }
        cluster.taps.sort((a, b) => a.alongIndex - b.alongIndex);
      }

      segments.push({
        id: segId,
        parentId: prevId,
        role: si === 0 ? 'main' : 'trunk',
        nacRole: 'MAIN',
        mainKey: letter,
        plenumOutlet: si === 0,
        flex: true,
        destination: si === 0
          ? 'Supply plenum \u2192 Main ' + letter
          : 'Main ' + letter + ' (reduced)',
        serves: si === 0 ? [...new Set(members.map(m => m.roomLabel))] : null,
        airflowLs: round(stretch.airflowLs, 0),
        // The size the PLENUM RULE and the reduction plan decided. Velocity
        // does not get a second vote on a main, or the first duct off the
        // plenum stops matching the other two.
        diameterMm: stretch.sizeMm,
        points: runPts.slice(from, to),
        rigid: false,
        fittings: (si === 0 && gi === 0) ? ['supply_plenum'] : []
      });
      prevId = segId;

      // ── The take-offs along this stretch ─────────────────────────────────
      for (const { cluster } of stretch.clusters) {
        let feedsFrom = prevId;
        let splitAt = cluster.taps[0].at;

        // HARD RULE 5 — outlets sitting well off the main share ONE major
        // branch, and each then comes off it through its own BTO.
        if (!cluster.direct &&
            (cluster.local || cluster.taps.length >= BTO_RULES.minRoomsForMajorBranch)) {
          const hub = {
            x: cluster.taps.reduce((sum, t) => sum + t.outlet.x, 0) / cluster.taps.length,
            y: cluster.taps.reduce((sum, t) => sum + t.outlet.y, 0) / cluster.taps.length
          };
          const toward = lerp(cluster.taps[0].at, hub, 0.7);
          const majorLs = cluster.taps.reduce((sum, t) => sum + t.outlet.airflowLs, 0);
          // A MAJOR BRANCH IS SIZED LIKE A MAIN, NOT LIKE A FINAL.
          //   - one stock size ABOVE the largest final coming off it, or it is
          //     a full-bore take-off with air still to carry past the first room
          //     (the bedroom wing came out a 200 branch with three 200s on it);
          //   - never more than two sizes under the duct it taps, or the branch
          //     itself is the take-off the step rule exists to stop;
          //   - never bigger than that duct.
          const majorFinals = cluster.taps.map(t => finalSizeForAirflow(t.outlet.airflowLs));
          const majorMm = capBranchToParent(
            Math.max(
              mainFloorForFinals(selectDiameter(majorLs, 'branch', { settings }).diameterMm,
                                 majorFinals),
              smallestTakeOffOn(stretch.sizeMm)),
            stretch.sizeMm);
          const majorId = 'major_' + letter + '_' + (btoNo + 1);
          btoNo += 1;
          segments.push({
            id: majorId,
            parentId: prevId,
            role: 'branch',
            nacRole: 'MAJOR_BRANCH',
            mainKey: letter,
            major: true,
            bto: true,
            btoNumber: btoNo,
            flex: true,
            destination: groupName(cluster.taps.map(t => t.outlet)),
            serves: [...new Set(cluster.taps.map(t => t.outlet.roomLabel))],
            airflowLs: round(majorLs, 0),
            diameterMm: majorMm,
            zone: cluster.taps[0].outlet.zone,
            points: sweep(cluster.taps[0].at, toward, 0.12),
            fittings: ['takeoff']
          });
          nodes.push({ id: 'bto_' + btoNo, type: 'bto', bto: true,
                       x: cluster.taps[0].at.x, y: cluster.taps[0].at.y,
                       // The direction of the duct it sits ON, so the drawing
                       // can set the collar ACROSS the main the way a take-off
                       // is drawn rather than as a dot floating on it.
                       angle: runAngleAt(runPts, cluster.taps[0].alongIndex),
                       label: 'BTO ' + btoNo,
                       serves: [...new Set(cluster.taps.map(t => t.outlet.roomLabel))] });
          feedsFrom = majorId;
          splitAt = toward;
        }

        // HARD RULE 2 — BTO -> ONE continuous final flex -> OUTLET.
        for (const t of cluster.taps) {
          btoNo += 1;
          const start = cluster.direct ? t.at : splitAt;
          segments.push({
            id: 'final_' + t.outlet.id,
            parentId: feedsFrom,
            role: 'final',
            nacRole: 'FINAL_FLEX',
            mainKey: letter,
            bto: true,
            btoNumber: btoNo,
            flex: true,
            roomId: t.outlet.roomId,
            outletId: t.outlet.id,
            destination: t.outlet.of > 1
              ? t.outlet.roomLabel + ' outlet ' + t.outlet.index
              : t.outlet.roomLabel,
            airflowLs: round(t.outlet.airflowLs, 0),
            zone: t.outlet.zone,
            points: sweep(start, { x: t.outlet.x, y: t.outlet.y }, 0.22),
            fittings: ['takeoff']
          });
          nodes.push({ id: 'bto_' + btoNo, type: 'bto', bto: true, x: start.x, y: start.y,
                       angle: cluster.direct ? runAngleAt(runPts, t.alongIndex)
                                             : Math.atan2(t.outlet.y - start.y,
                                                          t.outlet.x - start.x) + Math.PI / 2,
                       label: 'BTO ' + btoNo, serves: [t.outlet.roomLabel] });
          nodes.push({ id: t.outlet.id, type: 'outlet', x: t.outlet.x, y: t.outlet.y,
                       label: t.outlet.roomLabel, zone: t.outlet.zone });
        }
      }
    });
  });

  // ── HARD RULE 6: one or two returns ───────────────────────────────────────
  const returnCount = returnDesign?.returnCount
    ?? returnCountFor(systemLs, { override: opts.returnCount });
  // A RETURN GOES IN A HALLWAY. That is where NAC puts them: central,
  // reachable, out of the rooms. Putting them in the two BIGGEST rooms dropped
  // a grille in the middle of the living area and another in a bedroom, which
  // is neither how it is installed nor something anybody wants in a ceiling
  // they look at.
  const centreOf = (r) => ({ x: r.boundaryPx.x + r.boundaryPx.w / 2,
                             y: r.boundaryPx.y + r.boundaryPx.h / 2 });
  const halls = placed.filter(r => r.roomType === 'hallway')
    .sort((a, b) => dist(plenum, centreOf(a)) - dist(plenum, centreOf(b)));

  // Where a house has fewer hallways than returns, the extra one goes into the
  // CIRCULATION serving the rooms furthest from the first: the corridor a
  // bedroom wing hangs off. Approximated as the point between the plenum and
  // that group, which is the corridor on any normal plan.
  // A RETURN GRILLE IS NOT UNDER THE PLENUM. The fan coil sits over the
  // hallway, so the hallway's centre and the plenum are the same point, and the
  // return came out as a duct of zero length from the box back to itself. The
  // grille goes along the hallway, clear of the unit — which is where you would
  // stand to look at it.
  const clearOfPlenum = (pt, room) => {
    if (dist(pt, plenum) >= plenumClearPx) return pt;
    const b = room.boundaryPx;
    const along = b.w >= b.h ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const roomHalf = (b.w >= b.h ? b.w : b.h) / 2;
    // AND IT STAYS IN THE HALLWAY. Pushing it a fixed distance put the grille
    // through the wall and into the meals area, which is not a hallway and is
    // not where anybody fits a return.
    const reach = Math.min(plenumClearPx, roomHalf * 0.8);
    const a = { x: plenum.x + along.x * reach, y: plenum.y + along.y * reach };
    const c = { x: plenum.x - along.x * reach, y: plenum.y - along.y * reach };
    const inside = (q) => q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h;
    // AND AWAY FROM THE OPEN PLAN. A return grille belongs in the circulation
    // the closed rooms breathe back through, not at the end of the hall that
    // opens into the living area — which is also where every supply run is, so
    // putting it there crowded the drawing as well as the ceiling.
    const openPts = outletPoints.filter(o => o.openPlan);
    const openCentre = openPts.length
      ? { x: openPts.reduce((n, o) => n + o.x, 0) / openPts.length,
          y: openPts.reduce((n, o) => n + o.y, 0) / openPts.length }
      : { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
    const want = dist(a, openCentre) > dist(c, openCentre) ? [a, c] : [c, a];
    return want.find(inside) || pt;
  };
  const returnSpots = halls.map(r =>
    ({ pt: clearOfPlenum(centreOf(r), r), from: r.label, hallway: true }));
  if (returnSpots.length < returnCount) {
    const used = returnSpots[0]?.pt || plenum;
    // The furthest room from the first return, and ITS nearest neighbours —
    // not the three furthest rooms overall, which on this plan sat at opposite
    // ends of the house and averaged out to a point in the middle of nothing.
    // THE ROOMS THAT BREATHE BACK THROUGH A CORRIDOR are the ones that CLOSE.
    // Seeding on every room put the second grille at the far end of the OPEN
    // PLAN — which already has the first return, an open doorway and every
    // supply run in the house. The rooms that need their own path back are the
    // bedrooms behind doors, so the corridor that serves them is where it goes.
    const closable = placed.filter(r => r.roomType !== 'hallway' &&
                                        !openPlanRooms.has(r.id));
    const others = (closable.length >= 2 ? closable
                                         : placed.filter(r => r.roomType !== 'hallway'));
    const seed = others.reduce((a, r) =>
      (dist(used, centreOf(r)) > dist(used, centreOf(a)) ? r : a), others[0]);
    const far = seed ? [...others]
      .sort((a, b) => dist(centreOf(seed), centreOf(a)) - dist(centreOf(seed), centreOf(b)))
      .slice(0, 3) : [];
    if (far.length) {
      const c = { x: far.reduce((n, r) => n + centreOf(r).x, 0) / far.length,
                  y: far.reduce((n, r) => n + centreOf(r).y, 0) / far.length };
      returnSpots.push({ pt: lerp(plenum, c, 0.62),
                         from: far.map(r => r.label).join(' / ') + ' corridor', hallway: false });
    }
  }

  const returnRuns = [];
  for (let i = 0; i < Math.min(returnCount, RETURN_AIR.maxReturns); i++) {
    const host = layout['returnGrille' + (i === 0 ? '' : '_' + (i + 1))];
    const spot = returnSpots[i] || null;
    const src = host?.x !== undefined ? { x: host.x, y: host.y }
      : spot ? spot.pt : null;
    if (!src) continue;
    returnRuns.push({
      id: i === 0 ? 'return' : 'return_' + (i + 1),
      role: 'return',
      nacRole: 'RETURN',
      flex: true,
      index: i + 1,
      assumed: host?.x === undefined,
      hallway: !!returnSpots[i]?.hallway,
      from: returnSpots[i]?.from || null,
      points: sweep(src, plenum, 0.14)
    });
  }
  if (returnRuns.length && returnRuns.some(r => r.assumed)) {
    warnings.push({ code: 'RETURN_POSITION_ASSUMED', severity: 'CHECK',
      message: 'No return grille has been placed, so the return was routed from ' +
               returnRuns.map(r => r.from).filter(Boolean).join(' and ') +
               '. Place the grille and re-route for a real length.' });
  }

  return {
    generated: true,
    model: 'nac_flex',
    segments,
    nodes,
    footprint,
    plenum: { ...plenum, source: plenumSource },
    mainCount: groups.length,
    supplyMains: groups.map((members, gi) => ({
      key: letters[gi],
      segmentId: 'main_' + letters[gi],
      name: groupName(members),
      airflowLs: round(members.reduce((s, o) => s + o.airflowLs, 0), 0),
      serves: [...new Set(members.map(m => m.roomLabel))],
      outlets: members.length
    })),
    returnRuns,
    returnCount: returnRuns.length,
    btoCount: btoNo,
    junctionCount: btoNo,
    warnings,
    notice: ROUTING.notice
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION — HARD RULE 9
// ═══════════════════════════════════════════════════════════════════════════
//
// The design FAILS if any of these is true. A failure is not a warning to be
// scrolled past: it means the topology is wrong and must not be drawn, priced
// or sent.

export const NAC_TOPOLOGY_FAILURES = Object.freeze([
  'ONE_SUPPLY_DUCT',
  'REDUCER_ON_FINAL',
  'AUTO_150_FINAL',
  'FINAL_OVER_300',
  'OUTLET_NOT_FROM_BTO',
  'RIGID_ROUTING',
  'RETURN_COUNT_INVALID',
  'FINAL_THROUGH_ARTIFICIAL_SEGMENTS'
]);

/**
 * Check a sized network against every hard NAC rule.
 *
 * Takes the SIZED sections, because half of these are about diameters that only
 * exist after sizing. Returns every failure with the segment that caused it, so
 * the answer is never just "invalid".
 */
export function validateNacTopology(network, opts = {}) {
  const sections = network?.sections || [];
  const failures = [];
  const fail = (code, message, detail) => failures.push({ code, message, detail: detail || null });

  const byId = new Map(sections.map(s => [s.id, s]));
  const mains = sections.filter(s => s.plenumOutlet);
  const finals = sections.filter(s => s.role === 'final');

  // 1. Only one supply duct leaves the plenum.
  if (mains.length < SUPPLY_PLENUM.minMains) {
    fail('ONE_SUPPLY_DUCT',
      mains.length + ' main supply duct(s) leave the plenum. NAC fits ' +
      SUPPLY_PLENUM.minMains + ' or ' + SUPPLY_PLENUM.maxMains + '.');
  }
  if (mains.length > SUPPLY_PLENUM.maxMains) {
    fail('ONE_SUPPLY_DUCT',
      mains.length + ' mains leave the plenum, more than the ' + SUPPLY_PLENUM.maxMains +
      ' NAC fits.');
  }

  for (const f of finals) {
    // 2. A reducer on a final branch.
    if (f.reducerFrom) {
      fail('REDUCER_ON_FINAL',
        f.destination + ' is fed through a reducer. The BTO takes the branch down to ' +
        'final size — a reducer before an outlet is a design failure.', f.id);
    }
    const fittings = (f.fittings || []).map(x => (typeof x === 'string' ? x : x.type));
    if (fittings.includes('reducer')) {
      fail('REDUCER_ON_FINAL', f.destination + ' carries a reducer fitting.', f.id);
    }

    // 3 and 4. Final size.
    if (f.diameterMm === 150 || (f.diameterMm && f.diameterMm < FINAL_FLEX.minMm)) {
      fail('AUTO_150_FINAL',
        f.destination + ' was auto-sized to ' + f.diameterMm + ' mm. NAC finals are ' +
        FINAL_FLEX.autoSizesMm.join(' / ') + '.', f.id);
    }
    if (f.diameterMm > FINAL_FLEX.maxMm) {
      fail('FINAL_OVER_300',
        f.destination + ' is ' + f.diameterMm + ' mm, over the ' + FINAL_FLEX.maxMm +
        ' mm final maximum. Add another outlet instead.', f.id);
    }

    // 5. The outlet branch must come off a BTO.
    if (!f.bto) {
      fail('OUTLET_NOT_FROM_BTO', f.destination + ' does not originate from a BTO.', f.id);
    }

    // 8. And it must be ONE continuous run, not a chain of contrived segments.
    let hops = 0;
    let cur = f;
    while (cur?.parentId && hops < 40) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      // Walking up: main runs and at most one major branch are legitimate.
      if (parent.role === 'final') {
        fail('FINAL_THROUGH_ARTIFICIAL_SEGMENTS',
          f.destination + ' is fed through another final run.', f.id);
        break;
      }
      cur = parent;
      hops += 1;
    }
    const majors = [];
    cur = byId.get(f.parentId);
    while (cur) {
      if (cur.role === 'branch') majors.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    if (majors.length > 1) {
      fail('FINAL_THROUGH_ARTIFICIAL_SEGMENTS',
        f.destination + ' is fed through ' + majors.length + ' branch runs (' +
        majors.join(' <- ') + '). A final comes off ONE take-off.', f.id);
    }

    // And the main chain above it must be a real main with its real reductions,
    // not a string of contrived segments. One run plus at most the reductions
    // NAC actually fits.
    let mainHops = 0;
    cur = byId.get(f.parentId);
    while (cur) {
      if (cur.role === 'main' || cur.role === 'trunk') mainHops += 1;
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    const allowed = 1 + MAIN_REDUCTIONS.maxPerMain;
    if (mainHops > allowed) {
      fail('FINAL_THROUGH_ARTIFICIAL_SEGMENTS',
        f.destination + ' is reached through ' + mainHops + ' main segments. A main is ' +
        'one run with at most ' + MAIN_REDUCTIONS.maxPerMain + ' reductions on it.', f.id);
    }
  }

  // 6. Rigid routing.
  // Flex sweeps. A run made of two or three points meeting at right angles is
  // rigid conduit, and this model does not produce it.
  const supply = sections.filter(s => s.points?.length && s.role !== 'return');
  const squareRuns = supply.filter(s => !s.flex && squareCorners(s.points) > 0);
  if (squareRuns.length) {
    fail('RIGID_ROUTING',
      squareRuns.length + ' run(s) are drawn as rigid right angles rather than flex sweeps.',
      squareRuns.map(s => s.id).join(', '));
  }
  if (supply.length && supply.every(s => s.points.length <= 2)) {
    fail('RIGID_ROUTING', 'Every run is a straight two-point line — no flex geometry at all.');
  }

  // 7. Return count.
  const returns = opts.returnCount ?? network?.returnCount ?? null;
  if (returns !== null && (returns < RETURN_AIR.minReturns || returns > RETURN_AIR.maxReturns)) {
    fail('RETURN_COUNT_INVALID',
      returns + ' return duct(s). NAC fits ' + RETURN_AIR.minReturns +
      ' or ' + RETURN_AIR.maxReturns + '.');
  }

  return {
    ok: failures.length === 0,
    failures,
    checked: {
      mains: mains.length,
      finals: finals.length,
      btos: sections.filter(s => s.bto).length,
      returns,
      reducers: sections.filter(s => s.reducerFrom).length
    }
  };
}

/** How many near-90° corners a run has. */
function squareCorners(points) {
  let n = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
    if (m1 < 0.5 || m2 < 0.5) continue;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
    if (Math.abs(cos) < 0.2) n += 1;    // within ~11° of a right angle
  }
  return n;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TOPOLOGY TABLE — HARD RULE 10
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The design as plain text, in the shape NAC reads it.
 *
 * This is produced and checked BEFORE anything is drawn, because a drawing of
 * the wrong topology is just a prettier wrong answer.
 */
export function topologyTable(network, { returnDesign = null } = {}) {
  const sections = network?.sections || [];
  const byId = new Map(sections.map(s => [s.id, s]));
  const lines = [];
  const mm = (d) => d ? 'ø' + d : 'ø?';

  lines.push('PLENUM');
  const mains = sections.filter(s => s.plenumOutlet);
  for (const main of mains) {
    const key = main.mainKey;
    const chain = sections.filter(s => s.mainKey === key && s.nacRole === 'MAIN');
    const served = main.serves?.join(' / ') || '';
    lines.push('');
    lines.push('Main ' + key + ' — ' + mm(main.diameterMm) + ' — ' + served +
               '  (' + Math.round(main.airflowLs) + ' L/s)');

    // Where this main steps down, and why.
    for (const s of chain.slice(1)) {
      if (s.reducerFrom) {
        lines.push('  reducer ' + mm(s.reducerFrom) + ' → ' + mm(s.reducerTo) +
                   '   (main now carries ' + Math.round(s.airflowLs) + ' L/s)');
      }
    }

    // Major branches and finals on this main, in the order the air reaches them.
    const onMain = sections.filter(s => s.mainKey === key && s.nacRole !== 'MAIN')
      .sort((a, b) => (a.btoNumber || 0) - (b.btoNumber || 0));
    for (const s of onMain) {
      if (s.nacRole === 'MAJOR_BRANCH') {
        lines.push('  BTO ' + s.btoNumber + ' — ' + mm(s.diameterMm) +
                   ' → major branch — ' + (s.serves || []).join(' + ') +
                   '  (' + Math.round(s.airflowLs) + ' L/s)');
      } else if (s.nacRole === 'FINAL_FLEX') {
        const parent = s.parentId ? byId.get(s.parentId) : null;
        const indent = parent?.nacRole === 'MAJOR_BRANCH' ? '    ' : '  ';
        lines.push(indent + 'BTO ' + s.btoNumber + ' — ' + mm(parent?.diameterMm) +
                   ' → ' + mm(s.diameterMm) + ' → ' + s.destination +
                   '  (' + Math.round(s.airflowLs) + ' L/s)');
      }
    }
  }

  lines.push('');
  lines.push('RETURN');
  const rd = returnDesign;
  const count = rd?.returnCount ?? network?.returnCount ?? 0;
  for (let i = 0; i < count; i++) {
    lines.push('Return ' + (i + 1) + ' — ' + mm(rd?.duct?.diameterMm) +
               (rd?.perReturnLs ? '  (' + Math.round(rd.perReturnLs) + ' L/s)' : ''));
  }
  return lines.join('\n');
}
