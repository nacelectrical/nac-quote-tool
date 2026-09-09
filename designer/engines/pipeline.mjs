// NAC AI HVAC DESIGNER — the deterministic pipeline.
//
//   FLOOR PLAN → PLAN INTERPRETATION → ROOM DIMENSIONS → LOAD CALCULATION
//   → EQUIPMENT SELECTION → AIRFLOW → OUTLETS → DUCTS → RETURN AIR → ZONING
//   → MATERIALS → COSTING → CUSTOMER QUOTE
//
// Every stage is a pure function of the design plus HVAC Design Settings. The
// AI assistant reads the output of this pipeline; it never feeds values into it.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { round } from './units.mjs';
import { sizableRooms, blockedRooms, totalConditionedArea } from './rooms.mjs';
import { roomLoad, systemLoad, describeAssumptions } from './loads.mjs';
import { selectEquipment, selectZoneController } from './equipment.mjs';
import { calculateAirflow } from './airflow.mjs';
import { designOutlets } from './outlets.mjs';
import { buildDuctNetwork } from './ducts.mjs';
import { designReturnAir } from './returnair.mjs';
import { suggestZones, analyseZones } from './zones.mjs';
import { estimateStaticPressure } from './pressure.mjs';
import { buildBillOfMaterials, applyBomEdits } from './bom.mjs';
import { calculateLabour, calculateCommercials, toQuoteLineItems } from './costing.mjs';
import { collectWarnings, summarise } from './warnings.mjs';
import { ZONE_CONTROLLERS } from './catalogue.mjs';

/**
 * Run every deterministic stage over a design and return the updated design.
 * Safe to call after any edit — it is a full recompute, so the UI never has to
 * track which stages went stale.
 *
 * @param {Object} design   DuctDesign
 * @param {Object} ctx      { settings, catalogue, controllers, nacRates,
 *                            allowLowConfidence, brandPreference, phase }
 */
