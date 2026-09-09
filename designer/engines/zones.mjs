// NAC AI HVAC DESIGNER — PART 20: zone design.
//
// A bypass damper is never assumed. If the minimum open airflow cannot be met,
// the engine says so and recommends a constant zone — the estimator decides.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';

export const ZONE_KINDS = ['individual', 'grouped', 'constant', 'common', 'spill'];

/** Default zoning: each conditioned room its own zone, open-plan rooms grouped. */
export function suggestZones(rooms, airflow, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const byRoomId = new Map(airflow.rows.map(r => [r.roomId, r]));
  const groups = new Map();

  for (const room of rooms) {
    const flowRow = byRoomId.get(room.id);
    if (!flowRow) continue;
    const key = room.openPlanGroup || room.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: 'zone_' + key,
        name: room.openPlanGroup ? 'Open plan — ' + room.openPlanGroup : room.label,
        kind: room.openPlanGroup ? 'grouped' : 'individual',
        roomIds: [], rooms: [], airflowLs: 0
      });
    }
    const z = groups.get(key);
    z.roomIds.push(room.id);
    z.rooms.push(room.label);
    z.airflowLs += flowRow.adjustedLs;
  }

  const zones = [...groups.values()].map(z => ({ ...z, airflowLs: round(z.airflowLs, 0) }));
  // The largest common area is the natural constant zone.
  const largest = zones.slice().sort((a, b) => b.airflowLs - a.airflowLs)[0];
  if (largest && largest.kind === 'grouped') largest.kind = 'common';

  return analyseZones(zones, airflow, { ...opts, settings });
}

/**
 * Analyse a zone set: shares, minimum-open airflow, and the warnings that
 * matter for a real install.
 */
export function analyseZones(zones, airflow, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const Z = settings.zoning;
  const totalLs = zones.reduce((s, z) => s + z.airflowLs, 0);
  const systemLs = airflow.allocatedAirflowLs || totalLs;

  const rows = zones.map(z => ({
    ...z,
    systemSharePct: systemLs > 0 ? round((z.airflowLs / systemLs) * 100, 1) : 0,
    alwaysOpen: z.kind === 'constant' || z.kind === 'common'
  }));

  // Worst case: every closable zone shut, only the constant/common zones open.
  const alwaysOpenLs = rows.filter(r => r.alwaysOpen).reduce((s, r) => s + r.airflowLs, 0);
  const smallestClosableLs = rows.filter(r => !r.alwaysOpen)
    .reduce((min, r) => (min === null || r.airflowLs < min ? r.airflowLs : min), null);
  // If nothing is permanently open, the minimum realistic condition is the
  // single smallest zone left open on its own.
  const minOpenLs = alwaysOpenLs > 0 ? alwaysOpenLs : (smallestClosableLs ?? 0);
  const minOpenFraction = systemLs > 0 ? minOpenLs / systemLs : 0;
  const requiredLs = systemLs * Z.minOpenAirflowFraction;

  const warnings = [];
  if (minOpenFraction < Z.minOpenAirflowFraction) {
    warnings.push({ code: 'MINIMUM_OPEN_AIRFLOW_TOO_LOW', severity: 'CRITICAL',
      message: 'With the closable zones shut only ' + round(minOpenLs, 0) + ' L/s (' +
        round(minOpenFraction * 100, 0) + '% of system) stays open. At least ' + round(requiredLs, 0) +
        ' L/s (' + round(Z.minOpenAirflowFraction * 100, 0) + '%) is required.' });
  }
  if (minOpenFraction < Z.constantZoneThreshold && !rows.some(r => r.kind === 'constant')) {
    warnings.push({ code: 'CONSTANT_ZONE_RECOMMENDED', severity: 'WARNING',
      message: 'Nominate a constant zone (typically the main living area) so the system always has a path for air.' });
  }
  if (minOpenFraction < Z.minOpenAirflowFraction * 0.8) {
    warnings.push({ code: 'HIGH_STATIC_PRESSURE_RISK', severity: 'WARNING',
      message: 'Closing down to ' + round(minOpenFraction * 100, 0) +
        '% of design airflow will drive static pressure well above the design point.' });
  }
  if (rows.length > Z.maxZones) {
    warnings.push({ code: 'ZONE_COUNT_EXCEEDS_CONTROLLER', severity: 'WARNING',
      message: rows.length + ' zones exceeds the configured maximum of ' + Z.maxZones + '.' });
  }
  rows.filter(r => r.systemSharePct < Z.smallZoneFraction * 100).forEach(r => {
    warnings.push({ code: 'SMALL_ZONE', severity: 'INFO',
      message: r.name + ' carries only ' + r.systemSharePct + '% of system airflow — consider grouping it.' });
  });

  return {
    zones: rows,
    zoneCount: rows.length,
    totalZonedAirflowLs: round(totalLs, 0),
    systemAirflowLs: round(systemLs, 0),
    alwaysOpenLs: round(alwaysOpenLs, 0),
    minimumOpenAirflowLs: round(minOpenLs, 0),
    minimumOpenFractionPct: round(minOpenFraction * 100, 1),
    requiredMinimumLs: round(requiredLs, 0),
    meetsMinimum: minOpenFraction >= Z.minOpenAirflowFraction,
    bypassAssumed: false,
    bypassNote: 'No bypass damper has been assumed. If one is required it must be added deliberately and priced.',
    warnings
  };
}

/** Move a room into a zone, or set a zone's kind, and re-analyse. */
export function updateZones(zoneAnalysis, airflow, mutate, opts = {}) {
  const zones = zoneAnalysis.zones.map(z => ({ ...z, roomIds: [...z.roomIds], rooms: [...z.rooms] }));
  mutate(zones);
  return analyseZones(zones.filter(z => z.roomIds.length > 0), airflow, opts);
}
