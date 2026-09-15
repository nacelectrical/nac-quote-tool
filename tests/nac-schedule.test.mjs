// THE NAC DUCT DESIGN SCHEDULE, on the real onsite plan.
//
// Stage 1 of the two-stage brief: the duct design has to be right as PLAIN
// TEXT before anybody draws it. These tests are that gate. Every one of them
// is a rule Nick has stated, checked against the schedule the tool produces
// for the brochure ground-floor plan that failed on site.
//
// If a routing change breaks a rule, it breaks here — not in a drawing
// somebody has to squint at.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoomDimensionPair } from '../designer/engines/dimensions.mjs';
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes,
         applyRoomOverride } from '../designer/engines/rooms.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { nacScheduleData, checkNacSchedule, nacDuctSchedule, velocityMs }
  from '../designer/engines/nac-schedule.mjs';
import { FINAL_FLEX, SUPPLY_PLENUM, RETURN_AIR, MAIN_REDUCTIONS, mainFloorForFinals,
         plenumBalance, MIN_MAIN_DIAMETER_MM, RETURN_DUCT_SIZES_MM,
         choosePlenumMains } from '../designer/engines/nac-standard.mjs';
import { balanceGroups } from '../designer/engines/nac-router.mjs';
import { sizeColour, sizeKey } from '../designer/ui/flex-renderer.mjs';

// The real sheet: every label at the pixel it is printed, with the size text
// printed under it. Transcribed off the plan, NOT INVENTED.
//
// MEALS and STUDY carry no printed size. They are null here because that is
// what the sheet says, and the tool blocks on them until somebody measures
// them — which is the whole point of the rule. An earlier version of this
// fixture filled them in with plausible numbers and the resulting 22.54 kW
// load quietly included 19.5 m2 of floor that nothing had ever measured.
const SHEET = [
  ['LIVING', 297, 155, '4.3 x 7.1m'], ['KITCHEN', 203, 382, '3.7 x 4.2m'],
  ['MEALS', 398, 436, null], ['LOUNGE', 578, 334, '4.0 x 4.9m'],
  ['FAMILY', 238, 633, '5.8 x 3.9m'], ['STUDY', 378, 600, null],
  ['FOYER', 548, 663, '3.0 x 3.9m'], ['MASTER BEDROOM', 790, 560, '2.7 x 4.0m'],
  ['BEDROOM 4', 430, 772, '3.0 x 3.4m'], ['BEDROOM 2', 196, 1068, '3.0 x 3.2m'],
  ['BEDROOM 3', 415, 1068, '3.0 x 3.2m'],
  ['ENSUITE', 790, 700, null], ['WC', 222, 737, null], ["L'DRY", 186, 771, '2.9 x 2.3m'],
  ['BATH', 196, 884, '2.9 x 1.4m'], ['GARAGE', 855, 799, '6.0 x 6.9m'],
  ['COVERED ALFRESCO', 845, 335, null], ['PORCH', 658, 775, null],
  ["P'TRY", 137, 438, null], ["CUP'D", 313, 987, null]
];

const PPM = 340 / 6000;   // calibrated off the garage: 6.0 m across 340 px
const CAL = { pixelsPerMm: PPM, mmPerPixel: 1 / PPM,
              imageWidthPx: 1179, imageHeightPx: 1262, display: {} };

// What the ESTIMATOR measured on site for the two rooms the sheet does not
// print. These are input, not plan data, and they are kept apart from SHEET so
// that nothing can ever again present a typed number as something the drawing
// stated. The real workflow is identical: the tool blocks, names both rooms,
// and the estimator types these in.
const MEASURED_ON_SITE = {
  MEALS: { widthMm: 3600, lengthMm: 3400 },
  STUDY: { widthMm: 2800, lengthMm: 2600 }
};

async function realPlanDesign({ measured = MEASURED_ON_SITE } = {}) {
  const rooms = SHEET.map(([label, x, y, printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({
      label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null,
        printed ? ['printed'] : []),
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 }
    });
  });
  // The estimator's site measurements, applied through the SAME path the app
  // uses when they type them on the room verification screen. That path records
  // them as 'manual', so nothing downstream can mistake a typed number for one
  // the drawing printed.
  for (const [label, dims] of Object.entries(measured || {})) {
    const i = rooms.findIndex(r => r.label === label);
    if (i < 0) continue;
    rooms[i] = applyRoomOverride(rooms[i], dims, 'estimator');
  }

  const d = createDesign();
  d.rooms = deriveBoundariesFromPrintedSizes(rooms, CAL,
    { imageWidthPx: 1179, imageHeightPx: 1262 });
  d.plan = { name: 'brochure ground floor', widthPx: 1179, heightPx: 1262 };
  d.calibration = CAL;
  return runPipeline(d, { catalogue: await buildCatalogue({}) });
}

const design = await realPlanDesign();
const S = nacScheduleData(design);
const V = checkNacSchedule(S);

// ── The gate ────────────────────────────────────────────────────────────────

test('the schedule passes every NAC hard rule', () => {
  // Hard rules only. A NOTE is a rule that pulls against another one on this
  // particular house — the plenum balance against the installer areas — and it
  // is reported with its figures, not failed.
  const failed = V.checks.filter(c => !c.ok && !c.note).map(c => c.rule + ' — ' + c.detail);
  assert.deepEqual(failed, [], failed.join('\n'));
  assert.equal(V.ok, true);
});

