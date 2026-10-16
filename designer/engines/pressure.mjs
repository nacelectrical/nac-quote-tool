// NAC AI HVAC DESIGNER — PART 21: static pressure estimate.
//
// This is a DESIGN ESTIMATE. It is labelled as such everywhere it appears and
// it never replaces commissioning measurement.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { indexRun } from './ducts.mjs';
import { scaleTrust } from './calibration.mjs';

/** Shown wherever a static result would otherwise be read as a pass. */
export const STATIC_NOT_COMPLETED = 'STATIC PRESSURE CHECK NOT COMPLETED — MANUFACTURER DATA REQUIRED';

/** The check did not happen because there are no real metres behind it. */
export const STATIC_NO_LENGTHS =
  'STATIC PRESSURE CHECK NOT COMPLETED — DUCT LENGTHS HAVE NOT BEEN MEASURED';

/** The check did not happen because the metres cannot be trusted. */
export const STATIC_SCALE_UNRELIABLE =
  'STATIC PRESSURE CHECK NOT COMPLETED — THE PLAN SCALE IS NOT RELIABLE';

/**
 * Is there anything real behind the metres in this estimate?
 *
 * The review found a design that totalled its index run, compared it against
 * the unit's available static, and reported "Static pressure check passed" —
 * with every duct length zero. The sum was not low. There was nothing in it
 * but the fixed component allowances: an outlet, a damper, a grille and a
 * filter. No duct at all.
 *
 * The pipeline does gate this (supply-graph.pressureReadiness), but the gate
 * lived outside the engine, so every other caller — a report, a surface added
 * later, a test — could still be told the check passed. It belongs here, where
 * the verdict is actually made.
 *
 * Two separate questions, because they fail for different reasons and the
 * estimator fixes them in different places:
 *
 *   ARE THERE METRES?    A run with no measured length contributes nothing.
 *   ARE THEY REAL?       Metres measured off a plan scaled from a drawn car
 *                        are a confident-looking number with nothing behind
 *                        it. They are not zero, so a length check cannot see
 *                        them; only the scale's origin can.
 */
function lengthEvidence(run, calibration) {
  if (!run || !Array.isArray(run.path) || !run.path.length) {
    return { ok: false, code: 'STATIC_PRESSURE_NO_INDEX_RUN', label: STATIC_NO_LENGTHS,
             measuredSegments: 0, unmeasuredSegments: 0, runLengthM: 0, unmeasured: [],
             reason: 'No index run has been identified, so there is no path to add up.' };
  }

  const unmeasured = run.path.filter(s =>
    s.lengthM === null || s.lengthM === undefined || !(Number(s.lengthM) > 0));
  const runLengthM = round(run.path.reduce((t, s) => t + (Number(s.lengthM) || 0), 0), 2);

  if (unmeasured.length) {
    const which = unmeasured.map(s => s.destination || s.id).join(', ');
    return {
      ok: false, code: 'STATIC_PRESSURE_LENGTH_NOT_MEASURED', label: STATIC_NO_LENGTHS,
      measuredSegments: run.path.length - unmeasured.length,
      unmeasuredSegments: unmeasured.length,
      runLengthM, unmeasured: unmeasured.map(s => s.id),
      reason: unmeasured.length + ' of ' + run.path.length + ' runs on the index path have no '
        + 'measured length (' + which + '). A pressure drop over no duct is not a low pressure '
        + 'drop. Measure the routes on a calibrated plan, or enter the lengths by hand.'
    };
  }

  // The metres exist. Do they mean anything? Only asked when a calibration is
  // actually on the design: lengths typed in by hand do not depend on a scale,
  // and refusing them because no plan was calibrated would block the manual
  // fallback the estimator is entitled to.
  if (calibration) {
    const trust = scaleTrust(calibration);
    if (!trust.trusted) {
      return {
        ok: false, code: 'STATIC_PRESSURE_SCALE_NOT_RELIABLE', label: STATIC_SCALE_UNRELIABLE,
        measuredSegments: run.path.length, unmeasuredSegments: 0, runLengthM, unmeasured: [],
        scaleConfidence: trust.confidence,
        reason: 'These lengths were measured on a plan whose scale cannot be relied on. '
          + trust.reason + ' Until the scale is confirmed, ' + runLengthM + ' m of index run is '
          + 'a number without a measurement behind it.'
      };
    }
    return { ok: true, code: null, label: null, measuredSegments: run.path.length,
             unmeasuredSegments: 0, runLengthM, unmeasured: [],
             scaleConfidence: trust.confidence, reason: null };
  }

  return { ok: true, code: null, label: null, measuredSegments: run.path.length,
           unmeasuredSegments: 0, runLengthM, unmeasured: [], scaleConfidence: null, reason: null };
}

