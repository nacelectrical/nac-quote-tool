// ─────────────────────────────────────────────────────────────────────────────
// PRELIMINARY SIZING
//
// Nick, 4 November 2026: "NAC's previous 145 W/m² and 50 L/s per kW rules may
// be available as clearly labelled, configurable estimating methods... Do not
// present these rules as a detailed engineering calculation or manufacturer
// performance data." And: "Allow recorded installer overrides while retaining
// the original calculation and reason."
//
// So these tests are mostly about HONESTY rather than arithmetic: that a rule
// of thumb says it is one, that a figure nobody could calculate is absent
// rather than guessed, and that an override never erases what it overrode.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { preliminarySizing, sizingReadiness, ruleAirflowLs, methodLabel,
         ESTIMATING_RULES } from '../designer/engines/plan-sizing.mjs';
import { DEFAULT_SETTINGS, mergeSettings } from '../designer/engines/settings.mjs';
import { buildRoom, architecturalMeasurement } from '../designer/engines/rooms.mjs';

/** A room measured off a dimension printed on the plan — the best source there is. */
function printed(label, widthMm, lengthMm, over = {}) {
  return buildRoom({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label,
    measurement: architecturalMeasurement(widthMm, lengthMm, widthMm + ' x ' + lengthMm),
    ...over
  });
}

const HOUSE = [
  printed('Living', 5200, 4600),
  printed('Kitchen', 3400, 3000),
  printed('Master', 4200, 3800),
  printed('Bedroom 2', 3200, 3000),
  printed('Bedroom 3', 3200, 3000),
  printed('Bathroom', 2400, 2000),
  printed('Laundry', 2000, 1800),
  printed('Garage', 6000, 6000)
];

// ── THE RULE SAYS IT IS A RULE ─────────────────────────────────────────────

test('a figure from the area rule is labelled as an estimate, not a calculation', () => {
  const s = preliminarySizing(HOUSE, { method: ESTIMATING_RULES.AREA_RULE });
  assert.equal(s.isEstimate, true);
  assert.equal(s.estimates.areaRule.isEstimate, true);
  assert.match(s.methodLabel, /estimating rule/i);
  assert.match(s.methodLabel, /145 W\/m²/);
  // Never dressed up as something it is not.
  assert.ok(!/heat load|manufacturer|performance data/i.test(s.methodLabel));
});

test('the 145 W/m² rule is a setting, not a number in the code', () => {
  const settings = mergeSettings(DEFAULT_SETTINGS, { load: { baseWattsPerM2: 160 } });
  const s = preliminarySizing(HOUSE, { method: ESTIMATING_RULES.AREA_RULE, settings });
  assert.equal(s.estimates.areaRule.wattsPerM2, 160);
  assert.match(s.methodLabel, /160 W\/m²/);
  const base = preliminarySizing(HOUSE, { method: ESTIMATING_RULES.AREA_RULE });
  assert.ok(s.estimates.areaRule.kw > base.estimates.areaRule.kw);
});

test('the 50 L/s per kW rule is a setting too, and says what it is not', () => {
  const a = ruleAirflowLs(16);
  assert.equal(a.perKw, 50);
  assert.equal(a.litresPerSecond, 800);
  assert.equal(a.isEstimate, true);
  assert.match(a.label, /estimating rule/i);
  assert.match(a.note, /not a duct calculation/i);

  const settings = mergeSettings(DEFAULT_SETTINGS, { load: { litresPerSecondPerKw: 45 } });
  assert.equal(ruleAirflowLs(16, settings).litresPerSecond, 720);
});

test('no airflow figure is produced for a capacity nobody has', () => {
  assert.equal(ruleAirflowLs(null), null);
  assert.equal(ruleAirflowLs(0), null);
  assert.equal(ruleAirflowLs('not a number'), null);
});

// ── BOTH ESTIMATES ARE SHOWN, ALWAYS ───────────────────────────────────────

test('the rule and the room-by-room estimate are both produced, and compared', () => {
  const s = preliminarySizing(HOUSE, {});
  assert.ok(s.estimates.areaRule.kw > 0);
  assert.ok(s.estimates.perRoom.kw > 0);
  assert.equal(typeof s.varianceVsRulePct, 'number');
  // Showing one and hiding the other is how a number stops being questioned.
  assert.ok(s.estimates.areaRule.label !== s.estimates.perRoom.label);
});

// ── BATHROOMS, LAUNDRIES AND GARAGES ARE NOT CONDITIONED ───────────────────

test('the rooms NAC does not condition are excluded and named', () => {
  // Nick's standing rule: "dont count bathrooms, ensuites, laundry or garage".
  const s = preliminarySizing(HOUSE, {});
  const sized = s.rooms.map(r => r.label);
  for (const out of ['Bathroom', 'Laundry', 'Garage']) {
    assert.ok(!sized.includes(out), out + ' was sized');
    assert.ok(s.excluded.some(e => e.label === out), out + ' is not listed as excluded');
  }
  for (const inn of ['Living', 'Kitchen', 'Master', 'Bedroom 2', 'Bedroom 3']) {
    assert.ok(sized.includes(inn), inn + ' was not sized');
  }
  assert.equal(s.roomCount, 5);
});

