// WHICH ROOMS SHARE A ZONE.
//
// The bug: `suggestZones` keys on `room.openPlanGroup || room.id`, and nothing
// on a real uploaded plan ever set `openPlanGroup`. Every conditioned room
// became its own zone — eleven of them on a four-bedroom house, which bought a
// controller kit it did not need, eleven zone motors instead of five, and
// failed the minimum-open-airflow rule outright.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestOpenPlanGroups, applyOpenPlanGroups, zoningAlreadySet,
         roomsTouch, opennessBetween, zoneRemedies,
         OPEN_PLAN_TYPES } from '../designer/engines/zoning-groups.mjs';
import { buildRoom, manualMeasurement } from '../designer/engines/rooms.mjs';
import { suggestZones } from '../designer/engines/zones.mjs';
import { CONDITIONING } from '../designer/engines/classify.mjs';

const PPM = 0.05667;
const CAL = { pixelsPerMm: PPM, mmPerPixel: 1 / PPM };

/** A room at a place on the plan, sized in metres. */
const at = (label, x, y, wM, lM) => buildRoom({
  label,
  measurement: manualMeasurement(wM * 1000, lM * 1000),
  boundaryPx: { x, y, w: wM * 1000 * PPM, h: lM * 1000 * PPM }
});

// ── Adjacency ───────────────────────────────────────────────────────────────

test('rooms sharing an edge are touching', () => {
  const a = at('KITCHEN', 0, 0, 4, 4);
  const b = at('MEALS', 4 * 1000 * PPM, 0, 4, 4);
  assert.equal(roomsTouch(a, b, CAL).touching, true);
});

test('rooms a room apart are not touching', () => {
  const a = at('KITCHEN', 0, 0, 4, 4);
  const b = at('BEDROOM 2', 12 * 1000 * PPM, 0, 4, 4);
  const t = roomsTouch(a, b, CAL);
  assert.equal(t.touching, false);
  assert.ok(t.gapMm > 400);
});

test('a wall thickness apart still counts as touching', () => {
  const a = at('KITCHEN', 0, 0, 4, 4);
  // 200 mm of wall between them — inside the 400 mm tolerance.
  const b = at('MEALS', (4000 + 200) * PPM, 0, 4, 4);
  assert.equal(roomsTouch(a, b, CAL).touching, true);
});

test('a room with no boundary is never touching anything', () => {
  const a = at('KITCHEN', 0, 0, 4, 4);
  const b = buildRoom({ label: 'MEALS', measurement: manualMeasurement(3000, 3000) });
  assert.equal(roomsTouch(a, b, CAL).touching, false);
});

// ── Walls and openings ──────────────────────────────────────────────────────

test('with no wall data the drawing is reported as silent, not as open', () => {
  const a = at('MEALS', 0, 0, 4, 4);
  const b = at('LOUNGE', 4 * 1000 * PPM, 0, 4, 4);
  assert.equal(opennessBetween(a, b, {}).state, 'unknown');
});

test('a wall across the seam separates two rooms', () => {
  const a = at('MEALS', 0, 0, 4, 4);
  const edge = 4 * 1000 * PPM;
  const b = at('LOUNGE', edge, 0, 4, 4);
  const walls = [{ id: 'w1', orientation: 'vertical',
                   box: { x: edge - 2, y: 40, w: 4, h: 80 } }];
  assert.equal(opennessBetween(a, b, { walls }).state, 'separated');
});

test('a doorless opening in the seam makes two rooms one space', () => {
  const a = at('KITCHEN', 0, 0, 4, 4);
  const edge = 4 * 1000 * PPM;
  const b = at('MEALS', edge, 0, 4, 4);
  const walls = [{ id: 'w1', orientation: 'vertical', box: { x: edge - 2, y: 40, w: 4, h: 80 } }];
  const openings = [{ id: 'o1', type: 'opening', box: { x: edge - 3, y: 50, w: 6, h: 40 } }];
  assert.equal(opennessBetween(a, b, { walls, openings }).state, 'open');
});

