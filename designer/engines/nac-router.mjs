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
  BTO as BTO_RULES, ROUTING, MAIN_REDUCTIONS, MIN_MAIN_DIAMETER_MM,
  finalSizeForAirflow, mainFloorForFinals
} from './nac-standard.mjs';

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
export function groupOutlets(outletPoints, k) {
  const pts = outletPoints.filter(o => o && isFinite(o.x) && isFinite(o.y));
  if (pts.length <= k) return pts.map(p => [p]);

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

    let moved = false;
    for (const room of rooms) {
      // Never empty a main: the plenum has to keep all of its ducts.
      if (room.members.length >= work[heavy].length) continue;
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
    if (!moved) break;   // nothing left that helps — this is as even as it gets
  }
  return work.filter(g => g.length);
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
  let plenumSource = plenum ? 'placed' : 'assumed_centre';
  if (!plenum) {
    plenum = { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
    warnings.push({ code: 'PLENUM_POSITION_ASSUMED', severity: 'CHECK',
      message: 'No supply plenum has been placed, so it was assumed at the middle of the house. ' +
               'Place it and re-route for real lengths.' });
  }

  // ── Every outlet that has to be reached ───────────────────────────────────
  const outletPoints = [];
  for (const row of (airflow?.rows || [])) {
    const room = roomsById.get(row.roomId);
    if (!room?.boundaryPx) {
      warnings.push({ code: 'ROOM_NOT_ON_PLAN', severity: 'CHECK',
        message: row.label + ' has no boundary on the plan, so it could not be routed to.' });
      continue;
    }
    const qty = outletsByRoom.get(row.roomId)?.quantity ?? 1;
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
  const systemLs = outletPoints.reduce((s, o) => s + o.airflowLs, 0);
  const wantMains = Math.min(
    Math.max(opts.mainCount || mainSupplyCount(systemLs, placed.length), SUPPLY_PLENUM.minMains),
    Math.min(SUPPLY_PLENUM.maxMains, outletPoints.length));
  const groups = groupOutlets(outletPoints, wantMains);

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
  const commonMainMm = SUPPLY_PLENUM.sameSizeMains
    ? Math.max(...groupFlows.map(sizeForMain))
    : null;

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

    // The main sweeps from the plenum out through the group. Its anchors are
    // the group's centre and its far end, so the run travels the area it serves
    // instead of stopping at the first room.
    const centre = {
      x: members.reduce((s, o) => s + o.x, 0) / members.length,
      y: members.reduce((s, o) => s + o.y, 0) / members.length
    };
    const far = members.reduce((a, o) => (dist(plenum, o) > dist(plenum, a) ? o : a), members[0]);
    // Stop short of the last outlet — the final flex covers the rest.
    const end = lerp(centre, far, 0.62);
    const runPts = sweepThrough([plenum, lerp(plenum, centre, 0.55), centre, end]);

    // ── Where each outlet leaves the main ───────────────────────────────────
    // A BTO sits on the main at the point nearest the outlet it feeds, so the
    // final flex is the short run it should be.
    const taps = members.map(o => {
      const near = nearestOnRun(runPts, o);
      return { outlet: o, at: near.pt, alongIndex: near.i, run: dist(near.pt, o) };
    }).sort((a, b) => a.alongIndex - b.alongIndex);

    // ── HARD RULE 5: outlets far from the main share a major branch ─────────
    // Two or more outlets sitting well off the main get ONE major branch out to
    // them, and each then comes off it through its own BTO. Pulling each of
    // them individually back to the main is the "explosion of branches" this
    // model exists to stop.
    const farThreshold = Math.max(footprint.w, footprint.h) * 0.16;
    const clusters = [];
    for (const t of taps) {
      if (t.run < farThreshold) { clusters.push({ direct: true, taps: [t] }); continue; }
      const open = clusters.find(c => !c.direct &&
        dist(c.taps[0].outlet, t.outlet) < farThreshold &&
        Math.abs(c.taps[0].alongIndex - t.alongIndex) < runPts.length * 0.3);
      if (open) open.taps.push(t);
      else clusters.push({ direct: false, taps: [t] });
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
      candidates.push({
        afterCluster: ci,
        atIndex: cluster.taps[cluster.taps.length - 1].alongIndex,
        airflowLs: carried,
        size: mainFloorForFinals(sizeFor(carried), [largestFinalAfter[ci]])
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

    let prevId = null;
    stretches.forEach((stretch, si) => {
      const from = Math.min(stretch.from, runPts.length - 2);
      const to = Math.min(Math.max(stretch.to + 1, from + 2), runPts.length);
      const segId = si === 0 ? mainId : mainId + '_' + (si + 1);

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
        if (!cluster.direct && cluster.taps.length >= BTO_RULES.minRoomsForMajorBranch) {
          const hub = {
            x: cluster.taps.reduce((sum, t) => sum + t.outlet.x, 0) / cluster.taps.length,
            y: cluster.taps.reduce((sum, t) => sum + t.outlet.y, 0) / cluster.taps.length
          };
          const toward = lerp(cluster.taps[0].at, hub, 0.7);
          const majorLs = cluster.taps.reduce((sum, t) => sum + t.outlet.airflowLs, 0);
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
            zone: cluster.taps[0].outlet.zone,
            points: sweep(cluster.taps[0].at, toward, 0.12),
            fittings: ['takeoff']
          });
          nodes.push({ id: 'bto_' + btoNo, type: 'bto', bto: true,
                       x: cluster.taps[0].at.x, y: cluster.taps[0].at.y,
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
            fittings: ['takeoff', 'damper_open']
          });
          nodes.push({ id: 'bto_' + btoNo, type: 'bto', bto: true, x: start.x, y: start.y,
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
  const returnRuns = [];
  const biggest = [...placed].sort((a, b) =>
    (b.boundaryPx.w * b.boundaryPx.h) - (a.boundaryPx.w * a.boundaryPx.h));
  for (let i = 0; i < Math.min(returnCount, RETURN_AIR.maxReturns); i++) {
    const host = layout['returnGrille' + (i === 0 ? '' : '_' + (i + 1))];
    const src = host?.x !== undefined ? { x: host.x, y: host.y }
      : biggest[i] ? { x: biggest[i].boundaryPx.x + biggest[i].boundaryPx.w / 2,
                       y: biggest[i].boundaryPx.y + biggest[i].boundaryPx.h / 2 }
      : null;
    if (!src) continue;
    returnRuns.push({
      id: i === 0 ? 'return' : 'return_' + (i + 1),
      role: 'return',
      nacRole: 'RETURN',
      flex: true,
      index: i + 1,
      assumed: host?.x === undefined,
      from: biggest[i]?.label || null,
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