export function runPipeline(design, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const d = { ...design };

  // ── 1. Rooms cleared for sizing (PART 9) ──────────────────────────────────
  const included = sizableRooms(d.rooms, { allowOverride: !!ctx.allowLowConfidence });
  const blocked = blockedRooms(d.rooms);
  d.loadWarnings = blocked.map(r => ({
    code: 'UNVERIFIED_ROOM', severity: 'WARNING',
    message: r.label + ' (' + (r.areaSqM ?? '?') + ' m²) is not verified and is excluded from sizing.'
  }));

  // ── 2. Load calculation (PART 10/11) ──────────────────────────────────────
  const loadOpts = { settings, climate: d.job?.climate };
  const overridesById = Object.fromEntries((d.roomLoadOverrides || []).map(o => [o.roomId, o]));
  const loadsById = {};
  for (const r of included) {
    const base = roomLoad(r, loadOpts);
    const ov = overridesById[r.id];
    loadsById[r.id] = ov
      ? { ...base, coolingW: ov.coolingW ?? base.coolingW, heatingW: ov.heatingW ?? base.heatingW,
          designW: Math.max(ov.coolingW ?? base.coolingW, ov.heatingW ?? base.heatingW),
          overridden: true, overrideNote: ov.note || 'Load manually adjusted by the estimator.' }
      : base;
  }
  d.systemLoad = systemLoad(d.rooms, { ...loadOpts, rooms: included, loadsById, allowOverride: !!ctx.allowLowConfidence });
  d.roomLoads = d.systemLoad.rooms;
  d.totalConditionedAreaSqM = totalConditionedArea(d.rooms);
  d.assumptions = describeAssumptions(settings, loadOpts);

  if (!included.length) {
    // Nothing verified yet — stop here rather than producing a design from air.
    d.equipmentSelection = null; d.airflow = null; d.outlets = null; d.network = null;
    d.returnDesign = null; d.zones = null; d.pressure = null; d.bom = null;
    d.labour = null; d.commercials = null;
    d.warnings = collectWarnings(d, ctx);
    d.warningSummary = summarise(d.warnings);
    d.stage = 'awaiting_room_verification';
    return d;
  }

  // ── 3. Equipment selection (PART 13) ──────────────────────────────────────
  const catalogue = ctx.catalogue || [];
  const provisionalAirflowLs = d.systemLoad.designKw * settings.airflow.litresPerSecPerKw;
  d.equipmentSelection = selectEquipment(catalogue, d.systemLoad, {
    settings,
    brandPreference: ctx.brandPreference || d.brandPreference,
    phase: ctx.phase || d.phase,
    requirePrice: ctx.requirePrice,
    designAirflowLs: provisionalAirflowLs
  });

  // Keep the estimator's explicit choice if they made one, otherwise recommend.
  if (d.selectedUnitKey) {
    const [bId, mId] = d.selectedUnitKey.split(':');
    d.selectedUnit = d.equipmentSelection.allCandidates
      .find(c => c.brandId === bId && c.modelId === mId) || d.equipmentSelection.recommended[0] || null;
  } else {
    d.selectedUnit = d.equipmentSelection.recommended[0] || d.equipmentSelection.allCandidates[0] || null;
  }
  if (d.selectedUnit) {
    const brand = catalogue.find(b => b.id === d.selectedUnit.brandId);
    d.brandUrl = brand?.url || '';
  }

  // ── 4. Airflow (PART 14) ──────────────────────────────────────────────────
  d.airflow = calculateAirflow(d.systemLoad, {
    settings, selectedUnit: d.selectedUnit, overridesByRoomId: d.airflowOverrides || {}
  });

  // ── 5. Outlets (PART 15) ──────────────────────────────────────────────────
  d.outlets = designOutlets(included, d.airflow.rows, {
    settings, overridesByRoomId: d.outletOverrides || {}
  });

  // ── 6. Ducts (PART 16/17) ─────────────────────────────────────────────────
  d.network = buildDuctNetwork({
    airflow: d.airflow,
    outlets: d.outlets,
    routesByRoomId: d.ductRoutes || {},
    mainRoute: d.mainRoute,
    diameterOverrides: d.ductDiameterOverrides || {},
    extraFittingsByRoomId: d.extraFittings || {}
  }, { settings });

  // ── 7. Zoning (PART 20) ───────────────────────────────────────────────────
  d.zones = d.zoneDefinitions && d.zoneDefinitions.length
    ? analyseZones(d.zoneDefinitions, d.airflow, { settings })
    : suggestZones(included, d.airflow, { settings });

  const controllers = ctx.controllers || ZONE_CONTROLLERS;
  d.controllerSelection = selectZoneController(controllers, {
    brandId: d.selectedUnit?.brandId,
    zoneCount: d.zones.zoneCount,
    preferId: d.controllerId
  });
  d.controller = d.controllerSelection.recommended
    ? { ...d.controllerSelection.recommended, ...(ctx.controllerPricing?.[d.controllerSelection.recommended.id] || {}) }
    : null;

  // ── 8. Return air (PART 19) ───────────────────────────────────────────────
  d.returnDesign = designReturnAir({
    totalAirflowLs: d.airflow.allocatedAirflowLs,
    returnCount: d.returnCount || 1,
    grilleSizesMm: d.returnGrilleOverrides || null,
    filterSizeMm: d.returnFilterOverride || null,
    ductLengthMm: d.returnDuctLengthMm ?? null,
    diameterOverrideMm: d.returnDuctDiameterOverride || null
  }, { settings });

  // ── 9. Static pressure (PART 21) ──────────────────────────────────────────
  d.pressure = estimateStaticPressure({
    network: d.network, returnDesign: d.returnDesign, outlets: d.outlets,
    selectedUnit: d.selectedUnit, zoneAnalysis: d.zones
  }, { settings });

  // Re-check the selected unit now that a real pressure figure exists.
  if (d.selectedUnit && d.pressure.estimatedRequirementPa) {
    d.equipmentSelection = selectEquipment(catalogue, d.systemLoad, {
      settings,
      brandPreference: ctx.brandPreference || d.brandPreference,
      phase: ctx.phase || d.phase,
      requirePrice: ctx.requirePrice,
      designAirflowLs: d.airflow.allocatedAirflowLs,
      requiredStaticPa: d.pressure.estimatedRequirementPa
    });
    const key = d.selectedUnit.brandId + ':' + d.selectedUnit.modelId;
    d.selectedUnit = d.equipmentSelection.allCandidates
      .find(c => c.brandId + ':' + c.modelId === key) || d.selectedUnit;
  }

  // ── 10. Materials (PART 22) ───────────────────────────────────────────────
  d.bom = buildBillOfMaterials({
    selectedUnit: d.selectedUnit,
    controller: d.controller,
    network: d.network,
    outlets: d.outlets,
    zones: d.zones,
    returnDesign: d.returnDesign,
    refrigerantPipeM: d.refrigerantPipeM ?? 8,
    drainPipeM: d.drainPipeM ?? 6,
    cableM: d.cableM ?? 12,
    extraMaterials: d.extraMaterials || []
  }, { settings, nacRates: ctx.nacRates });

  // Any line the estimator edited by hand is re-applied over the rebuilt BOM.
  d.bom = applyBomEdits(d.bom, d.bomEdits);

  // ── 11. Costing (PART 24) ─────────────────────────────────────────────────
  d.labour = calculateLabour({
    outlets: d.outlets, zones: d.zones, network: d.network, extraLabour: d.extraLabour || []
  }, { settings });

  d.commercials = calculateCommercials({
    bom: d.bom,
    labour: d.labour,
    sellPrice: d.sellPriceOverride ?? d.selectedUnit?.sellPrice ?? null,
    extras: d.quoteExtras || [],
    subcontractorCost: d.subcontractorCost || 0,
    otherCost: d.otherCost || 0
  }, { settings });

  // ── 12. Warnings (PART 27) ────────────────────────────────────────────────
  d.warnings = collectWarnings(d, ctx);
  d.warningSummary = summarise(d.warnings);
  d.quoteLineItems = toQuoteLineItems(d, d.commercials);
  d.stage = 'complete';
  d.settingsSnapshot = { version: settings.version };
  return d;
}

