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
import { MAX_PORTS_PER_BTO } from './bto.mjs';
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
 * The fitting tree inside one area.
 *
 * Up to three ports on a body. Where an area has more outlets than that, the
 * outlets are split in two on position, the PRIMARY fitting takes the half
 * nearer the plenum, and a spur carries the rest to a secondary fitting sitting
 * in the middle of them. Serving the far half from the primary is what makes a
 * duct go out to an area and come back — the backtracking this avoids.
 */
export function planAreaFittings(outlets, plenum, maxPorts = MAX_PORTS_PER_BTO) {
  if (outlets.length <= maxPorts) {
    return { at: centroid(outlets), direct: outlets, onward: null };
  }
  const [A, B] = splitInTwo(outlets);
  const near = dist(centroid(A), plenum) <= dist(centroid(B), plenum) ? A : B;
  const far = near === A ? B : A;
  // The primary keeps maxPorts - 1 ports, because one is spent carrying on.
  let direct = near, rest = far;
  if (direct.length > maxPorts - 1) {
    const sorted = direct.slice().sort((a, b) => dist(a, plenum) - dist(b, plenum));
    direct = sorted.slice(0, maxPorts - 1);
    rest = sorted.slice(maxPorts - 1).concat(far);
  }
  return { at: centroid(direct.concat(rest.length ? [centroid(rest)] : [])),
           direct, onward: planAreaFittings(rest, centroid(direct), maxPorts) };
}

/**
 * Build the whole supply topology: N mains, one per area, each ending at its
 * area's primary fitting.
 */
export function buildAreaTopology({ rooms = [], airflow, outlets, layout = {}, zones = null,
                                    mainConfig = null } = {}, opts = {}) {
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

  const wantMains = Math.max(1, mainConfig?.count || 2);
  const mainMm = mainConfig?.diameterMm || 400;
  const areas = formInstallerAreas(outletPoints, wantMains);

  const segments = [];
  const nodes = [{ id: 'plenum', type: 'plenum', x: plenum.x, y: plenum.y,
                   source: plenumSource, label: 'Supply plenum' }];
  const letters = 'ABCDEFGH';

  areas.forEach((members, ai) => {
    const letter = letters[ai];
    const areaLs = members.reduce((n, o) => n + o.airflowLs, 0);
    const plan = planAreaFittings(members, plenum);

    // THE MAIN. Straight from the plenum to the area's primary fitting, at the
    // configured size, and NOT reduced on the way — it has nothing to shed
    // until it gets there.
    const mainId = 'main_' + letter;
    segments.push({
      id: mainId, parentId: null, role: 'main', nacRole: 'MAIN', mainKey: letter,
      plenumOutlet: true, flex: true,
      destination: 'Supply plenum → Main ' + letter,
      serves: [...new Set(members.map(m => m.roomLabel))],
      airflowLs: round(areaLs, 0),
      diameterMm: mainMm,
      points: sweep(plenum, plan.at, 0.08),
      rigid: false,
      fittings: ai === 0 ? ['supply_plenum'] : []
    });

    // The fitting chain inside the area.
    let node = plan;
    let feedId = mainId;
    let depth = 0;
    while (node) {
      const here = node.at;
      const onwardLs = node.onward
        ? (function total(n) {
            return n.direct.reduce((s, o) => s + o.airflowLs, 0) + (n.onward ? total(n.onward) : 0);
          })(node.onward)
        : 0;

      for (const o of node.direct) {
        segments.push({
          id: 'final_' + o.id, parentId: feedId, role: 'final', nacRole: 'FINAL_FLEX',
          mainKey: letter, flex: true, roomId: o.roomId, outletId: o.id,
          destination: o.of > 1 ? o.roomLabel + ' outlet ' + o.index : o.roomLabel,
          airflowLs: round(o.airflowLs, 0),
          zone: o.zone,
          points: sweep(here, { x: o.x, y: o.y }, 0.16),
          fittings: ['damper_open']
        });
        nodes.push({ id: o.id, type: 'outlet', x: o.x, y: o.y,
                     label: o.roomLabel, zone: o.zone });
      }

      if (node.onward) {
        const spurId = 'spur_' + letter + '_' + (depth + 1);
        // Sized against the finals ACTUALLY FITTED, not the ones the airflow
        // band alone would give. With an installer minimum of 250 the band
        // still says 200, and a spur sized off that came out a 250 feeding
        // three 250s — a full-bore take-off.
        const finals = (function all(n) {
          return n.direct.map(o => selectDiameter(o.airflowLs, 'final', { settings }).diameterMm)
            .concat(n.onward ? all(n.onward) : []);
        })(node.onward);
        const spurMm = Math.min(mainMm, mainFloorForFinals(
          selectDiameter(onwardLs, 'branch', { settings }).diameterMm, finals));
        segments.push({
          id: spurId, parentId: feedId, role: 'branch', nacRole: 'MAJOR_BRANCH',
          mainKey: letter, major: true, flex: true,
          destination: 'Main ' + letter + ' — onward',
          serves: [...new Set((function names(n) {
            return n.direct.map(o => o.roomLabel).concat(n.onward ? names(n.onward) : []);
          })(node.onward))],
          airflowLs: round(onwardLs, 0),
          diameterMm: spurMm,
          points: sweep(here, node.onward.at, 0.1),
          fittings: []
        });
        feedId = spurId;
      }
      node = node.onward;
      depth += 1;
    }
  });

  return {
    generated: true,
    model: 'nac_area',
    segments, nodes, footprint,
    plenum: { ...plenum, source: plenumSource },
    mainCount: areas.length,
    mainDiameterMm: mainMm,
    supplyMains: areas.map((members, ai) => ({
      key: letters[ai],
      segmentId: 'main_' + letters[ai],
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

export default { buildAreaTopology, formInstallerAreas, planAreaFittings, splitInTwo };
