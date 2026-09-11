// NAC AI HVAC DESIGNER — PART 7, 8, 9 & 30: room geometry, measurement source,
// confidence scoring and verification status.
//
// PART 30 measurement priority (highest first):
//   1. verified_architectural      — a dimension printed against that room
//   2. dimension_chain             — reconstructed chain stations
//   3. chain_plus_wall_geometry    — chain stations + detected wall positions
//   4. calibrated_geometry         — pixels x the estimator's calibration
//   5. manual                      — typed by the estimator (always trusted)
// Nothing else is permitted. A room with no source is 'estimated' and is never
// allowed into sizing without an explicit override.

import { DEFAULT_SETTINGS, confidenceBand } from './settings.mjs';
import { areaM2, round, mmToM } from './units.mjs';
import { snapToStation } from './chains.mjs';
import { pxToMm } from './calibration.mjs';

export const MEASUREMENT_SOURCES = [
  'verified_architectural',
  'dimension_chain',
  'chain_plus_wall_geometry',
  'calibrated_geometry',
  'manual',
  'estimated'
];

export const SOURCE_LABELS = {
  verified_architectural: 'Verified architectural dimensions',
  dimension_chain: 'Dimension-chain reconstruction',
  chain_plus_wall_geometry: 'Dimension chain + wall geometry',
  calibrated_geometry: 'Calibrated drawing geometry',
  manual: 'Manual entry',
  estimated: 'Estimate — not measured'
};

export const SOURCE_PRIORITY = {
  verified_architectural: 1,
  dimension_chain: 2,
  chain_plus_wall_geometry: 3,
  calibrated_geometry: 4,
  manual: 0,      // an estimator's typed value always wins
  estimated: 9
};

// ── Room classification ──────────────────────────────────────────────────────
// These are NAC's existing rules, lifted out of the intake AI prompt so they are
// now deterministic code rather than instructions to a language model.

const UNCONDITIONED_PATTERNS = [
  /\bgarage\b/i, /\bcarport\b/i, /\bcar\s*port\b/i,
  /\blaundry\b/i, /\bl'?dry\b/i,
  /\bbath(room)?\b/i, /\bensuite\b/i, /\bens\b/i, /\bwc\b/i, /\btoilet\b/i, /\bpowder\b/i,
  /\bwir\b/i, /\bbir\b/i, /\bwalk[- ]?in[- ]?robe\b/i, /\brobe\b/i, /\bwardrobe\b/i,
  /\blinen\b/i, /\bpantry\b/i, /\bp'?try\b/i, /\bstore\b/i, /\bstorage\b/i,
  // Cupboards. Australian plans label them CUP'D, CUPB, CPD or CUPBOARD, and a
  // dimensioned one would otherwise be read in as conditioned floor area.
  /\bcup'?d\b/i, /\bcupb(oard)?\b/i, /\bcpd\b/i, /\bbroom\b/i, /\bcloak\b/i,
  /\balfresco\b/i, /\bpatio\b/i, /\bverandah?\b/i, /\bporch\b/i, /\bdeck\b/i,
  /\boutdoor\b/i, /\bbalcony\b/i, /\bcourtyard\b/i, /\bvoid\b/i, /\bportico\b/i
];

/** Areas a floor-area schedule lists separately from the residence. */
const OUTDOOR_PATTERNS = [
  /\balfresco\b/i, /\bpatio\b/i, /\bverandah?\b/i, /\bporch\b/i, /\bdeck\b/i,
  /\bbalcony\b/i, /\bcourtyard\b/i, /\bportico\b/i, /\bgarage\b/i, /\bcarport\b/i
];

const ROOM_TYPE_PATTERNS = [
  [/\bmaster\b|\bbed\s*\d?\b|\bbedroom\b|\bguest\b/i, 'bedroom'],
  [/\bkitchen\b|\bkitch\b/i, 'kitchen'],
  [/\bdining\b|\bmeals?\b/i, 'dining'],
  [/\bliving\b|\bfamily\b|\blounge\b|\brumpus\b/i, 'living'],
  [/\bmedia\b|\btheatre\b|\btheater\b|\bcinema\b/i, 'media'],
  [/\bstudy\b|\boffice\b/i, 'study'],
  [/\bhall\b|\bentry\b|\bfoyer\b|\bpassage\b|\bcorridor\b/i, 'hallway']
];

