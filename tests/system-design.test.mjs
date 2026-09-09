// PART 35 — equipment, airflow, outlets, duct sizing/length/velocity/pressure,
// return air, zoning minimum airflow, BOM, margin, warnings.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCatalogue, DUCTED_CATALOGUE, ZONE_CONTROLLERS, SPEC_REQUIRED } from '../designer/engines/catalogue.mjs';
import { selectEquipment, selectZoneController } from '../designer/engines/equipment.mjs';
import { calculateAirflow } from '../designer/engines/airflow.mjs';
import { designRoomOutlets, designOutlets } from '../designer/engines/outlets.mjs';
import { velocity, idealDiameterMm, selectDiameter, pressureDropPaPerM, sizeSection,
         buildDuctNetwork, indexRun, routeLength, estimatedLength, manualLength } from '../designer/engines/ducts.mjs';
import { designReturnAir } from '../designer/engines/returnair.mjs';
import { suggestZones, analyseZones } from '../designer/engines/zones.mjs';
import { estimateStaticPressure } from '../designer/engines/pressure.mjs';
import { buildBillOfMaterials, editBomLine } from '../designer/engines/bom.mjs';
import { calculateLabour, calculateCommercials, toQuoteLineItems } from '../designer/engines/costing.mjs';
import { collectWarnings, summarise, acknowledge } from '../designer/engines/warnings.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { buildRoom, manualMeasurement, verifyRoom } from '../designer/engines/rooms.mjs';
import { systemLoad } from '../designer/engines/loads.mjs';
import { DEFAULT_SETTINGS, settingsWith } from '../designer/engines/settings.mjs';

const mk = (label, w, l, extra = {}) =>
  verifyRoom(buildRoom({ label, measurement: manualMeasurement(w, l), ...extra }));

const ROOMS = [
  mk('Master Bedroom', 3600, 3400), mk('Bed 2', 3200, 3400), mk('Bed 3', 3200, 3400),
  mk('Bed 4', 3600, 3600), mk('Media', 3200, 3600),
  mk('Kitchen', 3200, 3600, { openPlanGroup: 'core' }),
  mk('Living', 5640, 3600, { openPlanGroup: 'core' }),
  mk('Dining', 3200, 4160, { openPlanGroup: 'core' })
];
const LOAD = systemLoad(ROOMS);

// ── PART 13: equipment ──────────────────────────────────────────────────────

test('equipment is ranked against the design load inside the configured window', () => {
  const cat = buildCatalogue({});
  const sel = selectEquipment(cat, LOAD);
  assert.ok(sel.recommended.length > 0);
  for (const r of sel.recommended) {
    assert.ok(r.capacityKw >= sel.window.minKw && r.capacityKw <= sel.window.maxKw);
  }
  assert.equal(sel.recommended[0].score, Math.max(...sel.recommended.map(r => r.score)));
});

test('manufacturer data is never fabricated — missing specs are declared', () => {
  const cat = buildCatalogue({});
  const model = cat[0].models[0];
  assert.equal(model.specStatus, 'none');
  assert.match(model.specNotice, new RegExp(SPEC_REQUIRED));
  assert.equal(model.specs.ratedAirflowLs, undefined);

  const sel = selectEquipment(cat, LOAD, { designAirflowLs: 900 });
  const c = sel.allCandidates[0];
  assert.ok(c.warnings.some(w => w.code === 'MISSING_MANUFACTURER_DATA'));
  assert.equal(c.ratedAirflowLs, null);
});

