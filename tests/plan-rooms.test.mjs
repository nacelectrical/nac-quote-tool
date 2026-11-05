// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE PLAN READER SENDS, AND WHAT THE SCREEN READS
//
// Nick, 5 November 2026, with a screenshot of a plan whose every room is
// labelled "bed 4  3.63 X 3.0m": "Won't size plan." The screen said:
//
//     No room has a measurement good enough to size from.
//     Nothing on that plan could be read as a room.
//
// Two ends of one wire that were never connected to each other.
//
//   /api/plan-read emits   roomLabels[] = { id, text, dimensionText, box }
//   the screen read        roomLabels[] = { label, widthMm, lengthMm }
//
// Not one of those field names matches. `label` was always undefined, so every
// room off a plan was called "Room"; `widthMm` and `lengthMm` were always
// undefined, so no room ever had a size; and the printed "3.63 X 3.0m" that
// the reader copied out verbatim — the single most useful thing on a builder's
// plan — was parsed by nothing, anywhere in the application.
//
// Both sides shipped working, and tested. They were tested against each
// other's imagination. These tests use the shape the endpoint DOCUMENTS, in
// its own system prompt, so the two ends are held to one contract.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsePrintedRoomSize, parseDimensionText }
  from '../designer/engines/dimensions.mjs';
import { roomsFromObservations } from '../designer/ui/plan-step.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// ── THE CONTRACT, TAKEN FROM THE ENDPOINT ITSELF ───────────────────────────

test('the screen reads the field names the endpoint actually emits', () => {
  // Not a copy of them — the endpoint's own source, so this fails if either
  // side is renamed without the other.
  const api = readFileSync(ROOT + '/api/plan-read.js', 'utf8');
  const shape = api.match(/"roomLabels":\[\{.*/);
  assert.ok(shape, 'the endpoint no longer documents its roomLabels shape');
  const line = shape[0];
  // What it DOES send.
  for (const field of ['"text"', '"dimensionText"']) {
    assert.ok(line.includes(field), 'the endpoint no longer sends ' + field);
  }
  // And what it has never sent — the three the screen used to read.
  for (const field of ['"label"', '"widthMm"', '"lengthMm"']) {
    assert.ok(!line.includes(field),
      'the endpoint now sends ' + field + '; the screen should prefer it');
  }

  const ui = readFileSync(ROOT + '/designer/ui/plan-step.mjs', 'utf8');
  const fn = ui.slice(ui.indexOf('export function roomsFromObservations'),
                      ui.indexOf('export function roomsFromObservations') + 2600);
  for (const field of ['r.text', 'r.dimensionText']) {
    assert.ok(fn.includes(field),
      'roomsFromObservations never reads ' + field + ', which is where the name '
      + 'and the printed size actually arrive');
  }
});

test('a room exactly as /api/plan-read reports it arrives named and sized', () => {
  // The endpoint's own documented example, verbatim from its system prompt,
  // plus the two rooms off Nick's plan.
  const rooms = roomsFromObservations({
    roomLabels: [
      { id: 'r1', text: 'BED 2', dimensionText: '3.0 x 3.4m', box: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 'r2', text: 'bed 4', dimensionText: '3.63 X 3.0m', box: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 'r3', text: 'garage', dimensionText: '7.61 X 5.71m', box: { x: 0, y: 0, w: 1, h: 1 } }
    ]
  });
  assert.equal(rooms.length, 3);
  assert.deepEqual(rooms.map(r => r.label), ['BED 2', 'bed 4', 'garage'],
    'the rooms came back called "Room"');

  const bed4 = rooms[1];
  assert.ok(bed4.measurement, 'bed 4 arrived with no measurement');
  assert.equal(bed4.measurement.widthMm, 3630);
  assert.equal(bed4.measurement.lengthMm, 3000);
  assert.equal(bed4.measurement.areaSqM, 10.89);
  // The source stays what it is: a dimension PRINTED on the drawing, not a
  // scaled one. Nick: "Use printed dimensions or an installer-confirmed scale."
  assert.equal(bed4.measurement.source, 'verified_architectural');
  // And the text it came from is kept, so somebody can check it against the
  // sheet without opening the plan again.
  assert.equal(bed4.measurement.printedText, '3.63 X 3.0m');

  assert.equal(rooms[2].measurement.areaSqM, 43.45);
});

test('a room the reader named but could not size keeps its name and no size', () => {
  const rooms = roomsFromObservations({
    roomLabels: [{ id: 'r1', text: 'Study', box: { x: 0, y: 0, w: 1, h: 1 } }]
  });
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].label, 'Study');
  assert.equal(rooms[0].measurement, null,
    'a room with nothing printed against it was given a size');
});

