// NAC AI HVAC DESIGNER — PART 27: central validation / warning engine.
//
// Every engine emits warnings in the same shape; this module collects them,
// adds the design-wide checks no single engine can see, and tracks
// acknowledgement. A CRITICAL warning blocks design approval until it is
// explicitly acknowledged by a named estimator.

import { crossCheckFloorArea, incompleteRooms, isAutoCleared } from './rooms.mjs';
import { isConditionedRoom } from './classify.mjs';
import { quoteGateWarnings } from './quote-gate.mjs';

export const SEVERITY = { INFO: 'INFO', CHECK: 'CHECK', WARNING: 'WARNING', CRITICAL: 'CRITICAL' };
export const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, CHECK: 2, INFO: 3 };

let _seq = 0;
export function _resetWarningIds() { _seq = 0; }

/**
 * EVERY WARNING LIST THE PIPELINE DERIVES, AND NOTHING A PERSON ENTERED.
 *
 * These are rebuilt from the design state on every full run. They are listed
 * here rather than cleared where they happen to be written, because the bug
 * they exist to stop was exactly a list written in six places and cleared in
 * none of them.
 */
export const DERIVED_WARNING_FIELDS = Object.freeze([
  'warnings', 'warningSummary',
  'routeWarnings', 'returnRouteWarnings', 'loadWarnings'
]);

/**
 * The validation results those warnings are read off. Each is recomputed when
 * its stage runs, and several only run when the design is routed — so left
 * alone they describe a topology that no longer exists.
 */
export const DERIVED_VALIDATION_FIELDS = Object.freeze([
  'topologyCheck', 'btoValidation', 'zoneDamperValidation', 'returnSeparation',
  'supplySpigots', 'spigotOverride', 'spigotSelectionDiffers'
]);

/**
 * WHAT A PERSON PUT ON THE JOB, which a recomputation must never clear:
 * acknowledgements, site notes and photos, and every recorded override. Named
 * so the distinction is testable rather than remembered.
 */
export const USER_ENTERED_FIELDS = Object.freeze([
  'warningAcknowledgements', 'siteNotes', 'sitePhotos',
  'roomLoadOverrides', 'airflowOverrides', 'outletOverrides',
  'ductDiameterOverrides', 'returnGrilleOverrides', 'btoOverrides',
  'supplyMainConfig', 'zoneDefinitions', 'lockedRoutes', 'routeEdits'
]);

/**
 * The patch that starts a pipeline run: every derived warning and validation
 * result blanked, so the run rebuilds them instead of adding to them.
 *
 * Returns a patch rather than mutating, because the pipeline copies the design
 * and a function that quietly edited the caller's object would be the same
 * class of bug in a different place.
 */
export function resetDerivedWarnings(design = {}) {
  const patch = {};
  for (const k of DERIVED_WARNING_FIELDS) patch[k] = null;
  for (const k of DERIVED_VALIDATION_FIELDS) patch[k] = null;
  return patch;
}

function normalise(w, area) {
  return {
    // Anything the raiser attached travels with the warning. A capacity
    // mismatch carries BOTH figures and the fact that it blocks approval; a
    // normaliser that dropped them would leave the estimator reading a
    // sentence with no numbers behind it.
    ...w,
    id: w.id || ('w' + (++_seq)),
    code: w.code || 'UNSPECIFIED',
    severity: w.severity || SEVERITY.INFO,
    message: w.message || '',
    area: w.area || area || 'general',
    acknowledged: !!w.acknowledged,
    acknowledgedBy: w.acknowledgedBy || null,
    acknowledgedAt: w.acknowledgedAt || null,
    acknowledgementNote: w.acknowledgementNote || null
  };
}

/**
 * Collect warnings from every stage of the design plus the cross-cutting checks.
 * @param {Object} design the full DuctDesign record
 */
