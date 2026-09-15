// NAC AI HVAC DESIGNER — THE AUTO DUCT ROUTER.
//
//   CALCULATED DUCT DESIGN → AUTOMATIC ROUTE GENERATION → DRAWN ON PLAN
//   → DIAMETERS LABELLED → ESTIMATOR EDITS → BOM + PRESSURE + LENGTHS UPDATE
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// A routed layout is a FIRST-PASS SUGGESTION, never an installable drawing. A
// floor plan does not show trusses, bulkheads, beams, inaccessible roof zones,
// or plumbing and electrical already in the ceiling. Every route this module
// produces therefore carries VERIFY_SITE_CONDITIONS, and nothing in here may
// ever describe a route as install-ready.
//
// This module is PURE: rooms, outlets, equipment positions and calibration in;
// geometry out. It draws nothing and it touches no DOM. It also does not size
// ducts — sizing stays in ducts.mjs, and the geometry produced here is a
// SPATIAL REPRESENTATION OF THE SAME SECTIONS that airflow, pressure, materials
// and costing already use. There is deliberately no second duct model.
//
// Everything is deterministic. No LLM is asked to guess a coordinate: the same
// plan and the same rooms produce the same layout every time, which is the only
// way an estimator can trust what changed when they move something.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { isConditionedRoom } from './classify.mjs';
import { mainSupplyCount, ROUTING, DRAWING, BTO as BTO_RULES } from './nac-standard.mjs';
import { round } from './units.mjs';
import { polylineLengthMm } from './calibration.mjs';

/** Stamped on every auto-generated route. Never remove it from a route. */
export const AUTO_ROUTE_NOTICE = ROUTING.notice;

export const ROUTING_MODE = { AUTO: 'auto', ASSISTED: 'assisted', MANUAL: 'manual' };

/** How much of a segment's detail a label shows. */
export const LABEL_DETAIL = {
  HIDE: 'hide',
  DIAMETER: 'diameter',
  DIAMETER_FLOW: 'diameter_flow',
  FULL: 'full'
};

export const DEFAULT_LABEL_DETAIL = LABEL_DETAIL.DIAMETER;

// ── Labels ──────────────────────────────────────────────────────────────────

/**
 * The label drawn against one duct segment.
 *
 * The estimator's default view shows the diameter at minimum, because a duct
 * drawing without a size on it is decoration. Everything shown comes from the
 * sized section — nothing here recomputes a number.
 *
 * @param {Object} section  a sized section from buildDuctNetwork
 * @param {String} detail   one of LABEL_DETAIL
 * @param {Object} opts     { destination } to override the shown name
 */
export function segmentLabel(section, detail = DEFAULT_LABEL_DETAIL, opts = {}) {
  if (!section || detail === LABEL_DETAIL.HIDE) return null;
  // NAC's own drawings write the size as "ø300", so the tool does too.
  const dia = section.diameterMm ? DRAWING.diameterPrefix + section.diameterMm : null;
  if (!dia && section.airflowLs == null) return null;

  const flow = section.airflowLs != null ? round(section.airflowLs, 0) + ' L/s' : null;
  // The DRAWN length is the one that matters once a route exists, because that
  // is what the BOM buys and the pressure engine uses.
  const len = section.lengthM != null ? round(section.lengthM, 1) + ' m' : null;
  const name = opts.destination ?? section.destination ?? null;

  if (detail === LABEL_DETAIL.DIAMETER) return dia;
  if (detail === LABEL_DETAIL.DIAMETER_FLOW) return [dia, flow].filter(Boolean).join(' — ');

  // FULL: the room first, so the estimator reads what it serves before the numbers.
  const numbers = [dia, flow, len].filter(Boolean).join(' — ');
  return name ? name + '\n' + numbers : numbers;
}

/**
 * Line weight for a duct of this diameter, in screen pixels.
 *
 * A 400 trunk must look like a trunk. The scale is deliberately gentle — a
 * linear map on diameter would make a 100 invisible next to a 400 — and it is
 * clamped so a route is always clickable.
 */
export function lineWidthForDiameter(diameterMm, opts = {}) {
  const min = opts.min ?? 2;
  const max = opts.max ?? 9;
  const d = Number(diameterMm);
  if (!(d > 0)) return min;
  // 100 mm -> min, 400 mm -> max, smoothly between.
  const lo = 100, hi = 400;
  const t = Math.max(0, Math.min(1, (d - lo) / (hi - lo)));
  return round(min + (max - min) * Math.sqrt(t), 2);
}

/** Colour by the job the duct does, so a drawing reads at a glance. */
/**
 * The colours a run takes when it belongs to no zone.
 *
 * The trunk serves everything, so it carries a neutral colour of its own rather
 * than borrowing one zone's. The return is a different system and is deliberately
 * the only grey line on the drawing — it must never be read as a supply run.
 * Branches and finals are normally overpainted with their ZONE colour; these are
 * the fallbacks for a design that has not been zoned yet.
 */
export const ROLE_COLOUR = {
  main:   DRAWING.trunkColour,   // the spine, in its own neutral colour
  trunk:  DRAWING.trunkColour,
  branch: '#5fa8ff',
  final:  '#8fd0ff',
  return: DRAWING.returnColour   // the only grey line on the drawing
};

export function roleColour(role) {
  return ROLE_COLOUR[role] || ROLE_COLOUR.branch;
}

/**
 * The colour a run is drawn in.
 *
 * A branch or a final takes the colour of the ZONE it feeds, so an installer
 * can follow one colour from the trunk to the outlet and know which damper
 * controls it. The trunk and the return keep their own.
 */
export function runColour(section, zoneColourByRoomId = {}) {
  if (!section) return ROLE_COLOUR.branch;
  if (section.role === 'main' || section.role === 'trunk') return ROLE_COLOUR.main;
  if (section.role === 'return') return ROLE_COLOUR.return;
  const z = section.roomId ? zoneColourByRoomId[section.roomId] : null;
  return z?.colour || roleColour(section.role);
}

// ── Linking drawn geometry to the calculated design ─────────────────────────

/**
 * Match each drawn route to the duct section it represents.
 *
 * The route keys the estimator draws against are room ids (plus '__main'), and
 * the sections are keyed 'branch_<roomId>' / 'main'. This is the join between
 * the two, and it is the only place that mapping is written down.
 *
 * Returns overlay entries ready for the plan viewer: points, colour, width and
 * label all derived from the SIZED section, so a route can never show a
 * diameter the design does not actually carry.
 */
export function routeOverlayFromNetwork({ network, mainRoute, ductRoutes = {}, rooms = [],
                                          returnRoute = null, returnDesign = null,
                                          labelDetail = DEFAULT_LABEL_DETAIL } = {}) {
  const out = {};
  const sections = network?.sections || [];
  const byId = new Map(sections.map(s => [s.id, s]));
  const roomLabel = new Map((rooms || []).map(r => [r.id, r.label]));

  const add = (key, points, section, opts = {}) => {
    if (!points || points.length < 2) return;
    const role = opts.role || section?.role || 'branch';
    out[key] = {
      points,
      role,
      sectionId: section?.id ?? null,
      diameterMm: section?.diameterMm ?? opts.diameterMm ?? null,
      airflowLs: section?.airflowLs ?? opts.airflowLs ?? null,
      lengthM: section?.lengthM ?? opts.lengthM ?? null,
      colour: roleColour(role),
      width: lineWidthForDiameter(section?.diameterMm ?? opts.diameterMm),
      label: opts.label !== undefined
        ? opts.label
        : segmentLabel(section, labelDetail, { destination: opts.destination }),
      auto: !!opts.auto,
      locked: !!opts.locked
    };
  };

  if (mainRoute?.points) {
    add('main', mainRoute.points, byId.get('main'),
      { role: 'main', destination: 'Supply plenum', auto: mainRoute.auto, locked: mainRoute.locked });
  }

  for (const [roomId, r] of Object.entries(ductRoutes || {})) {
    if (!r?.points) continue;
    add(roomId, r.points, byId.get('branch_' + roomId),
      { destination: roomLabel.get(roomId) || roomId, auto: r.auto, locked: r.locked });
  }

  // Return air is its own system. It has no entry in the supply sections, so
  // its numbers come from the return design.
  if (returnRoute?.points) {
    const ret = returnDesign?.duct || null;
    add('return', returnRoute.points, null, {
      role: 'return',
      diameterMm: ret?.diameterMm ?? null,
      airflowLs: returnDesign?.totalAirflowLs ?? null,
      lengthM: ret?.lengthM ?? null,
      destination: 'Return',
      label: labelDetail === LABEL_DETAIL.HIDE ? null
        : (ret?.diameterMm ? 'RETURN \u00f8' + ret.diameterMm : 'RETURN'),
      auto: returnRoute.auto,
      locked: returnRoute.locked
    });
  }

  return out;
}

