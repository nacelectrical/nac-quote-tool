// A real Australian builder's brochure plan, supplied by NAC.
//
//   tests/fixtures/plan-brochure-ground-floor.jpg
//
// This is the second format NAC actually receives: no dimension chain along the
// edge, just a room name with its size printed under it — "LIVING 4.3 x 7.1m".
// Fifteen rooms are labelled, four of them are ones NAC never conditions, and
// two conditioned rooms (MEALS and STUDY) carry NO size at all.
//
// What is tested here is the part that must be right every time: that the
// printed sizes are read as printed, that garage, laundry, bath, ensuite, WC,
// pantry, porch and alfresco are all kept out of the load, and that the two
// rooms with no printed size are REPORTED rather than guessed at or silently
// dropped.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoomDimensionPair } from '../designer/engines/dimensions.mjs';
import { buildRoom, manualMeasurement, architecturalMeasurement, isConditionedLabel,
         verifyRoom } from '../designer/engines/rooms.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { collectWarnings, summarise } from '../designer/engines/warnings.mjs';
import { selectEquipment } from '../designer/engines/equipment.mjs';

// Every label and printed size on the sheet, transcribed exactly as drawn.
const SHEET = [
  ['LIVING',         '4.3 x 7.1m'],
  ['KITCHEN',        '3.7 x 4.2m'],
  ['MEALS',          null],          // labelled, no size printed
  ['LOUNGE',         '4.0 x 4.9m'],
  ['FAMILY',         '5.8 x 3.9m'],
  ['STUDY',          null],          // labelled, no size printed
  ['FOYER',          '3.0 x 3.9m'],
  ['MASTER BEDROOM', '2.7 x 4.0m'],
  ['BEDROOM 4',      '3.0 x 3.4m'],
  ['BEDROOM 2',      '3.0 x 3.2m'],
  ['BEDROOM 3',      '3.0 x 3.2m'],
  ['ENSUITE',        null],
  ['WC',             null],
  ["L'DRY",          '2.9 x 2.3m'],
  ['BATH',           '2.9 x 1.4m'],
  ['GARAGE',         '6.0 x 6.9m'],
  ['COVERED ALFRESCO', null],
  ['PORCH',          null],
  ["P'TRY",          null],
  ["CUP'D",          null]
];

// ── Reading what is printed ────────────────────────────────────────────────

test('every printed size on the sheet is read exactly as drawn', () => {
  const expect = {
    '4.3 x 7.1m': [4300, 7100], '3.7 x 4.2m': [3700, 4200], '4.0 x 4.9m': [4000, 4900],
    '5.8 x 3.9m': [5800, 3900], '3.0 x 3.9m': [3000, 3900], '2.7 x 4.0m': [2700, 4000],
    '3.0 x 3.4m': [3000, 3400], '3.0 x 3.2m': [3000, 3200], '2.9 x 2.3m': [2900, 2300],
    '2.9 x 1.4m': [2900, 1400], '6.0 x 6.9m': [6000, 6900]
  };
  for (const [printed, [w, l]] of Object.entries(expect)) {
    const got = parseRoomDimensionPair(printed);
    assert.ok(got, printed + ' was not read at all');
    assert.equal(got.widthMm, w, printed + ' width');
    assert.equal(got.lengthMm, l, printed + ' length');
  }
});

test('a room with no size printed reads as nothing, not as a guess', () => {
  for (const [label, printed] of SHEET.filter(r => !r[1])) {
    assert.equal(parseRoomDimensionPair(printed), null, label);
  }
});

// ── NAC's exclusions, on this sheet ────────────────────────────────────────

test("garage, laundry, bath, ensuite, WC, pantry, porch and alfresco are all out", () => {
  const out = ['GARAGE', "L'DRY", 'BATH', 'ENSUITE', 'WC', 'COVERED ALFRESCO', 'PORCH', "P'TRY", "CUP'D"];
  for (const label of out) {
    assert.equal(isConditionedLabel(label), false, label + ' must not be conditioned');
  }
});

test('the rooms NAC does condition are all in', () => {
  const inn = ['LIVING', 'KITCHEN', 'MEALS', 'LOUNGE', 'FAMILY', 'STUDY', 'FOYER',
               'MASTER BEDROOM', 'BEDROOM 2', 'BEDROOM 3', 'BEDROOM 4'];
  for (const label of inn) {
    assert.equal(isConditionedLabel(label), true, label + ' must be conditioned');
  }
});

test('the GARAGE is the biggest room on the sheet and still counts for nothing', () => {
  // 41.4 m² — larger than any conditioned room. Reading it in would add 6 kW.
  const garage = parseRoomDimensionPair('6.0 x 6.9m');
  assert.equal((garage.widthMm * garage.lengthMm) / 1e6, 41.4);
  assert.equal(isConditionedLabel('GARAGE'), false);
});

// ── The rooms, built the way the designer builds them ──────────────────────

