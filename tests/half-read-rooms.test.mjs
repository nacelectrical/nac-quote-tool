// NAC AI HVAC DESIGNER — a room the plan only half gives up.
//
// Two failures that look like nothing and cost real capacity:
//
//   • A room with one dimension became 0 m2 at full confidence. It stayed on
//     the schedule, contributed nothing to the load, and no warning fired. The
//     system comes out a size small and the reason is invisible.
//
//   • Room areas summing to MORE than the floor area printed on the sheet means
//     two rooms are claiming the same floor — an open-plan space measured as
//     separate rectangles, where the Lounge box already contains the Dining and
//     Family labels. Every rectangle is individually plausible, so nothing else
//     in the chain notices.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoom, manualMeasurement, verifyRoom, sizableRooms, blockedRooms,
  incompleteRooms, crossCheckFloorArea, parseFloorAreaText
} from '../designer/engines/rooms.mjs';
import { systemLoad } from '../designer/engines/loads.mjs';
import { collectWarnings } from '../designer/engines/warnings.mjs';

const mk = (label, w, l) => verifyRoom(buildRoom({ label, measurement: manualMeasurement(w, l) }));

// ── One dimension ──────────────────────────────────────────────────────────

test('a room with one dimension has no area, not zero area', () => {
  const m = manualMeasurement(2950, null);
  assert.equal(m.widthMm, 2950);
  assert.equal(m.lengthMm, null);
  assert.equal(m.areaSqM, null, 'zero would be a number the load engine happily adds');
  assert.equal(m.incomplete, true);
  assert.equal(m.missingDimension, 'length');
  assert.match(m.evidence.join(' '), /Length is missing/);
});

test('either dimension missing is reported by name', () => {
  assert.equal(manualMeasurement(null, 3300).missingDimension, 'width');
  assert.equal(manualMeasurement(2950, 0).missingDimension, 'length');
  assert.equal(manualMeasurement(null, null).missingDimension, 'both');
  assert.equal(manualMeasurement(2950, 3300).incomplete, false);
});

test('an incomplete room is never confident, even typed by hand', () => {
  const room = buildRoom({ label: 'Bed 2', measurement: manualMeasurement(2950, null) });
  assert.equal(room.status, 'Needs a dimension');
  assert.equal(room.confidenceBand, 'LOW');
  assert.equal(room.confidence, 0);
});

test('verifying an incomplete room does not make it sizable', () => {
  const rooms = [mk('Bedroom 1', 4400, 3600), verifyRoom(buildRoom({
    label: 'Bed 2', measurement: manualMeasurement(2950, null) }))];
  const sizable = sizableRooms(rooms).map(r => r.label);
  assert.deepEqual(sizable, ['Bedroom 1'], 'a half-measured room cannot be signed off');
  assert.deepEqual(blockedRooms(rooms).map(r => r.label), ['Bed 2']);
});

test('the half-measured room is named, with what is missing', () => {
  const rooms = [mk('Bedroom 1', 4400, 3600),
                 buildRoom({ label: 'Study', measurement: manualMeasurement(2900, null) })];
  assert.deepEqual(incompleteRooms(rooms), [{ id: 'room_study', label: 'Study',
                                              missing: 'length', knownMm: 2900 }]);
});

test('it is a CRITICAL warning, because the system would come out too small', () => {
  const w = collectWarnings({ rooms: [
    mk('Bedroom 1', 4400, 3600),
    buildRoom({ label: 'Bed 2', measurement: manualMeasurement(2950, null) })
  ] });
  const hit = w.find(x => x.code === 'ROOM_MISSING_A_DIMENSION');
  assert.ok(hit, 'a room counting as zero area must be reported');
  assert.equal(hit.severity, 'CRITICAL');
  assert.match(hit.message, /Bed 2/);
  assert.match(hit.message, /length missing/);
});

test('the load engine leaves an incomplete room out rather than adding zero', () => {
  const good = [mk('Bedroom 1', 4400, 3600), mk('Bed 2', 2950, 3300)];
  const half = [mk('Bedroom 1', 4400, 3600),
                verifyRoom(buildRoom({ label: 'Bed 2', measurement: manualMeasurement(2950, null) }))];
  assert.equal(systemLoad(good).roomCount, 2);
  assert.equal(systemLoad(half).roomCount, 1);
  assert.ok(systemLoad(half).totalConditionedAreaSqM < systemLoad(good).totalConditionedAreaSqM);
});

// ── Printed floor area ─────────────────────────────────────────────────────

test('rooms adding to more than the printed area are flagged as double-counted', () => {
  // The open-plan wing measured three times over.
  const rooms = [mk('Bedroom 1', 4400, 3600), mk('Bed 2', 2950, 3300), mk('Bed 3', 2950, 3300),
                 mk('Study', 2900, 3300), mk('Lounge', 6000, 6845), mk('Dining', 2200, 6995),
                 mk('Family', 4550, 4000), mk('Kitchen', 2950, 3000), mk('Entry', 1475, 2620),
                 mk('Ensuite', 1800, 2400), mk('Bath', 2575, 1800), mk('WC', 900, 920),
                 mk('W.I.R.', 1675, 2100)];
  const check = crossCheckFloorArea(rooms, 139.0);
  assert.equal(check.printedSqM, 139);
  assert.ok(check.deltaSqM > 0);
  assert.equal(check.agrees, false);
  const w = check.warnings.find(x => x.code === 'ROOM_AREAS_EXCEED_PRINTED_FLOOR_AREA');
  assert.ok(w);
  assert.equal(w.severity, 'WARNING');
  assert.match(w.message, /same floor/);
});

test('outdoor areas are not counted against the residence figure', () => {
  const indoor = [mk('Living', 6000, 5000)];              // 30 m2
  const withDeck = [...indoor, mk('Covered Deck', 6950, 3200), mk('Porch', 1818, 1650)];
  assert.equal(crossCheckFloorArea(indoor, 32).summedSqM,
               crossCheckFloorArea(withDeck, 32).summedSqM);
});

test('rooms summing a little under the printed area is normal, not a warning', () => {
  // Room areas are internal faces; the schedule measures to the outside of the
  // external walls, so the sum SHOULD come in under.
  const rooms = [mk('Living', 6000, 5000), mk('Bed 1', 4000, 3500)];   // 44 m2
  const check = crossCheckFloorArea(rooms, 48);                        // 8% of walls
  assert.equal(check.agrees, true);
  assert.deepEqual(check.warnings, []);
});

test('rooms far under the printed area means one is missing', () => {
  const check = crossCheckFloorArea([mk('Living', 6000, 5000)], 139.0);
  const w = check.warnings.find(x => x.code === 'ROOMS_MISSING_AGAINST_PRINTED_FLOOR_AREA');
  assert.ok(w);
  assert.equal(w.severity, 'CHECK');
});

test('no printed area on the sheet means no cross-check, not a false alarm', () => {
  assert.equal(crossCheckFloorArea([mk('Living', 6000, 5000)], null), null);
  assert.equal(crossCheckFloorArea([mk('Living', 6000, 5000)], 0), null);
});

test('a printed floor-area row is read without being converted', () => {
  assert.equal(parseFloorAreaText('139.0 m2'), 139);
  assert.equal(parseFloorAreaText('22.5 m²'), 22.5);
  assert.equal(parseFloorAreaText('164,5 m2'), 164.5);
  assert.equal(parseFloorAreaText('TOTAL'), null);
});
