// NAC AI HVAC DESIGNER — the deterministic pipeline.
//
//   FLOOR PLAN → PLAN INTERPRETATION → ROOM DIMENSIONS → LOAD CALCULATION
//   → EQUIPMENT SELECTION → AIRFLOW → OUTLETS → DUCTS → RETURN AIR → ZONING
//   → MATERIALS → COSTING → CUSTOMER QUOTE
//
// Every stage is a pure function of the design plus HVAC Design Settings. The
// AI assistant reads the output of this pipeline; it never feeds values into it.

import { DEFAULT_SETTINGS } from './settings.mjs';
import { designRulesFor, settingsForDesign } from './design-rules.mjs';
import { buildZoneDampers, validateZoneDampers, applyDamperPlacements } from './zone-dampers.mjs';
import { quoteGate, quoteGateWarnings } from './quote-gate.mjs';
import { buildSchedules } from './schedules.mjs';
import { round } from './units.mjs';
import { sizableRooms, blockedRooms, totalConditionedArea,
         deriveBoundariesFromPrintedSizes } from './rooms.mjs';
import { calibrationRequirement, deriveCalibrationFromRooms } from './calibration.mjs';
import { classificationSummary, isConditionedRoom, isExcludedRoom } from './classify.mjs';
import { roomLoad, systemLoad, describeAssumptions } from './loads.mjs';
import { selectEquipment, selectZoneController } from './equipment.mjs';
import { calculateAirflow, applySystemShares } from './airflow.mjs';
import { designOutlets } from './outlets.mjs';
import { buildDuctNetwork } from './ducts.mjs';
import { buildDuctTree, measureTree, scoreRoute, routeConfidence,
         buildReturnRoutes, placeZoneDampers, ROUTING_MODE } from './router.mjs';
import { deriveBtos, validateBtos, btoBomLines, withBody, labelBtos,
         applyBtoOverrides } from './bto.mjs';
import { buildReturnComponents, validateReturnSeparation, returnComponentCounts,
         findSupplyReturnClashes } from './return-model.mjs';
import { buildAreaTopology } from './area-router.mjs';
import { recommendedSupplySpigotCount, validateSupplySpigots } from './supply-spigots.mjs';
import { selectSupplySpigotArrangement, overrideSpigotArrangement,
         remeasureSelection } from './spigot-selection.mjs';
import { assessPlacement } from './placement.mjs';
import { buildNacTopology, validateNacTopology, topologyTable } from './nac-router.mjs';
import { designReturnAir } from './returnair.mjs';
import { suggestZones, analyseZones } from './zones.mjs';
import { zoningSafety } from './zoning-safety.mjs';
import { suggestOpenPlanGroups, applyOpenPlanGroups, zoneRemedies,
         zoningAlreadySet } from './zoning-groups.mjs';
import { estimateStaticPressure } from './pressure.mjs';
import { buildBillOfMaterials, applyBomEdits } from './bom.mjs';
import { calculateLabour, calculateCommercials, toQuoteLineItems } from './costing.mjs';
import { collectWarnings, summarise, resetDerivedWarnings } from './warnings.mjs';
import { capabilities, DESIGN_STAGE, ROOM_STATUS_PROVISIONAL, proposalAllowance }
  from './design-stage.mjs';
import { checkSupplyGraph, checkPlenum, checkDuctSizes, pressureReadiness,
         supplyMains, PRESSURE_STATUS } from './supply-graph.mjs';
import { ZONE_CONTROLLERS } from './catalogue.mjs';
import { buildOutletRegister, checkOutletConsistency } from './outlet-register.mjs';
import { nacScheduleData } from './nac-schedule.mjs';
import { pricingRequirements } from './pricing-mode.mjs';
import { usedRateStatus } from './material-verification.mjs';
import { proposalStageAudit } from './scale-invalidation.mjs';

/**
 * The corridors the return-air flexes will occupy, as keep-out segments.
 *
 * ROUTED BY THE SAME FUNCTION THAT WILL DRAW THEM. An earlier version guessed
 * the shape — first a straight line from grille to unit, then a square corner
 * on the unit's own centre — and both guesses were wrong in the same expensive
 * way: they reported BTO-C2 comfortably clear of R2 while the duct that
 * actually got drawn passed within 0.4 m of it. `buildReturnRoutes` is pure and
 * needs only the layout and the scale, so there is nothing to guess.
 *
 * The half-width is the duct's radius plus the half-width of a fabricated
 * take-off body plus a working clearance — a metre or so, because a label on a
 * leader needs more room than the metal does.
 */