export const PRESSURE_DISCLAIMER =
  'DESIGN ESTIMATE — COMMISSIONING VERIFICATION REQUIRED';

/**
 * Estimate the index-run pressure requirement and compare it with the selected
 * unit's available external static pressure.
 */
export function estimateStaticPressure({ network, returnDesign, outlets, selectedUnit,
                                         zoneAnalysis, calibration = null }, opts = {}) {
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
    // THE AIR TRAVELS THROUGH ONE DUCT, NOT ALL OF THEM IN SERIES.
    //
    // rd.lengthM is the total flex to BUY — two ducts is twice the metres on
    // the order. Charging the pressure calculation for all of it added the
    // second return's run to a path no air takes, and inflated the requirement
    // by the length of a whole duct on every two-return design.
    const runM = rd.lengthPerDuctM ?? rd.lengthM ?? 0;
    const returnDuctPa = runM
      ? round(runM * 2.2, 1)                          // typical flex return loss per metre
      : 0;
    if (returnDuctPa) {
      components.push({ item: 'Return duct',
        detail: rd.diameterMm + ' mm × ' + runM + ' m' +
                ((rd.ductCount ?? 1) > 1 ? ' (one of ' + rd.ductCount + ' in parallel)' : ''),
        pa: returnDuctPa });
    }
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

  // ── NOTHING BEHIND THE METRES IS ALSO "NOT COMPLETED" ──────────────────
  const evidence = lengthEvidence(run, calibration);
  if (!evidence.ok) {
    warnings.push({ code: evidence.code, severity: 'CRITICAL',
      message: evidence.label + '. ' + evidence.reason });
  }

  const hasUnitStatic = availablePa !== null && availablePa !== undefined;
  const checkCompleted = hasUnitStatic && evidence.ok;

  // Which failure the estimator is looking at decides where they go to fix it,
  // so the label names the missing input rather than saying "not completed".
  const notCompletedLabel = !evidence.ok ? evidence.label : STATIC_NOT_COMPLETED;

  return {
    disclaimer: PRESSURE_DISCLAIMER,
    indexRun: run ? { destination: run.destination, path: run.path } : null,
    components,
    estimatedRequirementPa: totalPa,
    unitAvailableStaticPa: availablePa,
    remainingMarginPa: marginPa,
    remainingMarginPct: marginPct,
    /**
     * What the metres in `estimatedRequirementPa` are made of: how many runs
     * on the index path were measured, how long the path is, and how far the
     * plan scale those metres came from can be relied on.
     */
    lengthEvidence: evidence,
    // Three states, never two. `checkCompleted: false` is NOT a pass.
    checkCompleted,
    status: !checkCompleted ? 'not_completed'
      : (marginPa !== null && marginPa < 0) ? 'fail' : 'pass',
    statusLabel: !checkCompleted ? notCompletedLabel
      : (marginPa !== null && marginPa < 0)
        ? 'STATIC PRESSURE CHECK FAILED — the estimate exceeds the unit'
        : 'Static pressure check passed',
    warnings
  };
}