export function collectWarnings(design, opts = {}) {
  const out = [];
  const push = (list, area) => (list || []).forEach(w => out.push(normalise(w, area)));

  // ── Plan & measurement ─────────────────────────────────────────────────────
  // RULE 4 — only a conditioned room that must be measured off the image makes
  // calibration a problem worth raising. Warning about it when every
  // conditioned room already carries its printed dimensions is noise, and
  // warning about it because an EXCLUDED room has no size is simply wrong.
  if (!design.calibration || !design.calibration.pixelsPerMm) {
    const req = design.calibrationRequirement;
    if (!req || req.required !== false) {
      out.push(normalise({ code: 'MISSING_PLAN_CALIBRATION', severity: SEVERITY.WARNING,
        message: (req?.reason ? req.reason + ' ' : '') +
          'The plan has not been calibrated. Any measurement taken from the image is unreliable until you run CALIBRATE PLAN.' }, 'plan'));
    }
  } else if (design.calibration.source === 'derived_from_dimensioned_rooms') {
    out.push(normalise({ code: 'CALIBRATION_DERIVED', severity: SEVERITY.INFO,
      message: 'The drawing scale was worked out from ' + (design.calibration.derivedFrom || []).length +
        ' rooms whose printed sizes and drawn boundaries agree to within ' +
        design.calibration.agreementSpreadPct + '%. Duct lengths are measured against it. ' +
        'Calibrating two known points by hand will override it.' }, 'plan'));
  }
  for (const chain of (design.chains || [])) {
    if (chain.closure && chain.closure.closes === false) {
      out.push(normalise({ code: 'UNCERTAIN_DIMENSION_CHAIN', severity: SEVERITY.WARNING,
        message: 'Dimension chain ' + chain.id + ' sums to ' + chain.closure.sumMm + ' mm but the stated overall is ' +
          chain.closure.overallMm + ' mm (' + chain.closure.errorMm + ' mm out). Check the chain before using its rooms.' }, 'plan'));
    }
  }

  const rooms = design.rooms || [];

  // Does the room schedule agree with the floor area printed on the sheet?
  if (design.printedResidenceSqM) {
    const check = crossCheckFloorArea(rooms, design.printedResidenceSqM);
    if (check) push(check.warnings, 'plan');
  }

  // A conditioned room with only one dimension counts as nothing in the load,
  // which would silently under-size the system.
  const half = incompleteRooms(rooms);
  if (half.length) {
    out.push(normalise({ code: 'ROOM_MISSING_A_DIMENSION', severity: SEVERITY.CRITICAL,
      message: half.length + ' conditioned room(s) have only one dimension, so they are counting as ' +
        'zero area and the system would be under-sized: ' +
        half.map(r => r.label + ' (' + r.missing + ' missing' +
          (r.knownMm ? ', ' + r.knownMm + ' mm known' : '') + ')').join(', ') +
        '. Enter the missing number on the Rooms tab.' }, 'rooms'));
  }

  for (const r of rooms) {
    if (!isConditionedRoom(r)) continue;
    if (r.confidenceBand === 'LOW') {
      out.push(normalise({ code: 'LOW_ROOM_MEASUREMENT_CONFIDENCE', severity: SEVERITY.CRITICAL,
        message: r.label + ' measurement confidence is ' + r.confidence + '% (' + r.confidenceBand +
          '). Verify the dimensions before sizing.' }, 'rooms'));
    } else if (r.confidenceBand === 'MEDIUM') {
      out.push(normalise({ code: 'MEDIUM_ROOM_MEASUREMENT_CONFIDENCE', severity: SEVERITY.CHECK,
        message: r.label + ' measurement confidence is ' + r.confidence + '%. Confirm the dimensions.' }, 'rooms'));
    }
    // WHAT ACTUALLY DECIDES THIS IS sizableRooms(). A room read confidently off
    // the plan is AUTO-CLEARED and is sized, whatever its status says — so
    // testing the status alone here told the estimator that eleven rooms were
    // excluded from a 22.54 kW load that had in fact sized all of them. A
    // warning that misdescribes the design is worse than no warning.
    if (r.status !== 'Verified' && r.status !== 'Manual' && !r.overrideApproved) {
      out.push(isAutoCleared(r)
        ? normalise({ code: 'ROOM_AUTO_CLEARED', severity: SEVERITY.CHECK,
            message: r.label + ' was sized from the dimensions printed on the plan (' +
              r.areaSqM + ' m²) without being confirmed. Check it on site.' }, 'rooms')
        : normalise({ code: 'UNVERIFIED_ROOM', severity: SEVERITY.WARNING,
            message: r.label + ' has not been verified — it is excluded from sizing until it is.' }, 'rooms'));
    }
    if (!r.insulation) {
      out.push(normalise({ code: 'MISSING_INSULATION', severity: SEVERITY.INFO,
        message: r.label + ': insulation not specified — the HVAC Design Settings default was used.' }, 'sizing'));
    }
    if (r.glazingAreaSqM === null || r.glazingAreaSqM === undefined) {
      out.push(normalise({ code: 'UNKNOWN_GLAZING', severity: SEVERITY.INFO,
        message: r.label + ': glazing area not entered — an assumed proportion of floor area was used.' }, 'sizing'));
    }
    if (r.overrides && r.overrides.length) {
      out.push(normalise({ code: 'MANUAL_OVERRIDE', severity: SEVERITY.INFO,
        message: r.label + ': ' + r.overrides.length + ' manual override(s) recorded.' }, 'rooms'));
    }
  }

  // ── Engine warnings ────────────────────────────────────────────────────────
  push(design.equipmentSelection?.systemWarnings, 'equipment');
  push(design.selectedUnit?.warnings, 'equipment');
  push(design.airflow?.warnings, 'airflow');
  push(design.outlets?.warnings, 'outlets');
  push(design.network?.warnings, 'ductwork');
  // THE ROUTING WARNINGS REACH THE APPROVAL GATE.
  //
  // They were assembled in the pipeline, shown on the Ductwork tab and printed
  // in the report, and then went no further — so a CRITICAL raised by the
  // topology validator, the return-separation check, the BTO validator or the
  // supply-spigot check never counted toward `unacknowledgedCritical` and never
  // blocked approval. A rule that blocks nothing is a rule nobody keeps.
  // BTO_TO_OUTLET_CLEARANCE_REVIEW is raised here, which is why it surfaced.
  push(design.routeWarnings, 'ductwork');
  push(design.returnRouteWarnings, 'return');
  push(design.returnDesign?.warnings, 'return');
  push(design.zones?.warnings, 'zones');
  push(design.pressure?.warnings, 'pressure');
  push(design.bom?.warnings, 'materials');
  push(design.commercials?.warnings, 'financials');
  push(design.loadWarnings, 'sizing');
  // THE CUSTOMER-QUOTE GATE. These are CRITICAL to a quote and not to the
  // internal sheet, which is why they carry `blocksCustomerQuote` and not
  // `blocksFinalApproval` — the estimator still gets their working.
  push(quoteGateWarnings(design.quoteGate), 'pricing');

  // ── Cross-cutting checks ───────────────────────────────────────────────────
  if (design.selectedUnit && design.systemLoad) {
    const ratio = design.selectedUnit.capacityKw / design.systemLoad.designKw;
    // BOTH FIGURES SURVIVE. The calculated load is never trimmed to agree with
    // a unit somebody chose by hand, and a hand-chosen unit is never quietly
    // presented as capacity-approved. Nick chose a 16 kW head against a 23 kW
    // calculated load deliberately; the job can be designed and drawn, but it
    // cannot be signed off until a person has looked at the gap.
    if (ratio < 0.95) out.push(normalise({ code: 'SYSTEM_UNDERSIZED', severity: SEVERITY.CRITICAL,
      blocksFinalApproval: true,
      calculatedDesignLoadKw: design.systemLoad.designKw,
      selectedCapacityKw: design.selectedUnit.capacityKw,
      shortfallKw: Math.round((design.systemLoad.designKw - design.selectedUnit.capacityKw) * 100) / 100,
      message: 'Selected equipment capacity is below the current calculated design load. ' +
        'Installer review/manual equipment override required. \u2014 ' +
        design.selectedUnit.capacityKw + ' kW selected against a ' +
        design.systemLoad.designKw + ' kW calculated design load (' +
        Math.round((1 - ratio) * 100) + '% short).' }, 'equipment'));
    if (ratio > 1.30) out.push(normalise({ code: 'SYSTEM_SIGNIFICANTLY_OVERSIZED', severity: SEVERITY.WARNING,
      message: 'Selected ' + design.selectedUnit.capacityKw + ' kW unit is ' +
        Math.round((ratio - 1) * 100) + '% above the ' + design.systemLoad.designKw + ' kW design load.' }, 'equipment'));
  }

  // A zoned design with no controller is a system that cannot be zoned and a
  // quote that is short by whatever the controller costs. The selection returns
  // null when nothing in the catalogue fits the brand and the zone count, and
  // nothing downstream noticed.
  if (design.zones?.zoneCount > 1 && !design.controller) {
    const brand = design.selectedUnit?.brandName || 'the selected brand';
    out.push(normalise({ code: 'NO_COMPATIBLE_ZONE_CONTROLLER', severity: SEVERITY.CRITICAL,
      message: 'No zone controller in the catalogue supports ' + design.zones.zoneCount +
        ' zones on ' + brand + '. The design has no controller and the quote carries no cost for ' +
        'one. Add the controller and its cost in HVAC Design Settings, or reduce the zone count.' },
      'zones'));
  }

  // A controller that fits but has no cost is the same hole, one step later.
  if (design.controller && (design.controller.cost === null || design.controller.cost === undefined)) {
    out.push(normalise({ code: 'ZONE_CONTROLLER_HAS_NO_COST', severity: SEVERITY.CRITICAL,
      message: design.controller.name + ' has no cost on file, so the quote is short by whatever ' +
        'it is worth. Enter it in HVAC Design Settings.' }, 'zones'));
  }

  // De-duplicate identical code+message pairs, keeping the highest severity.
  const seen = new Map();
  for (const w of out) {
    const key = w.code + '|' + w.message;
    const prev = seen.get(key);
    if (!prev || SEVERITY_ORDER[w.severity] < SEVERITY_ORDER[prev.severity]) seen.set(key, w);
  }
  const list = [...seen.values()].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.area.localeCompare(b.area));

  // Carry through any acknowledgements already recorded on the design.
  const acks = new Map((design.warningAcknowledgements || []).map(a => [a.code + '|' + a.message, a]));
  for (const w of list) {
    const a = acks.get(w.code + '|' + w.message);
    if (a) Object.assign(w, { acknowledged: true, acknowledgedBy: a.by, acknowledgedAt: a.at, acknowledgementNote: a.note });
  }

  return list;
}

export function summarise(warnings) {
  const counts = { CRITICAL: 0, WARNING: 0, CHECK: 0, INFO: 0 };
  for (const w of warnings) counts[w.severity] = (counts[w.severity] || 0) + 1;
  const unacknowledgedCritical = warnings.filter(w => w.severity === SEVERITY.CRITICAL && !w.acknowledged);
  return {
    counts,
    total: warnings.length,
    unacknowledgedCritical,
    canApprove: unacknowledgedCritical.length === 0,
    blockReason: unacknowledgedCritical.length
      ? unacknowledgedCritical.length + ' critical warning(s) must be acknowledged before this design can be approved.'
      : null
  };
}

export function acknowledge(design, warning, by, note) {
  return [...(design.warningAcknowledgements || []), {
    code: warning.code, message: warning.message, by, note: note || null, at: new Date().toISOString()
  }];
}