// ── PART 2 & 3: THE DUCT TREE ───────────────────────────────────────────────
//
// The sizing engine already knows how much air each room needs. What it did
// NOT know is how the ducts reach them: every branch was assumed to start at
// the plenum, so nothing ever carried several rooms and stepped down after a
// take-off. That is not how a house is ducted and it is not how one is costed.
//
// This builds the real thing — a trunk from the plenum, junctions along it, and
// branches off to groups of nearby rooms — as GEOMETRY ON THE PLAN. The sizing
// of each piece still happens in ducts.mjs against the airflow computed here.
//
// It is deterministic. No coordinate is guessed by an LLM, and the same plan
// with the same rooms produces the same layout every time.

/** Centre of a room's boundary rectangle, in image pixels. */
function roomCentre(room) {
  const b = room?.boundaryPx;
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * The building footprint, derived from the room rectangles.
 *
 * The plan has no wall data — nothing detects an external wall — so the
 * footprint is the box the rooms occupy and nothing more. It is used to say
 * "this route leaves the house", which is worth knowing, and it is never
 * presented as a surveyed boundary.
 */
export function deriveFootprint(rooms) {
  const boxes = (rooms || []).map(r => r.boundaryPx).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x));
  const y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w));
  const y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0,
           derived: true,
           note: 'Derived from the room boundaries. The plan carries no wall data.' };
}

/** Is this point inside the derived footprint? */
export function insideFootprint(footprint, pt, marginPx = 0) {
  if (!footprint || !pt) return true;          // nothing to judge against
  return pt.x >= footprint.x - marginPx && pt.x <= footprint.x + footprint.w + marginPx &&
         pt.y >= footprint.y - marginPx && pt.y <= footprint.y + footprint.h + marginPx;
}

/**
 * The trunk spine: the line the main duct runs along.
 *
 * Residential ducted runs down the hallway, which is almost always the long
 * axis of the house. Choosing the longer footprint dimension puts the trunk
 * where the ceiling space usually is, and keeps the big duct central instead of
 * chasing individual rooms.
 */
export function trunkSpine(footprint, plenum) {
  if (!footprint) return null;
  const horizontal = footprint.w >= footprint.h;
  // The spine passes through the plenum, so the trunk actually starts there
  // rather than at an arbitrary centre line.
  const axisPos = horizontal
    ? (plenum ? plenum.y : footprint.y + footprint.h / 2)
    : (plenum ? plenum.x : footprint.x + footprint.w / 2);
  return {
    horizontal,
    axisPos,
    from: horizontal ? footprint.x : footprint.y,
    to: horizontal ? footprint.x + footprint.w : footprint.y + footprint.h
  };
}

/**
 * Split the outlets into TRUNK ARMS radiating from the plenum.
 *
 * A single spine with every room projected perpendicular onto it produces a
 * comb: one long duct with stubs off it. Nobody installs that, and it does not
 * read as a duct layout. A real ducted system leaves the fan coil in two to
 * four directions and branches off each run, which is what this produces.
 *
 * Arms are the four square directions, because flex runs square through a truss
 * roof — a diagonal trunk is not a thing. An arm with a single room on it is
 * folded into the neighbouring arm rather than left as a trunk serving one
 * bedroom.
 *
 * @returns {Array} [{ key, horizontal, sign, axisPos, drops }]
 */
export function trunkArms(plenum, drops, opts = {}) {
  if (!plenum || !drops?.length) return [];
  const want = opts.mainCount
    || mainSupplyCount(drops.reduce((sum, d) => sum + (d.airflowLs || 0), 0), drops.length);

  const buckets = { E: [], W: [], S: [], N: [] };
  for (const d of drops) {
    const dx = d.target.x - plenum.x;
    const dy = d.target.y - plenum.y;
    // Whichever offset is larger decides the direction, so a room that is mostly
    // to the left goes west even if it is also a little below.
    if (Math.abs(dx) >= Math.abs(dy)) buckets[dx >= 0 ? 'E' : 'W'].push(d);
    else buckets[dy >= 0 ? 'S' : 'N'].push(d);
  }

  const order = ['E', 'W', 'S', 'N'];
  const flowOf = (k) => buckets[k].reduce((sum, d) => sum + (d.airflowLs || 0), 0);
  const axisOf = (k) => (k === 'E' || k === 'W');

  // THE NAC SUPPLY PLENUM RULE: the air leaves the fan coil on TWO OR THREE
  // mains, each serving a group of the house. Not one — a single trunk is not
  // a plenum, it is a tee — and not four, which is more penetrations than
  // anybody puts in a fan coil.
  //
  // So the four compass buckets are folded down to the number wanted, smallest
  // first: the rooms on a light direction join whichever kept main is nearest
  // in the axis that main does not travel along.
  const live = () => order.filter(k => buckets[k].length);
  while (live().length > want) {
    const smallest = live().sort((a, b) => flowOf(a) - flowOf(b))[0];
    const keep = live().filter(k => k !== smallest);
    for (const d of buckets[smallest].splice(0)) {
      const best = keep.reduce((acc, k) => {
        const dist = axisOf(k) ? Math.abs(d.target.y - plenum.y) : Math.abs(d.target.x - plenum.x);
        return (acc === null || dist < acc.dist) ? { k, dist } : acc;
      }, null);
      buckets[best.k].push(d);
    }
  }

  // Fewer live directions than the plenum should have: split the busiest one in
  // two along its own axis, so the plenum still leaves on the right number of
  // mains instead of everything hanging off a single run.
  while (live().length < want && live().length >= 1) {
    const busiest = live().sort((a, b) => flowOf(b) - flowOf(a))[0];
    const members = buckets[busiest];
    if (members.length < 2) break;
    const horizontal = axisOf(busiest);
    const across = (d) => horizontal ? d.target.y : d.target.x;
    const sorted = [...members].sort((a, b) => across(a) - across(b));
    const half = Math.ceil(sorted.length / 2);
    // The empty compass bucket on the other axis takes the far half, so the two
    // mains leave the plenum in genuinely different directions.
    const spare = order.find(k => !buckets[k].length && axisOf(k) !== horizontal);
    if (!spare) break;
    buckets[busiest] = sorted.slice(0, half);
    buckets[spare] = sorted.slice(half);
  }

  return order
    .filter(k => buckets[k].length)
    .map(k => {
      const horizontal = axisOf(k);
      return {
        key: k,
        horizontal,
        sign: (k === 'E' || k === 'S') ? 1 : -1,
        axisPos: horizontal ? plenum.y : plenum.x,
        drops: buckets[k].sort((a, b) => {
          const da = horizontal ? Math.abs(a.target.x - plenum.x) : Math.abs(a.target.y - plenum.y);
          const db = horizontal ? Math.abs(b.target.x - plenum.x) : Math.abs(b.target.y - plenum.y);
          return da - db;
        })
      };
    });
}

/** Where a drop takes off from its arm. */
function takeoffOnArm(arm, pt) {
  return arm.horizontal ? { x: pt.x, y: arm.axisPos, along: pt.x }
                        : { x: arm.axisPos, y: pt.y, along: pt.y };
}

/** Where a point drops onto the spine — its take-off position. */
function projectOntoSpine(spine, pt) {
  if (!spine || !pt) return null;
  const along = spine.horizontal ? pt.x : pt.y;
  const clamped = Math.max(spine.from, Math.min(spine.to, along));
  return spine.horizontal
    ? { x: clamped, y: spine.axisPos, along: clamped }
    : { x: spine.axisPos, y: clamped, along: clamped };
}