function roomsFromSheet() {
  return SHEET.map(([label, printed]) => {
    const d = printed ? parseRoomDimensionPair(printed) : null;
    return buildRoom({
      label,
      measurement: d
        ? architecturalMeasurement(d.widthMm, d.lengthMm, printed)
        : { widthMm: null, lengthMm: null, areaSqM: null, source: 'estimated',
            sourceLabel: 'No size printed',
            evidence: ['The plan labels this room but prints no size.'] }
    }, { settings: DEFAULT_SETTINGS });
  });
}

test('the conditioned area comes to what the printed sizes add up to', () => {
  const rooms = roomsFromSheet();
  const counted = rooms.filter(r => r.conditioned && r.areaSqM);
  const total = counted.reduce((s, r) => s + r.areaSqM, 0);

  // 30.53 + 15.54 + 19.60 + 22.62 + 11.70 + 10.80 + 10.20 + 9.60 + 9.60
  assert.equal(Number(total.toFixed(2)), 140.19);
  assert.equal(counted.length, 9, 'nine conditioned rooms carry a printed size');

  // And the rooms NAC excludes are worth 57.65 m² that never reaches the load.
  const excluded = rooms.filter(r => !r.conditioned && r.areaSqM)
    .reduce((s, r) => s + r.areaSqM, 0);
  // garage 41.40 + laundry 6.67 + bath 4.06 — the only excluded rooms that
  // carry a printed size. Over a quarter of the dimensioned floor area.
  assert.equal(Number(excluded.toFixed(2)), 52.13);
});

test('MEALS and STUDY are flagged, not guessed at and not quietly dropped', () => {
  const rooms = roomsFromSheet();
  const blank = rooms.filter(r => r.conditioned && !r.areaSqM).map(r => r.label);
  assert.deepEqual(blank.sort(), ['MEALS', 'STUDY']);
  for (const label of blank) {
    const r = rooms.find(x => x.label === label);
    assert.equal(r.areaSqM, null, label + ' must have no area, not an invented one');
    assert.ok(r.confidence < 60, label + ' must not look confident: ' + r.confidence);
  }
});

// ── Through the whole pipeline ─────────────────────────────────────────────

function designFromSheet({ verify = true } = {}) {
  let d = createDesign({
    customer: { name: 'Brochure Plan Test', address: 'Ground floor plan' },
    job: { description: 'Ducted AC Supply & Install' }
  });
  d.rooms = roomsFromSheet().map(r =>
    verify && r.areaSqM ? verifyRoom(r, 'estimator') : r);
  return runPipeline(d, { settings: DEFAULT_SETTINGS, catalogue: buildCatalogue({}) });
}

test('the design is blocked until the two blank rooms are dealt with', () => {
  const d = designFromSheet();
  const s = summarise(collectWarnings(d));
  assert.equal(s.canApprove, false,
    'a design missing two conditioned rooms must not approve on its own');
  const codes = collectWarnings(d).map(w => w.code);
  assert.ok(codes.includes('UNVERIFIED_ROOM') || codes.includes('ROOM_MISSING_A_DIMENSION') ||
            codes.includes('LOW_ROOM_MEASUREMENT_CONFIDENCE'),
    'the blank rooms are named in the warnings: ' + [...new Set(codes)].join(', '));
});

test('the load and the system come out where they should for this house', () => {
  const d = designFromSheet();
  assert.equal(d.stage, 'complete');

  // 140.19 m² of conditioned area actually read off the sheet.
  assert.equal(Number(d.systemLoad.totalConditionedAreaSqM.toFixed(2)), 140.19);

  // NAC's own rule: 145 W/m². 140.19 x 145 = 20 325 W, reported to 1 dp.
  assert.equal(d.systemLoad.legacy.kw, 20.3);

  // The detailed engine should land in the same neighbourhood, not somewhere else.
  assert.ok(Math.abs(d.systemLoad.varianceVsLegacyPct) < 25,
    'the two methods disagree by ' + d.systemLoad.varianceVsLegacyPct + '%');

  // A house this size is past a single 18 kW box. Whatever is selected must at
  // least cover the load — the one thing that must never be wrong.
  assert.ok(d.selectedUnit, 'a unit was selected');
  assert.ok(d.selectedUnit.capacityKw >= d.systemLoad.designKw * 0.95,
    'selected ' + d.selectedUnit.capacityKw + ' kW against a ' + d.systemLoad.designKw + ' kW load');
});

test('the ductwork follows NAC\'s sizes — never a 450 or a 500', () => {
  const d = designFromSheet();
  const diameters = [...new Set(d.network.sections.map(s => s.diameterMm))];
  for (const dia of diameters) {
    assert.ok(dia <= 400, 'a ' + dia + ' mm duct was sized; NAC never run above 400');
  }
  assert.ok(d.returnDesign.returns.length >= 1);
  for (const r of d.returnDesign.returns) assert.ok(r.airflowLs > 0);
});