test('the conditioned area is the sum of the rooms actually being sized', () => {
  const s = preliminarySizing(HOUSE, {});
  const summed = s.rooms.reduce((t, r) => t + r.areaSqM, 0);
  assert.equal(Math.round(s.totalConditionedAreaSqM * 100) / 100,
               Math.round(summed * 100) / 100);
});

// ── A ROOM NOBODY HAS MEASURED IS NAMED, NOT GUESSED ───────────────────────

test('a conditioned room with no measurement is reported, not invented', () => {
  const rooms = [...HOUSE, buildRoom({ id: 'study', label: 'Study' })];
  const s = preliminarySizing(rooms, {});
  const flagged = s.unmeasured.find(r => r.label === 'Study');
  assert.ok(flagged, 'an unmeasured room vanished instead of being flagged');
  assert.match(flagged.reason, /no dimension|not good enough/i);
  // And it contributes nothing to the figure.
  assert.ok(!s.rooms.some(r => r.label === 'Study'));

  const ready = sizingReadiness(s);
  assert.ok(ready.notes.some(x => x.code === 'ROOM_NOT_MEASURED'));
});

test('a job with nothing measured cannot be sized, and says so', () => {
  const s = preliminarySizing([buildRoom({ id: 'a', label: 'Living' })], {});
  const ready = sizingReadiness(s);
  assert.equal(ready.ok, false);
  assert.ok(ready.notes.some(x => x.code === 'NO_ROOMS_SIZED'));
  assert.match(ready.notes[0].message, /enter the room dimensions|confirm the plan/i);
});

// ── AN OVERRIDE KEEPS WHAT IT OVERRODE ─────────────────────────────────────

test('an installer override is recorded with its reason and what it replaced', () => {
  const plain = preliminarySizing(HOUSE, {});
  const s = preliminarySizing(HOUSE, {
    override: { designKw: 20, reason: 'West-facing glass across the whole living area',
                by: 'nick@nacelectrical.com.au', at: '2026-11-04T00:00:00Z' }
  });
  assert.equal(s.recommendedKw, 20);
  assert.equal(s.override.reason, 'West-facing glass across the whole living area');
  assert.equal(s.override.by, 'nick@nacelectrical.com.au');
  // The calculation is not erased — it is kept beside the override.
  assert.equal(s.calculatedKw, plain.calculatedKw);
  assert.equal(s.override.replaced.designKw, plain.calculatedKw);
  assert.ok(s.override.replaced.methodLabel);
});

test('no override, no override record', () => {
  const s = preliminarySizing(HOUSE, {});
  assert.equal(s.override, null);
  assert.equal(s.recommendedKw, s.calculatedKw);
});

test('an override of nothing is not an override', () => {
  for (const bad of [null, 0, '', 'twenty']) {
    const s = preliminarySizing(HOUSE, { override: { designKw: bad, reason: 'x' } });
    assert.equal(s.override, null, JSON.stringify(bad) + ' was taken as an override');
  }
});

// ── THE SAME FLOOR IS NOT COUNTED TWICE ────────────────────────────────────

test('rooms adding to more than the printed floor area are caught', () => {
  // The open-plan trap: living, dining and family measured as separate
  // rectangles over the same floor.
  const s = preliminarySizing(HOUSE, { printedFloorAreaSqM: 60 });
  assert.ok(s.floorAreaCrossCheck);
  assert.equal(s.floorAreaCrossCheck.agrees, false);
  const ready = sizingReadiness(s);
  assert.ok(ready.notes.some(x => x.code === 'ROOM_AREAS_EXCEED_PRINTED_FLOOR_AREA'),
    JSON.stringify(ready.notes.map(x => x.code)));
});

test('no printed floor area, no cross-check invented', () => {
  assert.equal(preliminarySizing(HOUSE, {}).floorAreaCrossCheck, null);
});

// ── THE ASSUMPTIONS ARE ON THE PAGE ────────────────────────────────────────

test('the ceiling height and the other assumptions come out with the figure', () => {
  const s = preliminarySizing(HOUSE, {});
  const keys = s.assumptions.map(a => a.key);
  assert.ok(keys.includes('ceiling_height'));
  assert.ok(keys.includes('base_w_m2'));
  for (const a of s.assumptions) {
    assert.ok(a.label && a.value, JSON.stringify(a));
    assert.ok(a.source, 'an assumption with no source: ' + a.label);
  }
});

test('every sized room says where its measurement came from', () => {
  const s = preliminarySizing(HOUSE, {});
  for (const r of s.rooms) {
    assert.ok(r.source, r.label + ' has no measurement source');
    assert.equal(r.source, 'verified_architectural');
    assert.ok(r.areaSqM > 0);
  }
});