/**
 * Group take-offs that land close together on the spine into one junction.
 *
 * Two bedrooms side by side share a Y piece in a real install; drawing two
 * separate take-offs 200 mm apart is not what anybody builds. The tolerance is
 * a fraction of the spine length so it scales with the house rather than being
 * a pixel constant that means something different on every plan.
 */
function clusterAlongSpine(takeoffs, spine, tolerance) {
  const sorted = [...takeoffs].sort((a, b) => a.along - b.along);
  const groups = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(t.along - last.along) <= tolerance) {
      last.members.push(t);
      // The junction sits at the mean of what it serves.
      last.along = last.members.reduce((s, m) => s + m.along, 0) / last.members.length;
    } else {
      groups.push({ along: t.along, members: [t] });
    }
  }
  return groups;
}

/**
 * Build the spatial duct tree.
 *
 * TRUNK-AND-BRANCH, not a star of straight lines from the unit to every outlet.
 * The trunk runs from the plenum along the spine; branches leave it at
 * junctions; a room with more than one outlet gets finals off its branch.
 *
 * Airflow is summed from the leaves back up, so the trunk carries everything
 * downstream of it and STEPS DOWN after each take-off. That is what makes the
 * sizing correct — ducts.mjs then picks a diameter for each piece from the
 * airflow this produced, and a reducer is recorded wherever the size changes.
 *
 * @param {Object} p
 * @param {Array}  p.rooms    rooms with boundaryPx
 * @param {Object} p.airflow  calculateAirflow output (rows carry adjustedLs)
 * @param {Object} p.outlets  designOutlets output (rows carry quantity)
 * @param {Object} p.layout   placed items — plenum / indoorUnit / outlet_*
 * @param {Object} p.zones    zone analysis, so a damper lands on the right branch
 */
