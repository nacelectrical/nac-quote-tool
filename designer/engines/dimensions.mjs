// NAC AI HVAC DESIGNER — PART 3: architectural dimension recognition & classification.
//
// A builder plan is covered in numbers. Only some of them are room dimensions.
// This module turns raw detected text into typed, evidence-backed
// DetectedDimension records. It NEVER invents a value: every record traces back
// to text that was actually detected (or entered) on the plan.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';

export const CLASSIFICATIONS = [
  'overall_building_dimension',
  'internal_wall_dimension',
  'wall_thickness',
  'window_width',
  'door_width',
  'setback',
  'annotation',
  'unknown'
];

/**
 * Parse the numeric content of a dimension label as printed on an Australian
 * builder plan. Returns { mm, printed, unit } or null when the text is not a
 * length at all.
 *
 * Conventions handled:
 *   "3400"      -> 3400 mm      (bare integers on AU plans are millimetres)
 *   "3,400"     -> 3400 mm
 *   "3.4"       -> 3400 mm      (small decimal = metres)
 *   "3.4m"      -> 3400 mm
 *   "3400mm"    -> 3400 mm
 *   "R2.5" / "FFL 12.50" / "BED 3" -> null (annotation, not a dimension)
 */
export function parseDimensionText(text) {
  if (text === null || text === undefined) return null;
  const raw = String(text).trim();
  if (!raw) return null;

  // Explicit unit suffix.
  const withUnit = raw.match(/^([0-9][0-9\s,]*(?:\.[0-9]+)?)\s*(mm|m|cm)\b/i);
  if (withUnit) {
    const n = parseFloat(withUnit[1].replace(/[\s,]/g, ''));
    if (!isFinite(n)) return null;
    const u = withUnit[2].toLowerCase();
    return { mm: u === 'm' ? n * 1000 : u === 'cm' ? n * 10 : n, printed: raw, unit: u };
  }

  // Reject anything carrying letters or level/spec prefixes.
  if (/[A-Za-z]/.test(raw)) return null;
  const cleaned = raw.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;

  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return null;

  // Decimal and small => metres. Integer => millimetres.
  if (cleaned.includes('.') && n < 100) return { mm: n * 1000, printed: raw, unit: 'm' };
  if (!cleaned.includes('.') && n < 40) return null; // "3", "12" — a room number, not a length
  return { mm: n, printed: raw, unit: 'mm' };
}

