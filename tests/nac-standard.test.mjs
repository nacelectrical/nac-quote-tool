// ═══════════════════════════════════════════════════════════════════════════
// THE NAC DUCT DESIGN STANDARD — CONFORMANCE
// ═══════════════════════════════════════════════════════════════════════════
//
// Thirteen rules, checked against the REAL NAC plan.
//
// These are not unit tests of a function. Each one takes the whole design the
// application would produce for tests/fixtures/plan-brochure-ground-floor.jpg
// and asserts that the finished thing obeys an NAC rule. That is deliberate:
// the faults these exist to stop were never a wrong formula, they were two
// parts of the application disagreeing about a rule, and only the finished
// design shows that.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import NAC, {
  FINAL_FLEX, SUPPLY_PLENUM, RETURN_AIR, reducerRequired, isLegalAutoFinal,
  maxAirflowPerOutletLs, mainSupplyCount, returnCountFor
} from '../designer/engines/nac-standard.mjs';
import { parseRoomDimensionPair } from '../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes,
         setRoomConditioning } from '../designer/engines/rooms.mjs';
import { isConditionedRoom, isExcludedRoom, CONDITIONING } from '../designer/engines/classify.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { collectInterruptions } from '../designer/engines/interruptions.mjs';
import { indexRun } from '../designer/engines/ducts.mjs';

// ── The real plan ───────────────────────────────────────────────────────────
// Labels, printed sizes and label positions transcribed off the sheet. MEALS
// and STUDY carry no printed size, so they are typed the way an estimator would
// type them.

const SHEET = [
  ['LIVING',           297,  155, '4.3 x 7.1m'],
  ['KITCHEN',          203,  382, '3.7 x 4.2m'],
  ['MEALS',            398,  436, '3.6 x 3.4m'],
  ['LOUNGE',           578,  334, '4.0 x 4.9m'],
  ['FAMILY',           238,  633, '5.8 x 3.9m'],
  ['STUDY',            378,  600, '2.8 x 2.6m'],
  ['FOYER',            548,  663, '3.0 x 3.9m'],
  ['MASTER BEDROOM',   790,  560, '2.7 x 4.0m'],
  ['BEDROOM 4',        430,  772, '3.0 x 3.4m'],
  ['BEDROOM 2',        196, 1068, '3.0 x 3.2m'],
  ['BEDROOM 3',        415, 1068, '3.0 x 3.2m'],
  ['ENSUITE',          790,  700, null],
  ['WC',               222,  737, null],
  ["L'DRY",            186,  771, '2.9 x 2.3m'],
  ['BATH',             196,  884, '2.9 x 1.4m'],
  ['GARAGE',           855,  799, '6.0 x 6.9m'],
  ['COVERED ALFRESCO', 845,  335, null],
  ['PORCH',            658,  775, null],
  ["P'TRY",            137,  438, null],
  ["CUP'D",            313,  987, null]
];

const EXCLUDED = ['ENSUITE', 'WC', "L'DRY", 'BATH', 'GARAGE',
                  'COVERED ALFRESCO', 'PORCH', "P'TRY", "CUP'D"];
const CONDITIONED = ['LIVING', 'KITCHEN', 'MEALS', 'LOUNGE', 'FAMILY', 'STUDY',
                     'FOYER', 'MASTER BEDROOM', 'BEDROOM 4', 'BEDROOM 2', 'BEDROOM 3'];

// The garage is 6.0 m across about 340 px on this image.
const PPM = 340 / 6000;
const CAL = { pixelsPerMm: PPM, mmPerPixel: 1 / PPM, imageWidthPx: 1179, imageHeightPx: 1262,
              display: {} };

function realPlanRooms(over = {}) {
  return SHEET.map(([label, x, y, printed]) => {
    const d = printed ? parseRoomDimensionPair(printed) : null;
    const m = architecturalMeasurement(d?.widthMm ?? null, d?.lengthMm ?? null,
      printed ? ['Printed on the plan as "' + printed + '"'] : []);
    return buildRoom({
      label, measurement: m,
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 },
      ...(over[label] || {})
    });
  });
}