/** PART 25 — the Overview tab. */
export function designSummary(d) {
  return {
    totalConditionedAreaSqM: d.systemLoad?.totalConditionedAreaSqM ?? 0,
    totalCoolingLoadKw: d.systemLoad ? round(d.systemLoad.designCoolingW / 1000, 2) : null,
    totalHeatingLoadKw: d.systemLoad ? round(d.systemLoad.designHeatingW / 1000, 2) : null,
    recommendedSystem: d.equipmentSelection?.recommended?.[0]
      ? d.equipmentSelection.recommended[0].brandName + ' ' + d.equipmentSelection.recommended[0].model +
        ' (' + d.equipmentSelection.recommended[0].capacityKw + ' kW)' : null,
    selectedSystem: d.selectedUnit
      ? d.selectedUnit.brandName + ' ' + d.selectedUnit.model + ' (' + d.selectedUnit.capacityKw + ' kW ' + d.selectedUnit.phase + ')' : null,
    totalAirflowLs: d.airflow?.allocatedAirflowLs ?? null,
    outletCount: d.outlets?.totals?.total ?? null,
    totalDuctLengthM: d.network?.totalDuctLengthM ?? null,
    returnDesign: d.returnDesign
      ? d.returnDesign.returnCount + ' × ' + (d.returnDesign.returns[0]?.grilleSize || '') +
        ' @ ' + d.returnDesign.perReturnLs + ' L/s' : null,
    zoneCount: d.zones?.zoneCount ?? null,
    estimatedStaticPa: d.pressure?.estimatedRequirementPa ?? null,
    unitAvailableStaticPa: d.pressure?.unitAvailableStaticPa ?? null,
    estimatedCost: d.commercials?.totalJobCost ?? null,
    sellPrice: d.commercials?.sellPriceIncGst ?? null,
    grossProfit: d.commercials?.grossProfit ?? null,
    grossMarginPct: d.commercials?.grossMarginPct ?? null,
    warningCounts: d.warningSummary?.counts ?? null,
    canApprove: d.warningSummary?.canApprove ?? false
  };
}
