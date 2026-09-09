// NAC AI HVAC DESIGNER — PART 2/3/4/7 glue: turn raw plan observations into
// classified dimensions, reconstructed chains and measured rooms.
//
// The AI plan reader (api/plan-read.js) only ever returns OBSERVATIONS: text it
// saw, where it saw it, and where it thinks walls, openings and room labels are.
// Every number that goes on to influence a load calculation is produced by the
// deterministic code below, from those observations.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { buildDetectedDimensions, classifyAll } from './dimensions.mjs';
import { groupChains, spanBetween } from './chains.mjs';
import { chainMeasurement, calibratedMeasurement, architecturalMeasurement,
         manualMeasurement, bestMeasurement, buildRoom } from './rooms.mjs';
import { round } from './units.mjs';

/**
 * Stage 1 — interpret the plan.
 * @returns { detectedDimensions, chains, chainsByAxis }
 */
export function interpretPlan({ rawDetections, walls = [], openings = [], overallWidthMm, overallDepthMm }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;

  const detections = buildDetectedDimensions(rawDetections, settings);
  const chains = groupChains(detections, { settings, rowTolerancePx: opts.rowTolerancePx });

  const classified = classifyAll(detections, {
    settings, chains, walls, openings,
    buildingExtentMm: overallWidthMm || overallDepthMm || null
  });

  // The primary chain on each axis is the longest multi-segment one that closes.
  const pick = (orientation) => {
    const onAxis = chains.filter(c => c.orientation === orientation && c.segments.length > 1);
    const closing = onAxis.filter(c => c.closure?.closes === true);
    return (closing.length ? closing : onAxis).sort((a, b) => b.totalMm - a.totalMm)[0] || null;
  };

  return {
    detectedDimensions: classified,
    chains,
    primaryHorizontalChain: pick('horizontal'),
    primaryVerticalChain: pick('vertical'),
    summary: {
      detectionCount: classified.length,
      lengthCount: classified.filter(d => d.mm !== null).length,
      annotationCount: classified.filter(d => d.classification === 'annotation').length,
      chainCount: chains.length,
      closingChains: chains.filter(c => c.closure?.closes === true).length,
      byClassification: classified.reduce((acc, d) => {
        acc[d.classification] = (acc[d.classification] || 0) + 1; return acc;
      }, {})
    }
  };
}

/**
 * Stage 2 — measure the rooms.
 *
 * A room definition may supply any of:
 *   { hStations: [i, j], vStations: [i, j] }   room bounded by chain stations
 *   { printedWidthMm, printedLengthMm }         a dimension printed on the room
 *   { boundaryPx: {x,y,w,h} }                   a boundary traced on the image
 *   { widthMm, lengthMm }                       typed by the estimator
 * The strongest available source wins (PART 30) and the rest are kept as
 * alternatives so the estimator can see the disagreement.
 */
export function measureRooms(roomDefs, { hChain, vChain, calibration, walls = [] }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;

  return (roomDefs || []).map(def => {
    const candidates = [];

    if (def.widthMm && def.lengthMm) {
      candidates.push(manualMeasurement(def.widthMm, def.lengthMm));
    }
    if (def.printedWidthMm && def.printedLengthMm) {
      candidates.push(architecturalMeasurement(def.printedWidthMm, def.printedLengthMm, def.printedText));
    }
    if (def.hStations && def.vStations && hChain && vChain) {
      const w = spanBetween(hChain, def.hStations[0], def.hStations[1]);
      const l = spanBetween(vChain, def.vStations[0], def.vStations[1]);
      if (w && l) {
        const wallGeometry = walls.length > 0;
        candidates.push(chainMeasurement({
          hChain, vChain,
          approxXMm: hChain.stations[def.hStations[0]],
          approxX2Mm: hChain.stations[def.hStations[1]],
          approxYMm: vChain.stations[def.vStations[0]],
          approxY2Mm: vChain.stations[def.vStations[1]],
          wallGeometryUsed: wallGeometry
        }));
      }
    }
    if (def.boundaryPx && calibration?.pixelsPerMm) {
      candidates.push(calibratedMeasurement({
        calibration, widthPx: def.boundaryPx.w, lengthPx: def.boundaryPx.h
      }));
    }

    const best = bestMeasurement(candidates, def.areaSqM ?? null);

    // Cross-check: if two independent sources disagree materially, say so.
    let crossCheck;
    if (best.alternatives?.length && best.areaSqM) {
      const alt = best.alternatives.find(a => a.areaSqM);
      if (alt) {
        crossCheck = { agreementPct: round(Math.abs(alt.areaSqM - best.areaSqM) / best.areaSqM * 100, 1),
                       against: alt.sourceLabel };
      }
    }

    return buildRoom({ ...def, measurement: best }, { settings, calibration, crossCheck, imageQuality: opts.imageQuality });
  });
}