function boxCentre(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Does the detection's span overlap an opening symbol's span on the same axis? */
function overlapsOpening(det, opening, axis, tolerancePx) {
  if (!opening || !opening.box) return false;
  const d = det.box, o = opening.box;
  if (axis === 'x') {
    const perpNear = Math.abs(boxCentre(d).y - boxCentre(o).y) <= (tolerancePx * 6);
    const overlap = Math.min(d.x + d.w, o.x + o.w) - Math.max(d.x, o.x);
    return perpNear && overlap > -tolerancePx;
  }
  const perpNear = Math.abs(boxCentre(d).x - boxCentre(o).x) <= (tolerancePx * 6);
  const overlap = Math.min(d.y + d.h, o.y + o.h) - Math.max(d.y, o.y);
  return perpNear && overlap > -tolerancePx;
}

function nearestWallThickness(mm, settings) {
  const list = settings.plan.wallThicknessesMm;
  let best = null;
  for (const t of list) {
    const d = Math.abs(mm - t);
    if (best === null || d < best.delta) best = { thickness: t, delta: d };
  }
  return best;
}

// Australian residential door leaf / opening widths (mm).
const DOOR_WIDTHS = [720, 770, 820, 870, 920, 1200, 1500, 1800, 2100, 2400];
// Common window / slider widths (mm).
const WINDOW_WIDTHS = [600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000];

function matchesAny(mm, list, tol) {
  for (const v of list) if (Math.abs(mm - v) <= tol) return v;
  return null;
}

/**
 * Classify one detected dimension.
 *
 * @param {object} det        DetectedDimension (must have .mm and .box, .orientation)
 * @param {object} ctx        { detections, walls, openings, chain, buildingExtentMm, settings }
 * @returns {{classification:string, confidence:number, evidence:string[]}}
 */
export function classifyDimension(det, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const P = settings.plan;
  const evidence = [];
  const mm = det.mm;

  if (!isFinite(mm) || mm <= 0) {
    return { classification: 'annotation', confidence: 20, evidence: ['Not a numeric length.'] };
  }

  const axis = det.orientation === 'vertical' ? 'y' : 'x';
  const openings = ctx.openings || [];
  const tol = ctx.tolerancePx ?? 6;

  // 1. Overall building dimension — the chain says so.
  if (ctx.chain && ctx.chain.overallId === det.id) {
    evidence.push('Equals the sum of the inner dimension chain (chain closure verified).');
    return { classification: 'overall_building_dimension', confidence: 96, evidence };
  }
  if (ctx.buildingExtentMm && Math.abs(mm - ctx.buildingExtentMm) <= P.chainClosureToleranceMm) {
    evidence.push('Matches the overall building extent.');
    return { classification: 'overall_building_dimension', confidence: 90, evidence };
  }

  // 2. Wall thickness — small value sitting on a known AU wall thickness.
  if (mm <= 320) {
    const near = nearestWallThickness(mm, settings);
    if (near && near.delta <= P.wallThicknessToleranceMm) {
      evidence.push('Matches standard wall thickness ' + near.thickness + ' mm (±' + P.wallThicknessToleranceMm + ' mm).');
      const walls = (ctx.walls || []).filter(w => w.orientation && w.orientation !== det.orientation);
      if (walls.length) evidence.push('A wall runs across this dimension.');
      return { classification: 'wall_thickness', confidence: walls.length ? 94 : 88, evidence };
    }
  }

  // 3. Openings — the dimension spans a detected window/door symbol.
  const spanningOpening = openings.find(o => overlapsOpening(det, o, axis, tol));
  if (spanningOpening) {
    const type = (spanningOpening.type || '').toLowerCase();
    if (type.includes('door') || type.includes('slid')) {
      evidence.push('Aligned with a detected ' + (type.includes('slid') ? 'sliding door' : 'door') + ' symbol.');
      return { classification: 'door_width', confidence: 86, evidence };
    }
    if (type.includes('window')) {
      evidence.push('Aligned with a detected window symbol.');
      return { classification: 'window_width', confidence: 86, evidence };
    }
  }

  // 4. Standard opening widths without a detected symbol — lower confidence.
  const doorMatch = matchesAny(mm, DOOR_WIDTHS, 15);
  const windowMatch = matchesAny(mm, WINDOW_WIDTHS, 25);
  if (mm < P.minRoomDimensionMm) {
    if (doorMatch) {
      evidence.push('Matches a standard door width (' + doorMatch + ' mm) and is below the minimum room dimension.');
      return { classification: 'door_width', confidence: 68, evidence };
    }
    if (windowMatch) {
      evidence.push('Matches a standard window width (' + windowMatch + ' mm) and is below the minimum room dimension.');
      return { classification: 'window_width', confidence: 62, evidence };
    }
    evidence.push('Below the configured minimum room dimension (' + P.minRoomDimensionMm + ' mm).');
    if (ctx.outsideEnvelope) {
      evidence.push('Positioned outside the building envelope.');
      return { classification: 'setback', confidence: 60, evidence };
    }
    return { classification: 'unknown', confidence: 40, evidence };
  }

  // 5. Plausible room clear dimension.
  if (mm >= P.minRoomDimensionMm && mm <= P.maxRoomDimensionMm) {
    let conf = 72;
    if (ctx.chain) { evidence.push('Member of dimension chain ' + ctx.chain.id + '.'); conf += 8; }
    if (ctx.chain && ctx.chain.closure && ctx.chain.closure.closes) {
      evidence.push('That chain closes against the overall dimension (±' + round(ctx.chain.closure.errorMm, 0) + ' mm).');
      conf += 10;
    }
    const boundedByWalls = (ctx.walls || []).length >= 2;
    if (boundedByWalls) { evidence.push('Bounded by detected walls on both ends.'); conf += 6; }
    if (windowMatch && mm < 3100) {
      evidence.push('Caution: also matches a common window width (' + windowMatch + ' mm).');
      conf -= 14;
    }
    return { classification: 'internal_wall_dimension', confidence: Math.max(30, Math.min(96, conf)), evidence };
  }

  // 6. Too large for a room.
  evidence.push('Above the configured maximum room dimension (' + P.maxRoomDimensionMm + ' mm).');
  return { classification: 'overall_building_dimension', confidence: 55, evidence };
}

/**
 * Normalise raw detections (from the AI plan reader, or typed by the estimator)
 * into DetectedDimension records. Anything that is not a length becomes an
 * 'annotation' record so it is still visible and auditable, never silently used.
 */
export function buildDetectedDimensions(rawDetections, settings = DEFAULT_SETTINGS) {
  const out = [];
  (rawDetections || []).forEach((d, i) => {
    const parsed = parseDimensionText(d.text ?? d.value);
    const box = d.box || { x: 0, y: 0, w: 0, h: 0 };
    out.push({
      id: d.id || ('dim' + (i + 1)),
      text: String(d.text ?? d.value ?? ''),
      mm: parsed ? round(parsed.mm, 1) : null,
      printedUnit: parsed ? parsed.unit : null,
      box,
      orientation: d.orientation || 'horizontal',
      row: d.row ?? null,
      source: d.source || 'plan_detection',
      chainId: null,
      classification: parsed ? 'unknown' : 'annotation',
      classificationConfidence: parsed ? 0 : 20,
      evidence: parsed ? [] : ['Text is not a length — treated as an annotation.'],
      settingsVersion: settings.version
    });
  });
  return out;
}

/** Apply classification to every detection, given chain assignments. */
export function classifyAll(detections, ctx = {}) {
  const chains = ctx.chains || [];
  const byChain = new Map();
  chains.forEach(c => c.memberIds.forEach(id => byChain.set(id, c)));
  return detections.map(det => {
    if (det.mm === null) return det;
    const chain = byChain.get(det.id) || null;
    const walls = (ctx.walls || []).filter(w => !w.orientation || w.orientation !== det.orientation);
    const res = classifyDimension(det, { ...ctx, chain, walls });
    return { ...det, chainId: chain ? chain.id : null, ...res, classificationConfidence: res.confidence };
  });
}
