// NAC AI HVAC DESIGNER — PART 19: return air design.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { selectDiameter, velocity } from './ducts.mjs';

/**
 * Size the return air path from the total design supply airflow.
 * Supports a single return or several, and always shows the face velocities so
 * an undersized return is obvious before it becomes a noise complaint.
 */
export function designReturnAir({ totalAirflowLs, returnCount = 1, grilleSizesMm = null,
                                  filterSizeMm = null, ductLengthMm = null, diameterOverrideMm = null }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const R = settings.returnAir;

  const designLs = Number(totalAirflowLs) * R.designFraction;
  const perReturnLs = designLs / Math.max(1, returnCount);
  const warnings = [];

  if (perReturnLs > R.maxSingleReturnLs) {
    warnings.push({ code: 'RETURN_AIR_UNDERSIZED', severity: 'WARNING',
      message: round(perReturnLs, 0) + ' L/s through one return exceeds the ' + R.maxSingleReturnLs +
        ' L/s single-return limit — add a second return.' });
  }

  // Required FREE area (m²) to stay under the grille face velocity, then the
  // gross grille area allowing for the core's free-area ratio.
  const requiredFreeAreaM2 = (perReturnLs / 1000) / R.maxGrilleFaceVelocityMs;
  const requiredGrossAreaM2 = requiredFreeAreaM2 / R.grilleFreeAreaRatio;

  const returns = [];
  for (let i = 0; i < Math.max(1, returnCount); i++) {
    const override = grilleSizesMm && grilleSizesMm[i];
    const candidates = R.standardGrilleSizesMm.map(([w, h]) => ({
      widthMm: w, heightMm: h,
      grossAreaM2: (w / 1000) * (h / 1000),
      freeAreaM2: (w / 1000) * (h / 1000) * R.grilleFreeAreaRatio
    }));
    const chosen = override
      ? { widthMm: override[0], heightMm: override[1],
          grossAreaM2: (override[0] / 1000) * (override[1] / 1000),
          freeAreaM2: (override[0] / 1000) * (override[1] / 1000) * R.grilleFreeAreaRatio,
          manual: true }
      : (candidates.find(c => c.grossAreaM2 >= requiredGrossAreaM2) || candidates[candidates.length - 1]);

    const faceVelocity = chosen.freeAreaM2 > 0 ? (perReturnLs / 1000) / chosen.freeAreaM2 : Infinity;
    const rWarnings = [];
    if (faceVelocity > R.maxGrilleFaceVelocityMs) {
      rWarnings.push({ code: 'RETURN_VELOCITY_HIGH', severity: 'WARNING',
        message: 'Return ' + (i + 1) + ': ' + round(faceVelocity, 2) + ' m/s face velocity exceeds the ' +
          R.maxGrilleFaceVelocityMs + ' m/s limit — expect noise.' });
    }
    returns.push({
      index: i + 1,
      airflowLs: round(perReturnLs, 0),
      grilleWidthMm: chosen.widthMm,
      grilleHeightMm: chosen.heightMm,
      grilleSize: chosen.widthMm + ' × ' + chosen.heightMm + ' mm',
      freeAreaM2: round(chosen.freeAreaM2, 3),
      faceVelocityMs: round(faceVelocity, 2),
      manual: !!chosen.manual,
      warnings: rWarnings
    });
    warnings.push(...rWarnings);
  }

  // Filter — sized on the whole return airflow unless the estimator sets it.
  const filter = filterSizeMm
    ? { widthMm: filterSizeMm[0], heightMm: filterSizeMm[1], manual: true }
    : { widthMm: returns[0].grilleWidthMm, heightMm: returns[0].grilleHeightMm, manual: false };
  const filterAreaM2 = (filter.widthMm / 1000) * (filter.heightMm / 1000);
  const filterFaceVelocity = filterAreaM2 > 0 ? (perReturnLs / 1000) / filterAreaM2 : Infinity;
  if (filterFaceVelocity > R.maxFilterFaceVelocityMs) {
    warnings.push({ code: 'FILTER_FACE_VELOCITY_HIGH', severity: 'WARNING',
      message: 'Filter face velocity ' + round(filterFaceVelocity, 2) + ' m/s exceeds the ' +
        R.maxFilterFaceVelocityMs + ' m/s limit — filter will load quickly and add static pressure.' });
  }

  // Return duct back to the unit.
  const duct = diameterOverrideMm
    ? { diameterMm: diameterOverrideMm, velocityMs: round(velocity(diameterOverrideMm, perReturnLs), 2),
        reason: 'Diameter set manually by the estimator.', manual: true }
    : selectDiameter(perReturnLs, 'return', opts);
  if (duct.velocityMs > settings.duct.velocity.return.max) {
    warnings.push({ code: 'RESTRICTED_RETURN_PATH', severity: 'WARNING',
      message: 'Return duct velocity ' + duct.velocityMs + ' m/s exceeds the ' +
        settings.duct.velocity.return.max + ' m/s maximum — the return path is restricted.' });
  }

  return {
    designAirflowLs: round(designLs, 0),
    returnCount: Math.max(1, returnCount),
    perReturnLs: round(perReturnLs, 0),
    requiredFreeAreaM2: round(requiredFreeAreaM2, 3),
    requiredGrossAreaM2: round(requiredGrossAreaM2, 3),
    returns,
    filter: {
      widthMm: filter.widthMm, heightMm: filter.heightMm,
      size: filter.widthMm + ' × ' + filter.heightMm + ' mm',
      faceVelocityMs: round(filterFaceVelocity, 2),
      manual: filter.manual
    },
    duct: {
      diameterMm: duct.diameterMm,
      velocityMs: duct.velocityMs,
      lengthMm: ductLengthMm ?? null,
      lengthM: ductLengthMm ? round(ductLengthMm / 1000, 2) : null,
      reason: duct.reason
    },
    warnings
  };
}