// ── 1. Supply plenum ────────────────────────────────────────────────────────

test('the plenum carries 2 or 3 supply ducts, never 1 and never 4', () => {
  assert.ok(S.plenum.ductCount >= SUPPLY_PLENUM.minMains);
  assert.ok(S.plenum.ductCount <= SUPPLY_PLENUM.maxMains);
});

test('every supply duct off the plenum states its size, airflow and rooms', () => {
  for (const duct of S.plenum.ducts) {
    assert.ok(duct.diameterMm > 0, duct.name + ' has no size');
    assert.ok(duct.airflowLs > 0, duct.name + ' has no airflow');
    assert.ok(duct.serves.length > 0, duct.name + ' serves nothing');
    assert.ok(duct.outletCount > 0, duct.name + ' reaches no outlet');
  }
});

test('every duct off the plenum is the same size', () => {
  assert.equal(S.plenum.sizesMm.length, 1,
    'plenum carries ' + S.plenum.sizesMm.join(' + '));
  assert.ok(S.plenum.ductSizeMm > 0);
  for (const duct of S.plenum.ducts) {
    assert.equal(duct.diameterMm, S.plenum.ductSizeMm);
  }
});

test('the plenum picks its count and its size together', () => {
  // 1202 L/s is 2 x 400 at 4.78 m/s or 3 x 400 at 3.19 m/s, and only the first
  // is a duct moving air — so the count cannot be settled before the size.
  const p = choosePlenumMains(1202);
  assert.equal(p.count, 2);
  assert.equal(p.diameterMm, 400);
  assert.equal(p.inBand, true);
  // A bigger system fills three of the same spigot.
  const big = choosePlenumMains(1800);
  assert.equal(big.count, 3);
  assert.equal(big.diameterMm, 400);
  assert.equal(big.inBand, true);
  // A small one steps the SIZE down rather than dropping below two mains.
  const small = choosePlenumMains(600);
  assert.equal(small.count, 2);
  assert.ok(small.diameterMm < 400);
  assert.ok(small.inBand);
  // Every option it considered is a size NAC makes a plenum in.
  for (const o of p.options) {
    assert.ok(SUPPLY_PLENUM.mainSizesMm.includes(o.diameterMm));
    assert.ok(o.count >= SUPPLY_PLENUM.minMains && o.count <= SUPPLY_PLENUM.maxMains);
  }
});

test('the plenum on the real plan is 2 x 400', () => {
  assert.equal(S.plenum.ductCount, 2);
  assert.equal(S.plenum.ductSizeMm, 400);
});

test('the plenum balance is measured, and said out loud when it is off', () => {
  // THE AREAS WIN. On this house the open plan is most of the air, so mains
  // that follow the areas an installer works in cannot also be even. The
  // schedule does not fail the design for that and does not quietly redraw the
  // house to make the number come out — it reports it as a NOTE with the
  // figures, and the estimator decides.
  const b = S.plenum.balance;
  assert.ok(Number.isFinite(b.worstDeviationPct));
  assert.equal(b.balanced, b.worstDeviationPct <= SUPPLY_PLENUM.balanceTolerancePct);
  const V = checkNacSchedule(S);
  const row = V.checks.find(c => /shared evenly/.test(c.rule));
  assert.ok(row, 'the plenum balance is not checked at all');
  if (!b.balanced) {
    assert.equal(row.note, true, 'an unbalanced plenum was reported as a hard failure');
    assert.match(row.detail, /follow the areas of the house/);
    assert.ok(V.notes.includes(row));
  }
});

test('a NOTE never counts as a hard-rule failure', () => {
  const V = checkNacSchedule(S);
  assert.equal(V.hardCount + V.notes.length, V.checks.length);
  assert.equal(V.failed, V.checks.filter(c => !c.ok && !c.note).length);
  assert.equal(V.ok, V.failed === 0);
});

test('plenumBalance measures the worst deviation, not the average', () => {
  assert.deepEqual(plenumBalance([400, 400, 400]),
    { meanLs: 400, worstDeviationPct: 0, balanced: true, flows: [400, 400, 400] });
  // 700/208/292 — the split this rule was written to stop.
  const bad = plenumBalance([702, 208, 292]);
  assert.equal(bad.balanced, false);
  assert.ok(bad.worstDeviationPct > 70);
  assert.equal(plenumBalance([]).balanced, true);
});

test('balancing moves whole rooms, never half of one', () => {
  // Two groups, wildly uneven, with a two-outlet room sitting between them.
  // Room b sits ON the boundary — as near the light group as its own — so it is
  // the one that may move. A room buried inside its own main may not (below).
  const groups = [
    [{ roomId: 'a', x: 0, y: 0, airflowLs: 300 },
     { roomId: 'b', x: 10, y: 0, airflowLs: 100 },
     { roomId: 'b', x: 11, y: 0, airflowLs: 100 }],
    [{ roomId: 'c', x: 14, y: 0, airflowLs: 100 }]
  ];
  const out = balanceGroups(groups, { tolerancePct: 15 });
  const flows = out.map(g => g.reduce((n, o) => n + o.airflowLs, 0));
  assert.ok(Math.max(...flows) - Math.min(...flows) < 300, flows.join('/'));
  // Room b is still whole, wherever it ended up.
  const whereB = out.map((g, i) => g.some(o => o.roomId === 'b') ? i : -1).filter(i => i >= 0);
  assert.equal(whereB.length, 1, 'room b was split across two mains');
  assert.equal(out[whereB[0]].filter(o => o.roomId === 'b').length, 2);
  // And no main was emptied.
  assert.ok(out.every(g => g.length > 0));
});

