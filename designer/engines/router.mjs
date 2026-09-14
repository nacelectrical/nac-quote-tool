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
import { round } from './units.mjs';

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
