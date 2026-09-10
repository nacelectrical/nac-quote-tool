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
  // Which lands on the same answer, by NAC's own rule.
  assert.equal(ret.duct.ductCount, 2);
  assert.equal(ret.duct.diameterMm, 400);
});

test('no unit given still designs a return', () => {
  const ret = designReturnAir({ totalAirflowLs: 450, returnCount: 1, ductLengthMm: 3000 });
  assert.equal(ret.duct.fromUnitSpec, false);
  assert.equal(ret.duct.ductCount, 1);
  assert.equal(ret.duct.diameterMm, 400);
});

test('NAC never size a return above 400, they add a second duct', () => {
  const S = DEFAULT_SETTINGS;
  for (const ls of [300, 450, 600, 787, 900, 1200]) {
    const d = selectReturnDuct(ls, S);
    assert.ok(d.diameterMm <= 400, ls + ' L/s picked ' + d.diameterMm + ' mm');
    assert.ok([350, 400].includes(d.diameterMm));
    assert.ok(d.ductCount <= 2);
    assert.equal(d.exceedsStandard, false, ls + ' L/s should be within standard');
  }
});

test('beyond two 400s it asks for another return rather than inventing a duct', () => {
  const d = selectReturnDuct(1600, DEFAULT_SETTINGS);
  assert.equal(d.exceedsStandard, true);
  assert.equal(d.diameterMm, 400);
  assert.equal(d.ductCount, 2);
  const ret = designReturnAir({ totalAirflowLs: 1600, returnCount: 1 });
  assert.ok(ret.warnings.some(w => w.code === 'RETURN_EXCEEDS_NAC_STANDARD'));
});

test('450 and 500 are not on the duct ladder at all', () => {
  const ladder = DEFAULT_SETTINGS.duct.availableDiametersMm;
  assert.ok(!ladder.includes(450));
  assert.ok(!ladder.includes(500));
  assert.equal(Math.max(...ladder), 400);
  assert.equal(DEFAULT_SETTINGS.duct.maxDiameterMm, 400);
});