function returnCorridors(d) {
  const ppm = d.calibration?.pixelsPerMm || 0;
  if (!ppm) return [];
  const layout = d.layout || {};
  const unit = layout.indoorUnit || layout.plenum || d.autoRoute?.plenum || null;
  if (!unit || unit.x === undefined) return [];
  // How many returns there will be: whatever has been placed, which is what the
  // return router will find too. The return DESIGN is settled later in this
  // pipeline, so it cannot be asked yet.
  let placed = 0;
  for (let i = 0; i < 8; i++) {
    const g = layout['returnGrille' + (i === 0 ? '' : '_' + (i + 1))];
    if (g && g.x !== undefined) placed = i + 1;
  }
  if (!placed) return [];
  const ductMm = d.returnDesign?.duct?.diameterMm || 400;
  const routed = buildReturnRoutes({
    layout: { ...layout, indoorUnit: unit },
    returnDesign: { returnCount: placed, duct: { diameterMm: ductMm } },
    rooms: [], calibration: d.calibration });
  // The duct's own radius plus the half-width of a fabricated take-off body
  // plus a working gap: enough that the two pieces of metal do not share
  // ceiling and somebody can reach both. Wider than this starts buying duct —
  // at 900 mm it pushed BTO-C2 three and a half metres of flex away from the
  // bedrooms it feeds, which is a real cost for a drawing problem the label
  // placer already solves.
  const halfWidthPx = (ductMm / 2 + 450) * ppm;
  const out = [];
  for (const r of (routed.routes || [])) {
    for (let i = 1; i < r.points.length; i++) {
      out.push({ a: r.points[i - 1], b: r.points[i], halfWidthPx });
    }
  }
  return out;
}

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
  // ── EVERY DERIVED WARNING IS REBUILT, NEVER ADDED TO ────────────────────
  //
  // `routeWarnings` was only ever appended to, and the design object survives
  // between runs, so every recomputation left the last run's warnings on the
  // job and added one more. A real plan reached 196 of them, and a CRITICAL
  // blocker from an intermediate state — "the mains carry 2302 L/s against
  // 901 L/s of outlets" — stayed on the design, blocking finalisation, long
  // after the live check read 900 against 900 with nothing wrong.
  //
  // So the derived lists are cleared here, at the one point every full run
  // passes through, and rebuilt from the state the run actually sees. What a
  // PERSON put on the job — acknowledgements, site notes, photos, overrides —
  // is not derived and is not touched.
  const cleared = resetDerivedWarnings(design);

  // ── THE RULES THIS JOB WAS DESIGNED TO COME FIRST ────────────────────────
  //
  // A design carries its own minimum branch diameter and its own minimum
  // BTO-to-outlet run. Application settings seed those when the design is
  // created; after that the DESIGN owns them, so opening the same job in a
  // different app instance cannot resize its ducts. That is exactly what put
  // ø200 back on the Foyer, the Master Bedroom and three bedrooms of a job
  // approved at ø250.
  const settings = settingsForDesign(design, ctx.settings || DEFAULT_SETTINGS);
  const d = { ...design, ...cleared };
  d.designRules = designRulesFor(design, ctx.settings || DEFAULT_SETTINGS);

  // ── 0. Classification, then scale (RULES 1, 4 and 6) ──────────────────────
  // Who is being air conditioned is settled before anything else is asked, so
  // that nothing downstream — not the verification queue, not the calibration
  // test — ever considers a room NAC was never going to condition.
  d.classification = classificationSummary(d.rooms);

  // Whether the estimator has to calibrate by hand is judged on CONDITIONED
  // rooms only. A bathroom with no readable size is not a reason to calibrate.
  d.calibrationRequirement = calibrationRequirement(d.rooms, { calibration: d.calibration });

  // Duct lengths are measured off the drawing, so a scale is still wanted even
  // when the room areas did not need one. If the plan's own dimensioned rooms
  // state the scale, take it from them rather than stopping to ask.
  if (!d.calibration?.pixelsPerMm) {
    const derived = deriveCalibrationFromRooms(d.rooms, {
      imageWidthPx: d.plan?.widthPx ?? null, imageHeightPx: d.plan?.heightPx ?? null });
    d.derivedCalibration = derived;
    if (derived.ok) {
      // A scale read off the plan's OWN printed dimensions, and cross-checked
      // between at least two rooms that agree, is a verified scale — the
      // drawing measured itself. It is recorded as such here so the scale gate
      // downstream can tell it apart from a figure somebody declared.
      d.calibration = { ...derived.calibration, verified: true,
                        source: 'printed_dimension',
                        derivedFromRooms: (derived.readings || []).map(r => r.label) };
    }
  } else {
    d.derivedCalibration = null;
  }

  // A room measured off its printed size but never placed on the drawing has
  // nothing for the duct router to route to. Give it its rectangle now that a
  // scale exists, so the DESIGN step draws a layout instead of a blank plan.
  if (d.calibration?.pixelsPerMm) {
    d.rooms = deriveBoundariesFromPrintedSizes(d.rooms, d.calibration, {
      imageWidthPx: d.plan?.widthPx ?? null, imageHeightPx: d.plan?.heightPx ?? null });
  }

  // ── 0a-ii. WHAT THIS JOB IS ALLOWED TO DO ────────────────────────────────
  // Asked once, here, and consulted by every stage below. A job whose scale
  // came off a car drawn on a marketing plan may not select equipment or carry
  // a price; a job still at proposal stage may not invent ductwork. Both of
  // those happened, and both produced confident numbers.
  d.capabilities = capabilities(d, { settings });
  d.designStage = d.capabilities.stage;

  // A room measured through an unverified scale is not verified, whatever the
  // measurement confidence says about the pixels.
  if (!d.capabilities.mayMeasureRooms) {
    // Only the rooms that actually lean on the scale. A room the estimator
    // typed in, or one read off a printed dimension, is measured and stays
    // measured whatever the pixels say.
    const SCALED = new Set(['calibrated_geometry', 'estimated']);
    // And only rooms that had otherwise CLEARED. This gate downgrades; it never
    // promotes. A room sitting at Review or Needs a dimension has a problem the
    // scale has nothing to do with, and it stays blocked on that problem.
    const CLEARED = new Set(['Verified', 'Manual']);
    d.rooms = d.rooms.map(r =>
      r.conditioned && CLEARED.has(r.status) && SCALED.has(r.measurement?.source)
        ? { ...r, status: ROOM_STATUS_PROVISIONAL, scaleUnverified: true,
            areaProvisional: true, statusBeforeScaleGate: r.status }
        : r);
  }

  // ── 0b. Which rooms share an air space (PART 20) ──────────────────────────
  // Rooms that are open to one another cannot be dampered apart, so they are
  // one zone whether anyone says so or not. Nothing on a real plan ever set
  // this, which is how a four-bedroom house came out with eleven zones, an
  // unnecessary controller kit and a failed minimum-airflow check.
  //
  // It runs HERE, before the load, because grouping applies open-plan
  // diversity — so it has to be settled before a single watt is worked out.
  if (d.rooms?.length && !zoningAlreadySet(d.rooms)) {
    d.openPlanSuggestion = suggestOpenPlanGroups(d.rooms, {
      settings, calibration: d.calibration, walls: d.walls, openings: d.openings });
    d.rooms = applyOpenPlanGroups(d.rooms, d.openPlanSuggestion);
  } else if (d.rooms?.length) {
    d.openPlanSuggestion = { groups: [], assignments: {}, confidence: 'HIGH',
      method: 'already_set', openPlanRoomCount: 0,
      notes: ['The zoning on this job was already set, so it was left alone.'], warnings: [] };
  }

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

  // ── A LOAD THE ESTIMATOR STATES ──────────────────────────────────────────
  //
  // The calculation is built on room areas measured off a plan image. An
  // estimator who has walked the house knows things the pixels do not: that an
  // open-plan rectangle swept in the circulation space, that a room is not
  // really conditioned, that the glazing is nothing like the default.
  //
  // On 34 Kauri the engine read 18.82 kW off 143.1 m² while Nick put the job at
  // 15.8 kW. He is right that a Family/Meals/Kitchen block measuring 7.5 × 7.6 m
  // is suspect — but the fix is NOT to quietly shrink a rectangle until the
  // total matches, because then neither number means anything afterwards.
  //
  // So a stated load is a recorded input, exactly like a calibration: a figure,
  // a person, a time and a reason. The calculated figure is kept beside it,
  // never overwritten, and a material divergence is reported rather than
  // smoothed away. Everything downstream — equipment, airflow, price — follows
  // the stated figure, because that is what the estimator is standing behind.
  if (d.statedLoad && Number(d.statedLoad.designKw) > 0 && String(d.statedLoad.statedBy ?? '').trim()) {
    const calculatedKw = d.systemLoad.designKw;
    const statedKw = round(Number(d.statedLoad.designKw), 2);
    const scale = calculatedKw > 0 ? statedKw / calculatedKw : 1;
    d.systemLoad = {
      ...d.systemLoad,
      designKw: statedKw,
      designCoolingKw: round(d.systemLoad.designCoolingKw * scale, 2),
      designHeatingKw: round(d.systemLoad.designHeatingKw * scale, 2),
      designCoolingW: round(d.systemLoad.designCoolingW * scale, 0),
      designHeatingW: round(d.systemLoad.designHeatingW * scale, 0),
      loadSource: 'estimator_stated',
      statedBy: String(d.statedLoad.statedBy ?? '').trim(),
      statedAt: d.statedLoad.at || new Date().toISOString(),
      statedNote: d.statedLoad.note || null,
      // NEVER overwritten. The working stays visible.
      calculatedKw,
      calculatedAreaSqM: d.systemLoad.totalConditionedAreaSqM,
      divergencePct: calculatedKw > 0
        ? round(((statedKw - calculatedKw) / calculatedKw) * 100, 1) : null
    };
    const diff = Math.abs(d.systemLoad.divergencePct ?? 0);
    d.routeWarnings = [...(d.routeWarnings || []), {
      code: diff > 10 ? 'STATED_LOAD_DIVERGES' : 'LOAD_STATED_BY_ESTIMATOR',
      severity: diff > 10 ? 'WARNING' : 'INFO',
      area: 'load',
      message: 'Design load is ' + statedKw + ' kW as stated by ' + d.systemLoad.statedBy
        + ', against ' + calculatedKw + ' kW calculated from '
        + d.systemLoad.calculatedAreaSqM.toFixed(1) + ' m² of measured rooms'
        + (d.systemLoad.divergencePct !== null
            ? ' (' + (d.systemLoad.divergencePct > 0 ? '+' : '') + d.systemLoad.divergencePct + '%)' : '')
        + '. ' + (d.statedLoad.note || '')
        + (diff > 10 ? ' A gap this size usually means a room rectangle is wrong — '
            + 'worth resolving before the duct design.' : '')
    }];
  }
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
    // What the SITE has, which is a different question from what to filter the
    // catalogue by. Left unset, a three-phase unit has to be confirmed.
    sitePhase: ctx.sitePhase ?? d.sitePhase ?? null,
    requirePrice: ctx.requirePrice ?? d.requirePrice,
    requireCost: ctx.requireCost ?? d.requireCost,
    designAirflowLs: provisionalAirflowLs
  });

  // ── EQUIPMENT IS NOT SELECTED FROM AN UNVERIFIED SCALE ───────────────────
  // The Kauri report said in its own words that equipment must not be selected
  // because the scale moved the load from 14 to 18 kW, and then selected a
  // 16 kW Daikin anyway — into the design summary, the bill of materials and
  // the price. A block that the next paragraph ignores is not a block.
  //
  // The CANDIDATES stay: an estimator comparing options internally is exactly
  // what the list is for. What does not happen is a selection.
  if (!d.capabilities.maySelectEquipment) {
    d.selectedUnit = null;
    d.equipmentBlocked = {
      blocked: true,
      reason: d.capabilities.reasonFor('selectEquipment'),
      candidatesForComparisonOnly: true
    };
  } else if (d.selectedUnitKey) {
    d.equipmentBlocked = null;
    const [bId, mId] = d.selectedUnitKey.split(':');
    d.selectedUnit = d.equipmentSelection.allCandidates
      .find(c => c.brandId === bId && c.modelId === mId) || d.equipmentSelection.recommended[0] || null;
  } else {
    d.equipmentBlocked = null;
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

  // ── 4b. SPILL ROOMS ───────────────────────────────────────────────────────
  //
  // A room that is open to the space beside it does not always get its own
  // outlet. The study on a renovated open plan is the case: it is conditioned,
  // it keeps its floor area and its heat load, and it is served by air spilling
  // in from the room it opens onto. What it must NOT have is an outlet or a
  // duct run of its own.
  //
  // So its airflow is not deleted — that would quietly shrink the system — it
  // is REDISTRIBUTED across the rooms it spills from, and the move is recorded
  // so the schedule can say where the air went.
  d.spillAllocations = [];
  const spillIds = new Set(d.spillRoomIds || []);
  if (spillIds.size) {
    const rows = d.airflow.rows || [];
    const donors = rows.filter(r => !spillIds.has(r.roomId) &&
      (d.spillIntoRoomIds ? d.spillIntoRoomIds.includes(r.roomId) : true));
    const donorTotal = donors.reduce((n, r) => n + (r.adjustedLs || 0), 0);
    for (const r of rows) {
      if (!spillIds.has(r.roomId) || !donorTotal) continue;
      const moved = r.adjustedLs || 0;
      d.spillAllocations.push({ roomId: r.roomId, label: r.label, airflowLs: moved,
        intoRoomIds: donors.map(x => x.roomId),
        reason: r.label + ' is open to the space beside it and takes spill air. Its ' +
                moved + ' L/s is carried by the outlets it spills from; it gets no ' +
                'outlet and no duct of its own.' });
      r.spillOnly = true;
      r.spilledLs = moved;
      r.adjustedLs = 0;
      const factor = (donorTotal + moved) / donorTotal;
      for (const dn of donors) dn.adjustedLs = Math.round((dn.adjustedLs || 0) * factor);
    }
    // ── THE SHARES FOLLOW THE AIR ──────────────────────────────────────────
    //
    // Redistributing spill air moves DESIGN airflow between rooms, so every
    // room's share of the system changed the moment that loop ran. Leaving the
    // shares as the calculator first worked them out is how the Study came to
    // print 0 L/s and 5.4% of system on the same line — 5.4% being its share of
    // the airflow it was RECOMMENDED, not of the airflow it is designed to get.
    //
    // This is presentation only: no airflow figure is touched here, so the
    // allocated total, the duct sizing and everything downstream are unchanged.
    applySystemShares(d.airflow.rows || []);
  }

  // ── 5. Outlets (PART 15) ──────────────────────────────────────────────────
  d.outlets = designOutlets(included.filter(r => !spillIds.has(r.id)),
    (d.airflow.rows || []).filter(r => !spillIds.has(r.roomId)), {
      settings, overridesByRoomId: d.outletOverrides || {},
      outletPositionSourceByRoomId: d.outletPositionSources || {}
    });

  // ── 6. Ducts (PART 16/17) + AUTO ROUTING ──────────────────────────────────
  //
  // In AUTO the tool lays the system out itself: a trunk from the plenum,
  // junctions along it, branches to groups of rooms, and the trunk stepping
  // down after each take-off. The routed drawing then becomes the source of
  // every length, because that is the duct somebody actually buys and hangs.
  //
  // Geometry the estimator has LOCKED is preserved — re-routing must never
  // throw away a run they positioned around a truss they have seen.
  const mode = d.routingMode || ROUTING_MODE.AUTO;
  // A job that may not route ducts may not choose the spigots they leave
  // through either. Running the arrangement selection on an unrouted design
  // asks it to reconcile mains that do not exist against outlets that do, and
  // it correctly answers "0 L/s against 736 L/s" — a real failure, reported
  // about a duct system nobody has drawn yet. The absent ductwork is already
  // said once, plainly, by the capability block.
  if (mode === ROUTING_MODE.AUTO && !d.routingSuspended && d.capabilities.mayRouteDucts) {
    // Zoning is worked out below, but a branch has to know its zone at the
    // moment it is created or the damper has nothing to sit on. Working it out
    // here costs one call and keeps the drawing and the zone plan in step.
    const zonesForRouting = d.zoneDefinitions && d.zoneDefinitions.length
      ? analyseZones(d.zoneDefinitions, d.airflow, { settings })
      : suggestZones(included, d.airflow, { settings });
    // THE NAC FLEX DUCT ROUTING MODEL. Not the old trunk-and-spine router:
    // PLENUM -> 2 or 3 MAINS -> BTOs -> one continuous final flex -> OUTLET,
    // with the geometry swept the way flex actually lies in a roof space.
    // ── HOW MANY DUCTS LEAVE THE PLENUM ───────────────────────────────────
    //
    // A recommendation the engine always makes, and an installer choice that
    // always wins. The recommendation is reported either way, so a job that
    // was set by hand still shows what the rule would have said.
    // ── WHICH ARRANGEMENT, NOT HOW MANY OUTLETS ───────────────────────────
    //
    // Nick: "Do not use outlet count as the deciding rule." So the decision is
    // a choice between whole arrangements — 2 × ø350, 2 × ø400, 3 × ø400 and
    // anything the unit or the job configures — each measured against the
    // equipment, the airflow, the available static, the velocity ceiling, the
    // pressure loss, the fabricated plenum, the installer areas, the roof and
    // the collar spacing. The outlet count is carried as an input and decides
    // nothing.
    d.spigotSelection = selectSupplySpigotArrangement({
      unit: d.selectedUnit || null,
      systemAirflowLs: d.airflow.allocatedAirflowLs,
      availableStaticPa: d.selectedUnit?.availableStaticPa ?? null,
      installerAreas: d.installerAreas || d.supplyMainConfig?.areas || null,
      // INSTALLER AREAS, NOT ZONES. A zone is a damper's worth of rooms; an
      // installer area is a main's worth of house, and a job routinely has six
      // of the first and three of the second. Reading the zone count here made
      // the sheet claim six areas on a three-main job.
      installerAreaCount: d.installerAreaCount ??
        (d.installerAreas?.length ?? d.supplyMainConfig?.areas?.length ??
         (zonesForRouting?.zones?.length || 0)),
      roofGeometry: d.roofGeometry || null,
      mainRouteLengthsM: d.mainRouteLengthsM || null,
      // On a design that has been routed before, the mains have a MEASURED
      // length and the pressure term is real. On the first pass there is none,
      // and the result says the loss could not be worked out rather than
      // printing a zero as though it had been.
      longestMainRouteM: d.longestMainRouteM ?? measuredLongestMainM(d),
      allowWidenedPlenum: d.allowWidenedPlenum !== false,
      maxPlenumWidthMm: d.maxPlenumWidthMm ?? null,
      arrangements: d.spigotArrangements || [],
      outletCount: d.outlets.totals.total
    }, { settings });
    // The old outlet-count table, kept only so a sheet can show what the
    // superseded rule would have said. NOTHING reads it to decide anything.
    d.spigotRecommendation = recommendedSupplySpigotCount(d.outlets.totals.total, {
      settings, systemAirflowLs: d.airflow.allocatedAirflowLs,
      diameterMm: d.supplyMainConfig?.diameterMm || 400
    });

    // ── A SAVED OR APPROVED DESIGN IS NEVER SILENTLY REROUTED ─────────────
    //
    // Nick: "Do not silently reroute saved or approved designs when this logic
    // is introduced." A design that already carries `supplyMainConfig` keeps
    // it, whatever the selection would now pick; the selection is recorded
    // beside it so the difference is visible rather than applied.
    const useAreaRouter = d.routingStrategy === 'area' || !!d.supplyMainConfig;
    const chosen = d.spigotSelection?.chosen || null;
    const effectiveMainConfig = d.supplyMainConfig || (chosen ? {
      count: chosen.count, diameterMm: chosen.diameterMm, source: 'selected',
      selectionKey: chosen.key
    } : { count: 2, diameterMm: 400, source: 'fallback_no_feasible_arrangement' });
    // ── THE INSTALLER'S OWN CHOICE, WITH ITS AUDIT RECORD ────────────────
    //
    // Nick: "Allow installer override, recording: original recommendation;
    // selected override; person; date and time; reason." The override wins; it
    // is still measured, and anything it overrides is carried as a warning
    // rather than being quietly accepted.
    if (d.supplyMainConfig) {
      d.spigotOverride = overrideSpigotArrangement(d.spigotSelection, {
        count: d.supplyMainConfig.count,
        diameterMm: d.supplyMainConfig.diameterMm,
        by: d.supplyMainConfig.approvedBy || d.supplyMainConfig.by || null,
        at: d.supplyMainConfig.approvedAt || d.supplyMainConfig.at || null,
        reason: d.supplyMainConfig.reason || d.supplyMainConfig.note || '',
        job: {
          unit: d.selectedUnit || null,
          systemAirflowLs: d.airflow.allocatedAirflowLs,
          availableStaticPa: d.selectedUnit?.availableStaticPa ?? null,
          installerAreaCount: d.installerAreaCount ??
            (d.installerAreas?.length ?? d.supplyMainConfig?.areas?.length ??
             (zonesForRouting?.zones?.length || 0)),
          roofGeometry: d.roofGeometry || null,
          longestMainRouteM: d.longestMainRouteM ?? measuredLongestMainM(d),
          allowWidenedPlenum: d.allowWidenedPlenum !== false,
          outletCount: d.outlets.totals.total
        }
      }, { settings });
      if (d.spigotOverride.warnings.length) {
        d.routeWarnings = [...(d.routeWarnings || []), ...d.spigotOverride.warnings];
      }
    }
    if (d.supplyMainConfig && chosen &&
        (d.supplyMainConfig.count !== chosen.count ||
         d.supplyMainConfig.diameterMm !== chosen.diameterMm)) {
      d.spigotSelectionDiffers = {
        stored: { count: d.supplyMainConfig.count, diameterMm: d.supplyMainConfig.diameterMm },
        wouldChoose: { count: chosen.count, diameterMm: chosen.diameterMm },
        message: 'This design is built as ' + d.supplyMainConfig.count + ' × ø' +
          d.supplyMainConfig.diameterMm + ', which is what was saved and approved. The ' +
          'selection would now choose ' + chosen.text + '. Nothing has been changed — ' +
          'reroute deliberately if that is wanted.'
      };
    }
    const tree = useAreaRouter ? measureTree(buildAreaTopology({
      rooms: included, airflow: d.airflow, outlets: d.outlets,
      layout: d.layout || {}, zones: zonesForRouting,
      mainConfig: effectiveMainConfig,
      // WHERE A FITTING MAY NOT BE SET. The router only ever sees the rooms
      // cleared for sizing, so the bathrooms, the ensuite, the laundry and the
      // garage are invisible to it — and those are exactly the ceilings a BTO
      // must not be moved into when the 2.0 m rule pushes it off an outlet.
      avoidRooms: (d.rooms || []).filter(r => isExcludedRoom(r) && r.boundaryPx),
      // WHERE THE RETURN AIR WILL RUN. The return routes are designed later in
      // this pipeline, but the grilles and the unit are already placed, so the
      // corridor between them is known now — and a supply take-off set in it
      // would clash in the roof and, on the drawing, read as a BTO plumbed into
      // the return. BTO-C was landing a few centimetres off the return
      // plenum's own collar for exactly this reason.
      avoidSegments: returnCorridors(d)
    }, { settings, calibration: d.calibration }), d.calibration, { settings })
    : measureTree(buildNacTopology({
      rooms: included, airflow: d.airflow, outlets: d.outlets,
      layout: d.layout || {}, zones: zonesForRouting,
      returnDesign: d.returnDesign || null
      // The router needs the scale to know how far along a main a reduction
      // actually falls: a reducer 130 mm off the plenum is not something
      // anybody fits, and that is a judgement in metres, not pixels.
    }, { settings, calibration: d.calibration,
         returnCount: d.returnCount ?? undefined }), d.calibration, { settings });
    d.autoRoute = applyLockedGeometry(tree, d, settings);
  } else if (mode !== ROUTING_MODE.AUTO && d.autoRoute?.generated) {
    // Kept as it was: switching to MANUAL does not delete the estimator's work.
    d.autoRoute = { ...d.autoRoute, stale: true };
  }

  // ── THE DUCT PIPELINE DOES NOT RUN BEFORE THE DESIGN STAGE ──────────────
  // 34 Kauri was explicitly proposal-stage with duct design deferred, and this
  // pipeline produced ten supply mains, a 4,660 mm plenum, BTOs, Y-pieces,
  // duct diameters, a duct bill of materials and a static pressure anyway.
  // None of it described anything, because there was nothing to describe.
  d.network = d.capabilities.mayRouteDucts
    ? buildDuctNetwork({
        airflow: d.airflow,
        outlets: d.outlets,
        routesByRoomId: d.ductRoutes || {},
        mainRoute: d.mainRoute,
        diameterOverrides: d.ductDiameterOverrides || {},
        extraFittingsByRoomId: d.extraFittings || {},
        topology: d.autoRoute?.generated && !d.autoRoute.stale ? d.autoRoute : null
      }, { settings })
    : { sections: [], totalDuctLengthM: 0, routed: false,
        notRouted: true,
        reason: d.capabilities.reasonFor('routeDucts') };

  // How good is the routed layout, and how much of it rests on something
  // solid? Never 'install-ready' — the best it can say is that the geometry it
  // was handed was good.
  if (d.network?.routed && d.autoRoute?.generated) {
    d.routeScore = scoreRoute(d.network, d.autoRoute, { settings });
    d.autoRoute = { ...d.autoRoute,
      confidence: routeConfidence({ design: d, tree: d.autoRoute, score: d.routeScore }).band,
      confidenceDetail: routeConfidence({ design: d, tree: d.autoRoute, score: d.routeScore }) };
  } else {
    d.routeScore = null;
  }

  // ── 7. Zoning (PART 20) ───────────────────────────────────────────────────
  d.zones = d.zoneDefinitions && d.zoneDefinitions.length
    ? analyseZones(d.zoneDefinitions, d.airflow, { settings })
    : suggestZones(included, d.airflow, { settings });

  // When the zoning does not work, name the merge that would fix it rather than
  // leaving the estimator with a percentage and no next step.
  d.zoneRemedies = zoneRemedies(d.zones, d.rooms, {
    settings, controllerMaxZones: d.controller?.maxZones ?? settings.zoning.maxZones });

  const controllers = ctx.controllers || ZONE_CONTROLLERS;
  d.controllerSelection = selectZoneController(controllers, {
    brandId: d.selectedUnit?.brandId,
    zoneCount: d.zones.zoneCount,
    preferId: d.controllerId || settings.equipment.defaultControllerId || null
  });
  // A price NAC has set in the existing Price Setup screen wins over the
  // supplier list, but the supplier cost always comes through.
  d.controller = d.controllerSelection.recommended
    ? { ...d.controllerSelection.recommended,
        ...(ctx.controllerPricing?.[d.controllerSelection.recommended.id] || {}) }
    : null;

  // ── 8. Return air (PART 19) ───────────────────────────────────────────────
  d.returnDesign = designReturnAir({
    totalAirflowLs: d.airflow.allocatedAirflowLs,
    // null lets the NAC DUCT DESIGN STANDARD decide one or two; an estimator's
    // own choice still wins.
    returnCount: d.returnCount ?? null,
    grilleSizesMm: d.returnGrilleOverrides || null,
    filterSizeMm: d.returnFilterOverride || null,
    ductLengthMm: d.returnDuctLengthMm ?? null,
    diameterOverrideMm: d.returnDuctDiameterOverride || null,
    // The fan coil's own return spigots outrank any calculation — and without
    // this the manufacturer data was never consulted at all.
    unit: d.selectedUnit || null
  }, { settings });

  // ── 8b. Return air routing (PART 11) and zone dampers (PART 12) ───────────
  // The return is a different system and is drawn as one. Both are only routed
  // once the supply has been, so they follow the same AUTO / MANUAL choice.
  if (mode === ROUTING_MODE.AUTO && !d.routingSuspended) {
    // The auto router has already decided where the plenum sits. The return
    // comes back to that same point, so it is handed over — without it the
    // return silently fails to route on every auto-designed job and the
    // estimator has to place the indoor unit by hand before seeing a return.
    // The returns come from the SAME topology model as the supply, so what is
    // drawn, what is measured and what is bought cannot disagree.
    const ret = d.autoRoute?.returnRuns?.length
      ? { generated: true, routes: d.autoRoute.returnRuns, warnings: [] }
      : (() => {
          const retLayout = { ...(d.layout || {}) };
          if (!retLayout.indoorUnit && !retLayout.plenum && d.autoRoute?.plenum) {
            retLayout.plenum = d.autoRoute.plenum;
          }
          // The scale, so each return's own lane is a real distance from the
          // next rather than a number of pixels that means nothing.
          return buildReturnRoutes({ layout: retLayout, returnDesign: d.returnDesign,
                                     rooms: included, calibration: d.calibration });
        })();
    if (ret.generated) {
      const measured = measureTree({ segments: ret.routes.map(r => ({ ...r, role: 'return' })) },
                                   d.calibration, { settings });
      d.returnRoutes = measured.segments;
      d.returnRoute = measured.segments[0] || null;
      // The routed return length replaces the assumption, same rule as supply.
      if (d.returnRoute?.lengthMm) {
        d.returnDesign = designReturnAir({
          totalAirflowLs: d.airflow.allocatedAirflowLs,
          returnCount: d.returnCount ?? null,
          grilleSizesMm: d.returnGrilleOverrides || null,
          filterSizeMm: d.returnFilterOverride || null,
          ductLengthMm: d.returnRoute.lengthMm,
          diameterOverrideMm: d.returnDuctDiameterOverride || null,
          // Same here: the re-measure must not lose the unit's own connection.
          unit: d.selectedUnit || null
        }, { settings });
      }
    }
    d.returnRouteWarnings = ret.warnings || [];
  }

  // HARD NAC RULE 9 — the topology is checked against every hard rule before it
  // is drawn, priced or sent. Run here, after the return is designed, so the
  // return count is a real number and not an unchecked null.
  d.topologyCheck = d.network?.routed
    ? validateNacTopology(d.network, { returnCount: d.returnDesign?.returnCount ?? null })
    : null;
  if (d.topologyCheck && !d.topologyCheck.ok) {
    d.routeWarnings = [
      ...(d.routeWarnings || []),
      ...d.topologyCheck.failures.map(f => ({
        code: 'NAC_TOPOLOGY_' + f.code, severity: 'CRITICAL',
        message: f.message + (f.detail ? ' (' + f.detail + ')' : '')
      }))
    ];
  }

  // ── 8b-i. MOTORISED ZONE DAMPERS, AS COMPONENTS ──────────────────────────
  //
  // The router decides WHERE a zone needs a motor. Everything else about the
  // fitting — its size, its airflow, its velocity, its part number and its
  // price — is read from the duct it is fitted in, so the drawing, the
  // schedule, the order and the quote cannot hold different sizes for the same
  // damper. Change the duct and all of them move.
  d.zoneDampers = d.network?.routed
    ? buildZoneDampers(
        // The router places them; the site edits move, delete, reassign and add.
        applyDamperPlacements(
          placeZoneDampers(d.network, { zoneOverrides: d.zoneDamperOverrides || {},
                                        zones: d.zones }),
          d.zoneDamperOverrides || {}, d.network),
        d.network,
        { nacRates: ctx.nacRates || null,
          sizeOverrides: d.zoneDamperSizeOverrides || {} })
    : [];
  d.zoneDamperValidation = validateZoneDampers(d.zoneDampers, { network: d.network });
  if (!d.zoneDamperValidation.ok) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.zoneDamperValidation.failures.map(f => ({
      code: f.code, severity: 'CRITICAL', message: f.message }))];
  }

  // ── 8c. THE PHYSICAL BRANCH TAKE-OFFS ────────────────────────────────────
  // A BTO is a fitting somebody buys and lifts into a roof, not a number stuck
  // on an outlet. They are DERIVED from the sized network — wherever two or
  // more runs leave the same duct at the same place — so the drawing, the
  // schedule and the order all read one object.
  d.btos = applyBtoOverrides(
      labelBtos(d.network?.routed ? deriveBtos(d.network) : [], d.network),
      d.btoOverrides || {}, d.network)
    .map(b => withBody(b, { allowances: settings.btoFabrication || undefined }));
  d.btoValidation = validateBtos(d.btos);
  if (d.btoValidation.warnings?.length) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.btoValidation.warnings.map(w => ({
      code: 'BTO_' + w.code, severity: 'WARNING', message: w.message }))];
  }

  // ── 8c-i. THE RETURN SIDE, AS ITS OWN ENTITIES ───────────────────────────
  // A BTO is a supply-air distribution fitting and nothing else. The return has
  // grilles, ducts and a fan-coil return box — typed separately so that a
  // junction on the return path can never be counted, drawn or priced as a
  // take-off, and so that neither side can pick up the other's dampers, colours
  // or BOM category.
  d.returnComponents = buildReturnComponents({
    returnDesign: d.returnDesign, returnRoutes: d.returnRoutes || [], layout: d.layout || {} });
  d.returnSeparation = validateReturnSeparation({
    returnComponents: d.returnComponents, btos: d.btos, network: d.network });
  // Where the two systems cross out in the roof. Reported, never hidden.
  d.supplyReturnClashes = findSupplyReturnClashes({
    network: d.network, returnRoutes: d.returnRoutes || [],
    plenum: d.autoRoute?.plenum || d.layout?.plenum || d.layout?.indoorUnit || null });
  if (d.supplyReturnClashes.count) {
    d.routeWarnings = [...(d.routeWarnings || []), {
      code: 'SUPPLY_RETURN_CROSSING', severity: 'CHECK',
      message: d.supplyReturnClashes.count + ' place(s) where a supply duct crosses a ' +
        'return duct away from the fan coil: ' +
        d.supplyReturnClashes.clashes.map(c => c.supplyId + ' × ' + c.returnId).join(', ') +
        '. One duct passes under the other — allow for it on site.' }];
  }
  if (!d.returnSeparation.ok) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.returnSeparation.failures.map(f => ({
      code: 'RETURN_' + f.code, severity: 'CRITICAL', message: f.message }))];
  }

  // ── 8c-ii. THE SUPPLY SPIGOTS ────────────────────────────────────────────
  // The count and size that actually left the plenum, checked: the fabricated
  // plenum's ability to take the collars, velocity in every main, pressure
  // against VERIFIED available static, one area per main, the port limit, and
  // that the mains add up to the outlets.
  // A SUPPLY MAIN IS A DUCT LEAVING THE PLENUM.
  //
  // This used to read `!s.parentId && s.role !== 'return'` — a definition by
  // absence. Whenever the router produced a flat list with no parent links,
  // every duct in the job qualified: on 34 Kauri that made ten mains out of
  // one, summed to 1921 L/s against 800 L/s of outlets by counting the same
  // air three times, and put ten ø400 collars on a fabricated plenum.
  const mainSections = supplyMains(d.network);
  d.supplySpigots = validateSupplySpigots({
    mains: mainSections.map(s => ({ key: s.mainKey, airflowLs: s.airflowLs,
                                    diameterMm: s.diameterMm,
                                    name: (s.serves || []).join(' / ') })),
    diameterMm: d.supplyMainConfig?.diameterMm || mainSections[0]?.diameterMm || null,
    unit: d.selectedUnit || null,
    outletTotalLs: (d.outlets?.rows || []).reduce((n, r) => n + r.airflowLs, 0),
    pressurePa: null,
    btos: d.btos,
    manualOverride: !!d.supplyMainConfig,
    areaNames: mainSections.map(s => (s.serves || []).join(' / '))
  }, { settings });
  // The mains now have a measured length, so the pressure term in the spigot
  // selection stops being a blank. The arrangement that was built is not
  // reconsidered — re-deciding here would be rerouting a design behind
  // somebody's back — only the numbers beside it are made real.
  if (d.spigotSelection?.chosen) {
    d.spigotSelection = remeasureSelection(d.spigotSelection,
      measuredLongestMainM(d), { settings,
        // THE MAINS THAT WERE ACTUALLY BUILT. Two spigots averaging 450 L/s can
        // be a 616 / 284 split once the rooms are grouped; 450 is not a duct.
        mainAirflowsLs: mainSections.map(s => s.airflowLs) });
  }

  // ONE RECORD OF HOW THE PLENUM IS MADE, read by the drawing, the schedule,
  // the BOM line and the warning — so they cannot describe four different
  // pieces of metal.
  d.supplyPlenum = d.supplySpigots?.plenum?.arrangement
    ? { ...d.supplySpigots.plenum.arrangement,
        flangeWidthMm: d.supplySpigots.plenum.flangeWidthMm ?? null,
        flangeHeightMm: d.supplySpigots.plenum.flangeHeightMm ?? null,
        // THE COLLAR COUNT IS THE SPIGOT COUNT. It used to fall back to the
        // number of ducts in the graph, which is how three selected ø400
        // spigots became a plenum with ten collars on a 4,660 mm body.
        collarCount: d.spigotSelection?.chosen?.count
          ?? d.supplyMainConfig?.count
          ?? d.supplySpigots.plenum.collarCount
          ?? null,
        collarDiameterMm: d.supplySpigots.plenum.collarDiameterMm ?? null }
    : null;
  // ── THE SUPPLY GRAPH HAS TO DESCRIBE A MACHINE THAT COULD EXIST ─────────
  // Not a warning somebody acknowledges — an invariant. Nick: "Do not
  // acknowledge or override this error. Correct the component graph."
  const outletTotalLs = (d.outlets?.rows || []).reduce((n, r) => n + (r.airflowLs || 0), 0);
  d.supplyGraphCheck = checkSupplyGraph({
    network: d.network,
    outletTotalLs,
    spigotCount: d.spigotSelection?.chosen?.count
      ?? d.supplyMainConfig?.count
      ?? null
  });
  d.plenumCheck = checkPlenum(d.supplyPlenum,
    d.spigotSelection?.chosen?.count ?? d.supplyMainConfig?.count ?? null);
  d.ductSizeCheck = checkDuctSizes(d.network, d.designRules?.minimumSupplyBranchDiameterMm
    ?? settings.duct.minimumSupplyBranchDiameterMm);

  for (const check of [d.supplyGraphCheck, d.plenumCheck, d.ductSizeCheck]) {
    if (check && !check.ok) {
      d.routeWarnings = [...(d.routeWarnings || []), ...check.failures];
    }
  }

  if (d.supplySpigots) {
    d.routeWarnings = [...(d.routeWarnings || []),
      ...d.supplySpigots.blockers.map(b => ({ ...b, code: 'SUPPLY_' + b.code })),
      ...d.supplySpigots.warnings.filter(w => w.severity !== 'INFO')
        .map(w => ({ ...w, code: 'SUPPLY_' + w.code }))];
  }
  if (!d.btoValidation.ok) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.btoValidation.failures.map(f => ({
      code: 'BTO_' + f.code, severity: 'CRITICAL', message: f.message }))];
  }

  // ── 8c-iii. FIVE COUNTS THAT ARE NOT THE SAME COUNT ──────────────────────
  // Nick: "Separate these concepts: supply-spigot count, main-duct count, BTO
  // count, BTO port count, outlet count. They must not be treated as
  // interchangeable." They had been drifting into one another — the header read
  // the spigot count, the schedule counted fittings, the BOM counted collars —
  // so they are computed once, here, each from its own source, and everything
  // downstream reads these.
  d.componentCounts = {
    supplySpigots: d.supplySpigots?.count ?? mainSections.length,
    supplyMains: mainSections.length,
    supplyBtos: d.btos.length,
    supplyBtoPorts: d.btos.map(b => b.ports.length),
    supplyBtoPortTotal: d.btos.reduce((n, b) => n + b.ports.length, 0),
    supplyOutlets: (d.network?.sections || []).filter(s => s.role === 'final').length,
    ...returnComponentCounts(d.returnComponents)
  };

  // ── 8d. PLACEMENT STATUS ─────────────────────────────────────────────────
  // A design may be PREVIEWED from an assumed fan-coil position. It may not be
  // FINALISED from one. The unit decides every duct length in the job, so a
  // guess at where it sits is a guess at the whole design.
  d.placement = assessPlacement(d);

  // ── 9. Static pressure (PART 21) ──────────────────────────────────────────
  // A pressure drop over no duct is not a low pressure drop. The Kauri report
  // chose an index run, totalled 107 Pa, compared it against 160 Pa available
  // and called the check passed — with a total routed length of 0.0 m and every
  // duct length zero.
  d.pressureReadiness = pressureReadiness(d.network);
  d.pressure = d.pressureReadiness.ok
    ? Object.assign(estimateStaticPressure({
        network: d.network, returnDesign: d.returnDesign, outlets: d.outlets,
        selectedUnit: d.selectedUnit, zoneAnalysis: d.zones
      }, { settings }), {
        // Which of the metres in that figure were measured and which were the
        // standard allowance. A number the estimator cannot trace is a number
        // nobody should sign off.
        basedOnAllowances: d.pressureReadiness.basedOnAllowances === true,
        allowanceSections: d.pressureReadiness.allowanceSections || [],
        allowanceNote: d.pressureReadiness.allowanceNote || null
      })
    : {
        status: PRESSURE_STATUS.NOT_CALCULATED,
        calculated: false,
        reason: d.pressureReadiness.reason,
        indexRun: null,
        totalPa: null, estimatedPa: null,
        availableStaticPa: null, marginPa: null,
        disclaimer: PRESSURE_STATUS.NOT_CALCULATED + ' — ' + d.pressureReadiness.reason
      };

  // Re-check the selected unit now that a real pressure figure exists.
  if (d.selectedUnit && d.pressure.estimatedRequirementPa) {
    d.equipmentSelection = selectEquipment(catalogue, d.systemLoad, {
      settings,
      brandPreference: ctx.brandPreference || d.brandPreference,
      phase: ctx.phase || d.phase,
    // What the SITE has, which is a different question from what to filter the
    // catalogue by. Left unset, a three-phase unit has to be confirmed.
    sitePhase: ctx.sitePhase ?? d.sitePhase ?? null,
      requirePrice: ctx.requirePrice ?? d.requirePrice,
      requireCost: ctx.requireCost ?? d.requireCost,
      designAirflowLs: d.airflow.allocatedAirflowLs,
      requiredStaticPa: d.pressure.estimatedRequirementPa
    });
    const key = d.selectedUnit.brandId + ':' + d.selectedUnit.modelId;
    d.selectedUnit = d.equipmentSelection.allCandidates
      .find(c => c.brandId + ':' + c.modelId === key) || d.selectedUnit;
  }

  // ── 9a. THE CAPABILITIES, RE-ASKED WITH REAL COUNTS ──────────────────────
  // The first ask ran before outlets and zones existed, so an allowance priced
  // per outlet or per zone could only see zeroes. Nothing that gates the
  // ENGINES changes here — scale, areas and stage are already settled — only
  // the proposal-price question, which needs the counts to answer.
  d.capabilities = capabilities(d, {
    settings,
    outletCount: d.outlets?.totals?.total || 0,
    zoneCount: (d.zones?.zones || []).filter(z => !z.alwaysOpen).length
  });

  // ── 9b. THE OUTLET REGISTER ──────────────────────────────────────────────
  // Built BEFORE the bill of materials, because the order reads it. One record
  // per physical outlet: id, room, type, airflow, neck, the final duct that
  // reaches it, the catalogue item, the SKU and the price. The plan, the
  // schedule and the order all quote from this and from nothing else.
  d.outletRegister = buildOutletRegister(d, { nacRates: ctx.nacRates });

  // ── 10. Materials (PART 22) ───────────────────────────────────────────────
  d.bom = buildBillOfMaterials({
    selectedUnit: d.selectedUnit,
    // WHY there is no unit, not just that there isn't one. Without this the
    // bill of materials is simply short by a machine and says nothing about it.
    equipmentBlocked: d.equipmentBlocked,
    // At proposal stage the ductwork is one declared allowance, not a measured
    // quantity. It goes through the BOM rather than being bolted onto the price
    // afterwards, so the job cost, the fee and the GST all follow from it the
    // same way they follow from every other line.
    proposalAllowance: d.capabilities.mayRouteDucts ? null
      : (d.capabilities.proposalAllowance?.ok ? d.capabilities.proposalAllowance : null),
    controller: d.controller,
    network: d.network,
    outlets: d.outlets,
    zones: d.zones,
    // The physical take-off fittings are real metal on the order.
    btos: d.btos,
    // The damper COMPONENTS, not the zone list. The BOM must never re-derive a
    // size the duct already owns.
    zoneDampers: d.zoneDampers,
    // How the supply plenum is actually made, so the order line describes the
    // same fabricated piece the drawing shows.
    supplyPlenum: d.supplyPlenum,
    returnDesign: d.returnDesign,
    refrigerantPipeM: d.refrigerantPipeM ?? 8,
    drainPipeM: d.drainPipeM ?? 6,
    cableM: d.cableM ?? 12,
    extraMaterials: d.extraMaterials || []
    // A FABRICATOR PRICE ENTERED ON SITE TRAVELS WITH THE DESIGN. Rates may
    // also come from settings; the design's own record wins, because that is
    // where the quote reference somebody keyed into Site Adjust lives.
  }, { settings, nacRates: ctx.nacRates,
       btoRates: { ...(ctx.btoRates || {}), ...(d.btoRates || {}) } });

  // Any line the estimator edited by hand is re-applied over the rebuilt BOM.
  d.bom = applyBomEdits(d.bom, d.bomEdits);

  // ── CAN THIS BE QUOTED? ──────────────────────────────────────────────────
  // Asked once, out loud, and only about the CUSTOMER quote. The internal
  // sheet is always allowed out; a number somebody signs is not.
  // ── THE TWO SCHEDULES ────────────────────────────────────────────────────
  // Built from the same components the plan draws and the order buys, so a
  // schedule cannot describe a fitting the drawing does not show.
  d.schedules = buildSchedules({ ...d, btoRates: { ...(ctx.btoRates || {}), ...(d.btoRates || {}) } });

  // The NAC schedule — the sheet an installer reads — is derived HERE rather
  // than only when a report is rendered, because the consistency check below
  // has to compare it against the drawing and the order. A schedule nobody
  // built is a schedule nobody checked.
  d.nacSchedule = nacScheduleData(d, { settings });

  // ── ZONING SAFETY (defect 9) ─────────────────────────────────────────────
  // Asked after the bill of materials, because part of the answer is whether a
  // spill or bypass is actually ON the order rather than assumed into the
  // design to make a check pass.
  d.zoningSafety = zoningSafety({
    zoneAnalysis: d.zones, selectedUnit: d.selectedUnit, design: d, settings
  });
  if (d.zoningSafety.failures.length || d.zoningSafety.notes.length) {
    d.routeWarnings = [...(d.routeWarnings || []),
      ...d.zoningSafety.failures.map(f => ({ code: f.code, severity: f.severity,
                                             area: 'zoning', message: f.message })),
      ...d.zoningSafety.notes.map(n => ({ code: n.code, severity: n.severity,
                                          area: 'zoning', message: n.message }))];
  }

  // Now that all three surfaces exist, do they describe the same outlets?
  d.outletConsistency = checkOutletConsistency({
    register: d.outletRegister,
    design: d,
    scheduleRooms: d.nacSchedule?.rooms || null
  });
  if (d.outletConsistency.failures.length) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.outletConsistency.failures.map(f => ({
      code: f.code, severity: f.severity, area: 'outlets', message: f.message
    }))];
  }

  d.quoteGate = quoteGate(d);

  // ── 11. Costing (PART 24) ─────────────────────────────────────────────────
  d.labour = calculateLabour({
    outlets: d.outlets, zones: d.zones, network: d.network, extraLabour: d.extraLabour || []
  }, { settings });

  d.commercials = calculateCommercials({
    bom: d.bom,
    labour: d.labour,
    cataloguePrice: d.selectedUnit?.sellPrice ?? null,
    sellOverride: d.sellPriceOverride ?? null,
    extras: d.quoteExtras || [],
    subcontractorCost: d.subcontractorCost || 0,
    otherCost: d.otherCost || 0
  }, { settings });

  // ── A DESIGN THAT MAY NOT BE PRICED DOES NOT CARRY A PRICE ───────────────
  //
  // The Kauri report printed $15,079.33 inc GST on a job with no verified
  // scale, no selected equipment, no routed ductwork and no static-pressure
  // calculation. Every input to that figure was absent; the figure was not.
  //
  // The internal COST working stays — an estimator needs to see what the parts
  // would come to, and the warnings above explain what is missing. What goes
  // is the sell price: the one number somebody could copy into a quote, read
  // off a screen, or take to a customer over the phone. It is null, and the
  // record says why rather than leaving a blank that reads as $0.
  if (!d.capabilities.mayPrice && d.capabilities.mayQuoteProposal) {
    // ── A PROPOSAL PRICE, AND IT SAYS SO ───────────────────────────────────
    // The rooms are measured, the load is known and the machine is chosen. What
    // is not designed is the ductwork, and that is carried as NAC's own declared
    // allowance. The arithmetic is the ordinary arithmetic — job cost plus the
    // fee — so this is a number NAC stands behind. It is not a fixed price, and
    // every surface that shows it has to say which of the two it is.
    d.commercials = {
      ...d.commercials,
      proposalPrice: true,
      fixedPrice: false,
      proposalBasis: d.capabilities.proposalAllowance,
      basis: {
        ...(d.commercials.basis || {}),
        key: 'proposal_allowance',
        label: 'Proposal price — job cost with a declared ductwork allowance, plus the fee'
      },
      warnings: [...(d.commercials.warnings || []), {
        code: 'PROPOSAL_PRICE_NOT_FIXED', severity: 'CHECK',
        message: 'This is a PROPOSAL price. The ductwork is carried as '
          + d.capabilities.proposalAllowance.basis.toLowerCase() + ', not as measured '
          + 'quantities. It is replaced by the real figure once the duct design is run, and '
          + 'the customer document must say so.'
      }]
    };
  } else if (!d.capabilities.mayPrice) {
    const why = d.capabilities.reasonFor('quoteProposal') === null
      ? d.capabilities.reasonFor('price')
      : d.capabilities.reasonFor('price') + ' A proposal price is not available either: '
        + d.capabilities.reasonFor('quoteProposal');
    d.commercials = {
      ...d.commercials,
      priceBlocked: true,
      priceBlockedReason: why,
      sellPriceIncGst: null,
      sellPriceExGst: null,
      gstAmount: null,
      grossProfit: null,
      grossMarginPct: null,
      basis: { key: 'blocked', label: 'PRICE WITHHELD — ' + why },
      warnings: [...(d.commercials.warnings || []), {
        code: 'PRICE_WITHHELD', severity: 'CRITICAL',
        message: 'No sell price is produced for this design. ' + why
      }]
    };
  }

  // ── 11b. THE PROPOSAL ALLOWANCE (defect 2) ───────────────────────────────
  //
  // A proposal must not invent ductwork. The Kauri report produced a duct bill
  // of materials — lengths, fittings, a plenum, a static-pressure check — for a
  // job whose ducts had never been routed, and priced it.
  //
  // At proposal stage the ductwork is ONE LINE with its basis printed on it.
  // Not a quantity, not a measured length, not a fitting list. And if NAC has
  // not configured an allowance, there is no line and no number: the proposal
  // says what to set and where, rather than reaching for a figure.
  if (!d.capabilities.mayRouteDucts) {
    const zoneCount = (d.zones?.zones || []).filter(z => !z.alwaysOpen).length;
    const allowance = proposalAllowance({
      outletCount: d.outlets?.totals?.total || 0,
      zoneCount,
      settings
    });
    d.proposalAllowance = {
      ...allowance,
      stage: DESIGN_STAGE.PROPOSAL,
      // Said out loud on every surface that shows it. An allowance is what the
      // work is expected to cost, not what it has been measured to cost.
      label: allowance.ok
        ? allowance.basis + ' (PROVISIONAL — not a measured quantity)'
        : 'No proposal ductwork allowance configured',
      replacedBy: 'Measured duct quantities, once the duct design is run.'
    };
    if (!allowance.ok) {
      d.routeWarnings = [...(d.routeWarnings || []), {
        code: 'NO_PROPOSAL_ALLOWANCE', severity: 'CRITICAL', area: 'pricing',
        message: allowance.reason
      }];
    }
  } else {
    d.proposalAllowance = null;
  }

  // ── 11c. WHAT THE ACTIVE PRICING MODE NEEDS ──────────────────────────────
  // One method, declared, and never mixed with the other. On cost-plus-fee an
  // equipment SELL price is not asked for at all — the supplier cost is what
  // the price is built from.
  d.pricing = pricingRequirements({ design: d, settings });

  // ── WHICH RATES THIS JOB LEANS ON, AND WHO STOOD BEHIND THEM ─────────────
  // Only the lines this job uses. The catalogue carries rates for sizes this
  // house will never see, and blocking on those is noise that teaches an
  // estimator to ignore the check.
  d.rateVerification = usedRateStatus({
    design: d, verifications: ctx.rateVerifications || d.rateVerifications || {}
  });
  if (!d.rateVerification.ok) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.rateVerification.failures.map(f => ({
      code: f.code, severity: f.severity, area: 'pricing', message: f.message
    }))];
  }
  if (!d.pricing.ok) {
    d.routeWarnings = [...(d.routeWarnings || []), ...d.pricing.failures.map(f => ({
      code: f.code, severity: f.severity, area: 'pricing', message: f.message
    }))];
  }

  // ── 11d. §11 — A PROPOSAL CARRIES NO DETAILED DUCTWORK ───────────────────
  // The gate is `mayRouteDucts`, which stops these being produced. This proves
  // they were not, which is a different and more useful thing to assert: a
  // future change that lets one through fails here by name.
  if (d.designStage === DESIGN_STAGE.PROPOSAL || !d.capabilities.mayRouteDucts) {
    d.proposalAudit = proposalStageAudit(d);
    if (!d.proposalAudit.ok) {
      d.routeWarnings = [...(d.routeWarnings || []), ...d.proposalAudit.failures.map(f => ({
        code: f.code, severity: f.severity, area: 'ductwork', message: f.message
      }))];
    }
  } else {
    d.proposalAudit = null;
  }

  // ── 12. Warnings (PART 27) ────────────────────────────────────────────────
  d.warnings = collectWarnings(d, ctx);
  d.warningSummary = summarise(d.warnings);
  // Quote lines ARE the price in another shape. A blocked design has none; a
  // proposal-priced one has them, carrying a proposal price.
  d.quoteLineItems = (d.capabilities.mayPrice || d.capabilities.mayQuoteProposal)
    ? toQuoteLineItems(d, d.commercials) : [];
  d.stage = 'complete';
  d.settingsSnapshot = { version: settings.version };
  return d;
}

