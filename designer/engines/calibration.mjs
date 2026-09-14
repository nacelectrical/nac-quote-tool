// NAC AI HVAC DESIGNER — PART 5 & 6: drawing scale + manual calibration.
//
// An uploaded screenshot or re-compressed image does NOT retain the original
// A3/A4 physical scale, so a printed "SCALE 1:100 @ A3" label is treated as
// SUPPORTING INFORMATION ONLY. The authoritative scale is the estimator's
// two-point calibration.

import { toMm, round, mmToM } from './units.mjs';

/** Parse scale labels such as "SCALE 1:100 @ A3", "1:100", "Scale 1 : 200". */
export function parseScaleLabel(text) {
  if (!text) return null;
  const m = String(text).match(/(?:scale\s*)?\b1\s*[:/]\s*(\d{1,5})\b/i);
  if (!m) return null;
  const denominator = parseInt(m[1], 10);
  if (!denominator || denominator < 5 || denominator > 5000) return null;
  const sheet = (String(text).match(/\b(A0|A1|A2|A3|A4)\b/i) || [])[1];
  return {
    ratio: denominator,
    label: '1:' + denominator + (sheet ? ' @ ' + sheet.toUpperCase() : ''),
    sheet: sheet ? sheet.toUpperCase() : null,
    // Never authoritative on its own.
    trusted: false,
    note: 'Printed scale label. Not reliable on an uploaded screenshot — calibrate to confirm.'
  };
}

