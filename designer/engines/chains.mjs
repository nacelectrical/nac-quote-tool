// NAC AI HVAC DESIGNER — PART 4: dimension chain reconstruction.
//
// A chained dimension row such as
//     350 | 2050 | 220 | 3400 | 90 | 2720 | 90 | 3150
// is a sequence of distances along one axis. Reconstructing it gives absolute
// coordinate STATIONS along that axis:
//     0, 350, 2400, 2620, 6020, 6110, 8830, 8920, 12070
// Those stations are the true architectural positions of the walls and
// openings, independent of any image scale — which is why they outrank
// calibrated pixel geometry in the measurement priority order (PART 30).

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';

let _seq = 0;
const nextId = (p) => p + '_' + (++_seq);
export function _resetChainIds() { _seq = 0; }

/**
 * Reconstruct cumulative stations from an ordered list of segment lengths (mm).
 * Pure arithmetic — no detection, no guessing.
 */
export function reconstructChain(segmentsMm, { startMm = 0 } = {}) {
  const segs = (segmentsMm || []).map(Number).filter(v => isFinite(v) && v > 0);
  const stations = [round(startMm, 2)];
  let acc = startMm;
  for (const s of segs) {
    acc += s;
    stations.push(round(acc, 2));
  }
  return { segments: segs, stations, totalMm: round(acc - startMm, 2) };
}

/**
 * Check a reconstructed chain against a stated overall dimension.
 * Returns { closes, errorMm, overallMm, sumMm }.
 */
export function checkClosure(sumMm, overallMm, settings = DEFAULT_SETTINGS) {
  if (!isFinite(overallMm) || overallMm <= 0) {
    return { closes: null, errorMm: null, overallMm: null, sumMm: round(sumMm, 1),
             note: 'No overall dimension available to check this chain against.' };
  }
  const err = sumMm - overallMm;
  const closes = Math.abs(err) <= settings.plan.chainClosureToleranceMm;
  return {
    closes,
    errorMm: round(err, 1),
    overallMm: round(overallMm, 1),
    sumMm: round(sumMm, 1),
    toleranceMm: settings.plan.chainClosureToleranceMm,
    note: closes
      ? 'Chain sum matches the stated overall dimension.'
      : 'Chain sum differs from the stated overall dimension by ' + round(err, 0) + ' mm — verify before use.'
  };
}

/**
 * Group DetectedDimension records into DimensionChain records.
 *
 * Detections are grouped when they
 *   (a) share an orientation,
 *   (b) sit on the same dimension row (same perpendicular coordinate, within
 *       rowTolerancePx), and
 *   (c) are adjacent along the axis without an implausible gap.
 *
 * @param {Array} detections  DetectedDimension[] with .box, .orientation, .mm
 */
export function groupChains(detections, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const rowTolerancePx = opts.rowTolerancePx ?? 18;
  const maxGapPx = opts.maxGapPx ?? Infinity;
  const usable = (detections || []).filter(d => d.mm !== null && d.mm >= settings.plan.minChainSegmentMm);

  const chains = [];
  for (const orientation of ['horizontal', 'vertical']) {
    const group = usable.filter(d => d.orientation === orientation);
    if (!group.length) continue;

    // Perpendicular axis defines the row; the along-axis defines the order.
    const perp = orientation === 'horizontal' ? (d) => d.box.y + d.box.h / 2 : (d) => d.box.x + d.box.w / 2;
    const along = orientation === 'horizontal' ? (d) => d.box.x + d.box.w / 2 : (d) => d.box.y + d.box.h / 2;

    // Bucket into rows. An explicit `row` on the detection wins over geometry,
    // which lets the estimator (or a plan with no reliable boxes) state the row.
    const rows = new Map();
    const sorted = [...group].sort((a, b) => perp(a) - perp(b));
    for (const d of sorted) {
      if (d.row !== null && d.row !== undefined) {
        const key = 'r' + d.row;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(d);
        continue;
      }
      let placed = false;
      for (const [key, members] of rows) {
        if (key.startsWith('r')) continue;
        const mean = members.reduce((s, m) => s + perp(m), 0) / members.length;
        if (Math.abs(perp(d) - mean) <= rowTolerancePx) { members.push(d); placed = true; break; }
      }
      if (!placed) rows.set('g' + rows.size, [d]);
    }

    for (const [, members] of rows) {
      const ordered = [...members].sort((a, b) => along(a) - along(b));
      // Split on implausible gaps along the axis.
      const runs = [[ordered[0]]];
      for (let i = 1; i < ordered.length; i++) {
        const gap = along(ordered[i]) - along(ordered[i - 1]);
        if (gap > maxGapPx) runs.push([ordered[i]]);
        else runs[runs.length - 1].push(ordered[i]);
      }
      for (const run of runs) {
        const rec = reconstructChain(run.map(d => d.mm));
        chains.push({
          id: nextId('chain'),
          orientation,
          memberIds: run.map(d => d.id),
          segments: rec.segments,
          stations: rec.stations,
          totalMm: rec.totalMm,
          overallId: null,
          closure: null,
          confidence: 0,
          source: 'plan_detection'
        });
      }
    }
  }

  return resolveOveralls(chains, settings);
}

/**
 * For each axis, identify single-member "overall" chains and use them to check
 * closure of the multi-segment chains on the same axis.
 */
