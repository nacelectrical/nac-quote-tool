// PART 35 — room geometry, confidence, measurement priority, load calculations.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isConditionedLabel, roomTypeFromLabel, manualMeasurement, manualAreaMeasurement,
  architecturalMeasurement, chainMeasurement, calibratedMeasurement, bestMeasurement,
  scoreMeasurement, buildRoom, applyRoomOverride, verifyRoom, sizableRooms,
  blockedRooms, totalConditionedArea, verificationTable
} from '../designer/engines/rooms.mjs';
import { reconstructChain } from '../designer/engines/chains.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { legacySizing, roomLoad, systemLoad, ceilingHeightFactor, overrideRoomLoad } from '../designer/engines/loads.mjs';
import { areaM2 } from '../designer/engines/units.mjs';
import { DEFAULT_SETTINGS, settingsWith, confidenceBand } from '../designer/engines/settings.mjs';

const mk = (label, w, l, extra = {}) =>
  buildRoom({ label, measurement: manualMeasurement(w, l), ...extra });

// ── Areas and room classification ───────────────────────────────────────────

test('area is computed from millimetre dimensions', () => {
  assert.equal(areaM2(3200, 3050).toFixed(4), '9.7600');
  assert.equal(mk('Bed 2', 3200, 3050).areaSqM, 9.76);
});

test("NAC's conditioned / excluded room rules are applied deterministically", () => {
  for (const l of ['Master Bedroom', 'Bed 2', 'Living', 'Kitchen', 'Dining', 'Media', 'Study', 'Hall', 'Family'])
    assert.equal(isConditionedLabel(l), true, l + ' should be conditioned');
  for (const l of ['Garage', 'DOUBLE GARAGE', 'Carport', 'Laundry', "L'DRY", 'Bath', 'Bathroom',
                   'Ensuite', 'WC', 'Toilet', 'WIR', 'Robe', 'Linen', 'Pantry', "P'TRY",
                   'Alfresco', 'Patio', 'Verandah', 'Porch', 'Deck', 'Balcony', 'Void'])
    assert.equal(isConditionedLabel(l), false, l + ' must never be conditioned');
});

test('room type is inferred from the label for the per-type load base', () => {
  assert.equal(roomTypeFromLabel('Master Bedroom'), 'bedroom');
  assert.equal(roomTypeFromLabel('Bed 3'), 'bedroom');
  assert.equal(roomTypeFromLabel('Meals'), 'dining');
  assert.equal(roomTypeFromLabel('Family'), 'living');
  assert.equal(roomTypeFromLabel('Theatre'), 'media');
  assert.equal(roomTypeFromLabel('Entry'), 'hallway');
});

// ── PART 30: measurement priority ───────────────────────────────────────────

test('the strongest measurement source wins, and the rest are kept as alternatives', () => {
  const chosen = bestMeasurement([
    calibratedMeasurement({ calibration: calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 }),
                            widthPx: 320, lengthPx: 305 }),
    architecturalMeasurement(3400, 3050, '3400 × 3050'),
    manualMeasurement(3450, 3100)
  ]);
  assert.equal(chosen.source, 'manual');                        // estimator always wins
  assert.equal(chosen.alternatives.length, 2);
  assert.equal(chosen.alternatives[0].source, 'verified_architectural');
});

test('with no source at all the room is flagged, never invented', () => {
  const m = bestMeasurement([]);
  assert.equal(m.source, 'estimated');
  assert.equal(m.widthMm, null);
  assert.equal(m.needsEstimatorInput, true);
});

test('chain measurement reads room dimensions off the reconstructed stations', () => {
  const h = { ...reconstructChain([110, 3600, 90, 1800]), id: 'h', orientation: 'horizontal',
              confidence: 95, closure: { closes: true } };
  const v = { ...reconstructChain([110, 3400, 90, 2600]), id: 'v', orientation: 'vertical',
              confidence: 95, closure: { closes: true } };
  const m = chainMeasurement({ hChain: h, vChain: v, approxXMm: 110, approxX2Mm: 3710,
                               approxYMm: 110, approxY2Mm: 3510 });
  assert.equal(m.widthMm, 3600);
  assert.equal(m.lengthMm, 3400);
  assert.equal(m.source, 'dimension_chain');
  assert.equal(m.snapped, true);
});

// ── PART 8: confidence ──────────────────────────────────────────────────────

test('confidence follows the source and the configured thresholds', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(scoreMeasurement(manualMeasurement(3200, 3050), { settings: s }).band, 'HIGH');
  assert.equal(scoreMeasurement(architecturalMeasurement(3200, 3050), { settings: s }).band, 'HIGH');
  const calibrated = scoreMeasurement(
    calibratedMeasurement({ calibration: calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 }),
                            widthPx: 320, lengthPx: 305 }), { settings: s });
  assert.equal(calibrated.band, 'MEDIUM');
  assert.equal(scoreMeasurement(bestMeasurement([]), { settings: s }).band, 'LOW');
});