test('specs NAC has entered are used, and airflow/static are then checked', () => {
  const cat = buildCatalogue({
    savedBrands: [{ id: 'daikin', models: [{ id: 'd6', price: '20400' }] }],
    specStore: { 'daikin:d6': { ratedAirflowLs: 700, availableStaticPa: 150, indoorWidthMm: 1400,
                                indoorHeightMm: 390, indoorDepthMm: 800, electricalSupply: '240V 1Ph',
                                runningCurrentA: 18, refrigerant: 'R32', heatingKw: 16 } }
  });
  const sel = selectEquipment(cat, LOAD, { designAirflowLs: 900, requiredStaticPa: 200 });
  const d6 = sel.allCandidates.find(c => c.modelId === 'd6');
  assert.equal(d6.specStatus, 'complete');
  assert.equal(d6.sellPrice, 20400);
  assert.ok(d6.warnings.some(w => w.code === 'AIRFLOW_ABOVE_UNIT_RATING'));
  assert.ok(d6.warnings.some(w => w.code === 'ESTIMATED_PRESSURE_EXCEEDS_UNIT_CAPABILITY'));
});

test('a brand preference and a price requirement steer the recommendation', () => {
  const cat = buildCatalogue({ savedBrands: [{ id: 'fujitsu', models: [{ id: 'f6', price: '21000' }] }] });
  const sel = selectEquipment(cat, LOAD, { brandPreference: 'fujitsu', requirePrice: true });
  assert.ok(sel.allCandidates.every(c => c.hasPrice));
  assert.equal(sel.allCandidates[0].brandId, 'fujitsu');
});

test('a load beyond a single residential unit is flagged, not silently split', () => {
  const big = { ...LOAD, designKw: 26 };
  const sel = selectEquipment(buildCatalogue({}), big);
  assert.ok(sel.systemWarnings.some(w => w.code === 'CUSTOM_OR_DUAL_SYSTEM'));
});

test('zone controllers are filtered by brand lock and zone count', () => {
  const r = selectZoneController(ZONE_CONTROLLERS, { brandId: 'fujitsu', zoneCount: 12 });
  assert.ok(!r.compatible.some(c => c.id === 'daikin_zone'));   // brand locked
  assert.ok(!r.compatible.some(c => c.id === 'std'));           // only 8 zones
  assert.equal(r.recommended.id, 'at5');
  assert.ok(r.incompatible.every(c => c.reason));
});

// ── PART 14: airflow ────────────────────────────────────────────────────────

test('airflow is apportioned by calculated load and sums to the system total', () => {
  const a = calculateAirflow(LOAD);
  const sum = a.rows.reduce((s, r) => s + r.adjustedLs, 0);
  assert.equal(a.allocatedAirflowLs, sum);
  assert.ok(Math.abs(sum - a.systemAirflowLs) / a.systemAirflowLs < 0.05);
  const shares = a.rows.reduce((s, r) => s + r.systemSharePct, 0);
  assert.ok(Math.abs(shares - 100) < 1);
});

test('airflow follows the selected unit capacity once one is chosen', () => {
  const a = calculateAirflow(LOAD, { selectedUnit: { model: 'X', capacityKw: 14, ratedAirflowLs: 750 } });
  assert.equal(a.basisKw, 14);
  assert.equal(a.systemAirflowLs, 14 * DEFAULT_SETTINGS.airflow.litresPerSecPerKw);
  assert.match(a.basisLabel, /Selected unit/);
});

test('an airflow override is applied and always announced', () => {
  const room = LOAD.rooms[0];
  const a = calculateAirflow(LOAD, { overridesByRoomId: { [room.roomId]: 140 } });
  const row = a.rows.find(r => r.roomId === room.roomId);
  assert.equal(row.adjustedLs, 140);
  assert.equal(row.overridden, true);
  assert.ok(a.warnings.some(w => w.code === 'MANUAL_AIRFLOW_OVERRIDE'));
});

test('a badly unbalanced override raises the balance-check warning', () => {
  const overrides = Object.fromEntries(LOAD.rooms.map(r => [r.roomId, 400]));
  const a = calculateAirflow(LOAD, { overridesByRoomId: overrides });
  assert.ok(a.warnings.some(w => w.code === 'AIRFLOW_BALANCE_CHECK_REQUIRED'));
});