/**
 * Australian plans write these rooms as dotted initials as often as not —
 * "W.I.R.", "W.C.", "B.I.R.", "L'DRY". Collapsing the dots between single
 * letters lets one set of patterns match both spellings, instead of a walk-in
 * robe being conditioned on one plan and excluded on the next.
 */
export function normaliseRoomLabel(label) {
  return String(label || '')
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (m) => m.replace(/\./g, ''))   // W.I.R. -> WIR
    .replace(/\u2019/g, "'")
    .trim();
}

/** Is this room label a conditioned space under NAC's rules? */
export function isConditionedLabel(label) {
  const l = normaliseRoomLabel(label);
  if (!l) return false;
  for (const p of UNCONDITIONED_PATTERNS) if (p.test(l)) return false;
  return true;
}

export function roomTypeFromLabel(label) {
  const l = normaliseRoomLabel(label);
  for (const [p, t] of ROOM_TYPE_PATTERNS) if (p.test(l)) return t;
  return 'other';
}

// ── Measurement construction ─────────────────────────────────────────────────

function measurement(widthMm, lengthMm, source, evidence, extra = {}) {
  const num = (v) => {
    const n = round(Number(v), 1);
    return isFinite(n) && n > 0 ? n : null;
  };
  const w = num(widthMm);
  const l = num(lengthMm);
  // A room read off a plan often gives up one dimension and not the other —
  // the second string is creased, cropped or simply not printed. That must NOT
  // become a 0 m² room: zero area sails through every check and quietly takes
  // the whole room out of the load. It is recorded as incomplete instead, and
  // the room is blocked until the missing number is supplied.
  const incomplete = w === null || l === null;
  return {
    widthMm: w,
    lengthMm: l,
    areaSqM: incomplete ? null : round(areaM2(w, l), 3),
    source,
    sourceLabel: SOURCE_LABELS[source],
    evidence: incomplete
      ? [...(evidence || []),
         (w === null && l === null) ? 'Neither dimension is known.'
           : w === null ? 'Width is missing — only the length is known.'
           : 'Length is missing — only the width is known.']
      : (evidence || []),
    incomplete,
    missingDimension: w === null && l === null ? 'both' : w === null ? 'width' : l === null ? 'length' : null,
    ...extra
  };
}

/** PART 30 #5 — the estimator typed it. Always fully trusted. */
export function manualMeasurement(widthMm, lengthMm, note) {
  return measurement(widthMm, lengthMm, 'manual',
    [note || 'Entered by the estimator.'], { snapped: false });
}

/** Manual area with no width/length — e.g. an irregular room measured on site. */
export function manualAreaMeasurement(areaSqMValue, note) {
  return {
    widthMm: null, lengthMm: null,
    areaSqM: round(Number(areaSqMValue), 3),
    source: 'manual',
    sourceLabel: SOURCE_LABELS.manual,
    evidence: [note || 'Area entered directly by the estimator.'],
    areaOnly: true
  };
}

/** PART 30 #1 — a dimension string printed against the room, e.g. "3400 x 3050". */
export function architecturalMeasurement(widthMm, lengthMm, printedText) {
  return measurement(widthMm, lengthMm, 'verified_architectural',
    ['Dimension printed on the plan against this room' + (printedText ? ': "' + printedText + '"' : '.')]);
}

/**
 * PART 30 #2/#3 — derive a room's clear dimensions from reconstructed chain
 * stations. The room's approximate extents (mm along each axis) are snapped to
 * the nearest station; the span between the snapped stations is the dimension.
 */