export function buildDuctTree({ rooms = [], airflow, outlets, layout = {}, zones = null } = {},
                              opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const warnings = [];
  const roomsById = new Map((rooms || []).map(r => [r.id, r]));
  const outletsByRoom = new Map((outlets?.rows || []).map(o => [o.roomId, o]));
  const zoneByRoom = new Map();
  for (const z of (zones?.zones || [])) {
    for (const rid of (z.roomIds || [])) zoneByRoom.set(rid, z.name || z.id);
  }

  const footprint = deriveFootprint(rooms);
  if (!footprint) {
    return { generated: false, segments: [], nodes: [], footprint: null,
             confidence: 'LOW', warnings: [{ code: 'NO_ROOM_GEOMETRY', severity: 'CHECK',
               message: 'No room boundaries have been drawn, so there is nothing to route against.' }] };
  }

  // Where the air starts. The plenum if it has been placed, otherwise the
  // indoor unit, otherwise the middle of the house — and say which, because an
  // assumed plenum position changes every length on the drawing.
  let plenum = layout.plenum && layout.plenum.x !== undefined
    ? { x: layout.plenum.x, y: layout.plenum.y } : null;
  let plenumSource = 'placed';
  if (!plenum && layout.indoorUnit?.x !== undefined) {
    plenum = { x: layout.indoorUnit.x, y: layout.indoorUnit.y };
    plenumSource = 'indoor_unit';
  }
  if (!plenum) {
    plenum = { x: footprint.x + footprint.w / 2, y: footprint.y + footprint.h / 2 };
    plenumSource = 'assumed_centre';
    warnings.push({ code: 'PLENUM_POSITION_ASSUMED', severity: 'CHECK',
      message: 'No supply plenum has been placed, so the trunk was started from the middle of ' +
               'the house. Place the plenum and re-route for real lengths.' });
  }

  // ── Every outlet that has to be reached ───────────────────────────────────
  const drops = [];
  for (const row of (airflow?.rows || [])) {
    const room = roomsById.get(row.roomId);
    const qty = outletsByRoom.get(row.roomId)?.quantity ?? 1;
    const centre = roomCentre(room);
    if (!centre) {
      warnings.push({ code: 'ROOM_NOT_ON_PLAN', severity: 'CHECK',
        message: row.label + ' has no boundary on the plan, so it could not be routed to. ' +
                 'Its duct length has to be entered by hand.' });
      continue;
    }
    // A placed outlet beats anything worked out here — the estimator put it
    // where it goes. Where one has NOT been placed, the position is spread
    // across the room the same way "Place all outlets" does, because the design
    // says this room has two outlets and a drawing showing one is wrong.
    const b = room.boundaryPx;
    const outletPoints = [];
    for (let i = 0; i < qty; i++) {
      const p = layout['outlet_' + row.roomId + '_' + i];
      if (p && p.x !== undefined) { outletPoints.push({ x: p.x, y: p.y }); continue; }
      const frac = (i + 1) / (qty + 1);
      outletPoints.push({ x: b.x + b.w * frac, y: b.y + b.h / 2 });
    }
    drops.push({
      roomId: row.roomId,
      label: row.label,
      airflowLs: row.adjustedLs,
      quantity: qty,
      zone: zoneByRoom.get(row.roomId) || null,
      // One point to route the BRANCH to; finals fan out from there.
      target: outletPoints[0] || centre,
      outletPoints
    });
  }

  if (!drops.length) {
    return { generated: false, segments: [], nodes: [], footprint, spine,
             confidence: 'LOW',
             warnings: warnings.concat([{ code: 'NOTHING_TO_ROUTE', severity: 'CHECK',
               message: 'No conditioned room has both airflow and a boundary on the plan.' }]) };
  }

  // ── Arms, and the junctions along each ────────────────────────────────────
  // The house is served by two to four trunk runs leaving the plenum in square
  // directions, not by one spine with stubs off it.
  const arms = trunkArms(plenum, drops, { minRoomsPerArm: settings.duct.minRoomsPerArm ?? 2 });
  const armSpan = Math.max(footprint.w, footprint.h) || 1;
  const tolerance = armSpan * (settings.duct.junctionClusterFraction ?? 0.06);

  const segments = [];
  const nodes = [{ id: 'plenum', type: 'plenum', x: plenum.x, y: plenum.y,
                   source: plenumSource, label: 'Supply plenum' }];

  let junctionCounter = 0;

  arms.forEach((arm, armIndex) => {
    // Take-offs on this arm, grouped so two rooms side by side share one Y
    // piece rather than getting a take-off each 200 mm apart.
    const takeoffs = arm.drops.map(d => {
      const t = takeoffOnArm(arm, d.target);
      return { ...d, along: t.along, at: { x: t.x, y: t.y } };
    });
    const clusters = [];
    for (const t of takeoffs) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(t.along - last.along) <= tolerance) { last.members.push(t); continue; }
      clusters.push({ along: t.along, members: [t] });
    }

    // Airflow, summed from the far end back to the plenum: the run leaving the
    // plenum carries everything on the arm, and each one after it carries less.
    const junctionFlow = clusters.map(c => c.members.reduce((sum, m) => sum + (m.airflowLs || 0), 0));
    const carriedFrom = clusters.map((_, i) => junctionFlow.slice(i).reduce((sum, f) => sum + f, 0));

    const at = (along) => arm.horizontal ? { x: along, y: arm.axisPos }
                                         : { x: arm.axisPos, y: along };

    let prevPoint = { x: plenum.x, y: plenum.y };
    let prevId = null;

    clusters.forEach((c, i) => {
      const jPoint = at(c.along);
      junctionCounter += 1;
      const jId = 'junction_' + junctionCounter;
      nodes.push({ id: jId, type: 'junction', x: jPoint.x, y: jPoint.y,
                   label: 'J' + junctionCounter, arm: arm.key,
                   serves: c.members.map(m => m.label) });

      // The first run on each arm leaves the plenum, so it is a 'main'. The
      // rest of the arm is trunk. Every arm is its own chain — the tree the
      // pressure calculation walks branches at the plenum, which is what a real
      // system does.
      const isFirst = i === 0;
      const segId = isFirst
        ? (armIndex === 0 ? 'main' : 'main_' + arm.key.toLowerCase())
        : 'trunk_' + arm.key.toLowerCase() + '_' + i;

      segments.push({
        id: segId,
        parentId: prevId,
        role: isFirst ? 'main' : 'trunk',
        arm: arm.key,
        // THE NAC SUPPLY PLENUM RULE: ONE plenum, with two or three mains off
        // it. The plenum itself is a single fitting and is counted once, on the
        // first main only — counting it per arm bought three plenums for a
        // house that has one.
        plenumOutlet: isFirst,
        // A main records the group of the house it feeds, because that is what
        // an installer and the order need to know about it.
        serves: isFirst ? arm.drops.map(d => d.label) : null,
        destination: isFirst ? 'Supply plenum \u2192 J' + junctionCounter
                             : 'J' + (junctionCounter - 1) + ' \u2192 J' + junctionCounter,
        airflowLs: carriedFrom[i],
        points: dedupePoints([prevPoint, jPoint]),
        rigid: isFirst,
        fittings: (isFirst && armIndex === 0) ? ['supply_plenum'] : []
      });
      prevPoint = jPoint;
      prevId = segId;
      const feedingTrunkId = segId;

      // ── The take-off ──────────────────────────────────────────────────────
      // A BTO serving several rooms runs ONE major branch out to the group
      // before it splits. Pulling each room individually back to the trunk is
      // what produced the explosion of branches at the middle of the plan, and
      // it is not how anybody installs a house: the three minor bedrooms come
      // off one branch, not three separate take-offs.
      const minForMajor = settings.duct.majorBranchMinRooms ?? 2;
      let feedsRooms = feedingTrunkId;       // what the room branches hang off
      let splitPoint = jPoint;               // where they start from

      // A hub that lands on the trunk itself is not a run — there is nothing to
      // install between the take-off and the split, and a zero-length segment
      // has no geometry for the drawing or the BOM.
      const hubAcrossProbe = c.members.reduce((sum, m) =>
        sum + (arm.horizontal ? m.target.y : m.target.x), 0) / c.members.length;
      const hubOffset = Math.abs(hubAcrossProbe - (arm.horizontal ? jPoint.y : jPoint.x));

      if (c.members.length >= minForMajor && hubOffset > 1) {
        // The group's hub: the middle of the rooms it serves, squared back onto
        // the arm so the major branch leaves the trunk at a right angle.
        const hub = arm.horizontal ? { x: jPoint.x, y: hubAcrossProbe }
                                   : { x: hubAcrossProbe, y: jPoint.y };
        const groupFlow = c.members.reduce((sum, m) => sum + (m.airflowLs || 0), 0);
        const btoId = 'bto_' + junctionCounter;

        segments.push({
          id: btoId,
          parentId: feedingTrunkId,
          junctionId: jId,
          role: 'branch',
          arm: arm.key,
          major: true,
          serves: c.members.map(m => m.label),
          destination: c.members.map(m => m.label).join(' + '),
          airflowLs: groupFlow,
          zone: c.members[0]?.zone || null,
          points: dedupePoints([jPoint, hub]),
          fittings: ['takeoff', 'damper_open']
        });
        nodes.push({ id: 'bto_node_' + junctionCounter, type: 'junction', bto: true,
                     x: hub.x, y: hub.y, label: 'BTO',
                     serves: c.members.map(m => m.label) });
        feedsRooms = btoId;
        splitPoint = hub;
      }

      // ── Room branches off the take-off ────────────────────────────────────
      for (const m of c.members) {
        const fittings = c.members.length >= minForMajor ? ['y_piece'] : ['takeoff', 'damper_open'];
        // Square off and into the room. Flex does not run diagonally across a
        // ceiling.
        const branchPts = [splitPoint];
        const corner = arm.horizontal ? { x: splitPoint.x, y: m.target.y }
                                      : { x: m.target.x, y: splitPoint.y };
        if (Math.abs(corner.x - splitPoint.x) > 0.5 || Math.abs(corner.y - splitPoint.y) > 0.5) {
          branchPts.push(corner);
        }
        branchPts.push({ x: m.target.x, y: m.target.y });

        segments.push({
          id: 'branch_' + m.roomId,
          // The parent is the RUN that feeds it — the major branch where there
          // is one, otherwise the trunk run itself. The segment graph has to be
          // a tree over SEGMENTS, because that is what the index run walks.
          parentId: feedsRooms,
          junctionId: jId,
          role: 'branch',
          roomId: m.roomId,
          arm: arm.key,
          destination: m.label,
          airflowLs: m.airflowLs,
          zone: m.zone,
          points: dedupePoints(branchPts),
          fittings
        });
        nodes.push({ id: 'outlet_' + m.roomId, type: 'outlet', x: m.target.x, y: m.target.y,
                     label: m.label, zone: m.zone });

      // ── Finals, when a room has more than one outlet ──────────────────────
      if (m.quantity > 1) {
        m.outletPoints.forEach((pt, k) => {
          if (k === 0) return;                       // the branch already reaches the first
          segments.push({
            id: 'final_' + m.roomId + '_' + (k + 1),
            parentId: 'branch_' + m.roomId,
            role: 'final',
            roomId: m.roomId,
            destination: m.label + ' outlet ' + (k + 1),
            airflowLs: m.airflowLs / m.quantity,
            zone: m.zone,
            points: dedupePoints([m.target, { x: pt.x, y: m.target.y }, pt]),
            fittings: ['bend_90']
          });
          nodes.push({ id: 'outlet_' + m.roomId + '_' + (k + 1), type: 'outlet',
                       x: pt.x, y: pt.y, label: m.label + ' ' + (k + 1), zone: m.zone });
        });
      }
      }
    });
  });

  return {
    generated: true,
    segments,
    nodes,
    footprint,
    // Kept for the manual routing path and for anything that still asks.
    spine: trunkSpine(footprint, plenum),
    arms: arms.map(a => ({ key: a.key, horizontal: a.horizontal,
                           rooms: a.drops.map(d => d.label) })),
    // What leaves the fan coil. Two or three, each serving a group of the
    // house — the thing an installer looks at first.
    supplyMains: arms.map((a, i) => ({
      index: i + 1,
      arm: a.key,
      segmentId: i === 0 ? 'main' : 'main_' + a.key.toLowerCase(),
      airflowLs: round(a.drops.reduce((sum, d) => sum + (d.airflowLs || 0), 0), 0),
      serves: a.drops.map(d => d.label)
    })),
    mainCount: arms.length,
    plenum: { ...plenum, source: plenumSource },
    junctionCount: junctionCounter,
    warnings,
    notice: AUTO_ROUTE_NOTICE
  };
}

/** Consecutive identical points make a zero-length leg and an ugly node. */
function dedupePoints(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push({ x: round(p.x, 2), y: round(p.y, 2) });
  }
  return out;
}

// ── PART 13: the drawn geometry becomes the length ──────────────────────────

/**
 * Measure every routed segment through the plan calibration.
 *
 * ONCE A LAYOUT EXISTS, THE DRAWING IS THE SOURCE OF TRUTH. A logical estimate
 * of 6.0 m and a routed drawing of 7.4 m are not two opinions — the 7.4 is the
 * duct somebody has to buy, hang and push air through, so that is the figure
 * the BOM, the costing and the pressure calculation get.
 *
 * The straight-line estimate is kept alongside it, because when the two differ
 * a long way it usually means the route has been dragged somewhere odd, and an
 * estimator with both numbers can see that at a glance.
 */