test('airflow above and below the unit rating are both reported', () => {
  const high = calculateAirflow(LOAD, { selectedUnit: { model: 'X', capacityKw: 20, ratedAirflowLs: 400 } });
  assert.ok(high.warnings.some(w => w.code === 'AIRFLOW_ABOVE_UNIT_RATING'));
  const low = calculateAirflow(LOAD, { selectedUnit: { model: 'X', capacityKw: 6, ratedAirflowLs: 2000 } });
  assert.ok(low.warnings.some(w => w.code === 'AIRFLOW_BELOW_UNIT_RANGE'));
});

// ── PART 15: outlets ────────────────────────────────────────────────────────

test('outlet quantity follows the capacity table and the throw limit', () => {
  const r = designRoomOutlets({ id: 'r', label: 'Living', widthMm: 5400, lengthMm: 4200 }, 320, { type: 'four_way' });
  assert.equal(r.quantity, 2);
  assert.equal(r.perOutletLs, 160);

  const small = designRoomOutlets({ id: 's', label: 'Bed 2', widthMm: 3200, lengthMm: 3400 }, 85);
  assert.equal(small.quantity, 1);
});

test('a long room is split for throw even when one outlet would carry the air', () => {
  const long = designRoomOutlets({ id: 'l', label: 'Hall', widthMm: 9000, lengthMm: 1400 }, 60);
  assert.equal(long.quantity, 2);
  assert.ok(long.reasons.some(r => /throw limit/.test(r)));
});

test('outlet quantity is capped and every recommendation explains itself', () => {
  const s = settingsWith({ outlets: { maxOutletsPerRoom: 2 } });
  const r = designRoomOutlets({ id: 'x', label: 'Hall', widthMm: 12000, lengthMm: 3000 }, 900, { settings: s });
  assert.equal(r.quantity, 2);
  assert.ok(r.warnings.some(w => w.code === 'OUTLET_OVER_CAPACITY'));
  assert.ok(r.reasons.length >= 2);
});

test('an outlet override is honoured and recorded', () => {
  const a = calculateAirflow(LOAD);
  const id = a.rows[0].roomId;
  const o = designOutlets(ROOMS, a.rows, { overridesByRoomId: { [id]: { quantity: 3, type: 'slot' } } });
  const row = o.rows.find(r => r.roomId === id);
  assert.equal(row.quantity, 3);
  assert.equal(row.type, 'slot');
  assert.equal(row.overridden, true);
});

// ── PART 16/17: ducts ───────────────────────────────────────────────────────

test('velocity and ideal diameter are correct round-duct fluid mechanics', () => {
  // 200 mm duct at 150 L/s: 0.15 m³/s over 0.0314 m² = 4.77 m/s
  assert.equal(velocity(200, 150).toFixed(2), '4.77');
  assert.equal(Math.round(idealDiameterMm(150, 4.77)), 200);
});

test('duct diameters are chosen from the configured list within the velocity band', () => {
  const branch = selectDiameter(105, 'branch');
  assert.equal(branch.diameterMm, 175);
  assert.ok(branch.velocityMs <= DEFAULT_SETTINGS.duct.velocity.branch.preferred);
  assert.ok(DEFAULT_SETTINGS.duct.availableDiametersMm.includes(branch.diameterMm));
  assert.ok(branch.considered.length === DEFAULT_SETTINGS.duct.availableDiametersMm.length);
});

test('the brief\'s example is reproduced: 150 mm at 105 L/s is over the preferred branch velocity', () => {
  const v = velocity(150, 105);
  assert.ok(v > DEFAULT_SETTINGS.duct.velocity.branch.preferred, v + ' m/s should exceed the preferred 4.5 m/s');
  const s = sizeSection({ id: 'b', role: 'branch', destination: 'Bed 3', airflowLs: 105, lengthMm: 6000, diameterMm: 150 });
  assert.ok(s.warnings.some(w => w.code === 'DUCT_VELOCITY_ABOVE_PREFERRED'));
  assert.equal(selectDiameter(105, 'branch').diameterMm, 175);   // what the engine would pick
});