test('a room buried inside its own main is not moved to even the numbers up', () => {
  // Balancing on airflow alone walked a family room onto the bedroom main
  // purely because the numbers came out evener — a division nobody could
  // explain standing in the roof. Room b is 30 away from the light group and 3
  // from its own centre, so it stays where it is and the plenum stays uneven.
  const groups = [
    [{ roomId: 'a', x: 0, y: 0, airflowLs: 300 },
     { roomId: 'b', x: 10, y: 0, airflowLs: 100 },
     { roomId: 'b', x: 11, y: 0, airflowLs: 100 }],
    [{ roomId: 'c', x: 40, y: 0, airflowLs: 100 }]
  ];
  const out = balanceGroups(groups, { tolerancePct: 15 });
  assert.equal(out[0].length, 3, 'a room deep inside its own main was moved');
  assert.equal(out[1].length, 1);
});

test('the open plan is never divided across two mains', () => {
  // Nick: "think in installer areas, not geometry." Two open-plan rooms and one
  // bedroom: moving the bedroom cannot even this plenum up, and the open plan
  // is not allowed to give, so it stays uneven and the schedule says so.
  const groups = [
    [{ roomId: 'liv', x: 0, y: 0, airflowLs: 300, openPlan: true },
     { roomId: 'kit', x: 7, y: 0, airflowLs: 300, openPlan: true }],
    [{ roomId: 'bed', x: 10, y: 0, airflowLs: 100 }]
  ];
  const out = balanceGroups(groups, { tolerancePct: 15 });
  assert.equal(out[0].length, 2, 'the open plan was split across two mains');
  assert.ok(out[1].every(o => o.roomId === 'bed'));
});

test('one room never feeds off two different mains', () => {
  const mainOfRoom = new Map();
  // Only take-offs that serve a ROOM. A take-off onto a major branch carries no
  // room, and two of them on two different mains is a main each having a branch,
  // not one room fed from both.
  for (const b of S.btos.filter(x => !x.feedsBranch)) {
    const main = b.parentId.split('_')[1];
    if (mainOfRoom.has(b.room)) {
      assert.equal(mainOfRoom.get(b.room), main,
        b.room + ' is fed from Main ' + mainOfRoom.get(b.room) + ' and Main ' + main);
    }
    mainOfRoom.set(b.room, main);
  }
});

test('the air leaving the plenum is the air the system moves', () => {
  const outlets = S.rooms.reduce((n, r) => n + r.totalLs, 0);
  assert.ok(Math.abs(S.plenum.totalAirflowLs - outlets) <= 2,
    S.plenum.totalAirflowLs + ' off the plenum vs ' + outlets + ' out of the outlets');
});

// ── 2. Mains ────────────────────────────────────────────────────────────────

test('a main is one duct, split only where it genuinely reduces', () => {
  for (const m of S.mainRuns) {
    assert.equal(m.stretches.length, m.reductions + 1,
      m.name + ' has ' + m.stretches.length + ' stretches for ' + m.reductions + ' reductions');
    // Every stretch after the first exists BECAUSE of a reduction.
    for (const s of m.stretches.slice(1)) {
      assert.ok(s.reducedFromMm, m.name + '/' + s.id + ' is a fragment, not a reduction');
    }
  }
});

test('no main reduces more than NAC fits', () => {
  for (const m of S.mainRuns) {
    assert.ok(m.reductions <= MAIN_REDUCTIONS.maxPerMain,
      m.name + ' reduces ' + m.reductions + ' times');
  }
});

test('a main is always a size above the largest final coming off it', () => {
  // Level with it is a FULL-BORE take-off. Rejected at 250; the same fault
  // reappeared at 300 the moment a 300 final existed, which is how you can
  // tell it was never about the number.
  assert.equal(mainFloorForFinals(200, [250]), 300);
  assert.equal(mainFloorForFinals(200, [300]), 350);
  assert.equal(mainFloorForFinals(400, [250]), 400);   // already bigger, left alone
  // And MIN_MAIN_DIAMETER_MM falls out of it: 250 finals are the common case.
  assert.equal(mainFloorForFinals(0, [250]), MIN_MAIN_DIAMETER_MM);

  for (const b of S.btos) {
    if (b.parentRole !== 'main') continue;
    assert.ok(b.branchDiameterMm < b.parentDiameterMm,
      'BTO ' + b.number + ' takes ' + b.branchDiameterMm + ' off a ' +
      b.parentDiameterMm + ' main — full bore');
  }
});