export function measureTree(tree, calibration, opts = {}) {
  if (!tree?.segments?.length) return tree;
  const settings = opts.settings || DEFAULT_SETTINGS;
  const slack = opts.slackFactor ?? settings.duct.routeSlackFactor;

  const segments = tree.segments.map(seg => {
    const planMm = polylineLengthMm(calibration, seg.points);
    if (planMm === null) {
      return { ...seg, lengthMm: null, lengthM: null, lengthSource: 'uncalibrated' };
    }
    const lengthMm = planMm * slack;
    // What the same run would be as the crow flies, for comparison only.
    const ends = [seg.points[0], seg.points[seg.points.length - 1]];
    const directMm = polylineLengthMm(calibration, ends);
    return {
      ...seg,
      planMm: round(planMm, 0),
      lengthMm: round(lengthMm, 0),
      lengthM: round(lengthMm / 1000, 2),
      straightLineM: directMm !== null ? round((directMm * slack) / 1000, 2) : null,
      slackFactor: slack,
      lengthSource: 'routed_drawing',
      lengthNote: 'Measured from the routed layout on the calibrated plan (' +
        round(planMm / 1000, 2) + ' m drawn × ' + slack + ' for rise, drop and slack).'
    };
  });

  return { ...tree, segments, measured: calibration ? true : false };
}

/**
 * The routed tree, ready for the plan viewer.
 *
 * Every line carries its own sized section's numbers, so what is drawn is the
 * design and not a picture of it. Trunk, branch, final and return are visually
 * distinct, and weight follows diameter.
 */
export function routedOverlay({ network, labelDetail = DEFAULT_LABEL_DETAIL,
                                returnRoute = null, returnDesign = null,
                                zoneColourByRoomId = {}, activeId = null } = {}) {
  const out = {};
  for (const s of (network?.sections || [])) {
    if (!s.points || s.points.length < 2) continue;
    out[s.id] = {
      points: s.points,
      role: s.role,
      sectionId: s.id,
      roomId: s.roomId || null,
      major: !!s.major,
      serves: s.serves || null,
      zone: s.zone || null,
      diameterMm: s.diameterMm,
      airflowLs: s.airflowLs,
      lengthM: s.lengthM,
      // LABEL PRIORITY. A drawing with a size on every one of twenty-five runs
      // is unreadable; NAC's own sheets carry about ten. The trunk always gets
      // one — it is the spine. A branch gets one, because that is the size the
      // installer pulls for the room. A final only gets one when it is a
      // DIFFERENT size from the branch feeding it: repeating the same number
      // 300 mm further along the same duct is the clutter, not the information.
      labelPriority: s.role === 'main' || s.role === 'trunk' ? 3
        : s.role === 'return' ? 3
        // A MAJOR branch is the take-off feeding a group of rooms — the size an
        // installer pulls. The short run from there into one room is not.
        : s.role === 'branch' && s.major ? 3
        : s.role === 'branch' ? 1
        : 1,
      colour: runColour(s, zoneColourByRoomId),
      zoneColour: s.roomId ? (zoneColourByRoomId[s.roomId]?.colour || null) : null,
      zoneName: s.roomId ? (zoneColourByRoomId[s.roomId]?.shortName || null) : null,
      width: lineWidthForDiameter(s.diameterMm),
      label: segmentLabel(s, labelDetail),
      auto: s.auto !== false,
      locked: !!s.locked,
      active: activeId === s.id,
      reducerFrom: s.reducerFrom || null,
      reducerTo: s.reducerTo || null
    };
  }

  // Drop a final's label when it repeats the size of the branch that feeds it,
  // and drop a trunk segment's when the run either side of it is the same size.
  const byId = new Map((network?.sections || []).map(x => [x.id, x]));
  for (const s of (network?.sections || [])) {
    const entry = out[s.id];
    if (!entry || !entry.label) continue;
    const parent = s.parentId ? byId.get(s.parentId) : null;
    if (!parent) continue;
    if (parent.diameterMm === s.diameterMm) {
      if (s.role === 'final' || s.role === 'trunk') { entry.label = null; entry.labelSuppressed = 'same size as the run before it'; }
    }
  }

  if (returnRoute?.points) {
    const ret = returnDesign?.duct || null;
    out.return = {
      points: returnRoute.points,
      role: 'return',
      diameterMm: ret?.diameterMm ?? null,
      airflowLs: returnDesign?.totalAirflowLs ?? null,
      lengthM: ret?.lengthM ?? null,
      colour: roleColour('return'),
      width: lineWidthForDiameter(ret?.diameterMm),
      label: labelDetail === LABEL_DETAIL.HIDE ? null
        : (ret?.diameterMm ? 'RETURN \u00f8' + ret.diameterMm : 'RETURN'),
      auto: !!returnRoute.auto,
      locked: !!returnRoute.locked
    };
  }
  return out;
}

/**
 * The fittings that get drawn as symbols: junctions, reducers and zone dampers.
 *
 * These are things somebody buys and fits, so showing them is not decoration —
 * a Y piece nobody drew is a Y piece nobody ordered.
 */
export function routedMarkers(network, tree) {
  const markers = [];
  const sections = network?.sections || [];

  for (const n of (tree?.nodes || [])) {
    // The NAC topology generator emits its take-offs as nodes of type 'bto';
    // the older tree called the same thing a junction. Both are the fitting an
    // installer sets on the main, so both get drawn.
    if (n.type === 'junction' || n.type === 'bto') {
      markers.push({ type: n.type === 'bto' || n.bto ? 'bto' : 'junction',
                     x: n.x, y: n.y, label: n.label,
                     // A BTO is a fitting an installer sets; a plain junction
                     // where the trunk meets a branch is just a meeting point.
                     bto: n.type === 'bto' || !!n.bto,
                     serves: n.serves || [],
                     title: 'Branch take-off \u2014 serves ' + (n.serves || []).join(', ') });
    }
  }

  for (const s of sections) {
    if (s.reducerFrom && s.points?.length) {
      const p = s.points[0];
      markers.push({ type: 'reducer', x: p.x, y: p.y,
                     label: s.reducerFrom + '→' + s.reducerTo,
                     title: 'Reducer ' + s.reducerFrom + ' to ' + s.reducerTo + ' mm' });
    }
    // NO DAMPER IS PLACED HERE. placeZoneDampers() is the one that decides
    // where the motors go, and it is the one the BOM counts. Putting a second
    // damper on every zoned branch from here drew SEVEN dampers on an order
    // that buys six, and stacked two of them on one branch — a fitting on the
    // drawing that nobody installs.
  }

  // Several finals leaving the same take-off point are ONE place on the ceiling
  // where the installer works, not three. Stacking three identical symbols on
  // the same pixel is the clutter this drawing is meant to be free of, so they
  // merge into a single mark that names everything it serves.
  const merged = [];
  const seen = new Map();
  for (const m of markers) {
    if (m.type !== 'bto' && m.type !== 'junction') { merged.push(m); continue; }
    const key = m.type + ':' + Math.round(m.x / 6) + ':' + Math.round(m.y / 6);
    const at = seen.get(key);
    if (!at) { seen.set(key, m); merged.push(m); continue; }
    at.serves = [...new Set([...(at.serves || []), ...(m.serves || [])])];
    at.title = 'Branch take-off \u2014 serves ' + (at.serves || []).join(', ');
  }
  return merged;
}

// ── PART 4 & 16: is this layout any good, and is it safe to trust? ──────────

/**
 * Score a routed layout and raise the plan-based warnings.
 *
 * The goal is not mathematical perfection. It is a fast, sensible first pass an
 * estimator can drag into shape — so these are flags to look at, not a gate. A
 * route is never blocked for being long or bendy; it is blocked only when an
 * engineering limit is exceeded, and that happens in the sizing engine.
 */
