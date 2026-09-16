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
import { sizableRooms, blockedRooms, totalConditionedArea,
         deriveBoundariesFromPrintedSizes } from './rooms.mjs';
import { calibrationRequirement, deriveCalibrationFromRooms } from './calibration.mjs';
import { classificationSummary, isConditionedRoom, isExcludedRoom } from './classify.mjs';
import { roomLoad, systemLoad, describeAssumptions } from './loads.mjs';
import { selectEquipment, selectZoneController } from './equipment.mjs';
import { calculateAirflow } from './airflow.mjs';
import { designOutlets } from './outlets.mjs';
import { buildDuctNetwork } from './ducts.mjs';
import { buildDuctTree, measureTree, scoreRoute, routeConfidence,
         buildReturnRoutes, placeZoneDampers, ROUTING_MODE } from './router.mjs';
import { deriveBtos, validateBtos, btoBomLines, withBody } from './bto.mjs';
import { buildReturnComponents, validateReturnSeparation, returnComponentCounts,
         findSupplyReturnClashes } from './return-model.mjs';
import { buildAreaTopology } from './area-router.mjs';
import { recommendedSupplySpigotCount, validateSupplySpigots } from './supply-spigots.mjs';
import { assessPlacement } from './placement.mjs';
import { buildNacTopology, validateNacTopology, topologyTable } from './nac-router.mjs';
import { designReturnAir } from './returnair.mjs';
import { suggestZones, analyseZones } from './zones.mjs';
import { suggestOpenPlanGroups, applyOpenPlanGroups, zoneRemedies,
         zoningAlreadySet } from './zoning-groups.mjs';
import { estimateStaticPressure } from './pressure.mjs';
import { buildBillOfMaterials, applyBomEdits } from './bom.mjs';
import { calculateLabour, calculateCommercials, toQuoteLineItems } from './costing.mjs';
import { collectWarnings, summarise } from './warnings.mjs';
import { ZONE_CONTROLLERS } from './catalogue.mjs';

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
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const d = { ...design };

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
    if (derived.ok) d.calibration = derived.calibration;
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
  if (mode === ROUTING_MODE.AUTO && !d.routingSuspended) {
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
    d.spigotRecommendation = recommendedSupplySpigotCount(d.outlets.totals.total, {
      settings, systemAirflowLs: d.airflow.allocatedAirflowLs,
      diameterMm: d.supplyMainConfig?.diameterMm || 400
    });

    // New designs default to practical installer areas. Older saved jobs have
    // no routingStrategy field and retain the legacy spine unless explicitly
    // converted. An installer configuration overrides the recommended count.
    const useAreaRouter = d.routingStrategy === 'area' || !!d.supplyMainConfig;
    const effectiveMainConfig = d.supplyMainConfig || {
      count: d.spigotRecommendation.count, diameterMm: 400, source: 'recommended'
    };
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

  d.network = buildDuctNetwork({
    airflow: d.airflow,
    outlets: d.outlets,
    routesByRoomId: d.ductRoutes || {},
    mainRoute: d.mainRoute,
    diameterOverrides: d.ductDiameterOverrides || {},
    extraFittingsByRoomId: d.extraFittings || {},
    topology: d.autoRoute?.generated && !d.autoRoute.stale ? d.autoRoute : null
  }, { settings });

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

  d.zoneDampers = d.network?.routed
    ? placeZoneDampers(d.network, { zoneOverrides: d.zoneDamperOverrides || {},
                                    zones: d.zones })
    : [];

  // ── 8c. THE PHYSICAL BRANCH TAKE-OFFS ────────────────────────────────────
  // A BTO is a fitting somebody buys and lifts into a roof, not a number stuck
  // on an outlet. They are DERIVED from the sized network — wherever two or
  // more runs leave the same duct at the same place — so the drawing, the
  // schedule and the order all read one object.
  d.btos = (d.network?.routed ? deriveBtos(d.network) : []).map(b => withBody(b));
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
  const mainSections = (d.network?.sections || [])
    .filter(s => !s.parentId && s.role !== 'return');
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
  // ONE RECORD OF HOW THE PLENUM IS MADE, read by the drawing, the schedule,
  // the BOM line and the warning — so they cannot describe four different
  // pieces of metal.
  d.supplyPlenum = d.supplySpigots?.plenum?.arrangement
    ? { ...d.supplySpigots.plenum.arrangement,
        flangeWidthMm: d.supplySpigots.plenum.flangeWidthMm ?? null,
        flangeHeightMm: d.supplySpigots.plenum.flangeHeightMm ?? null,
        collarCount: d.supplySpigots.plenum.collarCount ?? mainSections.length,
        collarDiameterMm: d.supplySpigots.plenum.collarDiameterMm ?? null }
    : null;
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

  // ── 10. Materials (PART 22) ───────────────────────────────────────────────
  d.bom = buildBillOfMaterials({
    selectedUnit: d.selectedUnit,
    controller: d.controller,
    network: d.network,
    outlets: d.outlets,
    zones: d.zones,
    // The physical take-off fittings are real metal on the order.
    btos: d.btos,
    // How the supply plenum is actually made, so the order line describes the
    // same fabricated piece the drawing shows.
    supplyPlenum: d.supplyPlenum,
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
    cataloguePrice: d.selectedUnit?.sellPrice ?? null,
    sellOverride: d.sellPriceOverride ?? null,
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