test('excessive velocity is a warning, not a silent resize', () => {
  const s = sizeSection({ id: 'b', role: 'branch', destination: 'Bed 2', airflowLs: 200, lengthMm: 6000, diameterMm: 150 });
  assert.equal(s.diameterMm, 150);
  assert.ok(s.warnings.some(w => w.code === 'EXCESSIVE_DUCT_VELOCITY'));
});

test('velocity targets differ by duct role', () => {
  const main = selectDiameter(1000, 'main');
  const ret = selectDiameter(1000, 'return');
  assert.ok(ret.diameterMm >= main.diameterMm, 'the return band is tighter than the main band');
});

test('pressure drop rises with airflow and falls with diameter', () => {
  assert.ok(pressureDropPaPerM(150, 150) > pressureDropPaPerM(200, 150));
  assert.ok(pressureDropPaPerM(200, 250) > pressureDropPaPerM(200, 150));
  // Flexible duct is rougher than rigid, per the configured factor.
  assert.ok(pressureDropPaPerM(200, 150) > pressureDropPaPerM(200, 150, { rigid: true }));
});

test('fittings are converted to equivalent length and add pressure', () => {
  const plain = sizeSection({ id: 'a', role: 'branch', destination: 'X', airflowLs: 120, lengthMm: 6000, fittings: [] });
  const fitted = sizeSection({ id: 'b', role: 'branch', destination: 'X', airflowLs: 120, lengthMm: 6000,
                               fittings: ['takeoff', { type: 'y_piece', quantity: 2 }] });
  assert.ok(fitted.effectiveLengthM > plain.effectiveLengthM);
  assert.ok(fitted.pressureDropPa > plain.pressureDropPa);
  assert.equal(fitted.fittings.find(f => f.type === 'y_piece').equivalentM, 6);
});

test('an unmeasured duct length is flagged rather than assumed', () => {
  const s = sizeSection({ id: 'a', role: 'branch', destination: 'Bed 2', airflowLs: 100, lengthMm: null });
  assert.equal(s.lengthMm, null);
  assert.ok(s.warnings.some(w => w.code === 'DUCT_LENGTH_NOT_MEASURED'));
});

test('a long run is flagged against the configured threshold', () => {
  const s = sizeSection({ id: 'a', role: 'branch', destination: 'Bed 4', airflowLs: 100, lengthMm: 15000 });
  assert.ok(s.warnings.some(w => w.code === 'LONG_DUCT_RUN'));
});

test('duct length is measured from a drawn route on the calibrated plan', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  // 300 px + 400 px = 700 px = 7000 mm plan length, x 1.12 slack = 7840 mm.
  const r = routeLength(cal, [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }]);
  assert.equal(r.planMm, 7000);
  assert.equal(r.lengthM, 7.84);
  assert.equal(r.source, 'drawn_route');
  assert.equal(r.segments, 2);
});

test('an undrawn route falls back to a clearly-labelled straight-line estimate', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const e = estimatedLength(cal, { x: 0, y: 0 }, { x: 500, y: 0 });
  assert.equal(e.source, 'straight_line_estimate');
  assert.match(e.note, /no route drawn/i);
  assert.equal(manualLength(7.4).lengthMm, 7400);
});