export function scoreRoute(network, tree, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const sections = (network?.sections || []).filter(s => s.points?.length);
  const warnings = [];
  if (!sections.length) return { score: null, warnings, confidence: 'LOW' };

  let bends = 0, totalM = 0, outside = 0, longBranches = 0;
  for (const s of sections) {
    totalM += s.lengthM || 0;
    bends += Math.max(0, s.points.length - 2);
    for (const p of s.points) if (!insideFootprint(tree?.footprint, p, 4)) { outside++; break; }
    if (s.role === 'branch' && (s.lengthM || 0) > (settings.duct.longRunWarnM ?? 12)) longBranches++;
  }

  if (outside) warnings.push({ code: 'DUCT_ROUTE_OUTSIDE_BUILDING', severity: 'CHECK',
    message: outside + ' routed run(s) leave the footprint the rooms describe. The plan has no ' +
             'wall data, so check these against the real building line.' });
  if (longBranches) warnings.push({ code: 'LONG_BRANCH', severity: 'CHECK',
    message: longBranches + ' branch(es) are longer than the ' + (settings.duct.longRunWarnM ?? 12) +
             ' m review length.' });
  const bendsPerRun = bends / sections.length;
  if (bendsPerRun > 2.5) warnings.push({ code: 'EXCESSIVE_BENDS', severity: 'CHECK',
    message: 'The routed layout averages ' + round(bendsPerRun, 1) + ' bends per run. Every bend ' +
             'is resistance the fan has to overcome.' });

  // A large duct needs room. The plan cannot show ceiling space, so this asks
  // rather than deciding — fabricating a clearance would be worse than useless.
  const big = sections.filter(s => (s.diameterMm || 0) >= (settings.duct.largeDuctMm ?? 350));
  if (big.length) warnings.push({ code: 'LARGE_DUCT_CLEARANCE_CHECK', severity: 'CHECK',
    message: big.length + ' run(s) at ' + (settings.duct.largeDuctMm ?? 350) + ' mm or larger. ' +
             'Confirm the ceiling or roof space actually takes them — the plan does not show it.' });

  warnings.push({ code: 'UNVERIFIED_ROUTE', severity: 'CHECK', message: AUTO_ROUTE_NOTICE });

  return {
    totalDuctM: round(totalM, 1),
    bends,
    bendsPerRun: round(bendsPerRun, 2),
    outsideCount: outside,
    longBranchCount: longBranches,
    largeDuctCount: big.length,
    warnings
  };
}

/**
 * How much of this layout rests on something solid?
 *
 * NEVER 'install-ready'. The best this can say is HIGH, meaning the geometry it
 * was given was good — a calibrated plan, drawn room boundaries, a placed
 * plenum. It says nothing about trusses, and it never will.
 */
export function routeConfidence({ design, tree, score } = {}) {
  const reasons = [];
  let points = 0;

  if (design?.calibration) { points += 2; } else reasons.push('The plan is not calibrated.');

  const rooms = (design?.rooms || []).filter(isConditionedRoom);
  const withBoundary = rooms.filter(r => r.boundaryPx).length;
  if (rooms.length && withBoundary === rooms.length) points += 2;
  else if (withBoundary >= rooms.length * 0.7) { points += 1; reasons.push('Some rooms have no boundary drawn.'); }
  else reasons.push('Most rooms have no boundary drawn, so they were not routed to.');

  if (tree?.plenum?.source === 'placed') points += 2;
  else if (tree?.plenum?.source === 'indoor_unit') { points += 1; reasons.push('The trunk starts at the indoor unit; no plenum was placed.'); }
  else reasons.push('No plenum was placed, so the trunk starts from an assumed centre.');

  const lowConf = rooms.filter(r => r.confidenceBand === 'LOW').length;
  if (!lowConf) points += 1; else reasons.push(lowConf + ' room measurement(s) are LOW confidence.');

  if ((score?.outsideCount || 0) === 0) points += 1;
  else reasons.push('Part of the layout falls outside the building footprint.');

  const band = points >= 7 ? 'HIGH' : points >= 4 ? 'MEDIUM' : 'LOW';
  return {
    band,
    points,
    reasons,
    // The one sentence that must always be true.
    statement: AUTO_ROUTE_NOTICE
  };
}

// ── PART 11: return air ─────────────────────────────────────────────────────

/**
 * Route the return air duct: return grille → the unit's return connection.
 *
 * The return is a different system from the supply and is drawn as one. It is
 * sized by the return design (from the unit's required return size), never by
 * anything worked out here, and where there are two returns both are routed.
 */
export function buildReturnRoutes({ layout = {}, returnDesign = null, rooms = [] } = {}) {
  const unit = (layout.indoorUnit?.x !== undefined) ? layout.indoorUnit
             : (layout.plenum?.x !== undefined ? layout.plenum : null);
  if (!unit) {
    return { generated: false, routes: [],
      warnings: [{ code: 'RETURN_NOT_ROUTED', severity: 'CHECK',
        message: 'The indoor unit has not been placed, so the return duct could not be routed. ' +
                 'Its length has to be entered by hand.' }] };
  }

  const count = returnDesign?.returnCount || 1;
  const routes = [];
  const warnings = [];

  for (let i = 0; i < count; i++) {
    const key = i === 0 ? 'returnGrille' : 'returnGrille_' + (i + 1);
    const grille = layout[key];
    if (!grille || grille.x === undefined) {
      // The first return falls back to the middle of the biggest room, which is
      // where a return usually goes — and it says that it assumed it.
      if (i === 0) {
        const biggest = [...(rooms || [])].filter(r => isConditionedRoom(r) && r.boundaryPx)
          .sort((a, b) => (b.boundaryPx.w * b.boundaryPx.h) - (a.boundaryPx.w * a.boundaryPx.h))[0];
        if (!biggest) continue;
        const c = roomCentre(biggest);
        warnings.push({ code: 'RETURN_POSITION_ASSUMED', severity: 'CHECK',
          message: 'No return grille has been placed, so the return was routed from ' +
                   biggest.label + '. Place the grille and re-route for a real length.' });
        routes.push({ id: 'return', points: orthogonal(c, unit), assumed: true,
                      from: biggest.label });
        continue;
      }
      warnings.push({ code: 'RETURN_NOT_PLACED', severity: 'CHECK',
        message: 'Return ' + (i + 1) + ' has not been placed on the plan.' });
      continue;
    }
    routes.push({ id: i === 0 ? 'return' : 'return_' + (i + 1),
                  points: orthogonal({ x: grille.x, y: grille.y }, unit), assumed: false });
  }

  return { generated: routes.length > 0, routes, warnings, notice: AUTO_ROUTE_NOTICE };
}

/** Two legs, square — the way duct actually runs. */
function orthogonal(from, to) {
  return dedupePoints([from, { x: to.x, y: from.y }, { x: to.x, y: to.y }]);
}

// ── PART 12: zone dampers ───────────────────────────────────────────────────

/**
 * Where each zone's damper goes: on the branch, before the run splits.
 *
 * A damper is a motor somebody buys, wires and commissions, so it is placed on
 * the drawing rather than left implied. The position stays editable — this is a
 * starting point, like everything else the router produces.
 */
