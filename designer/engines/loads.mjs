// NAC AI HVAC DESIGNER — PART 10 & 11: load calculation.
//
// This EXTENDS NAC's existing sizing rule rather than replacing it. The legacy
// rule (conditioned floor area × 145 W/m²) is reproduced exactly by
// `legacySizing()`, and `roomLoad()` is built so that with every modifier
// neutral it returns the identical number. The estimator can always see both
// figures side by side, so the new engine can be trusted before it is relied on.
//
// Everything here is deterministic arithmetic. No language model is involved in
// producing a load figure.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round, volumeM3 } from './units.mjs';
import { sizableRooms } from './rooms.mjs';

/** NAC's existing rule, unchanged: conditioned area × base W/m². */
export function legacySizing(totalConditionedAreaSqM, settings = DEFAULT_SETTINGS) {
  const watts = Number(totalConditionedAreaSqM) * settings.load.baseWattsPerM2;
  return {
    areaSqM: round(totalConditionedAreaSqM, 2),
    wattsPerM2: settings.load.baseWattsPerM2,
    watts: round(watts, 0),
    kw: round(watts / 1000, 1),
    rule: 'NAC standard: ' + round(totalConditionedAreaSqM, 1) + ' m² × ' + settings.load.baseWattsPerM2 + ' W/m²'
  };
}

function pick(map, key, fallbackKey) {
  if (key && map[key] !== undefined) return { key, value: map[key] };
  return { key: fallbackKey, value: map[fallbackKey] };
}

export function ceilingHeightFactor(heightMm, settings = DEFAULT_SETTINGS) {
  const L = settings.load;
  const h = Number(heightMm) || L.defaultCeilingHeightMm;
  const ratio = h / L.referenceCeilingHeightMm;
  const damped = 1 + (ratio - 1) * L.ceilingHeightDamping;
  return round(Math.min(L.ceilingHeightFactorMax, Math.max(0.85, damped)), 4);
}

/**
 * Full room load. Returns cooling/heating watts plus a complete, printable
 * breakdown of every factor applied (PART 11 "CALCULATION DETAILS").
 */