test('route measurement is refused before calibration', () => {
  const r = routeLength(null, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  assert.equal(r.lengthMm, null);
  assert.match(r.note, /Calibrate/);
});

test('the duct network covers main, branches and final connections', () => {
  const a = calculateAirflow(LOAD);
  const o = designOutlets(ROOMS, a.rows);
  const net = buildDuctNetwork({ airflow: a, outlets: o, mainRoute: { lengthMm: 4000 },
    routesByRoomId: Object.fromEntries(a.rows.map((r, i) => [r.roomId, { lengthMm: 5000 + i * 500 }])) });

  assert.equal(net.sections.filter(s => s.role === 'main').length, 1);
  assert.equal(net.sections.filter(s => s.role === 'branch').length, a.rows.length);
  const main = net.sections.find(s => s.role === 'main');
  assert.equal(main.airflowLs, a.allocatedAirflowLs);
  assert.ok(net.totalDuctLengthM > 0);

  const run = indexRun(net);
  assert.ok(run.totalPa > 0);
  assert.ok(run.path.some(p => p.role === 'main'));
});

// ── PART 19: return air ─────────────────────────────────────────────────────

test('the return grille is sized on free area and face velocity', () => {
  const r = designReturnAir({ totalAirflowLs: 500, returnCount: 1 });
  const grille = r.returns[0];
  assert.ok(grille.faceVelocityMs <= DEFAULT_SETTINGS.returnAir.maxGrilleFaceVelocityMs + 0.01);
  const expectedFree = (grille.grilleWidthMm / 1000) * (grille.grilleHeightMm / 1000) *
    DEFAULT_SETTINGS.returnAir.grilleFreeAreaRatio;
  assert.equal(grille.freeAreaM2, Math.round(expectedFree * 1000) / 1000);
});

test('one return over the single-return limit is called undersized', () => {
  const r = designReturnAir({ totalAirflowLs: 1000, returnCount: 1 });
  assert.ok(r.warnings.some(w => w.code === 'RETURN_AIR_UNDERSIZED'));
  const two = designReturnAir({ totalAirflowLs: 1000, returnCount: 2 });
  assert.ok(!two.warnings.some(w => w.code === 'RETURN_AIR_UNDERSIZED'));
  assert.equal(two.perReturnLs, 500);
});

test('an undersized manual grille reports high velocity instead of resizing itself', () => {
  const r = designReturnAir({ totalAirflowLs: 600, returnCount: 1, grilleSizesMm: [[400, 400]] });
  assert.equal(r.returns[0].grilleWidthMm, 400);
  assert.equal(r.returns[0].manual, true);
  assert.ok(r.warnings.some(w => w.code === 'RETURN_VELOCITY_HIGH'));
  assert.ok(r.warnings.some(w => w.code === 'FILTER_FACE_VELOCITY_HIGH'));
});

test('a restricted return duct is reported', () => {
  const r = designReturnAir({ totalAirflowLs: 600, returnCount: 1, diameterOverrideMm: 300 });
  assert.ok(r.warnings.some(w => w.code === 'RESTRICTED_RETURN_PATH'));
});

// ── PART 20: zoning ─────────────────────────────────────────────────────────

test('zones default to one per room with open-plan rooms grouped', () => {
  const a = calculateAirflow(LOAD);
  const z = suggestZones(ROOMS, a);
  assert.equal(z.zones.length, 6);                       // 5 individual + 1 open plan
  const core = z.zones.find(x => x.roomIds.length === 3);
  assert.equal(core.kind, 'common');
  assert.equal(core.alwaysOpen, true);
});

test('minimum open airflow is checked against the configured fraction', () => {
  const a = calculateAirflow(LOAD);
  const z = suggestZones(ROOMS, a);
  assert.equal(z.requiredMinimumLs,
    Math.round(z.systemAirflowLs * DEFAULT_SETTINGS.zoning.minOpenAirflowFraction));
  assert.equal(z.meetsMinimum, z.minimumOpenAirflowLs >= z.requiredMinimumLs);
});

test('all-individual zones trip the minimum-open-airflow critical warning', () => {
  const a = calculateAirflow(LOAD);
  const zones = a.rows.map(r => ({ id: 'z_' + r.roomId, name: r.label, kind: 'individual',
                                   roomIds: [r.roomId], rooms: [r.label], airflowLs: r.adjustedLs }));
  const z = analyseZones(zones, a);
  assert.equal(z.meetsMinimum, false);
  const critical = z.warnings.find(w => w.code === 'MINIMUM_OPEN_AIRFLOW_TOO_LOW');
  assert.ok(critical);
  assert.equal(critical.severity, 'CRITICAL');
  assert.ok(z.warnings.some(w => w.code === 'CONSTANT_ZONE_RECOMMENDED'));
});

test('a bypass damper is never assumed', () => {
  const a = calculateAirflow(LOAD);
  const z = suggestZones(ROOMS, a);
  assert.equal(z.bypassAssumed, false);
  assert.match(z.bypassNote, /No bypass damper has been assumed/);
});

// ── PART 21: static pressure ────────────────────────────────────────────────

test('static pressure is estimated over the index run and compared with unit ESP', () => {
  const a = calculateAirflow(LOAD);
  const o = designOutlets(ROOMS, a.rows);
  const net = buildDuctNetwork({ airflow: a, outlets: o, mainRoute: { lengthMm: 4000 },
    routesByRoomId: Object.fromEntries(a.rows.map((r, i) => [r.roomId, { lengthMm: 6000 + i * 800 }])) });
  const ret = designReturnAir({ totalAirflowLs: a.allocatedAirflowLs, returnCount: 2, ductLengthMm: 2500 });
  const z = suggestZones(ROOMS, a);

  const p = estimateStaticPressure({ network: net, returnDesign: ret, outlets: o,
    selectedUnit: { model: 'TEST', availableStaticPa: 150 }, zoneAnalysis: z });

  assert.ok(p.estimatedRequirementPa > 0);
  assert.equal(p.estimatedRequirementPa,
    Math.round(p.components.reduce((s, c) => s + c.pa, 0) * 10) / 10);
  assert.equal(p.remainingMarginPa, Math.round((150 - p.estimatedRequirementPa) * 10) / 10);
  assert.match(p.disclaimer, /DESIGN ESTIMATE/);
  assert.ok(p.components.some(c => /Filter/.test(c.item)));
  assert.ok(p.components.some(c => /Return grille/.test(c.item)));
});

test('without ESP on file the comparison is declared missing, not guessed', () => {
  const a = calculateAirflow(LOAD);
  const o = designOutlets(ROOMS, a.rows);
  const net = buildDuctNetwork({ airflow: a, outlets: o, mainRoute: { lengthMm: 4000 } });
  const p = estimateStaticPressure({ network: net, outlets: o, selectedUnit: { model: 'X', availableStaticPa: null } });
  assert.equal(p.unitAvailableStaticPa, null);
  assert.equal(p.remainingMarginPa, null);
  assert.ok(p.warnings.some(w => w.code === 'MISSING_MANUFACTURER_DATA'));
});

// ── PART 22/24: materials and money ─────────────────────────────────────────

function sampleDesignParts() {
  const a = calculateAirflow(LOAD);
  const o = designOutlets(ROOMS, a.rows);
  const net = buildDuctNetwork({ airflow: a, outlets: o, mainRoute: { lengthMm: 4000 },
    routesByRoomId: Object.fromEntries(a.rows.map((r, i) => [r.roomId, { lengthMm: 6000 + i * 500 }])) });
  const z = suggestZones(ROOMS, a);
  const ret = designReturnAir({ totalAirflowLs: a.allocatedAirflowLs, returnCount: 2, ductLengthMm: 2500 });
  return { a, o, net, z, ret };
}

test('the BOM is derived from the design, with quantities that trace back', () => {
  const { o, net, z, ret } = sampleDesignParts();
  const bom = buildBillOfMaterials({
    selectedUnit: { brandName: 'Daikin', model: 'FDYQN140LCV1', capacityKw: 14, phase: '1Ph',
                    supplierCost: 6800, sellPrice: 20400 },
    controller: { name: 'Airtouch 5', cost: 1450 },
    network: net, outlets: o, zones: z, returnDesign: ret,
    refrigerantPipeM: 8, drainPipeM: 6, cableM: 12
  });

  const diffusers = bom.items.filter(i => i.category === 'outlets')
    .reduce((s, i) => s + i.quantity, 0);
  assert.equal(diffusers, o.totals.total);

  const motors = bom.items.find(i => i.key === 'zone_motor');
  assert.equal(motors.quantity, z.zones.filter(x => !x.alwaysOpen).length);

  const flexTotal = bom.items.filter(i => i.key === 'flex_duct').reduce((s, i) => s + i.quantity, 0);
  assert.ok(Math.abs(flexTotal - (net.totalDuctLengthM + ret.duct.lengthM)) < 0.05);

  assert.ok(bom.totalCost > 0);
  assert.ok(bom.equipmentCost >= 6800);
});

test('placeholder material rates are declared, never passed off as NAC prices', () => {
  const { o, net, z, ret } = sampleDesignParts();
  const bom = buildBillOfMaterials({ network: net, outlets: o, zones: z, returnDesign: ret });
  assert.ok(bom.placeholderCount > 0);
  assert.ok(bom.warnings.some(w => w.code === 'MATERIAL_PRICE_PLACEHOLDER'));
  assert.ok(bom.items.filter(i => i.priceSource === 'default_placeholder').length === bom.placeholderCount);
});

test("NAC's own material rates take over from the placeholders", () => {
  const { o, net, z, ret } = sampleDesignParts();
  const bom = buildBillOfMaterials({ network: net, outlets: o, zones: z, returnDesign: ret },
    { nacRates: { zone_motor: 189, flex_duct: { 200: 24.5 } } });
  const motor = bom.items.find(i => i.key === 'zone_motor');
  assert.equal(motor.unitCost, 189);
  assert.equal(motor.priceSource, 'nac');
  const flex200 = bom.items.find(i => i.key === 'flex_duct' && i.diameterMm === 200);
  if (flex200) { assert.equal(flex200.unitCost, 24.5); assert.equal(flex200.priceSource, 'nac'); }
});

test('a BOM line can be edited and the totals follow', () => {
  const { o, net, z, ret } = sampleDesignParts();
  const bom = buildBillOfMaterials({ network: net, outlets: o, zones: z, returnDesign: ret });
  const i = bom.items.findIndex(x => x.key === 'zone_motor');
  const edited = editBomLine(bom, i, { unitCost: 200, quantity: 4 });
  assert.equal(edited.items[i].totalCost, 800);
  assert.equal(edited.items[i].edited, true);
  assert.equal(edited.totalCost,
    Math.round(edited.items.reduce((s, x) => s + (x.totalCost || 0), 0) * 100) / 100);
});

test('labour is built from the design, at the configured rate', () => {
  const { o, net, z } = sampleDesignParts();
  const l = calculateLabour({ outlets: o, zones: z, network: net });
  assert.equal(l.ratePerHour, DEFAULT_SETTINGS.commercial.labourRatePerHour);
  assert.equal(l.totalCost, Math.round(l.totalHours * l.ratePerHour * 100) / 100);
  assert.ok(l.rows.some(r => /Outlets/.test(r.task)));
  assert.ok(l.rows.some(r => /Commissioning/.test(r.task)));
});

test("margin maths matches NAC's existing GST-inclusive quote convention", () => {
  const c = calculateCommercials({
    bom: { equipmentCost: 6800, materialsCost: 5200 },
    labour: { totalCost: 3800 },
    sellPrice: 20400, subcontractorCost: 500, otherCost: 250
  });
  assert.equal(c.totalJobCost, 16550);
  assert.equal(c.sellPriceExGst, 18545.45);
  assert.equal(c.gstAmount, 1854.55);
  assert.equal(c.grossProfit, 1995.45);
  assert.equal(c.grossMarginPct, 10.8);
  assert.ok(c.warnings.some(w => w.code === 'LOW_GROSS_MARGIN'));
});

test('extras add to the sell price the same way the existing quote does', () => {
  const base = calculateCommercials({ bom: { equipmentCost: 1000, materialsCost: 0 }, labour: { totalCost: 0 }, sellPrice: 10000 });
  const withExtras = calculateCommercials({ bom: { equipmentCost: 1000, materialsCost: 0 }, labour: { totalCost: 0 },
    sellPrice: 10000, extras: [{ label: 'Extra outlet', price: 450, qty: 2 }] });
  assert.equal(withExtras.sellPriceIncGst - base.sellPriceIncGst, 900);
});

test('no sell price means no invented sell price', () => {
  const c = calculateCommercials({ bom: { equipmentCost: 1000, materialsCost: 0 }, labour: { totalCost: 0 }, sellPrice: null });
  assert.equal(c.sellPriceIncGst, null);
  assert.equal(c.grossProfit, null);
  assert.ok(c.warnings.some(w => w.code === 'NO_SELL_PRICE'));
});

test('quote line items are produced in the existing nac_quotes shape', () => {
  const c = calculateCommercials({ bom: { equipmentCost: 1000, materialsCost: 0 }, labour: { totalCost: 0 }, sellPrice: 20400 });
  const items = toQuoteLineItems({
    selectedUnit: { brandName: 'Daikin', model: 'FDYQN140LCV1', capacityKw: 14, phase: '1Ph' },
    outlets: { totals: { total: 11 } }, zones: { zones: [1, 2, 3, 4, 5, 6] }, brandUrl: 'https://x'
  }, c);
  assert.equal(items[0].price, 20400);
  assert.match(items[0].name, /Daikin FDYQN140LCV1 14kW/);
  assert.match(items[0].desc, /11 outlets, 6 zones/);
  assert.equal(items[0].link, 'https://x');
});

// ── PART 27: warnings ───────────────────────────────────────────────────────

test('warnings are collected across every stage and sorted by severity', () => {
  const w = collectWarnings({
    calibration: null,
    rooms: [buildRoom({ label: 'Bed 2', measurement: { widthMm: null, lengthMm: null, areaSqM: null,
      source: 'estimated', sourceLabel: 'Estimate', evidence: [] } })],
    airflow: { warnings: [{ code: 'AIRFLOW_TOO_LOW', severity: 'INFO', message: 'x' }] },
    network: { warnings: [{ code: 'EXCESSIVE_DUCT_VELOCITY', severity: 'WARNING', message: 'y' }] }
  });
  assert.equal(w[0].severity, 'CRITICAL');
  assert.ok(w.some(x => x.code === 'MISSING_PLAN_CALIBRATION'));
  assert.ok(w.some(x => x.code === 'LOW_ROOM_MEASUREMENT_CONFIDENCE'));
  assert.ok(w.every(x => x.area && x.id));
});

test('critical warnings block approval until they are acknowledged by name', () => {
  const design = { calibration: null, rooms: [], zones: { warnings: [
    { code: 'MINIMUM_OPEN_AIRFLOW_TOO_LOW', severity: 'CRITICAL', message: 'too low' }] } };
  let warnings = collectWarnings(design);
  let s = summarise(warnings);
  assert.equal(s.canApprove, false);
  assert.match(s.blockReason, /must be acknowledged/);

  const critical = warnings.find(w => w.severity === 'CRITICAL');
  design.warningAcknowledgements = acknowledge(design, critical, 'nick', 'Constant zone added on site');
  warnings = collectWarnings(design);
  s = summarise(warnings);
  assert.equal(s.canApprove, true);
  assert.equal(warnings.find(w => w.severity === 'CRITICAL').acknowledgedBy, 'nick');
});

test('duplicate warnings are collapsed, keeping the highest severity', () => {
  const w = collectWarnings({
    calibration: { pixelsPerMm: 0.1 }, rooms: [],
    airflow: { warnings: [{ code: 'X', severity: 'INFO', message: 'same' }] },
    network: { warnings: [{ code: 'X', severity: 'CRITICAL', message: 'same' }] }
  });
  const xs = w.filter(x => x.code === 'X');
  assert.equal(xs.length, 1);
  assert.equal(xs[0].severity, 'CRITICAL');
});