test('a plain DOOR does not make two rooms one zone', () => {
  // A door can be shut, so the rooms can be dampered apart. Only a doorless
  // opening joins them.
  const a = at('MEALS', 0, 0, 4, 4);
  const edge = 4 * 1000 * PPM;
  const b = at('LOUNGE', edge, 0, 4, 4);
  const walls = [{ id: 'w1', orientation: 'vertical', box: { x: edge - 2, y: 40, w: 4, h: 80 } }];
  const openings = [{ id: 'o1', type: 'door', box: { x: edge - 3, y: 50, w: 6, h: 40 } }];
  assert.equal(opennessBetween(a, b, { walls, openings }).state, 'separated');
});

// ── Grouping ────────────────────────────────────────────────────────────────

test('an open-plan living area is grouped onto one zone', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [
    at('KITCHEN', 0, 0, 4, 4),
    at('MEALS', w(4), 0, 4, 4),
    at('LIVING', w(8), 0, 5, 4),
    at('BEDROOM 2', 0, w(9), 3, 3)     // well away from the living area
  ];
  const s = suggestOpenPlanGroups(rooms, { calibration: CAL });
  assert.equal(s.openPlanRoomCount, 3);
  const grouped = s.groups[0].rooms;
  for (const l of ['KITCHEN', 'MEALS', 'LIVING']) assert.ok(grouped.includes(l), l);
  assert.ok(!grouped.includes('BEDROOM 2'));
});

test('a bedroom next to the kitchen is NOT dragged into the open plan', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4),
                 at('BEDROOM 2', 0, w(4), 3, 3)];
  const s = suggestOpenPlanGroups(rooms, { calibration: CAL });
  assert.ok(!s.groups[0].rooms.includes('BEDROOM 2'),
    'only open-plan room types seed or join a living area');
});

test('a wall drawn between them keeps a formal lounge on its own zone', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4),
                 at('LOUNGE', w(8), 0, 4, 4)];
  const walls = [{ id: 'w1', orientation: 'vertical',
                   box: { x: w(8) - 2, y: w(1), w: 4, h: w(2) } }];
  const s = suggestOpenPlanGroups(rooms, { calibration: CAL, walls });
  assert.equal(s.confidence, 'HIGH', 'wall data makes this a fact, not a proposal');
  assert.ok(!s.groups[0].rooms.includes('LOUNGE'));
});

test('without wall data the grouping is reported as a proposal, not a fact', () => {
  const w = (m) => m * 1000 * PPM;
  const s = suggestOpenPlanGroups(
    [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4)], { calibration: CAL });
  assert.equal(s.confidence, 'MEDIUM');
  assert.equal(s.method, 'room_adjacency');
  assert.ok(s.notes.some(n => /no walls or openings/i.test(n)),
    'it must say why it is not sure');
});

test('a hallway joins what it opens onto but never starts a group', () => {
  const w = (m) => m * 1000 * PPM;
  // Two bedrooms either side of a passage must not become one zone.
  const rooms = [at('HALLWAY', w(4), 0, 2, 8),
                 at('BEDROOM 2', 0, 0, 4, 4),
                 at('BEDROOM 3', w(6), 0, 4, 4)];
  const s = suggestOpenPlanGroups(rooms, { calibration: CAL });
  assert.equal(s.openPlanRoomCount, 0, 'a passage is not an open-plan living area');
});

test('excluded rooms are never grouped into a zone', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4),
                 at("P'TRY", 0, w(4), 2, 2)];
  const s = suggestOpenPlanGroups(rooms, { calibration: CAL });
  assert.ok(!s.groups[0].rooms.includes("P'TRY"));
});

// ── Applying it ─────────────────────────────────────────────────────────────

test('the grouping reaches the zones', () => {
  const w = (m) => m * 1000 * PPM;
  let rooms = [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4),
               at('LIVING', w(8), 0, 5, 4), at('BEDROOM 2', 0, w(9), 3, 3)]
    .map(r => ({ ...r, status: 'Verified' }));
  const before = suggestZones(rooms, {
    rows: rooms.map(r => ({ roomId: r.id, adjustedLs: 100 })), allocatedAirflowLs: 400 });
  assert.equal(before.zoneCount, 4, 'ungrouped, every room is its own zone');

  rooms = applyOpenPlanGroups(rooms, suggestOpenPlanGroups(rooms, { calibration: CAL }));
  const after = suggestZones(rooms, {
    rows: rooms.map(r => ({ roomId: r.id, adjustedLs: 100 })), allocatedAirflowLs: 400 });
  assert.equal(after.zoneCount, 2, 'the open-plan area is one zone');
  const openPlan = after.zones.find(z => z.roomIds.length === 3);
  assert.ok(openPlan);
  assert.equal(openPlan.alwaysOpen, true, 'the largest grouped zone becomes the constant zone');
});

