// NAC AI HVAC DESIGNER — manufacturer technical data.
//
// The return connection on a ducted fan coil is fixed by the manufacturer: one
// 400 mm spigot, or two at 350/400. That IS the return duct arrangement.
// Calculating a diameter the unit has no connection for is not a design.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { UNIT_SPECS, UNIT_SPEC_META, findUnitSpec, specsForBrand } from '../designer/engines/unit-specs.mjs';
import { designReturnAir, selectReturnDuct } from '../designer/engines/returnair.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { RETURN_DUCT_SIZES_MM } from '../designer/engines/nac-standard.mjs';
import { maxAirflowPerReturnLs, returnCountFor } from '../designer/engines/nac-standard.mjs';

test('the data is attributed to the sheets it came off', () => {
  assert.match(UNIT_SPEC_META.source, /TECH DATA SHEETS/);
  assert.equal(UNIT_SPEC_META.modelCount, UNIT_SPECS.length);
  assert.ok(UNIT_SPECS.length > 400);
});

test('every row carries a brand, a model and a plausible capacity', () => {
  for (const s of UNIT_SPECS) {
    assert.ok(s.brandId, 'missing brand');
    assert.ok(s.model, s.brandId + ' row has no model');
    assert.ok(s.kw >= 2 && s.kw <= 120, s.model + ' has kw ' + s.kw);
  }
});

test('airflow sits in the band a ducted fan coil actually runs at', () => {
  // 30-110 L/s per kW. A row outside that had its columns misaligned and was
  // dropped at build time rather than transcribed wrong.
  for (const s of UNIT_SPECS) {
    if (!s.ratedAirflowLs) continue;
    const perKw = s.ratedAirflowLs / s.kw;
    assert.ok(perKw >= 30 && perKw <= 110,
      s.model + ': ' + s.ratedAirflowLs + ' L/s on ' + s.kw + ' kW = ' + perKw.toFixed(0) + ' L/s per kW');
  }
});

test('static pressure is a real available static, not a stray number', () => {
  for (const s of UNIT_SPECS) {
    if (s.availableStaticPa === null) continue;
    assert.ok(s.availableStaticPa >= 50 && s.availableStaticPa <= 350,
      s.model + ' has ' + s.availableStaticPa + ' Pa');
  }
});

test('a return spigot is a size that exists as flex', () => {
  const ok = new Set([200, 250, 300, 350, 400, 450, 500]);
  for (const s of UNIT_SPECS) {
    if (!s.returnSpigots) continue;
    assert.ok(ok.has(s.returnSpigots.diameterMm), s.model + ': ' + s.returnSpigots.diameterMm + ' mm');
    assert.ok(s.returnSpigots.count >= 1 && s.returnSpigots.count <= 4, s.model);
  }
});

test('the spigot arrangements are the ones NAC install', () => {
  const seen = new Set(UNIT_SPECS.filter(s => s.returnSpigots)
    .map(s => s.returnSpigots.count + 'x' + s.returnSpigots.diameterMm));
  for (const a of seen) assert.ok(['1x400', '2x350', '2x400'].includes(a), 'unexpected: ' + a);
});

test('a model is found through its catalogue name and supplier pair', () => {
  const s = findUnitSpec('daikin', 'FDYA160AV19 / RZAS160C2V1');
  assert.ok(s, 'the indoor half of the pair should match');
  assert.equal(s.model, 'FDYA160AV1');
  assert.equal(s.kw, 16);
  assert.equal(s.phase, '1Ph');
  assert.deepEqual(s.returnSpigots, { count: 2, diameterMm: 400 });
  // A trailing description must not defeat the match.
  assert.equal(findUnitSpec('daikin', 'FDYA160AV19 — Slimline')?.model, 'FDYA160AV1');
});

test('a model the sheets do not carry returns null, never a near miss', () => {
  assert.equal(findUnitSpec('daikin', 'NOT-A-MODEL-XYZ'), null);
  assert.equal(findUnitSpec('daikin', ''), null);
  assert.equal(findUnitSpec('', 'FDYA160AV1'), null);
  // Samsung's DUCTED sheet states minimum capacity, not nominal, so that range
  // was dropped. Its wall splits parsed cleanly and are still here.
  assert.equal(specsForBrand('samsung').every(s => /^AR\d/.test(s.model)), true,
    'no Samsung ducted model should have survived validation');
});

test('a brand lists its models largest first', () => {
  const d = specsForBrand('daikin');
  assert.ok(d.length > 20);
  for (let i = 1; i < d.length; i++) assert.ok(d[i - 1].kw >= d[i].kw);
});

// ── Return air ─────────────────────────────────────────────────────────────

test("the unit's own return connection decides the return duct", () => {
  const ret = designReturnAir({ totalAirflowLs: 787, returnCount: 1, ductLengthMm: 3000,
    unit: { brandId: 'daikin', model: 'FDYA160AV19 / RZAS160C2V1' } });
  assert.equal(ret.duct.fromUnitSpec, true);
  assert.equal(ret.duct.ductCount, 2);
  assert.equal(ret.duct.diameterMm, 400);
  assert.equal(ret.duct.description, '2 × 400 mm');
  assert.match(ret.duct.reason, /FDYA160AV1/);
  assert.equal(ret.duct.unitReturnFlangeText, '2 x 400 Oval');
});

test('two ducts means twice the flex in the length', () => {
  const ret = designReturnAir({ totalAirflowLs: 787, returnCount: 1, ductLengthMm: 3000,
    unit: { brandId: 'daikin', model: 'FDYA160AV19 / RZAS160C2V1' } });
  assert.equal(ret.duct.lengthPerDuctM, 3);
  assert.equal(ret.duct.lengthM, 6);
});

