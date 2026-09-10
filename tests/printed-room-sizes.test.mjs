// NAC AI HVAC DESIGNER — room sizes printed inside the room.
//
// Two kinds of plan turn up, and until now the tool only understood one.
//
// A working drawing carries chained dimension strings around the perimeter,
// which is what chains.mjs reconstructs. A builder's brochure or display-home
// plan carries none of that — it prints the size against each room name,
// "LIVING 4.3 x 7.1m". That is most of what an estimator is actually sent, and
// it is also the BEST source there is: the architect's own figure for that
// room, needing no chain, no calibration and no geometry. It is why
// verified_architectural scores highest of all the sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoomDimensionPair, looksLikeDimensionPair } from '../designer/engines/dimensions.mjs';
import { measureRooms } from '../designer/engines/interpret.mjs';
import { systemLoad } from '../designer/engines/loads.mjs';
import { verifyRoom } from '../designer/engines/rooms.mjs';

// ── Parsing ────────────────────────────────────────────────────────────────

test('the pair a builder prints against a room is read as-is', () => {
  assert.deepEqual(parseRoomDimensionPair('4.3 x 7.1m'),
    { widthMm: 4300, lengthMm: 7100, printed: '4.3 x 7.1m', unit: 'm' });
  assert.deepEqual(parseRoomDimensionPair('2.9 x 1.4m'),
    { widthMm: 2900, lengthMm: 1400, printed: '2.9 x 1.4m', unit: 'm' });
});

test('a unit on either half governs the pair', () => {
  assert.equal(parseRoomDimensionPair('4.3m x 7.1m').widthMm, 4300);
  assert.equal(parseRoomDimensionPair('4.3 x 7.1m').widthMm, 4300);
  assert.equal(parseRoomDimensionPair('3700 x 4200').widthMm, 3700);
  assert.equal(parseRoomDimensionPair('3700 x 4200').unit, 'mm');
});

test('the separators and decorations builders actually use', () => {
  for (const t of ['4.3 x 7.1m', '4.3 × 7.1m', '4.3 X 7.1m', '(4.3 x 7.1m)', '4,3 x 7,1 m', ' 4.3x7.1m ']) {
    assert.equal(parseRoomDimensionPair(t)?.widthMm, 4300, t + ' should parse');
  }
});

test('anything that is not a room pair is refused', () => {
  for (const t of ['LIVING', '3400', '1:100', '', null, undefined, '0.3 x 0.3m',
                   '4.3', 'x 7.1m', '40 x 60', 'SCALE 1:100 @ A3', '2 x 400 Oval']) {
    assert.equal(parseRoomDimensionPair(t), null, JSON.stringify(t) + ' must not parse');
  }
  assert.equal(looksLikeDimensionPair('4.3 x 7.1m'), true);
  assert.equal(looksLikeDimensionPair('LIVING'), false);
});

test('a pair too small or too large for a room is refused', () => {
  assert.equal(parseRoomDimensionPair('0.3 x 0.3m'), null);   // a tile
  assert.equal(parseRoomDimensionPair('40 x 60m'), null);     // a paddock
  assert.ok(parseRoomDimensionPair('0.9 x 1.2m'));            // a small WC is real
});

// ── Measurement ────────────────────────────────────────────────────────────

const def = (label, printed) => {
  const p = parseRoomDimensionPair(printed);
  return { label, printedWidthMm: p.widthMm, printedLengthMm: p.lengthMm, printedText: p.printed };
};

test('a printed size measures the room with no chain and no calibration', () => {
  const [room] = measureRooms([def('LIVING', '4.3 x 7.1m')], {});
  assert.equal(room.measurement.source, 'verified_architectural');
  assert.equal(room.measurement.widthMm, 4300);
  assert.equal(room.measurement.lengthMm, 7100);
  assert.equal(room.areaSqM, 30.53);
  assert.equal(room.confidenceBand, 'HIGH');
  assert.match(room.measurement.evidence.join(' '), /4\.3 x 7\.1m/);
});

test('it outranks a calibrated boundary drawn on the image', () => {
  const cal = { pixelsPerMm: 0.1, mmPerPixel: 10 };
  const d = { ...def('LOUNGE', '4.0 x 4.9m'), boundaryPx: { x: 0, y: 0, w: 500, h: 500 } };
  const [room] = measureRooms([d], { calibration: cal });
  assert.equal(room.measurement.source, 'verified_architectural');
  assert.equal(room.measurement.widthMm, 4000);
  // The pixel measurement is kept as the cross-check, not thrown away.
  assert.ok(room.measurement.alternatives?.some(a => a.source === 'calibrated_geometry'));
});

test('a room the plan gives no size for is not invented', () => {
  const [room] = measureRooms([{ label: 'STUDY' }], {});
  assert.equal(room.areaSqM, null, 'no area, not a zero that the load engine would add');
  assert.equal(room.measurement.incomplete, true);
  assert.equal(room.status, 'Needs a dimension');
  assert.notEqual(room.confidenceBand, 'HIGH');
});

test('a whole brochure plan reads without a single dimension chain', () => {
  // Every room this plan prints a size for.
  const printed = [
    ['LIVING', '4.3 x 7.1m'], ['KITCHEN', '3.7 x 4.2m'], ['LOUNGE', '4.0 x 4.9m'],
    ['MASTER BEDROOM', '2.7 x 4.0m'], ['FAMILY', '5.8 x 3.9m'], ['FOYER', '3.0 x 3.9m'],
    ['BEDROOM 4', '3.0 x 3.4m'], ["L'DRY", '2.9 x 2.3m'], ['BATH', '2.9 x 1.4m'],
    ['BEDROOM 2', '3.0 x 3.2m'], ['BEDROOM 3', '3.0 x 3.2m'], ['GARAGE', '6.0 x 6.9m']
  ];
  const rooms = measureRooms(printed.map(([l, p]) => def(l, p)), {});
  assert.equal(rooms.length, 12);
  for (const r of rooms) {
    assert.equal(r.measurement.source, 'verified_architectural', r.label);
    assert.ok(r.areaSqM > 0, r.label);
  }

  // The wet areas and the garage stay out of the load; the living spaces do not.
  const excluded = rooms.filter(r => !r.conditioned).map(r => r.label);
  assert.deepEqual(excluded.sort(), ["BATH", "GARAGE", "L'DRY"]);

  const load = systemLoad(rooms.map(verifyRoom));
  assert.equal(load.roomCount, 9);
  // Nine conditioned rooms, all measured off the sheet.
  assert.ok(load.totalConditionedAreaSqM > 139 && load.totalConditionedAreaSqM < 141,
    'got ' + load.totalConditionedAreaSqM);
  assert.ok(load.designKw > 0);
});
