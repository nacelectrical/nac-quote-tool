// NAC AI HVAC DESIGNER — PART 14: airflow calculator.
// Deterministic. Room airflow is apportioned by calculated load, never guessed.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';

/**
 * @param {Object} systemLoadRec  from loads.systemLoad()
 * @param {Object} opts { settings, selectedUnit, overridesByRoomId }
 */
export function calculateAirflow(systemLoadRec, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const A = settings.airflow;
  const overrides = opts.overridesByRoomId || {};

  // System design airflow follows the SELECTED unit's capacity when one is
  // chosen (that is what will actually be installed), otherwise the design load.
  const basisKw = opts.selectedUnit?.capacityKw ?? systemLoadRec.designKw;
  const basisLabel = opts.selectedUnit
    ? 'Selected unit ' + opts.selectedUnit.model + ' (' + opts.selectedUnit.capacityKw + ' kW)'
    : 'Calculated design load (' + round(systemLoadRec.designKw, 2) + ' kW)';

  const systemAirflowLs = basisKw * A.litresPerSecPerKw;
  const totalLoadW = systemLoadRec.rooms.reduce((s, r) => s + r.coolingW, 0);

  const rows = systemLoadRec.rooms.map(r => {
    const share = totalLoadW > 0 ? r.coolingW / totalLoadW : 0;
    let recommended = systemAirflowLs * share;
    const belowMin = recommended < A.minRoomAirflowLs;
    if (belowMin) recommended = A.minRoomAirflowLs;

    const ov = overrides[r.roomId];
    const adjusted = ov !== undefined && ov !== null && ov !== '' ? Number(ov) : recommended;

    const warnings = [];
    if (ov !== undefined && ov !== null && ov !== '') {
      warnings.push({ code: 'MANUAL_AIRFLOW_OVERRIDE', severity: 'INFO',
        message: r.label + ' airflow manually set to ' + round(adjusted, 0) + ' L/s (calculated ' + round(recommended, 0) + ' L/s).' });
    }
    if (belowMin) {
      warnings.push({ code: 'AIRFLOW_TOO_LOW', severity: 'INFO',
        message: r.label + ' raised to the configured minimum of ' + A.minRoomAirflowLs + ' L/s.' });
    }

    return {
      roomId: r.roomId, label: r.label,
      loadW: r.coolingW,
      loadShare: round(share * 100, 1),
      recommendedLs: round(recommended, 0),
      adjustedLs: round(adjusted, 0),
      overridden: ov !== undefined && ov !== null && ov !== '',
      warnings
    };
  });

  const allocatedLs = rows.reduce((s, r) => s + r.adjustedLs, 0);
  rows.forEach(r => { r.systemSharePct = allocatedLs > 0 ? round((r.adjustedLs / allocatedLs) * 100, 1) : 0; });

  const warnings = rows.flatMap(r => r.warnings);
  const imbalance = systemAirflowLs > 0 ? (allocatedLs - systemAirflowLs) / systemAirflowLs : 0;
  if (Math.abs(imbalance) > A.balanceTolerance) {
    warnings.push({ code: 'AIRFLOW_BALANCE_CHECK_REQUIRED', severity: 'WARNING',
      message: 'Allocated airflow (' + round(allocatedLs, 0) + ' L/s) differs from system design airflow (' +
        round(systemAirflowLs, 0) + ' L/s) by ' + round(imbalance * 100, 0) + '%.' });
  }

  // Unit compatibility — only when the manufacturer figure is on file.
  if (opts.selectedUnit) {
    const rated = opts.selectedUnit.ratedAirflowLs;
    if (rated) {
      if (allocatedLs > rated) warnings.push({ code: 'AIRFLOW_ABOVE_UNIT_RATING', severity: 'WARNING',
        message: 'Total design airflow ' + round(allocatedLs, 0) + ' L/s exceeds the unit rating of ' + rated + ' L/s.' });
      else if (allocatedLs < rated * 0.6) warnings.push({ code: 'AIRFLOW_BELOW_UNIT_RANGE', severity: 'CHECK',
        message: 'Total design airflow is only ' + round((allocatedLs / rated) * 100, 0) + '% of the unit rating.' });
    } else {
      warnings.push({ code: 'MISSING_MANUFACTURER_DATA', severity: 'CHECK',
        message: 'Rated airflow is not on file for ' + opts.selectedUnit.model + ' — unit airflow compatibility not checked.' });
    }
  }

  return {
    basisKw: round(basisKw, 2),
    basisLabel,
    litresPerSecPerKw: A.litresPerSecPerKw,
    systemAirflowLs: round(systemAirflowLs, 0),
    allocatedAirflowLs: round(allocatedLs, 0),
    rows,
    warnings
  };
}