export function roomLoad(room, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const L = settings.load;
  const area = Number(room.areaSqM) || 0;
  const roomType = room.roomType || 'other';

  // Fabric base only - glazing, occupancy and appliances are added separately.
  const baseWm2 = (L.roomTypeWattsPerM2 && L.roomTypeWattsPerM2[roomType])
    || L.fabricWattsPerM2 || L.baseWattsPerM2;
  const fabricBaseW = area * baseWm2;

  const ceilingF = ceilingHeightFactor(room.ceilingHeightMm, settings);
  const climate = pick(L.climateFactors, opts.climate || room.climate, L.defaultClimate);
  const insulation = pick(L.insulationFactors, room.insulation || opts.insulation, L.defaultInsulation);
  const wall = pick(L.wallFactors, room.wallConstruction || opts.wallConstruction, L.defaultWall);

  const extWalls = room.externalWalls === null || room.externalWalls === undefined ? 1 : Number(room.externalWalls);
  const extWallF = round(1 + L.externalWallUplift * Math.max(0, extWalls - 1), 4);

  const fabricW = fabricBaseW * ceilingF * climate.value * insulation.value * wall.value * extWallF;

  // Glazing — the biggest single swing factor in an Australian residential load.
  const glazingAssumed = room.glazingAreaSqM === null || room.glazingAreaSqM === undefined;
  const glazingArea = glazingAssumed ? area * L.assumedGlazingRatio : Number(room.glazingAreaSqM);
  const glazingType = pick(L.glazingFactors, room.glazingType || opts.glazingType, L.defaultGlazing);
  const orientation = pick(L.orientationFactors, room.orientation, 'unknown');
  const shading = pick(L.shadingFactors, room.shading, 'unknown');
  const glazingW = glazingArea * L.glazingWattsPerM2 * glazingType.value * orientation.value * shading.value;

  const occupants = room.occupancy === null || room.occupancy === undefined
    ? (L.defaultOccupancy[roomType] ?? L.defaultOccupancy.other)
    : Number(room.occupancy);
  const occupancyW = occupants * L.wattsPerOccupant;

  const applianceW = room.applianceWatts !== undefined && room.applianceWatts !== null
    ? Number(room.applianceWatts)
    : (L.applianceWatts[roomType] ?? L.applianceWatts.other);

  let coolingW = fabricW + glazingW + occupancyW + applianceW;

  const openPlanApplied = !!room.openPlanGroup;
  if (openPlanApplied) coolingW *= L.openPlanDiversity;

  const heatingW = coolingW * L.heatingFactor;

  const breakdown = {
    floorAreaSqM: round(area, 2),
    ceilingHeightMm: room.ceilingHeightMm ?? L.defaultCeilingHeightMm,
    roomVolumeM3: round(volumeM3(area, room.ceilingHeightMm ?? L.defaultCeilingHeightMm), 2),
    baseWattsPerM2: baseWm2,
    fabricBaseW: round(fabricBaseW, 0),
    factors: [
      { name: 'Ceiling height', key: (room.ceilingHeightMm ?? L.defaultCeilingHeightMm) + ' mm', value: ceilingF },
      { name: 'Climate', key: climate.key, value: climate.value },
      { name: 'Insulation', key: insulation.key, value: insulation.value },
      { name: 'Wall construction', key: wall.key, value: wall.value },
      { name: 'External walls', key: extWalls + ' external', value: extWallF }
    ],
    fabricW: round(fabricW, 0),
    glazing: {
      areaSqM: round(glazingArea, 2),
      assumed: glazingAssumed,
      assumedNote: glazingAssumed
        ? 'Glazing area not entered — assumed ' + round(L.assumedGlazingRatio * 100, 0) + '% of floor area.'
        : null,
      wattsPerM2: L.glazingWattsPerM2,
      typeFactor: { key: glazingType.key, value: glazingType.value },
      orientationFactor: { key: orientation.key, value: orientation.value },
      shadingFactor: { key: shading.key, value: shading.value },
      watts: round(glazingW, 0)
    },
    occupancy: { people: occupants, wattsPerPerson: L.wattsPerOccupant, watts: round(occupancyW, 0) },
    appliances: { watts: round(applianceW, 0) },
    openPlanDiversity: openPlanApplied ? L.openPlanDiversity : null
  };

  return {
    roomId: room.id,
    label: room.label,
    conditioned: room.conditioned,
    areaSqM: round(area, 2),
    coolingW: round(coolingW, 0),
    heatingW: round(heatingW, 0),
    designW: round(Math.max(coolingW, heatingW), 0),
    wattsPerM2: area > 0 ? round(coolingW / area, 1) : 0,
    breakdown,
    overridden: false,
    overrideNote: null
  };
}

/** Estimator override of a calculated room load — recorded, never hidden. */
export function overrideRoomLoad(load, { coolingW, heatingW, note, by = 'estimator' }) {
  const c = coolingW !== undefined && coolingW !== null ? Number(coolingW) : load.coolingW;
  const h = heatingW !== undefined && heatingW !== null ? Number(heatingW) : load.heatingW;
  return {
    ...load,
    coolingW: round(c, 0),
    heatingW: round(h, 0),
    designW: round(Math.max(c, h), 0),
    wattsPerM2: load.areaSqM > 0 ? round(c / load.areaSqM, 1) : 0,
    overridden: true,
    overrideNote: note || 'Load manually adjusted by the estimator.',
    overrideBy: by,
    overrideAt: new Date().toISOString(),
    originalCoolingW: load.originalCoolingW ?? load.coolingW,
    originalHeatingW: load.originalHeatingW ?? load.heatingW
  };
}

/**
 * System-level load from the verified room set.
 * Only rooms cleared by the room-verification screen are included (PART 9).
 */