export function chainMeasurement({ hChain, vChain, approxXMm, approxX2Mm, approxYMm, approxY2Mm,
                                   toleranceMm = 150, wallGeometryUsed = false }) {
  if (!hChain || !vChain) return null;
  const x1 = snapToStation(hChain, approxXMm, toleranceMm);
  const x2 = snapToStation(hChain, approxX2Mm, toleranceMm);
  const y1 = snapToStation(vChain, approxYMm, toleranceMm);
  const y2 = snapToStation(vChain, approxY2Mm, toleranceMm);

  const allSnapped = x1.snapped && x2.snapped && y1.snapped && y2.snapped;
  if (x1.index === x2.index || y1.index === y2.index) return null;

  const widthMm = Math.abs(x2.stationMm - x1.stationMm);
  const lengthMm = Math.abs(y2.stationMm - y1.stationMm);

  const evidence = [
    'Width from ' + hChain.orientation + ' chain ' + hChain.id +
      ' stations ' + round(x1.stationMm, 0) + ' → ' + round(x2.stationMm, 0) + ' mm.',
    'Length from ' + vChain.orientation + ' chain ' + vChain.id +
      ' stations ' + round(y1.stationMm, 0) + ' → ' + round(y2.stationMm, 0) + ' mm.'
  ];
  if (hChain.closure?.closes) evidence.push('Horizontal chain closes against the overall dimension.');
  if (vChain.closure?.closes) evidence.push('Vertical chain closes against the overall dimension.');
  if (!allSnapped) evidence.push('At least one room edge did not land on a chain station — snapped to the nearest.');

  return measurement(widthMm, lengthMm,
    wallGeometryUsed ? 'chain_plus_wall_geometry' : 'dimension_chain',
    evidence,
    {
      snapped: allSnapped,
      maxSnapDeltaMm: round(Math.max(x1.deltaMm ?? 0, x2.deltaMm ?? 0, y1.deltaMm ?? 0, y2.deltaMm ?? 0), 1),
      chainIds: [hChain.id, vChain.id],
      chainConfidence: Math.min(hChain.confidence ?? 0, vChain.confidence ?? 0)
    });
}

/** PART 30 #4 — pixel geometry converted through the estimator's calibration. */
export function calibratedMeasurement({ calibration, widthPx, lengthPx }) {
  if (!calibration?.pixelsPerMm) return null;
  const w = pxToMm(calibration, widthPx);
  const l = pxToMm(calibration, lengthPx);
  return measurement(w, l, 'calibrated_geometry', [
    'Measured from the plan image (' + round(widthPx, 0) + ' × ' + round(lengthPx, 0) + ' px) using the ' +
      round(calibration.pixelsPerMm, 5) + ' px/mm calibration.',
    'Image geometry only — not confirmed against a printed dimension.'
  ]);
}

/**
 * Choose the best available measurement for a room under the PART 30 priority
 * order. Candidates that are null are ignored. Never fabricates: if nothing is
 * available it returns an 'estimated' record flagged for the estimator.
 */
export function bestMeasurement(candidates, fallbackAreaSqM = null) {
  const list = (candidates || []).filter(Boolean);
  if (!list.length) {
    return {
      widthMm: null, lengthMm: null,
      areaSqM: fallbackAreaSqM !== null ? round(fallbackAreaSqM, 3) : null,
      source: 'estimated',
      sourceLabel: SOURCE_LABELS.estimated,
      evidence: ['No dimension, chain station or calibration was available for this room.'],
      needsEstimatorInput: true,
      // No measurement at all is the same failure as half of one: the room is
      // on the plan, it will be air conditioned, and it is counting as nothing.
      // A fallback area supplied by the estimator is a measurement, so only the
      // truly blank case is incomplete.
      incomplete: fallbackAreaSqM === null || fallbackAreaSqM === undefined,
      missingDimension: 'both'
    };
  }
  list.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  const chosen = list[0];
  const alternatives = list.slice(1).map(m => ({
    source: m.source, sourceLabel: m.sourceLabel,
    widthMm: m.widthMm, lengthMm: m.lengthMm, areaSqM: m.areaSqM
  }));
  return { ...chosen, alternatives };
}

/**
 * PART 8 — confidence score for a room measurement.
 * Starts from the configured base score for the source, then applies concrete,
 * explainable adjustments. Every adjustment is recorded so the estimator (and
 * the design assistant) can see exactly why a number is what it is.
 */