export function placeZoneDampers(network, { zoneOverrides = {}, zones = null } = {}) {
  // AN ALWAYS-OPEN ZONE HAS NO MOTOR, SO IT GETS NO DAMPER.
  //
  // The common zone is what keeps air moving when everything else shuts; there
  // is nothing to close and the BOM never buys a motor for it. Drawing one put
  // seven dampers on a plan whose order carries six motors — a fitting on the
  // drawing that nobody installs, which is the same fault as a fitting in the
  // design that nobody drew.
  const alwaysOpen = new Set((zones?.zones || [])
    .filter(z => z.alwaysOpen).map(z => z.name));
  const sections = network?.sections || [];
  const byId = new Map(sections.map(s => [s.id, s]));
  const kids = new Map();
  for (const s of sections) {
    if (!s.parentId) continue;
    if (!kids.has(s.parentId)) kids.set(s.parentId, []);
    kids.get(s.parentId).push(s);
  }

  // Which zones sit downstream of each run.
  const zonesBelow = new Map();
  const walk = (s) => {
    if (zonesBelow.has(s.id)) return zonesBelow.get(s.id);
    const set = new Set();
    if (s.zone) set.add(s.zone);
    for (const k of (kids.get(s.id) || [])) for (const z of walk(k)) set.add(z);
    zonesBelow.set(s.id, set);
    return set;
  };
  for (const s of sections) walk(s);

  // ONE damper per zone, on the run that feeds the whole of that zone and
  // nothing else — the take-off for a grouped zone, the room branch for a zone
  // of one room. A damper on every branch would mean five motors on a zone that
  // has one, which is money on the order and a control that does not exist.
  const out = [];
  const done = new Set();
  for (const s of sections) {
    const below = zonesBelow.get(s.id) || new Set();
    if (below.size !== 1) continue;
    const zone = [...below][0];
    if (done.has(zone) || alwaysOpen.has(zone)) continue;
    const parent = s.parentId ? byId.get(s.parentId) : null;
    const parentBelow = parent ? (zonesBelow.get(parent.id) || new Set()) : new Set();
    // The highest run that is still all one zone: its parent must carry more
    // than this zone (or there is no parent).
    if (parent && parentBelow.size === 1) continue;
    if (!s.points || s.points.length < 2) continue;
    done.add(zone);

    const override = zoneOverrides[s.id];
    if (override?.x !== undefined) {
      out.push({ id: 'damper_' + s.id, sectionId: s.id, zone, roomId: s.roomId ?? null,
                 x: override.x, y: override.y, moved: true });
      continue;
    }
    // A SHORT WAY INTO THE RUN, not on the collar. A run is a swept polyline of
    // a dozen samples, so a fraction of the FIRST LEG is three per cent of the
    // duct: the three bedroom dampers all landed on the same take-off and the
    // drawing showed one damper with two hidden underneath it. A fraction of
    // the WHOLE run puts each one in its own branch, which is also where it is
    // fitted — far enough in to be reachable, before the duct turns away.
    //
    // The ANGLE of the leg it lands on travels with it so the drawing can sit
    // the damper ACROSS the duct — a damper drawn along the duct is a
    // decoration.
    const at = pointAlong(s.points, DAMPER_ALONG_RUN);
    out.push({ id: 'damper_' + s.id, sectionId: s.id, zone, roomId: s.roomId ?? null,
               x: at.x, y: at.y, angle: at.angle,
               diameterMm: s.diameterMm ?? null, moved: false });
  }
  // Two dampers on two different branches can still land within a few
  // millimetres of one another where the branches leave the same point. Slide
  // the later one further along its own run until it is clear — its own run,
  // so it never ends up drawn on a duct it does not control.
  const MIN_APART_PX = 22;
  for (let i = 1; i < out.length; i++) {
    const sec = byId.get(out[i].sectionId);
    if (!sec?.points || out[i].moved) continue;
    for (let tries = 0; tries < 5; tries++) {
      const clash = out.slice(0, i).some(o =>
        Math.hypot(o.x - out[i].x, o.y - out[i].y) < MIN_APART_PX);
      if (!clash) break;
      const at = pointAlong(sec.points, Math.min(0.85, DAMPER_ALONG_RUN + 0.16 * (tries + 1)));
      out[i].x = at.x; out[i].y = at.y; out[i].angle = at.angle;
    }
  }
  return out;
}

/** How far into the branch a zone damper is fitted, as a fraction of the run. */
const DAMPER_ALONG_RUN = 0.3;

/** The point, and the direction of travel, a fraction of the way along a run. */
function pointAlong(pts, fraction) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(d); total += d;
  }
  if (!total) return { x: pts[0].x, y: pts[0].y, angle: 0 };
  let want = total * Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < segs.length; i++) {
    if (want <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? want / segs[i] : 0;
      const a = pts[i], b = pts[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
               angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    want -= segs[i];
  }
  return { x: pts[0].x, y: pts[0].y, angle: 0 };
}

// ── PART 8: EDITING THE ROUTE ───────────────────────────────────────────────
//
// The auto layout is a first pass. An estimator who has stood in the roof space
// knows where the duct can actually go, and getting it there has to take
// seconds — so every node on the drawing is draggable.
//
// THE RULE THAT MAKES THIS SAFE: an edit is a change to the GEOMETRY OF A REAL
// DUCT SECTION, never to a drawing that sits alongside one. There is no second
// model to drift out of step. Move a node and the length changes, which changes
// the pressure, the bill of materials, the cost and the installer's sheet,
// because they were all reading that section all along.
//
// Everything here is PURE: sections and a drag in, new geometry out. The viewer
// does the pointer work and the app stores the result; the rules about what
// stays connected to what live here, where they can be tested.

/** How close two points have to be to count as the same node, in image px. */
export const JOIN_TOLERANCE_PX = 1.5;

const near = (a, b, tol = JOIN_TOLERANCE_PX) =>
  a && b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/**
 * Every handle an estimator can grab, with what it is attached to.
 *
 * A junction is not a separate object — it is the place where a trunk ends, the
 * next trunk starts and the branches leave. So a handle carries EVERY section
 * point that sits at that spot, and dragging it moves all of them together.
 * That is what keeps the system connected when a junction is moved.
 */
export function routeHandles(network, { lockedIds = [] } = {}) {
  const locked = new Set(lockedIds);
  const byPos = new Map();
  const key = (p) => Math.round(p.x / JOIN_TOLERANCE_PX) + ':' + Math.round(p.y / JOIN_TOLERANCE_PX);

  for (const s of (network?.sections || [])) {
    if (!s.points || s.points.length < 2) continue;
    s.points.forEach((p, i) => {
      const k = key(p);
      const entry = byPos.get(k) || { x: p.x, y: p.y, attach: [] };
      entry.x = p.x; entry.y = p.y;
      entry.attach.push({ sectionId: s.id, index: i, role: s.role,
                          end: i === 0 || i === s.points.length - 1 });
      byPos.set(k, entry);
    });
  }

  const handles = [];
  for (const [k, e] of byPos) {
    const roles = [...new Set(e.attach.map(a => a.role))];
    const shared = e.attach.length > 1;
    // A spot where more than one run meets IS the junction.
    const kind = shared ? 'junction'
      : e.attach[0].end ? 'end' : 'node';
    handles.push({
      id: 'h_' + k,
      x: e.x, y: e.y,
      kind,
      roles,
      attach: e.attach,
      sectionIds: [...new Set(e.attach.map(a => a.sectionId))],
      // A handle is locked if ANY run meeting there is locked — moving it would
      // drag a locked run with it.
      locked: e.attach.some(a => locked.has(a.sectionId)),
      shared
    });
  }
  return handles.sort((a, b) => (a.kind === 'junction' ? -1 : 1) - (b.kind === 'junction' ? -1 : 1));
}

/** The handle nearest a point, within `radius` image px. Junctions win ties. */
export function handleAt(handles, at, radius) {
  let best = null, bestD = Infinity;
  for (const h of handles) {
    const d = Math.hypot(h.x - at.x, h.y - at.y);
    if (d > radius) continue;
    // A junction under the same finger beats a plain node: it is the thing an
    // estimator is almost always reaching for, and it is the harder one to hit.
    const score = d - (h.kind === 'junction' ? radius * 0.35 : 0);
    if (score < bestD) { bestD = score; best = h; }
  }
  return best;
}

/**
 * Square every leg of a run, leaving the ENDS exactly where they are.
 *
 * A duct drawing full of diagonals is not a duct layout, it is spaghetti. But
 * pinning a dragged corner to stay square is impossible when both its
 * neighbours are fixed — the corner simply cannot move. So instead the point
 * goes exactly where it was dropped and any leg that came out diagonal gets an
 * ELBOW put in it, which is what a fitter would do with the actual duct.
 *
 * The ends never move: one is where the run leaves the trunk, the other is the
 * outlet, and shifting either would change what the run connects to.
 */
export function squarePolyline(points, { preferVerticalFirst = null } = {}) {
  if (!Array.isArray(points) || points.length < 2) return (points || []).map(p => ({ ...p }));
  const out = [{ ...points[0] }];
  let lastWasHorizontal = null;

  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);

    if (dx < 0.01 || dy < 0.01) {
      out.push({ ...b });
      if (dx >= 0.01) lastWasHorizontal = true;
      else if (dy >= 0.01) lastWasHorizontal = false;
      continue;
    }

    // Diagonal. Put an elbow in, carrying on in the direction the run was
    // already going so the drawing keeps its shape.
    const verticalFirst = preferVerticalFirst !== null ? preferVerticalFirst
      : (lastWasHorizontal === true ? false : lastWasHorizontal === false ? true : dy > dx);
    out.push(verticalFirst ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
    out.push({ ...b });
    lastWasHorizontal = !verticalFirst;
  }
  return dedupePoints(out);
}

