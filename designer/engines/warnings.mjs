// NAC AI HVAC DESIGNER — PART 27: central validation / warning engine.
//
// Every engine emits warnings in the same shape; this module collects them,
// adds the design-wide checks no single engine can see, and tracks
// acknowledgement. A CRITICAL warning blocks design approval until it is
// explicitly acknowledged by a named estimator.

export const SEVERITY = { INFO: 'INFO', CHECK: 'CHECK', WARNING: 'WARNING', CRITICAL: 'CRITICAL' };
export const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, CHECK: 2, INFO: 3 };

let _seq = 0;
export function _resetWarningIds() { _seq = 0; }

function normalise(w, area) {
  return {
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
  if (!design.calibration || !design.calibration.pixelsPerMm) {
    out.push(normalise({ code: 'MISSING_PLAN_CALIBRATION', severity: SEVERITY.WARNING,
      message: 'The plan has not been calibrated. Any measurement taken from the image is unreliable until you run CALIBRATE PLAN.' }, 'plan'));
  }
  for (const chain of (design.chains || [])) {
    if (chain.closure && chain.closure.closes === false) {
      out.push(normalise({ code: 'UNCERTAIN_DIMENSION_CHAIN', severity: SEVERITY.WARNING,
        message: 'Dimension chain ' + chain.id + ' sums to ' + chain.closure.sumMm + ' mm but the stated overall is ' +
          chain.closure.overallMm + ' mm (' + chain.closure.errorMm + ' mm out). Check the chain before using its rooms.' }, 'plan'));
    }
  }

  const rooms = design.rooms || [];
  for (const r of rooms) {
    if (!r.conditioned) continue;
    if (r.confidenceBand === 'LOW') {
      out.push(normalise({ code: 'LOW_ROOM_MEASUREMENT_CONFIDENCE', severity: SEVERITY.CRITICAL,
        message: r.label + ' measurement confidence is ' + r.confidence + '% (' + r.confidenceBand +
          '). Verify the dimensions before sizing.' }, 'rooms'));
    } else if (r.confidenceBand === 'MEDIUM') {
      out.push(normalise({ code: 'MEDIUM_ROOM_MEASUREMENT_CONFIDENCE', severity: SEVERITY.CHECK,
        message: r.label + ' measurement confidence is ' + r.confidence + '%. Confirm the dimensions.' }, 'rooms'));
    }
    if (r.status !== 'Verified' && r.status !== 'Manual') {
      out.push(normalise({ code: 'UNVERIFIED_ROOM', severity: SEVERITY.WARNING,
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
  push(design.returnDesign?.warnings, 'return');
  push(design.zones?.warnings, 'zones');
  push(design.pressure?.warnings, 'pressure');
  push(design.bom?.warnings, 'materials');
  push(design.commercials?.warnings, 'financials');
  push(design.loadWarnings, 'sizing');

  // ── Cross-cutting checks ───────────────────────────────────────────────────
  if (design.selectedUnit && design.systemLoad) {
    const ratio = design.selectedUnit.capacityKw / design.systemLoad.designKw;
    if (ratio < 0.95) out.push(normalise({ code: 'SYSTEM_UNDERSIZED', severity: SEVERITY.CRITICAL,
      message: 'Selected ' + design.selectedUnit.capacityKw + ' kW unit is below the ' +
        design.systemLoad.designKw + ' kW design load.' }, 'equipment'));
    if (ratio > 1.30) out.push(normalise({ code: 'SYSTEM_SIGNIFICANTLY_OVERSIZED', severity: SEVERITY.WARNING,
      message: 'Selected ' + design.selectedUnit.capacityKw + ' kW unit is ' +
        Math.round((ratio - 1) * 100) + '% above the ' + design.systemLoad.designKw + ' kW design load.' }, 'equipment'));
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