test('a main is never a 250 — nor anything under the minimum', () => {
  for (const m of S.mainRuns) {
    for (const s of m.stretches) {
      assert.ok(s.diameterMm >= MIN_MAIN_DIAMETER_MM,
        m.name + '/' + s.id + ' is ' + s.diameterMm);
    }
  }
});

test('no take-off is the same size as the main it comes off', () => {
  // The reason the minimum exists: a 250 take-off on a 250 main is full bore,
  // with air still to carry past it.
  for (const b of S.btos) {
    if (b.parentRole !== 'main') continue;
    assert.ok(b.branchDiameterMm < b.parentDiameterMm,
      'BTO ' + b.number + ' takes ' + b.branchDiameterMm + ' off a ' +
      b.parentDiameterMm + ' main');
  }
});

test('a main never grows along its length', () => {
  for (const m of S.mainRuns) {
    for (let i = 1; i < m.stretches.length; i++) {
      assert.ok(m.stretches[i].diameterMm <= m.stretches[i - 1].diameterMm,
        m.name + ': ' + m.stretches[i - 1].diameterMm + ' -> ' + m.stretches[i].diameterMm);
    }
  }
});

test('airflow falls along every main', () => {
  for (const m of S.mainRuns) {
    for (let i = 1; i < m.stretches.length; i++) {
      assert.ok(m.stretches[i].airflowLs < m.stretches[i - 1].airflowLs,
        m.name + ': ' + m.stretches[i - 1].airflowLs + ' -> ' + m.stretches[i].airflowLs);
    }
  }
});

// ── 3. Take-offs ────────────────────────────────────────────────────────────

test('every final comes off its own BTO', () => {
  // A take-off onto a MAJOR BRANCH is a take-off too — the bedroom wing comes
  // off the main through one — so it is the OUTLET take-offs that must match
  // the finals, not every take-off on the job.
  assert.equal(S.totals.outletBtos, S.totals.finals);
  assert.ok(S.totals.btos >= S.totals.outletBtos);
  assert.equal(S.btos.filter(b => !b.feedsBranch).length, S.totals.outletBtos);
});

test('a take-off onto a major branch names the branch, not a room', () => {
  for (const b of S.btos.filter(x => x.feedsBranch)) {
    assert.equal(b.room, '—', 'BTO ' + b.number + ' claims a room it does not serve');
    assert.match(b.outlet, /^major_.* \(\d+ rooms\)$/);
  }
});

test('every BTO records parent size, branch size, airflow and what it serves', () => {
  for (const b of S.btos) {
    assert.ok(b.parentDiameterMm > 0, 'BTO ' + b.number + ' has no parent size');
    assert.ok(b.branchDiameterMm > 0, 'BTO ' + b.number + ' has no branch size');
    assert.ok(b.airflowLs > 0, 'BTO ' + b.number + ' carries no air');
    assert.ok(b.room, 'BTO ' + b.number + ' serves no room');
    assert.ok(b.outlet, 'BTO ' + b.number + ' serves no outlet');
  }
});

test('no take-off is bigger than the duct it comes off', () => {
  for (const b of S.btos) {
    assert.ok(b.branchDiameterMm <= b.parentDiameterMm,
      'BTO ' + b.number + ': ' + b.branchDiameterMm + ' off ' + b.parentDiameterMm);
  }
});

test('the take-offs are numbered once each, with no gaps', () => {
  const numbers = S.btos.map(b => b.number);
  assert.deepEqual(numbers, [...Array(S.totals.btos)].map((_, i) => i + 1));
});

// ── 4. Finals ───────────────────────────────────────────────────────────────

test('finals are 200 / 250 / 300 only', () => {
  for (const r of S.rooms) {
    for (const mm of r.finalSizesMm) {
      assert.ok(FINAL_FLEX.autoSizesMm.includes(mm), r.room + ' got ' + mm);
    }
  }
});

test('no auto 150, and nothing over 300', () => {
  const all = S.rooms.flatMap(r => r.finalSizesMm);
  assert.ok(Math.min(...all) >= FINAL_FLEX.minMm);
  assert.ok(Math.max(...all) <= FINAL_FLEX.maxMm);
});

test('two outlets in one room at the same airflow get the same final size', () => {
  // The bug this was written for: LOUNGE had a 250 and a 200 for 74 L/s each,
  // because the main had already stepped past the second one.
  for (const r of S.rooms) {
    assert.equal(r.finalSizesMm.length, 1,
      r.room + ' has ' + r.finalSizesMm.join('/') + ' for ' + r.perOutletLs + ' L/s per outlet');
  }
});

test('more airflow is met with another outlet, never a bigger final', () => {
  for (const r of S.rooms) {
    assert.ok(r.perOutletLs <= 160,
      r.room + ' puts ' + r.perOutletLs + ' L/s through one outlet');
  }
});

test('every conditioned room is on the schedule and none of the excluded ones are', () => {
  const rooms = S.rooms.map(r => r.room).sort();
  assert.deepEqual(rooms, ['BEDROOM 2', 'BEDROOM 3', 'BEDROOM 4', 'FAMILY', 'FOYER',
    'KITCHEN', 'LIVING', 'LOUNGE', 'MASTER BEDROOM', 'MEALS', 'STUDY']);
  for (const excluded of ['BATH', 'ENSUITE', 'WC', "L'DRY", 'GARAGE', 'PORCH',
                          'COVERED ALFRESCO', "P'TRY", "CUP'D"]) {
    assert.ok(!rooms.includes(excluded), excluded + ' is on the duct schedule');
  }
});