test('figures already in millimetres beat the printed text', () => {
  // A stored draft carries what the estimator corrected by hand. That wins
  // over re-reading the string the plan happened to print.
  const rooms = roomsFromObservations({
    roomLabels: [{ id: 'r1', text: 'Bed 4', dimensionText: '3.63 X 3.0m',
                   widthMm: 3600, lengthMm: 2900, box: null }]
  });
  assert.equal(rooms[0].measurement.widthMm, 3600);
  assert.equal(rooms[0].measurement.lengthMm, 2900);
});

test('the old field name still works, for quotes saved before today', () => {
  const rooms = roomsFromObservations({
    roomLabels: [{ label: 'Lounge', widthMm: 4000, lengthMm: 5000 }]
  });
  assert.equal(rooms[0].label, 'Lounge');
  assert.equal(rooms[0].measurement.areaSqM, 20);
});

test('no room labels at all is no rooms, not a room called Room', () => {
  assert.deepEqual(roomsFromObservations({}), []);
  assert.deepEqual(roomsFromObservations(null), []);
  assert.deepEqual(roomsFromObservations({ roomLabels: [] }), []);
});

// ── THE PARSER, AND WHAT IT REFUSES ────────────────────────────────────────

test('the printed sizes Australian plans actually use', () => {
  const cases = [
    ['3.63 X 3.0m', 3630, 3000],      // Nick's plan
    ['7.61 X 5.71m', 7610, 5710],     // Nick's plan
    ['3.0 x 3.4m', 3000, 3400],       // the endpoint's own example
    ['4.3 x 7.1m', 4300, 7100],
    ['3700 x 4200', 3700, 4200],      // bare millimetres
    ['5000x4000', 5000, 4000],        // no spaces
    ['3.6 × 3.0m', 3600, 3000],  // the multiplication sign
    ['3.6 by 3.0m', 3600, 3000]
  ];
  for (const [text, w, l] of cases) {
    const got = parsePrintedRoomSize(text);
    assert.ok(got, text + ' was not read at all');
    assert.equal(got.widthMm, w, text + ' width');
    assert.equal(got.lengthMm, l, text + ' length');
    assert.equal(got.printed, text, 'the printed text was not kept verbatim');
  }
});

test('IT RETURNS NOTHING RATHER THAN A NUMBER IT IS NOT SURE OF', () => {
  // This is the rule the whole application is built on, and it matters most
  // here: a room nobody has measured is a visible gap on the screen. A room
  // measured wrong is a wrong price that nobody can see.
  for (const text of [
    '12 x 14',          // integers too small to be millimetres, too bare to be metres
    '3.63',             // one number, not a pair
    'BED 3',            // a name
    'SCALE 1:100 @ A3', // a scale note
    '0.2 x 0.3m',       // smaller than any room
    '50 x 60m',         // larger than any room
    '3.6 x 3.0 x 2.4m', // three numbers — a volume, or a mistake
    '', '   ', null, undefined
  ]) {
    assert.equal(parsePrintedRoomSize(text), null,
      JSON.stringify(text) + ' was read as a room size');
  }
});

test('it does not re-interpret what parseDimensionText already settled', () => {
  // The Australian conventions live in one place. "3.4" is metres because it
  // is a small decimal; "3400" is millimetres because it is a bare integer.
  // The pair parser must not acquire a second opinion about either.
  assert.equal(parseDimensionText('3.4').mm, 3400);
  assert.equal(parseDimensionText('3400').mm, 3400);
  const pair = parsePrintedRoomSize('3.4 x 3400');
  assert.equal(pair.widthMm, 3400);
  assert.equal(pair.lengthMm, 3400);
});