test('confidence thresholds are configurable, not hard-coded', () => {
  const strict = settingsWith({ confidence: { highMin: 97, mediumMin: 90, approvalThreshold: 90 } });
  assert.equal(confidenceBand(95, strict), 'MEDIUM');
  assert.equal(confidenceBand(95, DEFAULT_SETTINGS), 'HIGH');
  const cal = calibratedMeasurement({ calibration: calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 }),
                                      widthPx: 320, lengthPx: 305 });
  assert.equal(scoreMeasurement(cal, { settings: strict }).requiresVerification, true);
});

test('a low-quality image and a short calibration both reduce confidence', () => {
  const shortCal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 100, y: 0 }, knownDistance: 1000 });
  const goodCal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const m = calibratedMeasurement({ calibration: goodCal, widthPx: 320, lengthPx: 305 });
  const clean = scoreMeasurement(m, { calibration: goodCal });
  const blurry = scoreMeasurement(m, { calibration: shortCal, imageQuality: 'low' });
  assert.ok(blurry.score < clean.score - 15, 'blurry screenshot should score materially lower');
  assert.equal(blurry.band, 'LOW');
});

test('every confidence score explains itself', () => {
  const m = calibratedMeasurement({ calibration: calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 }),
                                    widthPx: 320, lengthPx: 305 });
  const s = scoreMeasurement(m, { imageQuality: 'low' });
  assert.ok(s.factors.length >= 2);
  assert.ok(s.factors.every(f => typeof f.reason === 'string' && f.reason.length > 0));
});

test('a wildly elongated room is flagged rather than accepted', () => {
  const s = scoreMeasurement(manualMeasurement(1600, 12000));
  assert.ok(s.factors.some(f => /elongated/i.test(f.reason)));
});

// ── PART 9: verification gate ───────────────────────────────────────────────

test('only verified or manually entered rooms reach the sizing engine', () => {
  const rooms = [
    verifyRoom(mk('Bed 2', 3200, 3050)),
    mk('Bed 3', 3200, 3050),                    // Review — not verified
    mk('Garage', 6000, 6000)                    // Excluded
  ];
  const sized = sizableRooms(rooms);
  assert.deepEqual(sized.map(r => r.label), ['Bed 2', 'Bed 3']); // manual counts as cleared
  assert.equal(blockedRooms(rooms).length, 0);
});

test('a room measured from the plan stays blocked until an estimator verifies it', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const room = buildRoom({ label: 'Bed 2',
    measurement: calibratedMeasurement({ calibration: cal, widthPx: 320, lengthPx: 305 }) });
  assert.equal(room.status, 'Review');
  assert.equal(sizableRooms([room]).length, 0);
  assert.equal(blockedRooms([room]).length, 1);
  assert.equal(sizableRooms([verifyRoom(room, 'nick')]).length, 1);
});

test('editing a dimension records the override and makes it a manual measurement', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const room = buildRoom({ label: 'Bed 2',
    measurement: calibratedMeasurement({ calibration: cal, widthPx: 320, lengthPx: 305 }) });
  const edited = applyRoomOverride(room, { widthMm: 3300 }, 'nick');
  assert.equal(edited.widthMm, 3300);
  assert.equal(edited.measurement.source, 'manual');
  assert.equal(edited.confidence, 100);
  assert.equal(edited.status, 'Manual');
  assert.equal(edited.overrides.length, 1);
  assert.equal(edited.overrides[0].by, 'nick');
});

test('an area can be entered directly for an irregular room', () => {
  const room = buildRoom({ label: 'Living', measurement: manualAreaMeasurement(24.5) });
  assert.equal(room.areaSqM, 24.5);
  assert.equal(room.widthMm, null);
  assert.equal(room.measurement.areaOnly, true);
});

test('the verification table exposes every column the screen needs', () => {
  const rows = verificationTable([verifyRoom(mk('Bed 2', 3200, 3050))]);
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['area', 'ceilingHeight', 'confidence', 'confidenceBand', 'id', 'length', 'room', 'source', 'status', 'width'].sort());
  assert.equal(rows[0].width, 3.2);
  assert.equal(rows[0].status, 'Verified');
});

// ── PART 10/11: loads ───────────────────────────────────────────────────────

test("NAC's existing 145 W/m² rule is preserved exactly", () => {
  const l = legacySizing(119.45);
  assert.equal(l.wattsPerM2, 145);
  assert.equal(l.watts, Math.round(119.45 * 145));
  assert.equal(l.kw, 17.3);
});

test('ceiling height scales the load, damped and capped by settings', () => {
  assert.equal(ceilingHeightFactor(2400), 1);
  assert.ok(ceilingHeightFactor(2700) > 1 && ceilingHeightFactor(2700) < 1.125);  // damped
  assert.ok(ceilingHeightFactor(5000) <= DEFAULT_SETTINGS.load.ceilingHeightFactorMax);
});