// ── 5. Return ───────────────────────────────────────────────────────────────

test('the return is 1 or 2 ducts, each with a size and an airflow', () => {
  assert.ok(S.ret.ductCount >= RETURN_AIR.minReturns);
  assert.ok(S.ret.ductCount <= RETURN_AIR.maxReturns);
  assert.equal(S.ret.ducts.length, S.ret.ductCount);
  for (const r of S.ret.ducts) {
    assert.ok(r.diameterMm > 0);
    assert.ok(r.airflowLs > 0);
  }
});

test('every return duct carries only its own share', () => {
  // The double-count this replaced had 601 L/s going through a duct the design
  // thought was carrying 300.
  const total = S.ret.ducts.reduce((n, d) => n + d.airflowLs, 0);
  assert.ok(Math.abs(total - S.ret.totalAirflowLs) <= 2,
    S.ret.ductCount + ' ducts carrying ' + total + ' of ' + S.ret.totalAirflowLs + ' L/s');
  for (const r of S.ret.ducts) {
    assert.ok(RETURN_DUCT_SIZES_MM.includes(r.diameterMm),
      'return ' + r.index + ' is ' + r.diameterMm);
    assert.equal(r.airflowLs, S.ret.perDuctLs);
  }
});

test('grilles and ducts are counted separately', () => {
  // One grille can feed a box that splits into the unit's two spigots, so these
  // are genuinely two numbers. Both must be stated.
  assert.ok(S.ret.pointCount >= 1);
  assert.ok(S.ret.ductCount >= 1);
  assert.equal(S.ret.points.length, S.ret.pointCount);
  assert.equal(S.ret.ducts.length, S.ret.ductCount);
});

test('a 25 kW system returns through 2 x 450', () => {
  // Nick, on this unit. A 450 on the RETURN is not a contradiction of "never a
  // 450" — that rule is about supply.
  assert.equal(S.ret.ductCount, 2);
  for (const r of S.ret.ducts) assert.equal(r.diameterMm, 450);
});

test('no return duct is over its velocity band', () => {
  // The old design ran 2 x 350 at 6.25 m/s, over the 5 m/s return maximum.
  for (const r of S.ret.ducts) {
    assert.ok(r.velocityMs <= 5, 'return ' + r.index + ' at ' + r.velocityMs + ' m/s');
  }
});

test('450 never appears on the supply side', () => {
  const supply = [
    ...S.plenum.ducts.map(d => d.diameterMm),
    ...S.mainRuns.flatMap(m => m.stretches.map(x => x.diameterMm)),
    ...S.rooms.flatMap(r => r.finalSizesMm)
  ];
  assert.ok(!supply.includes(450), 'a 450 got onto the supply side');
  assert.ok(!supply.includes(500));
  assert.ok(Math.max(...supply) <= 400);
});

test('the returns carry the whole system between them', () => {
  const total = S.ret.ducts.reduce((n, r) => n + r.airflowLs, 0);
  assert.ok(Math.abs(total - S.ret.totalAirflowLs) <= 2,
    total + ' vs ' + S.ret.totalAirflowLs);
});

// ── 6. Reducers ─────────────────────────────────────────────────────────────

test('no reducer sits between a BTO and its outlet', () => {
  const onFinal = S.reducers.filter(r => r.onFinal);
  assert.deepEqual(onFinal, []);
});

test('every reducer is on a main and says why it exists', () => {
  for (const r of S.reducers) {
    assert.ok(r.onRun.startsWith('Main '), r.ref + ' is on ' + r.onRun);
    assert.ok(r.fromMm > r.toMm, r.ref + ': ' + r.fromMm + ' -> ' + r.toMm);
    assert.ok(r.airflowAfterLs < r.airflowBeforeLs,
      r.ref + ' reduces without the airflow dropping');
    assert.ok(/L\/s/.test(r.why) && /m\/s/.test(r.why),
      r.ref + ' does not explain itself: ' + r.why);
    // The reason has to be a real one: the smaller duct must actually be a
    // better fit for the air still in the main than the bigger one was.
    const wasOff = Math.abs(r.velocityIfNotReducedMs - r.bandPreferredMs);
    const isOff = Math.abs(r.velocityAfterMs - r.bandPreferredMs);
    assert.ok(isOff < wasOff,
      r.ref + ' steps to a size no closer to the ' + r.bandPreferredMs +
      ' m/s target: ' + r.velocityIfNotReducedMs + ' -> ' + r.velocityAfterMs + ' m/s');
    // And the reduced main must be inside the band NAC runs mains in — unless
    // it is being HELD UP by the finals still to come off it, which is the
    // install rule beating the velocity band and has to be stated as such.
    assert.ok(r.velocityAfterMs <= r.bandMaxMs,
      r.ref + ' leaves the main at ' + r.velocityAfterMs + ' m/s');
    if (r.velocityAfterMs < r.bandMinMs) {
      assert.equal(r.heldByFinals, true,
        r.ref + ' runs slow at ' + r.velocityAfterMs + ' m/s for no stated reason');
      assert.ok(/cannot go smaller/.test(r.why), r.why);
      // And it has to name WHICH floor is holding it: the finals coming off it,
      // or the smallest main NAC runs.
      assert.ok(r.heldBy === 'finals' || r.heldBy === 'min_main', r.heldBy);
      assert.ok(r.heldBy === 'finals'
        ? /finals still come off it/.test(r.why)
        : /smallest main NAC runs/.test(r.why), r.why);
    }
    // The stated reason must match which of the two cases it actually is.
    assert.equal(r.reason, r.velocityIfNotReducedMs < r.bandMinMs ? 'below_minimum' : 'oversized');
    assert.ok(r.reason === 'below_minimum'
      ? /under the .* minimum/.test(r.why) : /oversized/.test(r.why), r.why);
  }
});