export function systemLoad(rooms, opts = {}) {
  const settings = opts.settings || DEFAULT_SETTINGS;
  const L = settings.load;
  const included = opts.rooms || sizableRooms(rooms, { allowOverride: !!opts.allowOverride });
  const loads = included.map(r => (opts.loadsById && opts.loadsById[r.id]) || roomLoad(r, opts));

  const rawCoolingW = loads.reduce((s, l) => s + l.coolingW, 0);
  const rawHeatingW = loads.reduce((s, l) => s + l.heatingW, 0);
  const totalAreaSqM = round(loads.reduce((s, l) => s + l.areaSqM, 0), 2);

  const diversifiedCoolingW = rawCoolingW * L.systemDiversity;
  const designCoolingW = diversifiedCoolingW * L.safetyMargin;
  const diversifiedHeatingW = rawHeatingW * L.systemDiversity;
  const designHeatingW = diversifiedHeatingW * L.safetyMargin;

  const withShare = loads.map(l => ({
    ...l,
    shareOfTotal: rawCoolingW > 0 ? round((l.coolingW / rawCoolingW) * 100, 1) : 0
  }));

  const legacy = legacySizing(totalAreaSqM, settings);

  return {
    rooms: withShare,
    roomCount: withShare.length,
    totalConditionedAreaSqM: totalAreaSqM,
    rawCoolingW: round(rawCoolingW, 0),
    rawHeatingW: round(rawHeatingW, 0),
    systemDiversity: L.systemDiversity,
    safetyMargin: L.safetyMargin,
    designCoolingW: round(designCoolingW, 0),
    designHeatingW: round(designHeatingW, 0),
    designCoolingKw: round(designCoolingW / 1000, 2),
    designHeatingKw: round(designHeatingW / 1000, 2),
    designKw: round(Math.max(designCoolingW, designHeatingW) / 1000, 2),
    averageWattsPerM2: totalAreaSqM > 0 ? round(designCoolingW / totalAreaSqM, 1) : 0,
    legacy,
    // How far the detailed calculation sits from NAC's existing rule. A large
    // divergence is a prompt to check the inputs, not a reason to hide either.
    varianceVsLegacyPct: legacy.watts > 0
      ? round(((designCoolingW - legacy.watts) / legacy.watts) * 100, 1) : null,
    assumptions: describeAssumptions(settings, opts)
  };
}

/** The DesignAssumption list shown on the design sheet (PART 11/34). */
export function describeAssumptions(settings = DEFAULT_SETTINGS, opts = {}) {
  const L = settings.load;
  return [
    { key: 'base_w_m2', label: 'NAC all-in rule (comparison)', value: L.baseWattsPerM2 + ' W/m²', source: 'HVAC Design Settings' },
    { key: 'fabric_w_m2', label: 'Fabric base allowance', value: L.fabricWattsPerM2 + ' W/m² (glazing, occupancy and appliances added on top)', source: 'HVAC Design Settings' },
    { key: 'climate', label: 'Climate zone', value: opts.climate || L.defaultClimate, source: 'HVAC Design Settings' },
    { key: 'ceiling_height', label: 'Default ceiling height', value: L.defaultCeilingHeightMm + ' mm', source: 'HVAC Design Settings' },
    { key: 'insulation', label: 'Default insulation', value: L.defaultInsulation, source: 'HVAC Design Settings' },
    { key: 'glazing', label: 'Default glazing', value: L.defaultGlazing, source: 'HVAC Design Settings' },
    { key: 'glazing_ratio', label: 'Assumed glazing where unknown', value: round(L.assumedGlazingRatio * 100, 0) + '% of floor area', source: 'HVAC Design Settings' },
    { key: 'diversity', label: 'System diversity', value: '×' + L.systemDiversity, source: 'HVAC Design Settings' },
    { key: 'safety', label: 'Safety margin', value: '×' + L.safetyMargin, source: 'HVAC Design Settings' },
    { key: 'heating', label: 'Heating load basis', value: '×' + L.heatingFactor + ' of cooling load', source: 'HVAC Design Settings' }
  ];
}