export function scoreMeasurement(m, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const base = settings.confidence.sourceScores[m.source] ?? 50;
  let score = base;
  const factors = [{ reason: SOURCE_LABELS[m.source], delta: 0, running: base }];

  // A measurement the estimator typed is the estimator's call. Sanity checks
  // still get recorded so they are visible on screen, but they must not
  // downgrade a number a person stood behind — that is the manual fallback
  // (PART 29) and it has to stay unconditional.
  const advisoryOnly = m.source === 'manual';
  const add = (delta, reason) => {
    const applied = advisoryOnly ? 0 : delta;
    score += applied;
    factors.push({
      reason: advisoryOnly && delta !== 0 ? reason + ' (noted — manual entry is not downgraded)' : reason,
      delta: applied,
      running: round(Math.max(0, Math.min(100, score)), 1)
    });
  };

  if (m.source === 'dimension_chain' || m.source === 'chain_plus_wall_geometry') {
    if (m.chainConfidence !== undefined && m.chainConfidence !== null) {
      const d = round((m.chainConfidence - 85) * 0.25, 1);
      if (d) add(d, 'Chain reconstruction confidence ' + round(m.chainConfidence, 0) + '%.');
    }
    if (m.snapped === false) add(-8, 'A room edge did not land cleanly on a chain station.');
    if (m.maxSnapDeltaMm > 100) add(-5, 'Largest edge snap was ' + round(m.maxSnapDeltaMm, 0) + ' mm.');
  }

  if (m.source === 'calibrated_geometry') {
    if (opts.calibration && opts.calibration.pixelDistance < 150) {
      add(-8, 'Calibration was taken over a short pixel distance (' + round(opts.calibration.pixelDistance, 0) + ' px).');
    }
    if (opts.imageQuality === 'low') add(-12, 'Uploaded image is low resolution or heavily compressed.');
  }

  if (opts.crossCheck) {
    const c = opts.crossCheck;
    if (c.agreementPct !== undefined) {
      if (c.agreementPct <= 2) add(6, 'Independent cross-check agrees within ' + round(c.agreementPct, 1) + '%.');
      else if (c.agreementPct >= 8) add(-15, 'Independent cross-check differs by ' + round(c.agreementPct, 1) + '%.');
    }
  }

  if (m.widthMm && m.lengthMm) {
    const ratio = Math.max(m.widthMm, m.lengthMm) / Math.min(m.widthMm, m.lengthMm);
    if (ratio > 4) add(-8, 'Unusually elongated room (aspect ratio ' + round(ratio, 1) + ':1) — check the boundary.');
    const P = settings.plan;
    if (m.widthMm < P.minRoomDimensionMm || m.lengthMm < P.minRoomDimensionMm) {
      add(-20, 'A dimension is below the configured minimum room size.');
    }
    if (m.widthMm > P.maxRoomDimensionMm || m.lengthMm > P.maxRoomDimensionMm) {
      add(-20, 'A dimension is above the configured maximum room size.');
    }
  }

  if (m.source === 'estimated') add(0, 'No measurement source — estimator input required.');

  // Half a room is not a measurement, whoever supplied it. This overrides even
  // a manual entry, because the estimator typing one dimension and moving on is
  // exactly the case that must not slip through.
  if (m.incomplete) {
    return {
      score: 0,
      band: 'LOW',
      factors: [...factors, { delta: 0, reason: m.missingDimension === 'both'
        ? 'No dimensions yet.' : 'Only one dimension is known — the ' + m.missingDimension + ' is missing.' }],
      requiresVerification: true,
      incomplete: true
    };
  }

  const finalScore = round(Math.max(0, Math.min(100, score)), 1);
  return {
    score: finalScore,
    band: confidenceBand(finalScore, settings),
    factors,
    requiresVerification: finalScore < settings.confidence.approvalThreshold
  };
}

/**
 * Build a DesignRoom from a detected/entered room plus its measurement.
 * Status starts as 'Review' unless the room was typed manually or scores HIGH.
 */