test('a reducer has a real length of duct on both sides of it', () => {
  // A reducer 130 mm off the plenum, or one with 140 mm of duct after it, is a
  // fitting bought for nothing. Both happened once the plenum went to one size.
  for (const m of S.mainRuns) {
    for (const s of m.stretches) {
      assert.ok(s.lengthM >= MAIN_REDUCTIONS.minStretchM,
        m.name + '/' + s.id + ' is only ' + s.lengthM + ' m long');
    }
  }
});

test('a reducer only ever steps a size a main is actually stocked in', () => {
  for (const r of S.reducers) {
    assert.ok(r.fromMm - r.toMm >= MAIN_REDUCTIONS.minStepMm,
      r.ref + ' steps only ' + (r.fromMm - r.toMm) + ' mm');
  }
});

// ── The rule that fixed the LOUNGE ──────────────────────────────────────────

test('a main is never reduced past a final still to come off it', () => {
  // The rule itself — a SIZE ABOVE the largest final, never level with it.
  assert.equal(mainFloorForFinals(200, [250, 250]), 300);
  assert.equal(mainFloorForFinals(300, [250]), 300);
  assert.equal(mainFloorForFinals(200, [], 250), 250);

  // And on the real plan: every stretch is at least as big as every final
  // that still comes off it.
  for (const m of S.mainRuns) {
    for (const s of m.stretches) {
      const belowIt = S.btos.filter(b => b.parentId === s.id);
      for (const b of belowIt) {
        assert.ok(s.diameterMm >= b.branchDiameterMm,
          m.name + '/' + s.id + ' is ' + s.diameterMm + ' with a ' +
          b.branchDiameterMm + ' take-off on it');
      }
    }
  }
});

// ── Physics and presentation ────────────────────────────────────────────────

test('velocity is computed from the airflow and the duct, not asserted', () => {
  // 1000 L/s through a 400 is 1.0 m3/s over 0.1257 m2.
  assert.equal(velocityMs(1000, 400), 7.96);
  assert.equal(velocityMs(0, 400), null);
  assert.equal(velocityMs(100, 0), null);
});

test('the printed schedule states every section the brief asks for', () => {
  const text = nacDuctSchedule(design);
  for (const heading of ['1. SUPPLY PLENUM', '2. MAINS AND MAJOR FLEX DUCTS',
                         '3. BRANCH TAKE-OFFS (BTO)', '4. FINAL OUTLETS',
                         '5. RETURN AIR', '6. REDUCERS', '7. NAC HARD RULE CHECK']) {
    assert.ok(text.includes(heading), 'missing: ' + heading);
  }
  assert.ok(text.includes('SCHEDULE PASSES ALL NAC HARD RULES'));
  // Every take-off and every room is named in it.
  for (const b of S.btos) assert.ok(text.includes(b.room), b.room + ' not printed');
  assert.ok(!/FAIL/.test(text), 'the printed schedule reports a failure');
});

test('the schedule describes the SAME network the BOM and pressure read', () => {
  const sized = design.network.sections;
  assert.equal(S.totals.finals, sized.filter(s => s.role === 'final').length);
  assert.equal(S.totals.mainStretches,
    sized.filter(s => s.role === 'main' || s.role === 'trunk').length);
  assert.equal(S.totals.reducers, design.network.reducerCount);
  assert.equal(S.totals.btos, design.network.btoCount);
});

// ── A warning must describe the design that was actually produced ───────────

test('a room sized from the plan is not reported as excluded from sizing', () => {
  // The bug: eleven rooms were reported "excluded from sizing" on a 22.54 kW
  // load that had sized all eleven of them. The status alone does not decide
  // it — sizableRooms() auto-clears a room read confidently off the plan.
  const sizedIds = new Set(design.roomLoads.filter(l => l.designW > 0).map(l => l.roomId));
  const unverified = design.rooms.filter(r =>
    r.conditioned && r.status !== 'Verified' && r.status !== 'Manual');
  assert.ok(unverified.length > 0, 'fixture no longer exercises this');

  for (const r of unverified) {
    if (!sizedIds.has(r.id)) continue;
    const excluded = (design.warnings || []).filter(w =>
      w.code === 'UNVERIFIED_ROOM' && w.message.includes(r.label));
    assert.deepEqual(excluded, [],
      r.label + ' carries ' + design.roomLoads.find(l => l.roomId === r.id).designW +
      ' W but is reported as excluded from sizing');
  }
});

