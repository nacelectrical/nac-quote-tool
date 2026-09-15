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
import { buildRoom, architecturalMeasurement, deriveBoundariesFromPrintedSizes }
  from '../designer/engines/rooms.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { nacScheduleData, checkNacSchedule, nacDuctSchedule, velocityMs }
  from '../designer/engines/nac-schedule.mjs';
import { FINAL_FLEX, SUPPLY_PLENUM, RETURN_AIR, MAIN_REDUCTIONS, mainFloorForFinals }
  from '../designer/engines/nac-standard.mjs';

// The real sheet: every label at the pixel it is printed, with the size text
// printed under it. Transcribed off the plan, not invented.
const SHEET = [
  ['LIVING', 297, 155, '4.3 x 7.1m'], ['KITCHEN', 203, 382, '3.7 x 4.2m'],
  ['MEALS', 398, 436, '3.6 x 3.4m'], ['LOUNGE', 578, 334, '4.0 x 4.9m'],
  ['FAMILY', 238, 633, '5.8 x 3.9m'], ['STUDY', 378, 600, '2.8 x 2.6m'],
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

async function realPlanDesign() {
  const rooms = SHEET.map(([label, x, y, printed]) => {
    const dd = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({
      label,
      measurement: architecturalMeasurement(dd?.widthMm ?? null, dd?.lengthMm ?? null,
        printed ? ['printed'] : []),
      labelPx: { x: x - label.length * 4, y: y - 9, w: label.length * 8, h: 18 }
    });
  });
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
  const failed = V.checks.filter(c => !c.ok).map(c => c.rule + ' — ' + c.detail);
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
  assert.equal(S.totals.btos, S.totals.finals);
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
    // And the reduced main must still be inside the band NAC runs mains in.
    assert.ok(r.velocityAfterMs >= r.bandMinMs && r.velocityAfterMs <= r.bandMaxMs,
      r.ref + ' leaves the main at ' + r.velocityAfterMs + ' m/s');
    // The stated reason must match which of the two cases it actually is.
    assert.equal(r.reason, r.velocityIfNotReducedMs < r.bandMinMs ? 'below_minimum' : 'oversized');
    assert.ok(r.reason === 'below_minimum'
      ? /under the .* minimum/.test(r.why) : /oversized/.test(r.why), r.why);
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
  // The rule itself.
  assert.equal(mainFloorForFinals(200, [250, 250]), 250);
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