export function buildRoom(input, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const label = input.label || input.name || 'Room';
  const measurementRec = input.measurement;
  const conf = scoreMeasurement(measurementRec, { ...opts, settings });

  const conditioned = input.conditioned !== undefined
    ? !!input.conditioned
    : isConditionedLabel(label);

  let status = input.status;
  // An incomplete measurement always resets the status, even a status carried
  // over from a previous read — a room cannot stay Verified once a dimension
  // it was verified on has gone.
  if (measurementRec?.incomplete) status = 'Needs a dimension';
  if (!status) {
    if (!conditioned) status = 'Excluded';
    else if (measurementRec.source === 'manual') status = 'Manual';
    else if (conf.band === 'HIGH') status = 'Review';   // still needs a human tick
    else status = 'Review';
  }

  return {
    id: input.id || ('room_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_')),
    label,
    roomType: input.roomType || roomTypeFromLabel(label),
    conditioned,
    openPlanGroup: input.openPlanGroup || null,
    ceilingHeightMm: input.ceilingHeightMm ?? settings.load.defaultCeilingHeightMm,
    measurement: measurementRec,
    widthMm: measurementRec.widthMm,
    lengthMm: measurementRec.lengthMm,
    areaSqM: measurementRec.areaSqM,
    confidence: conf.score,
    confidenceBand: conf.band,
    confidenceFactors: conf.factors,
    requiresVerification: conf.requiresVerification,
    status,                     // Verified | Review | Manual | Excluded
    verifiedBy: null,
    verifiedAt: null,
    overrides: [],
    // Load inputs — filled in on the Sizing tab, all optional.
    externalWalls: input.externalWalls ?? null,
    glazingAreaSqM: input.glazingAreaSqM ?? null,
    orientation: input.orientation || 'unknown',
    shading: input.shading || 'unknown',
    insulation: input.insulation || null,
    wallConstruction: input.wallConstruction || null,
    glazingType: input.glazingType || null,
    occupancy: input.occupancy ?? null,
    boundaryPx: input.boundaryPx || null,
    labelPx: input.labelPx || null,
    notes: input.notes || ''
  };
}

/** Apply an estimator edit, recording the override for the audit trail. */
export function applyRoomOverride(room, patch, who = 'estimator') {
  const changes = [];
  const next = { ...room };
  for (const [k, v] of Object.entries(patch)) {
    if (next[k] === v) continue;
    changes.push({ field: k, from: next[k], to: v, by: who, at: new Date().toISOString() });
    next[k] = v;
  }
  if (patch.widthMm !== undefined || patch.lengthMm !== undefined) {
    const w = patch.widthMm ?? room.widthMm;
    const l = patch.lengthMm ?? room.lengthMm;
    if (w && l) {
      next.areaSqM = round(areaM2(w, l), 3);
      next.measurement = manualMeasurement(w, l, 'Dimension edited by the estimator on the room verification screen.');
      next.confidence = 100;
      next.confidenceBand = 'HIGH';
      next.requiresVerification = false;
      next.status = next.conditioned ? 'Manual' : 'Excluded';
    }
  }
  if (patch.areaSqM !== undefined && patch.widthMm === undefined && patch.lengthMm === undefined) {
    next.measurement = manualAreaMeasurement(patch.areaSqM, 'Area entered directly by the estimator.');
    next.confidence = 100;
    next.confidenceBand = 'HIGH';
    next.requiresVerification = false;
    next.status = next.conditioned ? 'Manual' : 'Excluded';
  }
  next.overrides = [...(room.overrides || []), ...changes];
  return next;
}

export function verifyRoom(room, who = 'estimator') {
  return { ...room, status: room.conditioned ? 'Verified' : 'Excluded',
           verifiedBy: who, verifiedAt: new Date().toISOString(), requiresVerification: false };
}

/**
 * PART 9 — rooms that are allowed into the sizing engine.
 * Only Verified/Manual conditioned rooms qualify, unless the estimator has
 * explicitly overridden a low-confidence room.
 */
export function sizableRooms(rooms, { allowOverride = false } = {}) {
  return (rooms || []).filter(r =>
    r.conditioned &&
    !r.measurement?.incomplete &&
    r.areaSqM > 0 &&
    (r.status === 'Verified' || r.status === 'Manual' || (allowOverride && r.overrideApproved)));
}

export function blockedRooms(rooms) {
  return (rooms || []).filter(r =>
    r.conditioned &&
    (r.measurement?.incomplete ||
     (r.status !== 'Verified' && r.status !== 'Manual' && !r.overrideApproved)));
}

/**
 * Conditioned rooms the tool has only half a measurement for. These are the
 * ones worth naming out loud: the room is on the plan, it will be air
 * conditioned, and its area is currently counting as nothing.
 */
export function incompleteRooms(rooms) {
  return (rooms || []).filter(r => r.conditioned && r.measurement?.incomplete)
    .map(r => ({ id: r.id, label: r.label,
                 missing: r.measurement.missingDimension,
                 knownMm: r.measurement.widthMm ?? r.measurement.lengthMm ?? null }));
}

export function totalConditionedArea(rooms) {
  return round(sizableRooms(rooms).reduce((s, r) => s + (r.areaSqM || 0), 0), 2);
}

