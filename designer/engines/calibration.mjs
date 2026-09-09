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