test('a unit with a rectangular flange falls back to NAC standard sizing', () => {
  const ret = designReturnAir({ totalAirflowLs: 787, returnCount: 1, ductLengthMm: 3000,
    unit: { brandId: 'fujitsu', model: 'ARTH60KHTA / AOTH60KBTA' } });
  assert.equal(ret.duct.fromUnitSpec, false);
  // ONE duct back from the return point, sized to carry the lot. 787 L/s in a
  // 450 is 4.95 m/s — inside the 5 m/s maximum, and the only size on the
  // return ladder that manages it.
  assert.equal(ret.duct.ductCount, 1);
  assert.equal(ret.duct.diameterMm, 450);
});

test('no unit given still designs a return', () => {
  const ret = designReturnAir({ totalAirflowLs: 450, returnCount: 1, ductLengthMm: 3000 });
  assert.equal(ret.duct.fromUnitSpec, false);
  assert.equal(ret.duct.ductCount, 1);
  assert.equal(ret.duct.diameterMm, 400);
});

test('the return runs ONE duct per point, on the 350 / 400 / 450 ladder', () => {
  // A 450 IS fitted on the return — on the 25 kW unit the returns are 2 x 450.
  // That is not a contradiction of "NAC never fit a 450": that rule is about
  // SUPPLY. Here the whole system comes back through one or two ducts, and a
  // 400 runs them too fast.
  const S = DEFAULT_SETTINGS;
  const band = S.duct.velocity.return;
  for (const ls of [300, 450, 600, 787]) {
    const d = selectReturnDuct(ls, S);
    assert.ok(RETURN_DUCT_SIZES_MM.includes(d.diameterMm),
      ls + ' L/s picked ' + d.diameterMm + ' mm');
    assert.equal(d.ductCount, 1, ls + ' L/s ran ' + d.ductCount + ' ducts from one point');
    assert.ok(d.velocityMs <= band.max, ls + ' L/s at ' + d.velocityMs + ' m/s');
    assert.equal(d.exceedsStandard, false, ls + ' L/s should be within standard');
  }
});

test('the return picks the smallest duct that stays inside the band', () => {
  const S = DEFAULT_SETTINGS;
  assert.equal(selectReturnDuct(300, S).diameterMm, 350);
  assert.equal(selectReturnDuct(450, S).diameterMm, 400);
  assert.equal(selectReturnDuct(600, S).diameterMm, 450);
});

test('a 25 kW system returns through 2 x 450', () => {
  // 1202 L/s, two return points, 601 L/s each: a 450 at 3.78 m/s.
  const ret = designReturnAir({ totalAirflowLs: 1202, returnCount: 2, ductLengthMm: 4000 });
  assert.equal(ret.returnCount, 2);
  assert.equal(ret.duct.ductCount, 1, 'one duct back from each return point');
  assert.equal(ret.duct.diameterMm, 450);
  assert.ok(ret.duct.velocityMs <= DEFAULT_SETTINGS.duct.velocity.return.max);
  assert.ok(!ret.warnings.some(w => w.code === 'RESTRICTED_RETURN_PATH'));
});

test('beyond what one 450 carries it asks for another return point', () => {
  const d = selectReturnDuct(1600, DEFAULT_SETTINGS);
  assert.equal(d.exceedsStandard, true);
  assert.equal(d.diameterMm, 450);
  assert.equal(d.ductCount, 1);
  assert.match(d.reason, /another return air point/i);
  const ret = designReturnAir({ totalAirflowLs: 1600, returnCount: 1 });
  assert.ok(ret.warnings.some(w => w.code === 'RETURN_EXCEEDS_NAC_STANDARD'));
});

test('450 and 500 are not on the SUPPLY duct ladder at all', () => {
  // The supply side is unchanged: nothing above a 400 is installed.
  const ladder = DEFAULT_SETTINGS.duct.availableDiametersMm;
  assert.ok(!ladder.includes(450));
  assert.ok(!ladder.includes(500));
  assert.equal(Math.max(...ladder), 400);
  assert.equal(DEFAULT_SETTINGS.duct.maxDiameterMm, 400);
});

// ── How many return points, decided by the duct rather than a round number ──

test('one return point carries only what one duct can carry', () => {
  // The biggest duct on the return ladder at the fastest it may run.
  const cap = maxAirflowPerReturnLs(5);
  assert.ok(Math.abs(cap - 795) < 1, cap + ' L/s');
  // It is derived, so it moves with the band rather than disagreeing with it.
  assert.ok(maxAirflowPerReturnLs(4) < cap);
});

test('a second return is fitted as soon as one duct cannot carry the air', () => {
  // The bug: at 800 L/s the design stayed on ONE return, which no return duct
  // NAC fits can carry inside its band. The tool reported 5.03 m/s and told
  // the estimator to add a return, instead of fitting one.
  assert.equal(returnCountFor(790), 1);
  assert.equal(returnCountFor(800), 2);
  assert.equal(returnCountFor(1202), 2);
  // And the estimator's own call still wins.
  assert.equal(returnCountFor(1202, { override: 1 }), 1);
});

test('no return point is ever left over its velocity band', () => {
  for (const total of [300, 500, 790, 800, 1000, 1202, 1400]) {
    const count = returnCountFor(total);
    const d = selectReturnDuct(total / count, DEFAULT_SETTINGS);
    assert.ok(d.velocityMs <= DEFAULT_SETTINGS.duct.velocity.return.max,
      total + ' L/s over ' + count + ' return(s) runs at ' + d.velocityMs + ' m/s');
    assert.equal(d.exceedsStandard, false, total + ' L/s exceeded the standard');
  }
});
