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
import { round } from './units.mjs';
import { polylineLengthMm } from './calibration.mjs';

/** Stamped on every auto-generated route. Never remove it from a route. */
export const AUTO_ROUTE_NOTICE =
  'AUTO ROUTE — VERIFY SITE CONDITIONS, STRUCTURE AND CLEARANCES BEFORE INSTALLATION';

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
  const dia = section.diameterMm ? section.diameterMm + 'Ø' : null;
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
export const ROLE_COLOUR = {
  main:   '#F5C200',   // trunk from the unit — NAC yellow, the spine of the drawing
  trunk:  '#F5C200',
  branch: '#5fa8ff',
  final:  '#8fd0ff',
  return: '#ff9d5c'    // return air is a different system and must never be read as supply
};

export function roleColour(role) {
  return ROLE_COLOUR[role] || ROLE_COLOUR.branch;
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
        : 'RETURN' + (ret?.diameterMm ? '\n' + ret.diameterMm + 'Ø' : ''),
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

  const spine = trunkSpine(footprint, plenum);

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

  // ── Take-offs, clustered into junctions ───────────────────────────────────
  const spineLen = Math.abs(spine.to - spine.from) || 1;
  const tolerance = spineLen * (settings.duct.junctionClusterFraction ?? 0.06);
  const takeoffs = drops.map(d => {
    const proj = projectOntoSpine(spine, d.target);
    return { ...d, along: proj.along, at: { x: proj.x, y: proj.y } };
  });
  const clusters = clusterAlongSpine(takeoffs, spine, tolerance);

  // Junctions in the order the air reaches them, walking out from the plenum.
  const plenumAlong = spine.horizontal ? plenum.x : plenum.y;
  clusters.sort((a, b) => Math.abs(a.along - plenumAlong) - Math.abs(b.along - plenumAlong));

  // ── Airflow, summed from the leaves back up ───────────────────────────────
  // Trunk segment i carries everything from junction i outwards.
  const junctionFlow = clusters.map(c => c.members.reduce((s, m) => s + (m.airflowLs || 0), 0));
  const carriedFrom = clusters.map((_, i) =>
    junctionFlow.slice(i).reduce((s, f) => s + f, 0));

  const segments = [];
  const nodes = [{ id: 'plenum', type: 'plenum', x: plenum.x, y: plenum.y,
                   source: plenumSource, label: 'Supply plenum' }];

  const at = (along) => spine.horizontal
    ? { x: along, y: spine.axisPos } : { x: spine.axisPos, y: along };

  // ── The trunk ─────────────────────────────────────────────────────────────
  let prevPoint = { x: plenum.x, y: plenum.y };
  let prevId = null;
  clusters.forEach((c, i) => {
    const jPoint = at(c.along);
    const jId = 'junction_' + (i + 1);
    nodes.push({ id: jId, type: 'junction', x: jPoint.x, y: jPoint.y,
                 label: 'J' + (i + 1), serves: c.members.map(m => m.label) });

    segments.push({
      id: i === 0 ? 'main' : 'trunk_' + i,
      parentId: prevId,
      role: i === 0 ? 'main' : 'trunk',
      destination: i === 0 ? 'Supply plenum → J1' : 'J' + i + ' → J' + (i + 1),
      airflowLs: carriedFrom[i],
      points: [prevPoint, jPoint],
      rigid: i === 0,
      // A trunk that has just dropped a branch is smaller than the one before
      // it; ducts.mjs sizes from the airflow and the reducer falls out of that.
      fittings: i === 0 ? ['supply_plenum'] : []
    });
    prevPoint = jPoint;
    prevId = i === 0 ? 'main' : 'trunk_' + i;
    const feedingTrunkId = prevId;

    // ── Branches off this junction ──────────────────────────────────────────
    for (const m of c.members) {
      const fittings = ['takeoff', 'damper_open'];
      if (m.quantity > 1) fittings.push({ type: 'y_piece', quantity: m.quantity - 1 });
      // Orthogonal: along the spine to the take-off, then square off to the
      // room. Real flex does not run diagonally across a ceiling.
      const elbow = spine.horizontal ? { x: m.at.x, y: m.at.y } : { x: m.at.x, y: m.at.y };
      const branchPts = [jPoint];
      if (Math.abs(elbow.x - jPoint.x) > 0.5 || Math.abs(elbow.y - jPoint.y) > 0.5) branchPts.push(elbow);
      branchPts.push(spine.horizontal ? { x: elbow.x, y: m.target.y } : { x: m.target.x, y: elbow.y });
      branchPts.push({ x: m.target.x, y: m.target.y });

      segments.push({
        id: 'branch_' + m.roomId,
        // The parent is the TRUNK RUN that feeds this junction, not the
        // junction node. The segment graph has to be a tree over SEGMENTS —
        // that is what the index run walks, and pointing at a node instead left
        // every trunk looking like a dead end with the branches orphaned.
        parentId: feedingTrunkId,
        junctionId: jId,
        role: 'branch',
        roomId: m.roomId,
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

  return {
    generated: true,
    segments,
    nodes,
    footprint,
    spine,
    plenum: { ...plenum, source: plenumSource },
    junctionCount: clusters.length,
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
                                activeId = null } = {}) {
  const out = {};
  for (const s of (network?.sections || [])) {
    if (!s.points || s.points.length < 2) continue;
    out[s.id] = {
      points: s.points,
      role: s.role,
      sectionId: s.id,
      roomId: s.roomId || null,
      zone: s.zone || null,
      diameterMm: s.diameterMm,
      airflowLs: s.airflowLs,
      lengthM: s.lengthM,
      colour: roleColour(s.role),
      width: lineWidthForDiameter(s.diameterMm),
      label: segmentLabel(s, labelDetail),
      auto: s.auto !== false,
      locked: !!s.locked,
      active: activeId === s.id,
      reducerFrom: s.reducerFrom || null,
      reducerTo: s.reducerTo || null
    };
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
        : 'RETURN' + (ret?.diameterMm ? '\n' + ret.diameterMm + 'Ø' : ''),
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
    if (n.type === 'junction') {
      markers.push({ type: 'junction', x: n.x, y: n.y, label: n.label,
                     title: 'Take-off / Y piece — serves ' + (n.serves || []).join(', ') });
    }
  }

  for (const s of sections) {
    if (s.reducerFrom && s.points?.length) {
      const p = s.points[0];
      markers.push({ type: 'reducer', x: p.x, y: p.y,
                     label: s.reducerFrom + '→' + s.reducerTo,
                     title: 'Reducer ' + s.reducerFrom + ' to ' + s.reducerTo + ' mm' });
    }
    // A zone damper sits on the branch, before the run splits.
    if (s.role === 'branch' && s.zone && s.points?.length >= 2) {
      const a = s.points[0], b = s.points[1];
      markers.push({ type: 'damper', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                     label: s.zone, title: 'Zone damper — ' + s.zone + ' (' + s.destination + ')' });
    }
  }
  return markers;
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
export function placeZoneDampers(network, { zoneOverrides = {} } = {}) {
  const out = [];
  for (const s of (network?.sections || [])) {
    if (s.role !== 'branch' || !s.zone || !s.points || s.points.length < 2) continue;
    const override = zoneOverrides[s.id];
    if (override?.x !== undefined) {
      out.push({ id: 'damper_' + s.id, sectionId: s.id, zone: s.zone,
                 roomId: s.roomId, x: override.x, y: override.y, moved: true });
      continue;
    }
    // Just off the take-off, on the first leg, which is where it is reachable.
    const a = s.points[0], b = s.points[1];
    out.push({ id: 'damper_' + s.id, sectionId: s.id, zone: s.zone, roomId: s.roomId,
               x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35, moved: false });
  }
  return out;
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
