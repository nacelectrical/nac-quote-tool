// NAC AI HVAC DESIGNER — PART 20: zone design.
//
// A bypass damper is never assumed. If the minimum open airflow cannot be met,
// the engine says so and recommends a constant zone — the estimator decides.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { DRAWING } from './nac-standard.mjs';
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

// ── Zone colours ─────────────────────────────────────────────────────────────
// One palette, used by the plan drawing, the zone chips and the zone table, so
// the yellow block on the drawing is the same Zone 4 as the yellow row in the
// list. Picked to stay legible over a printed floor plan and to be told apart
// by someone who does not see colour well — no red/green pair carries meaning
// on its own, and every zone is also numbered.

// From the NAC DUCT DESIGN STANDARD, so the yellow block on the drawing is the
// same Zone 4 as the yellow row in the zone list.
export const ZONE_PALETTE = DRAWING.zonePalette.map(c => ({ ...c, name: c.key }));

/** The trunk belongs to no zone, so it is drawn in its own neutral colour. */
export const TRUNK_COLOUR = DRAWING.trunkColour;
/** The return is a different system and must never read as a supply run. */
export const RETURN_COLOUR = DRAWING.returnColour;

/**
 * Give every zone a colour and a number, and say which rooms carry it.
 *
 * Returns a lookup by zone id and by room id, because the drawing needs to
 * colour a room by its zone and colour a duct by the room it feeds, and doing
 * that from two different places is how the two end up disagreeing.
 */
export function zoneColours(zoneAnalysis) {
  const zones = zoneAnalysis?.zones || [];
  const byZoneId = {};
  const byRoomId = {};
  zones.forEach((z, i) => {
    const c = ZONE_PALETTE[i % ZONE_PALETTE.length];
    const entry = {
      zoneId: z.id,
      index: i + 1,
      shortName: 'Zone ' + (i + 1),
      name: z.name,
      colour: c.line,
      fill: c.fill,
      paletteKey: c.key,
      alwaysOpen: !!z.alwaysOpen
    };
    byZoneId[z.id] = entry;
    for (const rid of (z.roomIds || [])) byRoomId[rid] = entry;
  });
  return { byZoneId, byRoomId, list: zones.map(z => byZoneId[z.id]) };
}

/**
 * The small block of figures that sits beside each zone on the drawing:
 *
 *   Zone 4
 *   6.23 kW
 *   374 L/s
 *   41.5 m²
 *
 * Every number is the one the engines actually calculated — nothing on the
 * drawing is a second opinion.
 */
export function zoneChips(zoneAnalysis, { rooms = [], roomLoads = [] } = {}) {
  const cols = zoneColours(zoneAnalysis);
  const roomById = new Map((rooms || []).map(r => [r.id, r]));
  const loadById = new Map((roomLoads || []).map(l => [l.roomId, l]));

  return (zoneAnalysis?.zones || []).map(z => {
    const ids = z.roomIds || [];
    const watts = ids.reduce((s, id) => s + (loadById.get(id)?.designW || 0), 0);
    const areaSqM = ids.reduce((s, id) => s + (roomById.get(id)?.areaSqM || 0), 0);
    // Anchor the chip on the room that carries the most of the zone, so it
    // lands in the middle of the space rather than on a cupboard at the edge.
    const anchorRoom = ids.map(id => roomById.get(id)).filter(r => r?.boundaryPx)
      .sort((a, b) => (b.areaSqM || 0) - (a.areaSqM || 0))[0] || null;
    const c = cols.byZoneId[z.id];
    return {
      zoneId: z.id,
      index: c?.index ?? null,
      title: c?.shortName || z.name,
      fullName: z.name,
      rooms: z.rooms || [],
      kw: Math.round((watts / 1000) * 100) / 100,
      airflowLs: Math.round(z.airflowLs || 0),
      areaSqM: Math.round(areaSqM * 10) / 10,
      alwaysOpen: !!z.alwaysOpen,
      colour: c?.colour || TRUNK_COLOUR,
      fill: c?.fill || 'rgba(255,255,255,0.10)',
      anchorPx: anchorRoom
        ? { x: anchorRoom.boundaryPx.x, y: anchorRoom.boundaryPx.y,
            w: anchorRoom.boundaryPx.w, h: anchorRoom.boundaryPx.h }
        : null
    };
  });
}