export function pixelDistance(a, b) {
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a PlanCalibration from two clicked points and the real-world distance
 * printed on the drawing between them.
 *
 * @returns {{pixelsPerMm:number, mmPerPixel:number, ...}} or {error}
 */
export function calibrate({ pointA, pointB, knownDistance, unit = 'mm', imageWidthPx, imageHeightPx, scaleLabel }) {
  if (!pointA || !pointB) return { error: 'Two calibration points are required.' };
  const px = pixelDistance(pointA, pointB);
  if (!(px > 0)) return { error: 'Calibration points must be at different locations.' };

  const distanceMm = toMm(knownDistance, unit);
  if (distanceMm === null || !(distanceMm > 0)) {
    return { error: 'Enter the real distance shown on the drawing (greater than zero).' };
  }

  const pixelsPerMm = px / distanceMm;
  return {
    pointA: { x: Number(pointA.x), y: Number(pointA.y) },
    pointB: { x: Number(pointB.x), y: Number(pointB.y) },
    knownDistance: Number(knownDistance),
    unit,
    calibrationDistanceMm: round(distanceMm, 2),
    pixelDistance: round(px, 2),
    pixelsPerMm,
    mmPerPixel: 1 / pixelsPerMm,
    // Handy display forms.
    display: {
      calibrationDistance: round(distanceMm, 1) + ' mm (' + round(mmToM(distanceMm), 3) + ' m)',
      pixelDistance: round(px, 1) + ' px',
      calculatedScale: round(pixelsPerMm, 5) + ' px/mm  ·  ' + round(1 / pixelsPerMm, 4) + ' mm/px'
    },
    imageWidthPx: imageWidthPx ?? null,
    imageHeightPx: imageHeightPx ?? null,
    scaleLabel: scaleLabel ? parseScaleLabel(scaleLabel) : null,
    calibratedAt: new Date().toISOString()
  };
}

export function pxToMm(calibration, px) {
  if (!calibration || !calibration.pixelsPerMm) return null;
  return Number(px) / calibration.pixelsPerMm;
}

export function mmToPx(calibration, mm) {
  if (!calibration || !calibration.pixelsPerMm) return null;
  return Number(mm) * calibration.pixelsPerMm;
}

/** Real-world length in mm of a polyline given in image pixels. */
export function polylineLengthMm(calibration, points) {
  if (!calibration || !Array.isArray(points) || points.length < 2) return null;
  let px = 0;
  for (let i = 1; i < points.length; i++) px += pixelDistance(points[i - 1], points[i]);
  return pxToMm(calibration, px);
}

/**
 * Cross-check a calibration against a printed scale label, if the physical
 * sheet size is also known. Returns an advisory only — never changes the scale.
 */
export function crossCheckScaleLabel(calibration, scaleLabelText, assumedSheetDpi) {
  const label = parseScaleLabel(scaleLabelText);
  if (!label || !assumedSheetDpi || !calibration?.pixelsPerMm) return null;
  // At 1:N, one real mm is 1/N sheet mm; one sheet mm is dpi/25.4 pixels.
  const impliedPxPerMm = (assumedSheetDpi / 25.4) / label.ratio;
  const deviation = Math.abs(impliedPxPerMm - calibration.pixelsPerMm) / calibration.pixelsPerMm;
  return {
    label: label.label,
    impliedPixelsPerMm: impliedPxPerMm,
    actualPixelsPerMm: calibration.pixelsPerMm,
    deviationPct: round(deviation * 100, 1),
    agrees: deviation <= 0.10,
    note: 'Advisory only — the manual calibration always wins.'
  };
}

// ── Is calibration actually required? ────────────────────────────────────────
// RULE 4. Calibration is a means to an end, not a ritual. It exists so that
// lengths can be taken off the image. If every conditioned room already carries
// the architect's own printed dimensions, there is nothing left for it to
// measure and demanding it is pure friction — and demanding it because a
// BATHROOM has no readable size is worse than friction, it is wrong.
//
// Note the two separate questions, because they have different answers:
//
//   ROOM AREAS  — satisfied by printed dimensions or a dimension chain alone.
//   DUCT LENGTHS — measured off the drawing, so they DO need a scale.
//
// The second is why a scale is still derived below rather than skipped.

/** Measurement sources that stand on their own without a scale. */
const SOURCES_WITHOUT_SCALE = new Set(['verified_architectural', 'dimension_chain', 'manual']);

/**
 * Does this design need the estimator to calibrate the plan by hand?
 *
 * @returns {{required: boolean, reason: string, roomsNeedingScale: Array,
 *            statusLabel: string}}
 */
export function calibrationRequirement(rooms, { calibration = null } = {}) {
  const conditioned = (rooms || []).filter(r => r.conditioned);
  if (calibration?.pixelsPerMm) {
    return { required: false, roomsNeedingScale: [],
             statusLabel: 'CALIBRATED',
             reason: 'The plan is calibrated at ' + round(calibration.pixelsPerMm, 5) + ' px/mm.' };
  }
  if (!conditioned.length) {
    return { required: false, roomsNeedingScale: [], statusLabel: 'NO CONDITIONED ROOMS YET',
             reason: 'No conditioned room has been detected yet.' };
  }
  // Only conditioned rooms are assessed. An excluded room with no readable
  // size is not a reason to calibrate anything.
  const needScale = conditioned.filter(r =>
    r.measurement?.incomplete || !SOURCES_WITHOUT_SCALE.has(r.measurement?.source));

  if (!needScale.length) {
    return {
      required: false, roomsNeedingScale: [], statusLabel: 'CALIBRATION NOT REQUIRED',
      reason: 'All ' + conditioned.length + ' conditioned rooms carry their own printed or ' +
              'chain dimensions, so no measurement is being taken off the image.'
    };
  }
  return {
    required: true, roomsNeedingScale: needScale.map(r => ({ id: r.id, label: r.label })),
    statusLabel: 'CALIBRATION REQUIRED',
    reason: needScale.length + ' conditioned room' + (needScale.length > 1 ? 's have' : ' has') +
            ' no printed dimensions and must be measured off the image: ' +
            needScale.map(r => r.label).join(', ') + '.'
  };
}

/**
 * Work the scale out from the rooms themselves.
 *
 * A room that carries BOTH the architect's printed size AND a boundary drawn
 * on the image states the scale directly: so many pixels across, so many
 * millimetres across. Every such room is one reading; the median is taken and
 * the spread between readings is reported, because readings that disagree mean
 * a boundary is wrong and the estimator needs to know rather than be handed a
 * confident average.
 *
 * This is derived from the plan's own figures — nothing is invented, and the
 * evidence for every reading is returned with it. It exists so that DUCT
 * LENGTHS can be measured on a plan whose rooms are already fully dimensioned,
 * without making the estimator click two points for a scale the drawing has
 * already told us.
 */
export function deriveCalibrationFromRooms(rooms, { imageWidthPx = null, imageHeightPx = null,
                                                    maxSpreadPct = 12 } = {}) {
  const readings = [];
  for (const r of rooms || []) {
    const b = r.boundaryPx;
    const m = r.measurement;
    if (!b || !m || m.incomplete) continue;
    if (!SOURCES_WITHOUT_SCALE.has(m.source)) continue;   // else it is circular
    const w = Number(b.w), h = Number(b.h);
    if (!(w > 0) || !(h > 0)) continue;
    // The drawn box and the printed pair are the same rectangle, but which way
    // round is not guaranteed, so take the orientation that agrees with itself.
    const direct = [w / m.widthMm, h / m.lengthMm];
    const swapped = [w / m.lengthMm, h / m.widthMm];
    const spread = (p) => Math.abs(p[0] - p[1]) / ((p[0] + p[1]) / 2);
    const pair = spread(direct) <= spread(swapped) ? direct : swapped;
    const pxPerMm = (pair[0] + pair[1]) / 2;
    if (!(pxPerMm > 0) || !isFinite(pxPerMm)) continue;
    readings.push({ roomId: r.id, label: r.label, pixelsPerMm: pxPerMm,
                    evidence: r.label + ': ' + round(w, 0) + ' x ' + round(h, 0) + ' px drawn against ' +
                              m.widthMm + ' x ' + m.lengthMm + ' mm printed' });
  }

  if (readings.length < 2) {
    return { ok: false, readings,
             reason: readings.length
               ? 'Only one room has both a printed size and a drawn boundary — not enough to ' +
                 'confirm a scale against a second reading.'
               : 'No room has both a printed size and a drawn boundary on the image.' };
  }

  const sorted = readings.map(r => r.pixelsPerMm).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const pixelsPerMm = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const spreadPct = ((sorted[sorted.length - 1] - sorted[0]) / pixelsPerMm) * 100;

  if (spreadPct > maxSpreadPct) {
    return {
      ok: false, readings, pixelsPerMm, spreadPct: round(spreadPct, 1),
      reason: 'The rooms disagree about the scale by ' + round(spreadPct, 1) + '% (' +
              round(sorted[0], 5) + ' to ' + round(sorted[sorted.length - 1], 5) + ' px/mm). ' +
              'One of the drawn boundaries does not match its printed size — calibrate by hand.'
    };
  }

  return {
    ok: true,
    readings,
    spreadPct: round(spreadPct, 1),
    calibration: {
      pointA: null, pointB: null,
      knownDistance: null, unit: 'mm',
      calibrationDistanceMm: null,
      pixelDistance: null,
      pixelsPerMm,
      mmPerPixel: 1 / pixelsPerMm,
      source: 'derived_from_dimensioned_rooms',
      derivedFrom: readings.map(r => r.evidence),
      agreementSpreadPct: round(spreadPct, 1),
      display: {
        calibrationDistance: 'Derived from ' + readings.length + ' dimensioned rooms',
        pixelDistance: readings.length + ' readings, ' + round(spreadPct, 1) + '% spread',
        calculatedScale: round(pixelsPerMm, 5) + ' px/mm  ·  ' + round(1 / pixelsPerMm, 4) + ' mm/px'
      },
      imageWidthPx, imageHeightPx,
      scaleLabel: null,
      calibratedAt: new Date().toISOString()
    }
  };
}