test('a room sized from the plan is still flagged for checking on site', () => {
  const autoCleared = (design.warnings || []).filter(w => w.code === 'ROOM_AUTO_CLEARED');
  assert.ok(autoCleared.length > 0, 'nothing asks the estimator to check the printed sizes');
  for (const w of autoCleared) {
    assert.equal(w.severity, 'CHECK');
    assert.match(w.message, /printed on the plan/);
  }
});

test('the load the tool reports is the load it calculated', () => {
  const L = design.systemLoad;
  const summed = design.roomLoads.reduce((n, l) => n + l.designW, 0);
  // Raw room loads, then system diversity, then the safety margin — which is a
  // MULTIPLIER (1.05), not a fraction.
  assert.equal(Math.round(L.rawCoolingW), Math.round(summed));
  const expected = L.rawCoolingW * L.systemDiversity * L.safetyMargin;
  assert.ok(Math.abs(L.designCoolingW - expected) < 2,
    L.designCoolingW + ' W reported, ' + Math.round(expected) + ' W from ' +
    Math.round(summed) + ' x ' + L.systemDiversity + ' x ' + L.safetyMargin);
  assert.equal(L.designCoolingKw, Math.round(L.designCoolingW / 10) / 100);
  assert.equal(L.roomCount, design.roomLoads.length);
});

// ── Never present a typed number as something the plan stated ───────────────

test('the sheet claims a size only where the plan actually prints one', () => {
  // The brochure prints a size under every room name EXCEPT these two. If this
  // list ever shrinks, somebody has filled a dimension in and called it plan
  // data — which is how a 22.54 kW load came to include 19.5 m² nothing had
  // measured.
  const noPrintedSize = SHEET.filter(([, , , size]) => size === null).map(([l]) => l);
  for (const label of ['MEALS', 'STUDY']) {
    assert.ok(noPrintedSize.includes(label),
      label + ' has been given a printed size the brochure does not show');
  }
});

test('a room measured on site is recorded as measured, not as read off the plan', () => {
  for (const label of Object.keys(MEASURED_ON_SITE)) {
    const room = design.rooms.find(r => r.label === label);
    assert.ok(room, label + ' is missing');
    assert.ok(room.areaSqM > 0, label + ' has no area');
    assert.notEqual(room.measurement?.source, 'verified_architectural',
      label + ' claims it was read off the plan');
  }
});

test('with no site measurements the design blocks and names both rooms', async () => {
  const blocked = await realPlanDesign({ measured: null });
  const { collectInterruptions } = await import('../designer/engines/interruptions.mjs');
  const i = collectInterruptions(blocked);

  assert.equal(i.canQuote, false, 'a design missing two rooms was quotable');
  assert.match(i.blockReason, /MEALS/);
  assert.match(i.blockReason, /STUDY/);
  // And the load it does report covers only the rooms it actually measured.
  assert.equal(blocked.systemLoad.roomCount, 9);
  assert.ok(!blocked.roomLoads.some(r => /MEALS|STUDY/.test(r.label)),
    'an unmeasured room carried load');
  assert.ok(blocked.systemLoad.totalConditionedAreaSqM < design.systemLoad.totalConditionedAreaSqM,
    'dropping two rooms did not reduce the conditioned area');
});

// ── Parallel ducts are not in series ────────────────────────────────────────

test('the return pressure is one duct’s run, not every duct added together', () => {
  // rd.lengthM is the flex to BUY — two ducts is twice the metres on the order.
  // Charging the pressure calculation for all of it added the second return's
  // run to a path no air takes.
  const rd = design.returnDesign.duct;
  assert.ok(rd.ductCount >= 2, 'fixture no longer has parallel return ducts');
  assert.ok(rd.lengthM > rd.lengthPerDuctM, 'total flex should exceed one run');

  const line = design.pressure.components.find(c => c.item === 'Return duct');
  assert.ok(line, 'no return duct in the pressure breakdown');
  const perDuctPa = Math.round(rd.lengthPerDuctM * 2.2 * 10) / 10;
  assert.equal(line.pa, perDuctPa,
    line.pa + ' Pa charged for ' + rd.lengthM + ' m when the air travels ' +
    rd.lengthPerDuctM + ' m');
  assert.match(line.detail, /one of 2 in parallel/);
});

test('the BOM still buys every metre of return flex', () => {
  // The other half of the same distinction: pressure uses one run, the order
  // uses all of them.
  const rd = design.returnDesign.duct;
  assert.ok(Math.abs(rd.lengthM - rd.lengthPerDuctM * rd.ductCount) < 0.02,
    rd.lengthM + ' m total for ' + rd.ductCount + ' × ' + rd.lengthPerDuctM + ' m');
});

// ── A unit with a real supplier cost is not an unpriced unit ────────────────

test('the selected unit carries its real supplier cost into the quote', () => {
  // hasPrice means NAC has typed a RETAIL price. It is NOT what the quote is
  // built from on the cost-plus-fee basis, and reading it as "no price" is
  // wrong: the MMEM trade list carries a cost for this unit.
  const u = design.selectedUnit;
  assert.ok(u.supplierCost > 0, u.model + ' has no supplier cost');
  assert.ok(u.supplierSource, 'the cost is not attributed to a price list');

  const line = design.bom.items.find(i => i.key === 'indoor_outdoor_system');
  assert.ok(line, 'no equipment line in the BOM');
  assert.equal(line.priced, true, 'the equipment line is reported unpriced');
  assert.equal(line.totalCost, u.supplierCost);
});