/** Room verification table rows (PART 9). */
export function verificationTable(rooms) {
  return (rooms || []).map(r => ({
    id: r.id,
    room: r.label,
    width: r.widthMm !== null && r.widthMm !== undefined ? round(mmToM(r.widthMm), 2) : null,
    length: r.lengthMm !== null && r.lengthMm !== undefined ? round(mmToM(r.lengthMm), 2) : null,
    area: r.areaSqM,
    ceilingHeight: round(mmToM(r.ceilingHeightMm), 2),
    source: r.measurement?.sourceLabel || SOURCE_LABELS.estimated,
    confidence: r.confidence,
    confidenceBand: r.confidenceBand,
    status: r.status
  }));
}

/**
 * Cross-check the room schedule against the floor area printed on the sheet.
 *
 * Almost every Australian plan prints one — "FLOOR AREA / RESIDENCE 139.0 m2".
 * Room areas that add to MORE than that mean two rooms are claiming the same
 * floor, which is what happens when an open-plan space is measured as separate
 * rectangles: the Lounge rectangle already contains the Dining and Family
 * labels sitting inside it. That over-sizes the system and nothing else in the
 * chain would notice, because each rectangle is individually plausible.
 *
 * The two numbers are not measured the same way, and that sets the tolerances.
 * A floor-area schedule measures to the OUTSIDE of the external walls; room
 * dimensions are internal faces. So summed rooms should land somewhat UNDER the
 * printed area — the external walls and every internal wall are missing from
 * the sum. Summed rooms coming out ABOVE the printed area is therefore not
 * within tolerance at all: it means the same floor has been counted twice.
 *
 * @param {Array}  rooms
 * @param {number} printedResidenceSqM  the sheet's own under-roof residence area
 */
export function crossCheckFloorArea(rooms, printedResidenceSqM, opts = {}) {
  const printed = Number(printedResidenceSqM);
  if (!isFinite(printed) || printed <= 0) return null;
  // Only enough headroom to absorb rounding and a room measured to the outside
  // of a wall by mistake — not enough to hide a double-counted room.
  const overPct = opts.overTolerancePct ?? 2;
  // Walls typically account for 6-12% of the under-roof area, so a sum well
  // below that is a room that never made it onto the schedule.
  const underPct = opts.underTolerancePct ?? 20;

  // Everything under the roof, conditioned or not — that is what the schedule
  // measures. Outdoor areas are listed separately on the sheet.
  const indoor = (rooms || []).filter(r => !OUTDOOR_PATTERNS.some(p => p.test(normaliseRoomLabel(r.label))));
  const summed = round(indoor.reduce((s, r) => s + (r.areaSqM || 0), 0), 2);
  const deltaSqM = round(summed - printed, 2);
  const deltaPct = round((deltaSqM / printed) * 100, 1);

  const warnings = [];
  if (deltaPct > overPct) {
    warnings.push({ code: 'ROOM_AREAS_EXCEED_PRINTED_FLOOR_AREA', severity: 'WARNING',
      message: 'The rooms add to ' + summed + ' m2 but the sheet prints ' + printed + ' m2 under roof — ' +
        deltaSqM + ' m2 (' + deltaPct + '%) too much. Two rooms are claiming the same floor. ' +
        'This is usually an open-plan area measured as separate rectangles: check whether the ' +
        'living, dining and family boxes overlap.' });
  } else if (deltaPct < -underPct) {
    warnings.push({ code: 'ROOMS_MISSING_AGAINST_PRINTED_FLOOR_AREA', severity: 'CHECK',
      message: 'The rooms add to ' + summed + ' m2 but the sheet prints ' + printed + ' m2 under roof — ' +
        Math.abs(deltaSqM) + ' m2 (' + Math.abs(deltaPct) + '%) short. A room is probably missing ' +
        'from the schedule, or one is only half measured.' });
  }
  return { printedSqM: round(printed, 2), summedSqM: summed, deltaSqM, deltaPct,
           agrees: deltaPct <= overPct && deltaPct >= -underPct, warnings };
}

/** Parse a printed floor-area schedule row, e.g. "139.0 m2" -> 139. */
export function parseFloorAreaText(text) {
  const m = String(text || '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return isFinite(n) && n > 0 ? n : null;
}