/**
 * Put back the geometry the estimator has moved, and anything they locked.
 *
 * Two stores, and the order matters:
 *
 *   routeEdits    every run the estimator has dragged. Applied first.
 *   lockedRoutes  runs they have fixed in place. Applied second, so a lock
 *                 always wins, and RE-ROUTE UNLOCKED keeps exactly these.
 *
 * This is the join that makes dragging safe: an edit is geometry on a REAL duct
 * section, so the moment it is applied the length, the pressure, the materials
 * and the cost all follow from it. There is no separate drawing to fall out of
 * step with the design.
 */
/** The longest main this design has actually been routed with, if it has. */
function measuredLongestMainM(d) {
  const mains = supplyMains(d.network).filter(x => x.lengthM > 0);
  return mains.length ? Math.max(...mains.map(x => x.lengthM)) : null;
}

function applyLockedGeometry(tree, design, settings) {
  const edits = design.routeEdits || {};
  const locked = design.lockedRoutes || {};
  if (!tree?.segments?.length) return tree;
  if (!Object.keys(edits).length && !Object.keys(locked).length) return tree;

  const segments = tree.segments.map(seg => {
    let out = seg;
    const edited = edits[seg.id];
    if (edited?.points?.length >= 2) {
      out = { ...out, points: edited.points, edited: true, editedAt: edited.at || null };
    }
    const keep = locked[seg.id];
    if (keep?.points?.length >= 2) {
      out = { ...out, points: keep.points, locked: true, lockedBy: keep.by || null,
              lockedAt: keep.at || null };
    }
    return out;
  });
  // Moved geometry has to be re-measured on its own path, or every number
  // downstream is still describing where the duct used to be.
  return measureTree({ ...tree, segments }, design.calibration, { settings });
}

/** PART 25 — the Overview tab. */
export function designSummary(d) {
  return {
    totalConditionedAreaSqM: d.systemLoad?.totalConditionedAreaSqM ?? 0,
    totalCoolingLoadKw: d.systemLoad ? round(d.systemLoad.designCoolingW / 1000, 2) : null,
    totalHeatingLoadKw: d.systemLoad ? round(d.systemLoad.designHeatingW / 1000, 2) : null,
    // On a blocked design the candidates are a COMPARISON LIST, not a
    // recommendation. Printing one here is how "no equipment selected" and
    // "the 16 kW Daikin" ended up on the same page.
    equipmentBlocked: d.equipmentBlocked?.blocked === true,
    recommendedSystem: d.equipmentBlocked?.blocked
      ? null
      : d.equipmentSelection?.recommended?.[0]
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