test('the detailed engine tracks the NAC rule across a whole project', () => {
  const rooms = [
    ['Master Bedroom', 3600, 3400], ['Bed 2', 3200, 3400], ['Bed 3', 3200, 3400],
    ['Bed 4', 3600, 3600], ['Study', 1800, 3600], ['Media', 3200, 3600],
    ['Kitchen', 3200, 3600], ['Living', 5640, 3600], ['Dining', 3200, 4160], ['Hall', 3600, 2600]
  ].map(([l, w, d]) => verifyRoom(mk(l, w, d)));
  const s = systemLoad(rooms);
  assert.ok(Math.abs(s.varianceVsLegacyPct) < 12,
    'variance vs the 145 rule was ' + s.varianceVsLegacyPct + '%');
  assert.ok(s.averageWattsPerM2 > 130 && s.averageWattsPerM2 < 170);
});

test('west-facing glass and a hot climate raise the load; shading lowers it', () => {
  const base = { label: 'Living', measurement: manualMeasurement(5640, 3600), glazingAreaSqM: 6 };
  const west = roomLoad(buildRoom({ ...base, orientation: 'W', shading: 'none' }));
  const south = roomLoad(buildRoom({ ...base, orientation: 'S', shading: 'none' }));
  const shaded = roomLoad(buildRoom({ ...base, orientation: 'W', shading: 'heavy' }));
  assert.ok(west.coolingW > south.coolingW);
  assert.ok(shaded.coolingW < west.coolingW);

  const tropical = roomLoad(buildRoom(base), { climate: 'qld-tropical' });
  const seq = roomLoad(buildRoom(base), { climate: 'qld-seq' });
  assert.ok(tropical.coolingW > seq.coolingW);
});

test('every room load shows its full working', () => {
  const l = roomLoad(mk('Kitchen', 3200, 3600));
  const b = l.breakdown;
  assert.ok(b.floorAreaSqM > 0 && b.roomVolumeM3 > 0);
  assert.ok(b.factors.length >= 5);
  assert.ok(b.glazing.assumed === true && b.glazing.assumedNote);
  assert.ok(b.occupancy.people >= 1);
  assert.ok(b.appliances.watts > 0, 'a kitchen carries an appliance allowance');
});

test('open-plan rooms get the configured diversity, others do not', () => {
  const open = roomLoad(buildRoom({ label: 'Living', measurement: manualMeasurement(5640, 3600), openPlanGroup: 'g1' }));
  const closed = roomLoad(mk('Living', 5640, 3600));
  assert.ok(open.coolingW < closed.coolingW);
  assert.equal(open.breakdown.openPlanDiversity, DEFAULT_SETTINGS.load.openPlanDiversity);
  assert.equal(closed.breakdown.openPlanDiversity, null);
});

test('a manual load override is applied and recorded, never silent', () => {
  const l = roomLoad(mk('Bed 2', 3200, 3400));
  const o = overrideRoomLoad(l, { coolingW: 1500, note: 'Client keeps this room closed' });
  assert.equal(o.coolingW, 1500);
  assert.equal(o.overridden, true);
  assert.equal(o.originalCoolingW, l.coolingW);
  assert.match(o.overrideNote, /closed/);
});

test('unverified rooms contribute nothing to the system load', () => {
  const rooms = [verifyRoom(mk('Bed 2', 3200, 3400)), mk('Bed 3', 3200, 3400)];
  rooms[1].status = 'Review';
  const s = systemLoad(rooms);
  assert.equal(s.roomCount, 1);
  assert.equal(s.totalConditionedAreaSqM, 10.88);
});

test('system diversity and safety margin come from settings', () => {
  const rooms = [verifyRoom(mk('Living', 5640, 3600))];
  const a = systemLoad(rooms);
  const b = systemLoad(rooms, { settings: settingsWith({ load: { safetyMargin: 1.20 } }) });
  assert.ok(b.designCoolingW > a.designCoolingW);
  assert.equal(a.safetyMargin, DEFAULT_SETTINGS.load.safetyMargin);
});

test('the total conditioned area matches the sum of the cleared rooms', () => {
  const rooms = [verifyRoom(mk('Bed 2', 3200, 3400)), verifyRoom(mk('Bed 3', 3200, 3400)), mk('Garage', 6000, 6000)];
  assert.equal(totalConditionedArea(rooms), 21.76);
});

// ── Dotted room abbreviations (PART 8) ─────────────────────────────────────
//
// Australian plans write these rooms as dotted initials as often as not. A
// walk-in robe that is excluded on one plan and conditioned on the next is a
// sizing error nobody would spot in the room table.

test('dotted room abbreviations are excluded the same as the spelled-out room', () => {
  for (const label of ['W.I.R.', 'WIR', 'W.C.', 'WC', 'B.I.R.', 'Walk-in robe', 'Ens.', 'Ensuite']) {
    assert.equal(isConditionedLabel(label), false, label + ' should be excluded');
  }
});

test('dots do not accidentally exclude a living space', () => {
  for (const label of ['Bed 2', 'Bedroom 1', 'Living', 'Family', 'Dining', 'Kitchen', 'Study', 'Media']) {
    assert.equal(isConditionedLabel(label), true, label + ' should be conditioned');
  }
});

test('room type is read through the dots too', () => {
  assert.equal(roomTypeFromLabel('W.I.R.'), 'other');
  assert.equal(roomTypeFromLabel('Bed 3'), 'bedroom');
  assert.equal(roomTypeFromLabel('Entry'), 'hallway');
});