// ── Nothing already decided is ever overwritten ─────────────────────────────

test('zoning set by hand is left alone', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [
    { ...at('KITCHEN', 0, 0, 4, 4), openPlanGroup: 'living-dining-kitchen' },
    { ...at('MEALS', w(4), 0, 4, 4), openPlanGroup: 'living-dining-kitchen' }
  ];
  assert.equal(zoningAlreadySet(rooms), true);
});

test("the estimator's split survives a re-run", () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [at('KITCHEN', 0, 0, 4, 4), at('MEALS', w(4), 0, 4, 4),
                 { ...at('LOUNGE', w(8), 0, 4, 4),
                   openPlanGroup: null, zoneGroupSource: 'estimator' }];
  const out = applyOpenPlanGroups(rooms, suggestOpenPlanGroups(rooms, { calibration: CAL }));
  const lounge = out.find(r => r.label === 'LOUNGE');
  assert.equal(lounge.openPlanGroup, null, 'the split must not be undone by the auto-grouping');
  assert.equal(out.find(r => r.label === 'KITCHEN').openPlanGroup, 'open-plan');
});

test('an auto grouping IS replaced when the plan is re-read', () => {
  const w = (m) => m * 1000 * PPM;
  const rooms = [{ ...at('KITCHEN', 0, 0, 4, 4), openPlanGroup: 'stale', zoneGroupSource: 'auto' }];
  assert.equal(zoningAlreadySet(rooms), false);
});

// ── When the zoning cannot work, name the fix ───────────────────────────────

test('too many zones names the merge that fixes it', () => {
  const rooms = ['BEDROOM 2', 'BEDROOM 3', 'BEDROOM 4', 'MASTER BEDROOM']
    .map((l, i) => at(l, i * 200, 500, 3, 3));
  const zones = rooms.map((r, i) => ({
    id: 'z' + i, name: r.label, kind: 'individual', roomIds: [r.id],
    airflowLs: 70, systemSharePct: 6, alwaysOpen: false
  }));
  zones.push({ id: 'zc', name: 'Open plan', kind: 'common', roomIds: [], airflowLs: 700,
               systemSharePct: 70, alwaysOpen: true });
  const out = zoneRemedies({ zones, meetsMinimum: true }, rooms, { controllerMaxZones: 4 });
  const merge = out.find(r => r.code === 'MERGE_BEDROOM_ZONES');
  assert.ok(merge, 'it must say which rooms to put together');
  assert.ok(merge.roomIds.length >= 2);
  assert.match(merge.title, /BEDROOM/);
});

test('failing the minimum airflow proposes a constant zone', () => {
  const rooms = [at('LIVING', 0, 0, 6, 5)];
  const zones = [{ id: 'z1', name: 'LIVING', kind: 'individual', roomIds: [rooms[0].id],
                   airflowLs: 600, systemSharePct: 60, alwaysOpen: false }];
  const out = zoneRemedies({ zones, meetsMinimum: false }, rooms);
  assert.ok(out.some(r => r.code === 'NOMINATE_CONSTANT_ZONE'));
});

test('a working zoning proposes nothing', () => {
  const rooms = [at('LIVING', 0, 0, 6, 5)];
  const zones = [{ id: 'z1', name: 'Open plan', kind: 'common', roomIds: [rooms[0].id],
                   airflowLs: 600, systemSharePct: 60, alwaysOpen: true }];
  assert.deepEqual(zoneRemedies({ zones, meetsMinimum: true }, rooms, { controllerMaxZones: 8 }), []);
});

// ── The room-type list is the one from the classifier ───────────────────────

test('only genuine open-plan types seed a group', () => {
  for (const t of ['kitchen', 'dining', 'living']) assert.ok(OPEN_PLAN_TYPES.has(t), t);
  for (const t of ['bedroom', 'study', 'media', 'hallway', 'other']) {
    assert.ok(!OPEN_PLAN_TYPES.has(t), t + ' must not seed an open-plan zone');
  }
});
