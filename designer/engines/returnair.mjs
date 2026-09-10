// NAC AI HVAC DESIGNER — PART 19: return air design.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { selectDiameter, velocity } from './ducts.mjs';
import { findUnitSpec } from './unit-specs.mjs';

/**
 * Size the return air path from the total design supply airflow.
 * Supports a single return or several, and always shows the face velocities so
 * an undersized return is obvious before it becomes a noise complaint.
 */
export function designReturnAir({ totalAirflowLs, returnCount = 1, grilleSizesMm = null,
                                  filterSizeMm = null, ductLengthMm = null, diameterOverrideMm = null,
                                  unit = null }, opts = {}) {
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

  // Return duct(s) back to the unit.
  //
  // NAC's standard is one 400 mm duct or two at 350/400 — 450 and 500 flex is
  // not installed, so anything a 400 cannot carry is run as a second duct
  // rather than sized up. That is how it goes in on site, and it keeps the
  // BOM honest about what is actually bought.
  // The fan coil's own return connection wins where the manufacturer states
  // one. A ducted unit has a fixed return spigot arrangement — one 400 or two
  // at 350/400 — and the duct runs to it. Calculating a diameter that the unit
  // has no connection for is not a design, it is a number.
  const spec = unit ? findUnitSpec(unit.brandId, unit.model || unit.code) : null;
  const spigots = spec?.returnSpigots || null;

  const duct = diameterOverrideMm
    ? { diameterMm: diameterOverrideMm, ductCount: 1,
        velocityMs: round(velocity(diameterOverrideMm, perReturnLs), 2),
        reason: 'Diameter set manually by the estimator.', manual: true }
    : spigots
      ? { diameterMm: spigots.diameterMm, ductCount: spigots.count,
          velocityMs: round(velocity(spigots.diameterMm, perReturnLs / spigots.count), 2),
          fromUnitSpec: true,
          reason: spec.model + ' has a ' + spigots.count + ' × ' + spigots.diameterMm +
            ' mm return connection (' + spec.returnFlangeText + '), so that is the return duct.' }
      : selectReturnDuct(perReturnLs, settings);

  if (duct.velocityMs > settings.duct.velocity.return.max) {
    warnings.push({ code: 'RESTRICTED_RETURN_PATH', severity: 'WARNING',
      message: 'Return duct velocity ' + duct.velocityMs + ' m/s exceeds the ' +
        settings.duct.velocity.return.max + ' m/s maximum — the return path is restricted.' });
  }
  // The unit's own connection is what it is; if the airflow through it is
  // above the band that is a note about the unit, not a sizing choice.
  if (duct.fromUnitSpec && duct.velocityMs > settings.duct.velocity.return.max) {
    warnings.push({ code: 'UNIT_RETURN_CONNECTION_TIGHT', severity: 'CHECK',
      message: 'At ' + round(perReturnLs, 0) + ' L/s the unit\'s own ' + duct.ductCount + ' × ' +
        duct.diameterMm + ' mm return connection runs at ' + duct.velocityMs + ' m/s. ' +
        'Split the return across more grilles, or accept the noise.' });
  }
  if (duct.exceedsStandard) {
    warnings.push({ code: 'RETURN_EXCEEDS_NAC_STANDARD', severity: 'WARNING',
      message: round(perReturnLs, 0) + ' L/s needs more return than ' + R.maxReturnDucts + ' × ' +
        Math.max(...R.returnDuctSizesMm) + ' mm can carry at ' + settings.duct.velocity.return.max +
        ' m/s. Add another return air point, or set the duct manually.' });
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
      // How many ducts of that diameter run back to the unit, side by side.
      ductCount: duct.ductCount ?? 1,
      description: (duct.ductCount ?? 1) > 1
        ? duct.ductCount + ' × ' + duct.diameterMm + ' mm' : duct.diameterMm + ' mm',
      velocityMs: duct.velocityMs,
      fromUnitSpec: !!duct.fromUnitSpec,
      unitModel: spec?.model || null,
      unitReturnFlangeText: spec?.returnFlangeText || null,
      lengthMm: ductLengthMm ?? null,
      // Length is per duct, so two ducts is twice the flex.
      lengthM: ductLengthMm ? round((ductLengthMm / 1000) * (duct.ductCount ?? 1), 2) : null,
      lengthPerDuctM: ductLengthMm ? round(ductLengthMm / 1000, 2) : null,
      reason: duct.reason
    },
    warnings
  };
}

/**
 * Pick the return duct arrangement for one return air point.
 *
 * NAC install one 400 mm duct or two at 350/400 — never a 450 or a 500. So the
 * search is over (count × diameter) combinations rather than a single diameter,
 * and it takes the first that sits inside the return velocity band, preferring
 * fewer ducts and then the smaller diameter.
 */
export function selectReturnDuct(airflowLs, settings = DEFAULT_SETTINGS) {
  const R = settings.returnAir;
  const band = settings.duct.velocity.return;
  const sizes = [...(R.returnDuctSizesMm || [400])].sort((a, b) => a - b);
  const maxCount = R.maxReturnDucts || 1;

  const options = [];
  for (let count = 1; count <= maxCount; count++) {
    for (const diameterMm of sizes) {
      options.push({ count, diameterMm, velocityMs: round(velocity(diameterMm, airflowLs / count), 2) });
    }
  }

  const within = options.filter(o => o.velocityMs <= band.preferred);
  const acceptable = options.filter(o => o.velocityMs <= band.max);
  const pick = within[0] || acceptable[0];

  if (pick) {
    return {
      diameterMm: pick.diameterMm,
      ductCount: pick.count,
      velocityMs: pick.velocityMs,
      exceedsStandard: false,
      reason: (pick.count > 1 ? pick.count + ' × ' : '') + pick.diameterMm + ' mm at ' +
        pick.velocityMs + ' m/s' + (within.length ? '' : ' (above the preferred ' + band.preferred +
        ' m/s but within the ' + band.max + ' m/s maximum)') + '. NAC standard return sizing.'
    };
  }

  // Nothing NAC carry can do it. Report the largest arrangement and say so
  // rather than quietly sizing to a duct that will never be installed.
  const largest = options[options.length - 1];
  return {
    diameterMm: largest.diameterMm,
    ductCount: largest.count,
    velocityMs: largest.velocityMs,
    exceedsStandard: true,
    reason: largest.count + ' × ' + largest.diameterMm + ' mm is the largest return NAC install, and it is ' +
      'still ' + largest.velocityMs + ' m/s. Another return air point is needed.'
  };
}