test('the equipment is not counted among the unpriced or placeholder lines', () => {
  const equipment = design.bom.items.find(i => i.key === 'indoor_outdoor_system');
  assert.ok(!(design.bom.unpricedLabels || []).includes(equipment.label),
    'the unit is listed as unpriced');
  assert.ok(!(design.bom.placeholderLabels || []).includes(equipment.label),
    'the unit is listed as a placeholder rate');
});

// ── Colour means SIZE, and a damper is a thing somebody fits ────────────────

test('every duct size has its own colour, and a return keeps grey', () => {
  const sizes = [200, 250, 300, 350, 400];
  const seen = sizes.map(mm => sizeColour(mm, 'supply'));
  assert.equal(new Set(seen).size, sizes.length, 'two sizes share a colour: ' + seen.join(', '));
  for (const c of seen) assert.match(c, /^#[0-9a-f]{6}$/i);
  // A return is the other system and is never coloured by its size.
  assert.equal(sizeColour(400, 'return'), sizeColour(200, 'return'));
  assert.notEqual(sizeColour(400, 'return'), sizeColour(400, 'supply'));
  // An off-ladder size still draws rather than vanishing.
  assert.match(sizeColour(175, 'supply'), /^#[0-9a-f]{6}$/i);
});

test('the size key lists only the sizes this design actually uses', () => {
  const routes = {};
  for (const s of design.network.sections) {
    routes[s.id] = { diameterMm: s.diameterMm, role: s.role };
  }
  const key = sizeKey(routes);
  const supply = [...new Set(design.network.sections
    .filter(s => s.role !== 'return').map(s => s.diameterMm))].sort((a, b) => a - b);
  assert.deepEqual(key.map(k => k.diameterMm), supply);
  // Ascending, and no return size smuggled in.
  assert.ok(!key.some(k => k.diameterMm === design.returnDesign.duct.diameterMm &&
                           !supply.includes(k.diameterMm)));
});

test('a zone damper is drawn for every motor bought, and no others', () => {
  // The drawing showed seven dampers on a design whose order carried six
  // motors: the always-open zone had one it never needs.
  const motors = design.bom.items.find(i => i.key === 'zone_motor');
  assert.ok(motors, 'no zone motor line in the BOM');
  assert.equal(design.zoneDampers.length, motors.quantity,
    design.zoneDampers.length + ' dampers drawn, ' + motors.quantity + ' motors bought');
});

test('the always-open zone gets no damper', () => {
  const open = design.zones.zones.filter(z => z.alwaysOpen).map(z => z.name);
  assert.ok(open.length, 'fixture has no always-open zone');
  for (const name of open) {
    assert.ok(!design.zoneDampers.some(d => d.zone === name),
      name + ' is always open and still has a damper');
  }
});

test('every damper sits on a real duct and knows which way it runs', () => {
  const byId = new Map(design.network.sections.map(s => [s.id, s]));
  for (const d of design.zoneDampers) {
    const run = byId.get(d.sectionId);
    assert.ok(run, d.zone + ' damper is on no section');
    assert.ok(Number.isFinite(d.angle), d.zone + ' damper has no duct angle');
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
    // And it sits ON that run — a short way in, where a motor is fitted and
    // reachable — turned the way THAT leg of the duct runs, not floating beside
    // it and not stacked on the collar with the two dampers next to it.
    let onRun = false;
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1], b = run.points[i];
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      if (!len2) continue;
      const t = Math.max(0, Math.min(1, ((d.x - a.x) * vx + (d.y - a.y) * vy) / len2));
      const off = Math.hypot(d.x - (a.x + vx * t), d.y - (a.y + vy * t));
      if (off > 0.001) continue;
      onRun = true;
      const expected = Math.atan2(vy, vx);
      assert.ok(Math.abs(d.angle - expected) < 1e-9,
        d.zone + ' damper is turned the wrong way for the leg it sits on');
      break;
    }
    assert.ok(onRun, d.zone + ' damper is not on its own duct');
  }
});

test('no two zone dampers are drawn on top of one another', () => {
  // Three bedrooms off one major branch put three dampers on the same collar:
  // the drawing showed one, with two hidden underneath it, and an installer
  // counting motors off the sheet would have found one.
  const ds = design.zoneDampers;
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const apart = Math.hypot(ds[i].x - ds[j].x, ds[i].y - ds[j].y);
      assert.ok(apart >= 20,
        ds[i].zone + ' and ' + ds[j].zone + ' dampers are ' +
        Math.round(apart) + ' px apart');
    }
  }
});

test('one damper is drawn for every motor the order buys, and no more', () => {
  const closable = design.zones.zones.filter(z => !z.alwaysOpen).length;
  assert.equal(design.zoneDampers.length, closable);
  const zones = new Set(design.zoneDampers.map(d => d.zone));
  assert.equal(zones.size, design.zoneDampers.length, 'a zone has two dampers');
});