let CATALOGUE = null;
async function realPlanDesign(over = {}) {
  if (!CATALOGUE) CATALOGUE = await buildCatalogue({});
  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(realPlanRooms(over.rooms || {}), CAL,
    { imageWidthPx: 1179, imageHeightPx: 1262 });
  d.plan = { name: 'plan-brochure-ground-floor.jpg', widthPx: 1179, heightPx: 1262 };
  d.calibration = CAL;
  return runPipeline({ ...d, ...(over.design || {}) }, { catalogue: CATALOGUE });
}

const sections = (d) => d.network?.sections || [];
const finals = (d) => sections(d).filter(s => s.role === 'final');
const branches = (d) => sections(d).filter(s => s.role === 'branch');
const mains = (d) => sections(d).filter(s => s.plenumOutlet);

// ═══════════════════════════════════════════════════════════════════════════
// 1. Bathrooms, laundry, garage and the rest are excluded EVERYWHERE
// ═══════════════════════════════════════════════════════════════════════════

test('1. excluded rooms are excluded in every engine at once', async () => {
  const d = await realPlanDesign();
  const excludedIds = d.rooms.filter(r => EXCLUDED.includes(r.label)).map(r => r.id);
  assert.equal(excludedIds.length, EXCLUDED.length, 'all nine excluded rooms are on the plan');

  for (const label of EXCLUDED) {
    const room = d.rooms.find(r => r.label === label);
    assert.equal(isExcludedRoom(room), true, label + ' is not excluded');
    assert.equal(room.status, 'Excluded', label + ' status is ' + room.status);
  }
  for (const label of CONDITIONED) {
    assert.equal(isConditionedRoom(d.rooms.find(r => r.label === label)), true, label);
  }

  // NAC's rule, engine by engine — this is the disagreement the standard exists
  // to stop, so every consumer is checked rather than trusting one.
  const has = (list, key) => (list || []).filter(x => excludedIds.includes(x[key]));
  assert.equal(has(d.roomLoads, 'roomId').length, 0, 'load');
  assert.equal(has(d.roomLoads, 'roomId').reduce((s, r) => s + (r.designW || 0), 0), 0, 'watts');
  assert.equal(has(d.airflow?.rows, 'roomId').length, 0, 'airflow');
  assert.equal(has(d.outlets?.rows, 'roomId').length, 0, 'outlets');
  assert.equal(has(sections(d), 'roomId').length, 0, 'ducts');
  assert.equal(has(d.autoRoute?.segments, 'roomId').length, 0, 'routes');
  assert.equal((d.zones?.zones || []).filter(z =>
    (z.roomIds || []).some(id => excludedIds.includes(id))).length, 0, 'zones');
  assert.equal((d.zoneDampers || []).filter(x => excludedIds.includes(x.roomId)).length, 0, 'dampers');
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. 150 mm finals never appear in AUTO DESIGN
// ═══════════════════════════════════════════════════════════════════════════

test('2. no 150 mm final — and nothing under 200 anywhere in the auto design', async () => {
  const d = await realPlanDesign();
  for (const s of finals(d)) {
    assert.ok(isLegalAutoFinal(s.diameterMm),
      s.id + ' is a ' + s.diameterMm + ' mm final, which is not one of ' +
      FINAL_FLEX.autoSizesMm.join('/'));
  }
  // And no run of any role is below NAC's minimum.
  const tooSmall = sections(d).filter(s => s.diameterMm && s.diameterMm < NAC.autoMinDiameterMm);
  assert.equal(tooSmall.length, 0,
    'runs below ' + NAC.autoMinDiameterMm + ' mm: ' +
    tooSmall.map(s => s.id + '=' + s.diameterMm).join(', '));
  // 150 is still available for the estimator to set by hand.
  assert.ok(FINAL_FLEX.manualOnlyMm.includes(150));
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Finals never exceed 300 mm
// ═══════════════════════════════════════════════════════════════════════════

test('3. no final exceeds 300 mm', async () => {
  const d = await realPlanDesign();
  for (const s of finals(d)) {
    assert.ok(s.diameterMm <= FINAL_FLEX.maxMm,
      s.id + ' is ' + s.diameterMm + ' mm — over the ' + FINAL_FLEX.maxMm + ' mm final maximum');
  }
  // The neck an outlet is ordered by is under the same cap.
  for (const row of (d.outlets?.rows || [])) {
    assert.ok(row.neckMm <= FINAL_FLEX.maxMm, row.label + ' neck ' + row.neckMm);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. High airflow makes MORE OUTLETS, not a bigger final
// ═══════════════════════════════════════════════════════════════════════════

test('4. a room needing more than one final can carry gets another outlet', async () => {
  const ceiling = maxAirflowPerOutletLs(5.0);
  assert.ok(ceiling > 300 && ceiling < 400, 'sanity: a 300 at 5 m/s carries about ' + Math.round(ceiling));

  const { designRoomOutlets } = await import('../designer/engines/outlets.mjs');
  // A big open-plan space, far more air than one final should carry.
  const big = designRoomOutlets(
    { id: 'big', label: 'OPEN PLAN', roomType: 'living', widthMm: 12000, lengthMm: 7000, areaSqM: 84 },
    900);
  assert.ok(big.quantity > 1, '900 L/s went to ' + big.quantity + ' outlet(s)');
  assert.ok(big.perOutletLs <= ceiling,
    big.perOutletLs + ' L/s per outlet is more than a ' + FINAL_FLEX.maxMm + ' should carry');
  assert.ok(big.neckMm <= FINAL_FLEX.maxMm);
  assert.ok(big.reasons.some(r => /outlet/i.test(r) && /\d/.test(r)),
    'it must say why it split: ' + big.reasons.join(' | '));
  // And where a hard cap stops it splitting far enough, it says so rather than
  // quietly running every outlet over its limit.
  if (big.quantity === NAC.outlets.maxPerRoom) {
    assert.ok(big.reasons.some(r => /[Cc]apped at/.test(r)) ||
              big.warnings.some(w => /OVER_CAPACITY/.test(w.code)),
      'the cap bound but nothing said so');
  }

  // On the real plan, every room's per-outlet flow is inside the cap.
  const d = await realPlanDesign();
  for (const row of (d.outlets?.rows || [])) {
    assert.ok(row.perOutletLs <= ceiling, row.label + ': ' + row.perOutletLs + ' L/s per outlet');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. A final branch is BTO → FLEX → OUTLET
// ═══════════════════════════════════════════════════════════════════════════

test('5. every final branch is BTO then correctly sized flex then an outlet', async () => {
  const d = await realPlanDesign();
  const net = d.network;
  assert.ok(net.btoCount > 0, 'the design has no take-offs at all');

  for (const bto of net.btos) {
    for (const field of NAC.bto.requiredFields) {
      assert.ok(bto[field] !== undefined && bto[field] !== null,
        bto.id + ' does not record ' + field);
    }
    assert.ok(bto.branchDiameterMm > 0, bto.id + ' has no branch size');
    assert.ok(bto.branchAirflowLs > 0, bto.id + ' carries no air');
    assert.ok(Array.isArray(bto.serves) ? bto.serves.length > 0 : !!bto.serves,
      bto.id + ' serves nothing');
    // The transition happens AT the take-off.
    assert.equal(bto.reducer, false, bto.id + ' is modelled as a reducer');
  }

  // MAIN FLEX -> BTO -> ONE continuous final flex -> OUTLET. Every outlet is
  // reached by exactly one final run, and that run comes off a take-off.
  const byId = new Map(sections(d).map(s => [s.id, s]));
  for (const row of (d.outlets?.rows || [])) {
    const roomFinals = finals(d).filter(s => s.roomId === row.roomId);
    assert.equal(roomFinals.length, row.quantity,
      row.label + ' has ' + roomFinals.length + ' final run(s) for ' + row.quantity + ' outlet(s)');
    for (const f of roomFinals) {
      assert.ok(f.bto, row.label + ' final does not come off a BTO');
      assert.ok(isLegalAutoFinal(f.diameterMm), row.label + ' final is ' + f.diameterMm + ' mm');
      assert.ok(!f.reducerFrom, row.label + ' final carries a reducer');
      // Straight off its parent — no chain of contrived segments in between.
      const parent = byId.get(f.parentId);
      assert.ok(parent, row.label + ' final hangs off nothing');
      assert.ok(parent.role !== 'final', row.label + ' final is fed by another final');
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. No reducer is inserted just to reach outlet size
// ═══════════════════════════════════════════════════════════════════════════

test('6. a reducer exists only where a main genuinely steps down', async () => {
  const d = await realPlanDesign();
  const byId = new Map(sections(d).map(s => [s.id, s]));

  for (const s of sections(d)) {
    if (!s.reducerFrom) continue;
    assert.ok(s.role !== 'branch' && s.role !== 'final',
      s.id + ' is a ' + s.role + ' carrying a reducer — a take-off is not a reduction');
    const parent = byId.get(s.parentId);
    assert.ok(parent && parent.diameterMm !== s.diameterMm,
      s.id + ' has a reducer but is the same size as its parent');
  }

  // A take-off smaller than the main it comes off must NOT produce a reducer —
  // the BTO is what takes it down to final size.
  const takeoffs = [...finals(d), ...branches(d)];
  const shrinking = takeoffs.filter(b => {
    const p = byId.get(b.parentId);
    return p && p.diameterMm > b.diameterMm;
  });
  assert.ok(shrinking.length > 0,
    'sanity: on this house some take-off is smaller than the main feeding it');
  for (const b of shrinking) {
    assert.ok(!b.reducerFrom, b.id + ' got a reducer just to reach outlet size');
    assert.equal(reducerRequired(byId.get(b.parentId), b), false);
  }

  // And the BOM buys no reducer that the topology does not have.
  const reducerLines = (d.bom?.items || []).filter(i => i.key === 'reducer');
  const realReducers = sections(d).filter(s => s.reducerFrom).length;
  const bought = reducerLines.reduce((sum, i) => sum + i.quantity, 0);
  assert.equal(bought, realReducers,
    'the order has ' + bought + ' reducers for ' + realReducers + ' in the design');
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. The supply plenum always has 2 or 3 mains
// ═══════════════════════════════════════════════════════════════════════════

test('7. the plenum leaves the fan coil on two or three mains', async () => {
  const d = await realPlanDesign();
  const m = mains(d);
  assert.ok(m.length >= SUPPLY_PLENUM.minMains && m.length <= SUPPLY_PLENUM.maxMains,
    m.length + ' mains leave the plenum — NAC fits ' +
    SUPPLY_PLENUM.minMains + ' or ' + SUPPLY_PLENUM.maxMains);
  assert.equal(d.network.mainSupplyCount, m.length);

  for (const main of d.network.supplyMains) {
    for (const field of SUPPLY_PLENUM.requiredFields) {
      assert.ok(main[field] !== undefined && main[field] !== null,
        main.segmentId + ' does not record ' + field);
    }
  }
  // Together they carry the whole system.
  const total = m.reduce((sum, s) => sum + s.airflowLs, 0);
  assert.ok(Math.abs(total - d.airflow.allocatedAirflowLs) < 1,
    'the mains carry ' + total + ' of ' + d.airflow.allocatedAirflowLs);

  // ONE plenum on the order, not one per main.
  const plenumLines = (d.bom?.items || []).filter(i => /supply_plenum/.test(i.key));
  const plenums = plenumLines.reduce((sum, i) => sum + i.quantity, 0);
  assert.equal(plenums, 1, 'the order has ' + plenums + ' supply plenums');

  // The rule itself, at the sizes it decides between.
  assert.equal(mainSupplyCount(400, 4), SUPPLY_PLENUM.minMains);
  assert.equal(mainSupplyCount(1200, 10), SUPPLY_PLENUM.maxMains);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. The return is 1 or 2 ducts
// ═══════════════════════════════════════════════════════════════════════════

test('8. the return is one or two ducts, never an arbitrary number', async () => {
  const d = await realPlanDesign();
  const r = d.returnDesign;
  assert.ok(r.returnCount >= RETURN_AIR.minReturns && r.returnCount <= RETURN_AIR.maxReturns,
    r.returnCount + ' returns — NAC fits ' + RETURN_AIR.minReturns + ' or ' + RETURN_AIR.maxReturns);
  assert.equal(r.returns.length, r.returnCount);
  assert.ok(r.duct?.diameterMm > 0, 'the return has no size');

  // Sized off the design airflow, shared evenly.
  assert.ok(Math.abs(r.perReturnLs - r.designAirflowLs / r.returnCount) < 1);

  assert.equal(returnCountFor(400), RETURN_AIR.minReturns);
  assert.equal(returnCountFor(1400), RETURN_AIR.maxReturns);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. The DRAWING uses the same topology as the BOM
// ═══════════════════════════════════════════════════════════════════════════

test('9. what is drawn and what is bought are the same design', async () => {
  const d = await realPlanDesign();
  const { routedOverlay } = await import('../designer/engines/router.mjs');
  const overlay = routedOverlay({ network: d.network, returnRoute: d.returnRoute,
                                  returnDesign: d.returnDesign });

  // Every sized run with geometry is on the drawing, at its own size.
  const drawnIds = new Set(Object.values(overlay).map(o => o.sectionId).filter(Boolean));
  for (const s of sections(d)) {
    if (!s.points?.length) continue;
    assert.ok(drawnIds.has(s.id), s.id + ' is in the design but not on the drawing');
    const o = Object.values(overlay).find(x => x.sectionId === s.id);
    assert.equal(o.diameterMm, s.diameterMm, s.id + ' is drawn at the wrong size');
  }

  // The metres on the order are the metres on the drawing, plus the return.
  const drawnM = d.network.totalDuctLengthM;
  const bomM = (d.bom?.items || []).filter(i => i.key === 'flex_duct')
    .reduce((sum, i) => sum + (i.metresRequired || 0), 0);
  const retM = d.returnDesign?.duct?.lengthM ?? 0;
  assert.ok(bomM >= drawnM - 0.5 && bomM <= drawnM + retM * d.returnDesign.returnCount + 0.5,
    'the order buys ' + bomM + ' m for a drawing of ' + drawnM + ' m plus ' + retM + ' m of return');
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. PRESSURE uses the same topology as the drawing
// ═══════════════════════════════════════════════════════════════════════════

test('10. the pressure calculation walks the routed geometry, with no invented loss', async () => {
  const d = await realPlanDesign();
  const run = indexRun(d.network);
  assert.ok(run, 'a routed design must have an index run');

  const byId = new Map(sections(d).map(s => [s.id, s]));
  // Every step is on the drawing and genuinely hangs off the one before it.
  for (let i = 0; i < run.path.length; i++) {
    const s = byId.get(run.path[i].id);
    assert.ok(s, run.path[i].id + ' is on the index run but not in the design');
    assert.ok(s.points?.length, s.id + ' is on the index run but has no geometry');
    if (i > 0) assert.equal(s.parentId, run.path[i - 1].id,
      s.id + ' does not hang off ' + run.path[i - 1].id);
  }
  // It starts at the plenum and reaches a room.
  assert.equal(run.path[0].role, 'main');
  assert.ok(run.path.length >= 3, 'the intermediate runs must be on it: ' +
    run.path.map(s => s.role).join(' → '));

  // NO FINAL-BRANCH REDUCER LOSS unless a genuine reducer exists.
  for (const step of run.path) {
    const s = byId.get(step.id);
    if (s.role !== 'branch' && s.role !== 'final') continue;
    assert.ok(!s.reducerFrom, s.id + ' carries a reducer loss it should not have');
    const fittings = (s.fittings || []).map(f => (typeof f === 'string' ? f : f.type));
    assert.ok(!fittings.includes('reducer'), s.id + ' has a reducer fitting');
  }
  // And the total is the sum of the path, not a separate figure.
  const total = run.path.reduce((sum, s) => sum + (s.pressureDropPa || 0), 0);
  assert.ok(Math.abs(total - run.totalPa) < 0.2);
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Quick Quote triggers the full auto design
// ═══════════════════════════════════════════════════════════════════════════

test('11. uploading the plan produces a complete design with no advanced step', async () => {
  const d = await realPlanDesign();
  assert.equal(d.stage, 'complete');
  assert.ok(d.systemLoad.designKw > 0, 'load');
  assert.ok(d.selectedUnit, 'equipment');
  assert.ok(d.airflow.allocatedAirflowLs > 0, 'airflow');
  assert.ok(d.outlets.rows.length > 0, 'outlets');
  assert.ok(d.network.sections.length > 0, 'duct sizing');
  assert.equal(d.network.routed, true, 'auto routing');
  assert.ok(d.autoRoute.generated, 'routes drawn');
  assert.ok(d.returnDesign.returnCount > 0, 'return');
  assert.ok(d.zones.zoneCount > 0, 'zoning');
  assert.ok(d.pressure.estimatedRequirementPa > 0, 'pressure');
  assert.ok(d.bom.lineCount > 0, 'BOM');
  assert.ok(d.commercials.sellPriceIncGst > 0, 'price');
  // Every routed run has geometry, so the layout is actually drawn.
  const routed = sections(d).filter(s => s.points?.length);
  assert.equal(routed.length, sections(d).length, 'some runs were sized but never drawn');
  assert.equal(NAC.quickQuote.advancedDesignRequired, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. Excluded rooms never block verification
// ═══════════════════════════════════════════════════════════════════════════

test('12. nothing NAC does not condition can ever stop a quote', async () => {
  const d = await realPlanDesign();
  const asked = collectInterruptions(d);
  for (const item of asked.all) {
    for (const label of EXCLUDED) {
      assert.ok(!item.title.toUpperCase().includes(label.toUpperCase()),
        'the estimator was asked about ' + label + ': ' + item.title);
    }
  }
  // Even with every excluded room missing its size, none of them blocks.
  const excluded = d.rooms.filter(r => EXCLUDED.includes(r.label));
  assert.ok(excluded.every(r => r.status === 'Excluded'));
  assert.ok(excluded.every(r => !r.measurement?.incomplete || r.status === 'Excluded'));
  const roomBlockers = asked.blocking.filter(b => b.roomId);
  for (const b of roomBlockers) {
    const room = d.rooms.find(r => r.id === b.roomId);
    assert.ok(isConditionedRoom(room), room.label + ' blocks the quote but is not conditioned');
  }
});

test('12b. the estimator can still condition an excluded room for one job', async () => {
  const base = await realPlanDesign();
  const garage = base.rooms.find(r => r.label === 'GARAGE');
  assert.equal(isConditionedRoom(garage), false);

  const on = setRoomConditioning(garage, CONDITIONING.CONDITIONED);
  const d = await realPlanDesign({
    rooms: { GARAGE: { conditioningOverride: on.conditioningOverride } }
  });
  const g = d.rooms.find(r => r.label === 'GARAGE');
  assert.equal(isConditionedRoom(g), true, 'the override did not take');
  assert.ok((d.airflow.rows || []).some(r => r.roomId === g.id), 'it gets air now');
  assert.ok(d.systemLoad.totalConditionedAreaSqM > base.systemLoad.totalConditionedAreaSqM);
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. A saved and reloaded design keeps the same topology
// ═══════════════════════════════════════════════════════════════════════════

test('13. saving and reloading a design does not change the design', async () => {
  const before = await realPlanDesign();

  // Round-trip through JSON, which is exactly what the store does.
  const reloaded = JSON.parse(JSON.stringify(before));
  const after = runPipeline(reloaded, { catalogue: CATALOGUE });

  const shape = (d) => ({
    mains: d.network.mainSupplyCount,
    btos: d.network.btoCount,
    reducers: d.network.reducerCount,
    returns: d.returnDesign.returnCount,
    zones: d.zones.zoneCount,
    sections: sections(d).map(s => s.id + ':' + s.role + ':' + s.diameterMm).sort(),
    outlets: (d.outlets.rows || []).map(o => o.roomId + ':' + o.quantity + ':' + o.neckMm).sort()
  });

  assert.deepEqual(shape(after), shape(before), 'the design changed on reload');
  assert.equal(after.pressure.estimatedRequirementPa, before.pressure.estimatedRequirementPa);
  assert.equal(after.bom.lineCount, before.bom.lineCount);

  // And the estimator's own decisions survive too.
  const withOverride = JSON.parse(JSON.stringify(before));
  const lounge = withOverride.rooms.find(r => r.label === 'LOUNGE');
  withOverride.rooms = withOverride.rooms.map(r => r.id === lounge.id
    ? { ...r, openPlanGroup: null, zoneGroupSource: 'estimator' } : r);
  const out = runPipeline(withOverride, { catalogue: CATALOGUE });
  const again = runPipeline(JSON.parse(JSON.stringify(out)), { catalogue: CATALOGUE });
  assert.equal(again.rooms.find(r => r.label === 'LOUNGE').openPlanGroup, null,
    'the estimator\'s zone split was undone by a reload');
});

// ═══════════════════════════════════════════════════════════════════════════
// The standard is the only place these rules live
// ═══════════════════════════════════════════════════════════════════════════

test('the standard is what the settings publish — one set of numbers', async () => {
  const { DEFAULT_SETTINGS } = await import('../designer/engines/settings.mjs');
  const D = DEFAULT_SETTINGS.duct;
  assert.deepEqual(D.finalBranch.autoLadderMm, [...FINAL_FLEX.autoSizesMm]);
  assert.equal(D.finalBranch.preferredMinMm, FINAL_FLEX.minMm);
  assert.equal(D.finalBranch.maxMm, FINAL_FLEX.maxMm);
  assert.equal(D.autoMinDiameterMm, NAC.autoMinDiameterMm);
  assert.equal(D.branchMinMm, NAC.branchMinMm);
  assert.deepEqual(D.availableDiametersMm, [...NAC.stockedDiametersMm]);
  assert.equal(DEFAULT_SETTINGS.outlets.maxOutletsPerRoom, NAC.outlets.maxPerRoom);
  assert.deepEqual(DEFAULT_SETTINGS.outlets.neckSizesMm, [...NAC.outlets.neckSizesMm]);
});

test('the classifier reads the standard, and holds no list of its own', async () => {
  const classify = await import('../designer/engines/classify.mjs');
  const { classifyRoomLabel } = classify;
  // Every name in the standard's exclusion list classifies as excluded.
  for (const rule of NAC.rooms.EXCLUDED_ROOMS) {
    assert.ok(rule.name && rule.why, 'every exclusion states a reason');
  }
  for (const label of ['Bathroom', 'Ensuite', 'WC', 'Laundry', 'Garage', 'Carport',
                       'Alfresco', 'Porch', 'Patio', 'Verandah', 'Pantry', 'WIP',
                       'WIR', 'BIR', 'Robe', 'Wardrobe', 'Cupboard', 'Linen',
                       'Store', 'Storage', 'Plant room', 'Powder room']) {
    assert.equal(classifyRoomLabel(label).status, CONDITIONING.NON_CONDITIONED, label);
  }
  assert.equal(classify.EXCLUDED_BANNER, NAC.rooms.EXCLUDED_BANNER);
});

test('the drawing colours come from the standard', async () => {
  const zones = await import('../designer/engines/zones.mjs');
  const { ROLE_COLOUR } = await import('../designer/engines/router.mjs');
  assert.equal(zones.TRUNK_COLOUR, NAC.drawing.trunkColour);
  assert.equal(zones.RETURN_COLOUR, NAC.drawing.returnColour);
  assert.equal(ROLE_COLOUR.main, NAC.drawing.trunkColour);
  assert.equal(ROLE_COLOUR.return, NAC.drawing.returnColour);
  assert.equal(zones.ZONE_PALETTE.length, NAC.drawing.zonePalette.length);
});
