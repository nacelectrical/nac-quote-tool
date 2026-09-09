// NAC AI HVAC DESIGNER — PART 21: static pressure estimate.
//
// This is a DESIGN ESTIMATE. It is labelled as such everywhere it appears and
// it never replaces commissioning measurement.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { indexRun } from './ducts.mjs';

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
    const returnDuctPa = returnDesign.duct.lengthM
      ? round(returnDesign.duct.lengthM * 2.2, 1)     // typical flex return loss per metre
      : 0;
    if (returnDuctPa) components.push({ item: 'Return duct', detail: returnDesign.duct.diameterMm + ' mm × ' + returnDesign.duct.lengthM + ' m', pa: returnDuctPa });
    components.push({ item: 'Return plenum', detail: 'Equivalent allowance', pa: round(settings.pressure.equivalentLengthM.return_plenum * 2.2, 1) });
    components.push({ item: 'Return grille', detail: returnDesign.returns[0]?.grilleSize || '', pa: C.return_grille });
    components.push({ item: 'Filter (clean)', detail: returnDesign.filter.size, pa: C.filter_clean });
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
    warnings.push({ code: 'MISSING_MANUFACTURER_DATA', severity: 'CHECK',
      message: 'Available external static pressure is not on file for the selected unit — the pressure estimate cannot be compared against the unit. Enter it in HVAC Design Settings → Equipment specifications.' });
  }

  return {
    disclaimer: PRESSURE_DISCLAIMER,
    indexRun: run ? { destination: run.destination, path: run.path } : null,
    components,
    estimatedRequirementPa: totalPa,
    unitAvailableStaticPa: availablePa,
    remainingMarginPa: marginPa,
    remainingMarginPct: marginPct,
    warnings
  };
}