export function resolveOveralls(chains, settings = DEFAULT_SETTINGS) {
  for (const orientation of ['horizontal', 'vertical']) {
    const onAxis = chains.filter(c => c.orientation === orientation);
    const multi = onAxis.filter(c => c.segments.length > 1);
    const singles = onAxis.filter(c => c.segments.length === 1);
    if (!multi.length) continue;

    // The overall is the largest single value on the axis that is close to a
    // multi-segment chain's total, OR simply the largest single value.
    let overall = null;
    for (const s of singles) {
      const v = s.totalMm;
      for (const m of multi) {
        if (Math.abs(v - m.totalMm) <= settings.plan.chainClosureToleranceMm) {
          if (!overall || v > overall.value) overall = { value: v, chain: s };
        }
      }
    }
    if (!overall) {
      const largest = singles.sort((a, b) => b.totalMm - a.totalMm)[0];
      const longest = multi.sort((a, b) => b.totalMm - a.totalMm)[0];
      if (largest && longest && largest.totalMm >= longest.totalMm * 0.9) {
        overall = { value: largest.totalMm, chain: largest };
      }
    }

    for (const m of multi) {
      // Only a row that actually spans the building can be closed against the
      // overall dimension. A short row (window and door widths, an internal
      // wing, a partial setting-out string) is NOT a failed chain — it simply
      // has nothing to close against, and must not raise a false alarm.
      const spansBuilding = overall && m.totalMm >= overall.value * 0.5;
      if (spansBuilding) {
        m.closure = checkClosure(m.totalMm, overall.value, settings);
        m.overallId = overall.chain.memberIds[0];
        overall.chain.isOverall = true;
      } else {
        m.closure = {
          closes: null, errorMm: null, overallMm: overall ? overall.value : null,
          sumMm: round(m.totalMm, 1),
          partial: true,
          note: overall
            ? 'Partial dimension row — it spans ' + round(m.totalMm, 0) + ' mm of the ' +
              round(overall.value, 0) + ' mm overall, so it cannot be closed against it.'
            : 'No overall dimension on this axis to close this chain against.'
        };
      }
      m.confidence = chainConfidence(m, settings);
    }
    for (const s of singles) {
      s.closure = { closes: null, errorMm: null, overallMm: null, sumMm: s.totalMm,
                    note: s.isOverall ? 'Stated overall dimension for this axis.' : 'Single dimension — no chain to close.' };
      s.confidence = s.isOverall ? 95 : 60;
    }
  }
  return chains;
}

/** Confidence in a reconstructed chain, 0-100. */
export function chainConfidence(chain, settings = DEFAULT_SETTINGS) {
  let score = 70;
  if (chain.segments.length >= 3) score += 6;
  if (chain.closure) {
    if (chain.closure.closes === true) {
      score += 22;
      // Perfect closure is worth a little more than a barely-in-tolerance one.
      if (Math.abs(chain.closure.errorMm) <= 5) score += 4;
    } else if (chain.closure.closes === false) {
      score -= 30;
    } else if (chain.closure.partial) {
      score -= 12; // a partial row is usable but unconfirmed
    } else {
      score -= 6;  // nothing to check against
    }
  }
  // A chain containing plausible wall thicknesses reads like a real architectural
  // chain rather than a row of unrelated numbers.
  const hasWallish = chain.segments.some(v => v <= 320 && settings.plan.wallThicknessesMm
    .some(t => Math.abs(v - t) <= settings.plan.wallThicknessToleranceMm));
  if (hasWallish) score += 6;
  return Math.max(5, Math.min(99, score));
}

/**
 * Snap a coordinate (mm along an axis) to the nearest chain station.
 * Returns { stationMm, deltaMm, index, snapped } — `snapped` is false when the
 * nearest station is further away than the tolerance, in which case the caller
 * must keep the original value and lower its confidence.
 */
export function snapToStation(chain, valueMm, toleranceMm = 120) {
  if (!chain || !chain.stations || !chain.stations.length) {
    return { stationMm: valueMm, deltaMm: null, index: -1, snapped: false };
  }
  let best = { stationMm: chain.stations[0], deltaMm: Math.abs(valueMm - chain.stations[0]), index: 0 };
  chain.stations.forEach((s, i) => {
    const d = Math.abs(valueMm - s);
    if (d < best.deltaMm) best = { stationMm: s, deltaMm: d, index: i };
  });
  return { ...best, snapped: best.deltaMm <= toleranceMm };
}

/**
 * Derive the clear spans (bays) between consecutive stations, dropping spans
 * that are only a wall thickness wide. These bays are the candidate room
 * dimensions along the axis.
 */
export function bays(chain, settings = DEFAULT_SETTINGS) {
  if (!chain || !chain.stations) return [];
  const out = [];
  for (let i = 1; i < chain.stations.length; i++) {
    const startMm = chain.stations[i - 1];
    const endMm = chain.stations[i];
    const widthMm = round(endMm - startMm, 1);
    const isWall = widthMm <= 320 && settings.plan.wallThicknessesMm
      .some(t => Math.abs(widthMm - t) <= settings.plan.wallThicknessToleranceMm);
    out.push({
      index: i - 1, startMm, endMm, widthMm, isWall,
      usableAsRoomDimension: !isWall && widthMm >= settings.plan.minRoomDimensionMm
    });
  }
  return out;
}

/**
 * Span between two stations, chosen by index — used when a room's boundary is
 * known to run from one wall face to another.
 */
export function spanBetween(chain, fromIndex, toIndex) {
  if (!chain?.stations) return null;
  const a = chain.stations[fromIndex], b = chain.stations[toIndex];
  if (a === undefined || b === undefined) return null;
  return round(Math.abs(b - a), 1);
}