test('nothing downstream invents a number for the rooms with no size', () => {
  const d = designFromSheet();
  const named = (d.airflow.rows || []).map(r => r.label);
  assert.ok(!named.includes('MEALS'), 'MEALS must not be given an airflow it has no area for');
  assert.ok(!named.includes('STUDY'), 'STUDY must not be given an airflow it has no area for');
  // And the outlets follow the same rule.
  const outletRooms = (d.outlets.rows || []).map(r => r.label);
  assert.ok(!outletRooms.includes('MEALS'));
});

test('typing the two missing rooms in by hand completes the design', () => {
  // What the estimator does on site: measure them, type them, carry on.
  let d = createDesign({ customer: { name: 'Brochure Plan Test' } });
  d.rooms = roomsFromSheet().map(r => {
    if (r.label === 'MEALS') return verifyRoom(buildRoom({ label: 'MEALS',
      measurement: manualMeasurement(3500, 3800) }, { settings: DEFAULT_SETTINGS }), 'estimator');
    if (r.label === 'STUDY') return verifyRoom(buildRoom({ label: 'STUDY',
      measurement: manualMeasurement(2600, 2600) }, { settings: DEFAULT_SETTINGS }), 'estimator');
    return r.areaSqM ? verifyRoom(r, 'estimator') : r;
  });
  d = runPipeline(d, { settings: DEFAULT_SETTINGS, catalogue: buildCatalogue({}) });

  // 140.19 + 13.30 + 6.76
  assert.equal(Number(d.systemLoad.totalConditionedAreaSqM.toFixed(2)), 160.25);
  assert.equal(d.systemLoad.legacy.kw, 23.2);
  const s = summarise(collectWarnings(d));
  assert.equal(s.unacknowledgedCritical.filter(w =>
    w.code === 'ROOM_MISSING_A_DIMENSION').length, 0, 'no room is missing a dimension any more');
});

// ── What this plan turned up ───────────────────────────────────────────────

test('a three-phase unit is never quoted without the supply being confirmed', () => {
  // This house comes to 23.45 kW, and the best fit in the catalogue is a
  // three-phase Daikin. On a single-phase house that is a supply upgrade
  // nobody has been quoted for, found on installation day.
  const cat = buildCatalogue({});
  const load = { designKw: 23.45 };

  const unconfirmed = selectEquipment(cat, load, {}).allCandidates[0];
  assert.match(unconfirmed.phase, /3/, 'the best fit here really is three-phase');
  const warn = unconfirmed.warnings.find(w => w.code === 'THREE_PHASE_UNIT_UNCONFIRMED');
  assert.ok(warn, 'it must be raised, not assumed');
  assert.match(warn.message, /three-phase supply/);

  // Told the site is single-phase, it stops being a question and becomes a fault.
  const onSingle = selectEquipment(cat, load, { sitePhase: '1' }).allCandidates[0];
  const crit = onSingle.warnings.find(w => w.code === 'THREE_PHASE_UNIT_ON_SINGLE_PHASE_SITE');
  assert.ok(crit);
  assert.equal(crit.severity, 'CRITICAL');

  // Told the site has three phase, nobody is asked again.
  const onThree = selectEquipment(cat, load, { sitePhase: '3' }).allCandidates[0];
  assert.equal(onThree.warnings.filter(w => /PHASE/.test(w.code)).length, 0);
});

test('a single-phase unit never raises the question at all', () => {
  const cat = buildCatalogue({});
  const single = selectEquipment(cat, { designKw: 10 }, {}).allCandidates
    .find(c => /1\s*ph/i.test(c.phase));
  assert.ok(single, 'there are single-phase units at 10 kW');
  assert.equal(single.warnings.filter(w => /PHASE/.test(w.code)).length, 0);
});

test("a cupboard is not conditioned floor area, however the plan abbreviates it", () => {
  // This sheet writes it CUP'D. Others write CUPB, CPD or CUPBOARD.
  for (const label of ["CUP'D", 'CUPD', 'CUPB', 'CUPBOARD', 'CPD', 'BROOM CUPBOARD', 'CLOAK']) {
    assert.equal(isConditionedLabel(label), false, label);
  }
});

test('this house is past a single unit, and says so', () => {
  const d = designFromSheet();
  const codes = (d.equipmentSelection.systemWarnings || []).map(w => w.code);
  assert.ok(codes.includes('CUSTOM_OR_DUAL_SYSTEM'),
    'a 23 kW load must be flagged as a dual or custom system: ' + codes.join(', '));
});

test('one return cannot carry this house, and the design says so', () => {
  const d = designFromSheet();
  const codes = (d.returnDesign.warnings || []).map(w => w.code);
  assert.ok(codes.includes('RETURN_AIR_UNDERSIZED'),
    'over 700 L/s through one return must be flagged: ' + codes.join(', '));
});