/**
 * Move one point of a run, keeping every leg square unless a free one is asked
 * for. The point lands exactly where it was dropped; the squaring happens in
 * the legs around it.
 */
export function orthogonalise(points, index, to, { allowDiagonal = false } = {}) {
  const moved = points.map((p, i) => (i === index ? { ...to } : { ...p }));
  return allowDiagonal ? moved : squarePolyline(moved);
}

/** Snap to another handle, so runs actually meet rather than nearly meet. */
export function snapToHandles(at, handles, { exclude = [], radius = 12 } = {}) {
  const skip = new Set(exclude);
  let best = null, bestD = Infinity;
  for (const h of handles) {
    if (skip.has(h.id)) continue;
    const d = Math.hypot(h.x - at.x, h.y - at.y);
    if (d <= radius && d < bestD) { bestD = d; best = h; }
  }
  return best ? { x: best.x, y: best.y, snappedTo: best.id } : { ...at, snappedTo: null };
}

/**
 * Drag one handle and return the new geometry of every section it touches.
 *
 * MOVE A JUNCTION AND EVERYTHING STAYS JOINED. The handle carries every
 * section point sitting at that spot, so the trunk arriving, the trunk leaving
 * and each branch hanging off it all move with it — a junction cannot be pulled
 * apart by accident, which would be the easiest way to produce a drawing that
 * looks fine and is not a system.
 *
 * A LOCKED SECTION DOES NOT MOVE. If a handle is shared with a locked run, the
 * locked run keeps its geometry and the others follow the drag, so the lock
 * always wins.
 *
 * @returns {{edits: Object, moved: String[], blocked: String[]}}
 */
export function dragHandle(network, handle, to, { lockedIds = [], allowDiagonal = false } = {}) {
  const locked = new Set(lockedIds);
  const byId = new Map((network?.sections || []).map(s => [s.id, s]));
  const edits = {};
  const moved = [];
  const blocked = [];

  for (const a of (handle?.attach || [])) {
    const s = byId.get(a.sectionId);
    if (!s?.points) continue;
    if (locked.has(a.sectionId)) { blocked.push(a.sectionId); continue; }
    const base = edits[a.sectionId] || s.points;
    // A shared point is a joint: it lands exactly where it is put, because
    // nudging it per-section would tear the junction apart. The legs leading
    // away from it are still squared, so moving a junction does not leave four
    // diagonals behind it.
    const placed = base.map((p, i) => (i === a.index ? { ...to } : { ...p }));
    edits[a.sectionId] = allowDiagonal ? placed : squarePolyline(placed);
    moved.push(a.sectionId);
  }
  return { edits, moved: [...new Set(moved)], blocked: [...new Set(blocked)] };
}

/**
 * Move a whole branch, keeping it attached where it leaves the trunk.
 *
 * Dragging one node at a time to shift a run across a room is the sort of thing
 * that makes an estimator give up and draw it by hand.
 */
export function dragBranch(network, sectionId, delta, { lockedIds = [] } = {}) {
  if ((lockedIds || []).includes(sectionId)) return { edits: {}, moved: [], blocked: [sectionId] };
  const s = (network?.sections || []).find(x => x.id === sectionId);
  if (!s?.points || s.points.length < 2) return { edits: {}, moved: [], blocked: [] };
  // The first point is the take-off and stays on the trunk; everything after it
  // shifts. Otherwise the branch comes away from the system.
  const pts = s.points.map((p, i) => (i === 0 ? { ...p }
    : { x: round(p.x + delta.x, 2), y: round(p.y + delta.y, 2) }));
  return { edits: { [sectionId]: pts }, moved: [sectionId], blocked: [] };
}

/** Add a point part way along a run, so a duct can be taken around something. */
export function addRoutePoint(network, sectionId, at, { lockedIds = [] } = {}) {
  if ((lockedIds || []).includes(sectionId)) return { edits: {}, blocked: [sectionId] };
  const s = (network?.sections || []).find(x => x.id === sectionId);
  if (!s?.points || s.points.length < 2) return { edits: {}, blocked: [] };

  // Put it on the leg it was actually dropped on.
  let bestLeg = 0, bestD = Infinity;
  for (let i = 1; i < s.points.length; i++) {
    const d = distanceToSegment(at, s.points[i - 1], s.points[i]);
    if (d < bestD) { bestD = d; bestLeg = i; }
  }
  const pts = [...s.points.slice(0, bestLeg).map(p => ({ ...p })),
               { x: round(at.x, 2), y: round(at.y, 2) },
               ...s.points.slice(bestLeg).map(p => ({ ...p }))];
  return { edits: { [sectionId]: pts }, index: bestLeg, blocked: [] };
}

/**
 * Remove a point.
 *
 * The two ends are not removable: one is where the duct leaves the trunk and
 * the other is the outlet. Deleting either would disconnect the run rather than
 * simplify it.
 */
export function deleteRoutePoint(network, sectionId, index, { lockedIds = [] } = {}) {
  if ((lockedIds || []).includes(sectionId)) return { edits: {}, blocked: [sectionId], reason: 'locked' };
  const s = (network?.sections || []).find(x => x.id === sectionId);
  if (!s?.points) return { edits: {}, blocked: [] };
  if (index <= 0 || index >= s.points.length - 1) {
    return { edits: {}, blocked: [sectionId],
             reason: 'An end point is where this run joins the system. Move it instead.' };
  }
  if (s.points.length <= 2) {
    return { edits: {}, blocked: [sectionId], reason: 'A run needs at least two points.' };
  }
  return { edits: { [sectionId]: s.points.filter((_, i) => i !== index).map(p => ({ ...p })) },
           blocked: [] };
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Is a manual diameter at odds with what the design actually needs?
 *
 * A manual size is never changed back — the estimator may know something the
 * tool does not. But it is never silently accepted either: if it pushes the
 * velocity outside NAC's configured band, that is said out loud.
 */
export function checkDiameterOverride(section, settings = DEFAULT_SETTINGS) {
  if (!section?.selection?.manual) return null;
  const role = section.role === 'trunk' ? 'main' : section.role;
  const band = settings.duct.velocity[role] || settings.duct.velocity.branch;
  const v = section.velocityMs;
  if (v > band.max) {
    return { code: 'MANUAL_DIAMETER_OVER_VELOCITY', severity: 'WARNING',
      message: (section.destination || section.id) + ': the ' + section.diameterMm +
        ' mm you set runs at ' + round(v, 2) + ' m/s, over the ' + band.max +
        ' m/s maximum for a ' + role + ' duct. It has been kept — reset it to auto to undo.' };
  }
  if (v > band.preferred) {
    return { code: 'MANUAL_DIAMETER_ABOVE_PREFERRED', severity: 'CHECK',
      message: (section.destination || section.id) + ': ' + round(v, 2) + ' m/s at the ' +
        section.diameterMm + ' mm you set, above the preferred ' + band.preferred + ' m/s.' };
  }
  if (v > 0 && v < band.preferredMin) {
    return { code: 'MANUAL_DIAMETER_BELOW_PREFERRED', severity: 'CHECK',
      message: (section.destination || section.id) + ': ' + round(v, 2) + ' m/s at the ' +
        section.diameterMm + ' mm you set, below the preferred ' + band.preferredMin +
        ' m/s — oversized for the air it carries.' };
  }
  return null;
}

/** PART 16 — do any two runs cross where they should not? */
export function crossingCheck(network) {
  const runs = (network?.sections || []).filter(s => s.points?.length >= 2);
  const hits = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i], b = runs[j];
      // Runs that share a joint are supposed to meet.
      if (a.parentId === b.id || b.parentId === a.id) continue;
      if (legsCross(a.points, b.points)) hits.push([a.id, b.id]);
    }
  }
  return hits;
}

function legsCross(A, B) {
  for (let i = 1; i < A.length; i++) {
    for (let j = 1; j < B.length; j++) {
      if (segmentsIntersect(A[i - 1], A[i], B[j - 1], B[j])) return true;
    }
  }
  return false;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  // Touching at a shared endpoint is a joint, not a crossing.
  if (near(p1, p3) || near(p1, p4) || near(p2, p3) || near(p2, p4)) return false;
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
