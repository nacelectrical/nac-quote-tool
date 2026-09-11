// NAC AI HVAC DESIGNER — PART 21: static pressure estimate.
//
// This is a DESIGN ESTIMATE. It is labelled as such everywhere it appears and
// it never replaces commissioning measurement.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { indexRun } from './ducts.mjs';

/** Shown wherever a static result would otherwise be read as a pass. */
export const STATIC_NOT_COMPLETED = 'STATIC PRESSURE CHECK NOT COMPLETED — MANUFACTURER DATA REQUIRED';

export const PRESSURE_DISCLAIMER =
  'DESIGN ESTIMATE — COMMISSIONING VERIFICATION REQUIRED';

/**
 * Estimate the index-run pressure requirement and compare it with the selected
 * unit's available external static pressure.
 */
export function estimateStaticPressure({ network, returnDesign, outlets, selectedUnit, zoneAnalysis }, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const C = settings.pressure.componentPa;

  const run = indexRun(network);
  const components = [];

  if (run) {
    run.path.forEach(seg => {
      components.push({
        item: seg.role === 'main' ? 'Main supply duct + plenum'
          : seg.role === 'branch' ? 'Branch duct to ' + seg.destination
          : 'Final connection to ' + seg.destination,
        detail: seg.diameterMm + ' mm × ' + seg.effectiveLengthM + ' m effective',
        pa: seg.pressureDropPa
      });
    });
  }

  // Terminal device on the index run.
  const indexOutlet = (outlets?.rows || []).find(o => run && o.label === run.destination);
  const outletPa = indexOutlet && indexOutlet.type === 'linear_bar' ? C.linear_grille : C.diffuser;
  components.push({ item: 'Supply outlet', detail: indexOutlet ? indexOutlet.typeLabel : 'Ceiling diffuser', pa: outletPa });

  if (zoneAnalysis && zoneAnalysis.zoneCount > 0) {
    components.push({ item: 'Zone damper', detail: 'One damper in the index run', pa: C.zone_damper });
  }

  // Return side.
  if (returnDesign) {
    // A return design part-built (or restored from an older save) must still
    // produce an estimate rather than throw — this runs on the way to a quote.
    const rd = returnDesign.duct || {};
    const returnDuctPa = rd.lengthM
      ? round(rd.lengthM * 2.2, 1)                    // typical flex return loss per metre
      : 0;
    if (returnDuctPa) components.push({ item: 'Return duct', detail: rd.diameterMm + ' mm × ' + rd.lengthM + ' m', pa: returnDuctPa });
    components.push({ item: 'Return plenum', detail: 'Equivalent allowance', pa: round(settings.pressure.equivalentLengthM.return_plenum * 2.2, 1) });
    components.push({ item: 'Return grille', detail: returnDesign.returns?.[0]?.grilleSize || '', pa: C.return_grille });
    components.push({ item: 'Filter (clean)', detail: returnDesign.filter?.size || '', pa: C.filter_clean });
    components.push({ item: 'Filter loading allowance', detail: 'Dirty-filter allowance', pa: C.filter_dirty_allowance });
  }

  const totalPa = round(components.reduce((s, c) => s + c.pa, 0), 1);

  const warnings = [];
  let availablePa = null, marginPa = null, marginPct = null;

  if (selectedUnit && selectedUnit.availableStaticPa) {
    availablePa = Number(selectedUnit.availableStaticPa);
    marginPa = round(availablePa - totalPa, 1);
    marginPct = round((marginPa / availablePa) * 100, 1);
    if (marginPa < 0) {
      warnings.push({ code: 'ESTIMATED_PRESSURE_EXCEEDS_UNIT_CAPABILITY', severity: 'CRITICAL',
        message: 'Estimated ' + totalPa + ' Pa exceeds the ' + availablePa + ' Pa available external static of ' +
          selectedUnit.model + '. Increase duct sizes, shorten runs, or select a higher-static unit.' });
    } else if (marginPa / availablePa < settings.pressure.lowMarginFraction) {
      warnings.push({ code: 'STATIC_PRESSURE_MARGIN_LOW', severity: 'WARNING',
        message: 'Only ' + marginPa + ' Pa (' + marginPct + '%) of static margin remains on ' + selectedUnit.model + '.' });
    }
  } else {
    // Without the manufacturer's figure there is nothing to compare the
    // estimate against, so the check DID NOT HAPPEN. That is a different
    // thing from passing, and it has to read differently — an estimator who
    // sees no red must not conclude the design cleared its static check.
    // CRITICAL, not WARNING. A warning can be scrolled past; a critical has to
    // be acknowledged by a named estimator before the design can be approved.
    // That is the difference between "we could not check this" and a false pass.
    warnings.push({ code: 'STATIC_PRESSURE_CHECK_NOT_COMPLETED', severity: 'CRITICAL',
      message: STATIC_NOT_COMPLETED + '. The estimate of ' + totalPa + ' Pa has not been compared ' +
        'against ' + (selectedUnit ? selectedUnit.model : 'the selected unit') +
        ' because its available external static pressure is not on file. ' +
        'Enter it from the manufacturer data sheet in HVAC Design Settings → Equipment specifications.' });
  }

  const checkCompleted = availablePa !== null && availablePa !== undefined;

  return {
    disclaimer: PRESSURE_DISCLAIMER,
    indexRun: run ? { destination: run.destination, path: run.path } : null,
    components,
    estimatedRequirementPa: totalPa,
    unitAvailableStaticPa: availablePa,
    remainingMarginPa: marginPa,
    remainingMarginPct: marginPct,
    // Three states, never two. `checkCompleted: false` is NOT a pass.
    checkCompleted,
    status: !checkCompleted ? 'not_completed'
      : (marginPa !== null && marginPa < 0) ? 'fail' : 'pass',
    statusLabel: !checkCompleted ? STATIC_NOT_COMPLETED
      : (marginPa !== null && marginPa < 0)
        ? 'STATIC PRESSURE CHECK FAILED — the estimate exceeds the unit'
        : 'Static pressure check passed',
    warnings
  };
}
