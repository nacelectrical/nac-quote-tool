// NAC AI HVAC DESIGNER — the worked examples, asserted.
//
// These are the numbers the brief specifies, checked against values computed by
// hand. They are deliberately separate from the engines' own test files: this is
// the arithmetic anyone can verify on paper, and it must never drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoom, manualMeasurement, verifyRoom } from '../designer/engines/rooms.mjs';
import { systemLoad } from '../designer/engines/loads.mjs';
import { reconstructChain } from '../designer/engines/chains.mjs';
import { calibrate, pxToMm, mmToPx } from '../designer/engines/calibration.mjs';
import { velocity, selectDiameter } from '../designer/engines/ducts.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const room = (w, l, extra = {}) =>
  verifyRoom(buildRoom({ label: 'Bedroom', measurement: manualMeasurement(w, l), ...extra }));

// ── Room area reaches the sizing engine unchanged ──────────────────────────

test('a 3 m x 4 m bedroom is 12 m2, and the load engine receives exactly 12', () => {
  const r = room(3000, 4000);
  assert.equal(r.areaSqM, 12);
  assert.equal(systemLoad([r]).totalConditionedAreaSqM, 12);
});

test('areas that do not land on whole numbers are still exact', () => {
  for (const [w, l, expected] of [[3500, 4200, 14.7], [6000, 8500, 51], [2900, 1400, 4.06],
                                  [3333, 4444, 14.812]]) {   // 3.333 x 4.444, to 3 dp
    const r = room(w, l);
    assert.equal(r.areaSqM, expected, `${w} x ${l}`);
    // A room keeps 3 decimals; the system total is reported to 2. The
    // difference is under a hundredth of a square metre, but assert it rather
    // than assume the two are the same number.
    assert.ok(Math.abs(systemLoad([r]).totalConditionedAreaSqM - expected) < 0.005,
      `load total ${systemLoad([r]).totalConditionedAreaSqM} vs room ${expected}`);
  }
});

test('several rooms sum to the area the engine sizes on', () => {
  const rooms = [[3000, 4000], [3500, 4200], [6000, 8500]]
    .map(([w, l], i) => verifyRoom(buildRoom({ label: 'Room ' + (i + 1),
                                               measurement: manualMeasurement(w, l) })));
  const byHand = 12 + 14.7 + 51;                       // 77.7
  const load = systemLoad(rooms);
  assert.equal(load.totalConditionedAreaSqM, byHand);
  assert.equal(load.roomCount, 3);
  // NAC's own rule, on paper: 77.7 x 145 = 11266.5 W
  assert.equal(load.legacy.watts, Math.round(byHand * 145));
});

test('ceiling height changes the load but never the floor area', () => {
  let previous = 0;
  for (const h of [2400, 2550, 2700, 3000]) {
    const r = room(4000, 5000, { ceilingHeightMm: h });
    assert.equal(r.areaSqM, 20, 'area is floor area, whatever the ceiling does');
    const w = systemLoad([r]).designCoolingW;
    assert.ok(w > previous, 'a taller room is more air to cool');
    previous = w;
  }
});

test('an area typed directly is used as typed', () => {
  const r = verifyRoom(buildRoom({ label: 'Odd shaped room',
    measurement: manualMeasurement(4000, 5000) }));
  assert.equal(r.areaSqM, 20);
  assert.equal(systemLoad([r]).totalConditionedAreaSqM, 20);
});

// ── Dimension chains ───────────────────────────────────────────────────────

test("the brief's dimension chain reconstructs to the stated coordinates", () => {
  const chain = reconstructChain([350, 2050, 220, 3400, 90, 2720]);
  assert.deepEqual(chain.stations, [0, 350, 2400, 2620, 6020, 6110, 8830]);
  assert.equal(chain.totalMm, 8830);
  assert.deepEqual(chain.segments, [350, 2050, 220, 3400, 90, 2720]);
});

test('each station is the running total of everything before it', () => {
  const segs = [110, 3600, 90, 1800, 90, 4200, 110];
  const chain = reconstructChain(segs);
  let acc = 0;
  assert.equal(chain.stations[0], 0);
  segs.forEach((s, i) => { acc += s; assert.equal(chain.stations[i + 1], acc); });
  assert.equal(chain.totalMm, segs.reduce((a, b) => a + b, 0));
});

test('a chain can start somewhere other than zero', () => {
  const chain = reconstructChain([1000, 2000], { startMm: 500 });
  assert.deepEqual(chain.stations, [500, 1500, 3500]);
  assert.equal(chain.totalMm, 3000, 'the span is the length, not the last coordinate');
});

// ── Manual scale calibration ───────────────────────────────────────────────

test("the brief's calibration example: 600 px over 6000 mm is 10 mm per pixel", () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 },
                          knownDistance: 6000, unit: 'mm' });
  assert.equal(cal.mmPerPixel, 10);
  assert.equal(cal.pixelsPerMm, 0.1);
  assert.equal(cal.pixelDistance, 600);
  // ...so a 320 px wall is 3200 mm.
  assert.equal(pxToMm(cal, 320), 3200);
});

test('the ratio holds at other scales, and round-trips', () => {
  for (const [px, mm, testPx, expectMm] of [[600, 6000, 320, 3200], [1000, 5000, 250, 1250],
                                            [850, 7200, 425, 3600], [1200, 12000, 60, 600]]) {
    const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: px, y: 0 },
                            knownDistance: mm, unit: 'mm' });
    assert.ok(Math.abs(pxToMm(cal, testPx) - expectMm) < 0.01, `${px}px=${mm}mm`);
    assert.ok(Math.abs(mmToPx(cal, expectMm) - testPx) < 0.01, 'mm -> px must invert');
  }
});

test('pixel distance is the diagonal, not the horizontal run', () => {
  // 300, 400 -> 500 by Pythagoras.
  const cal = calibrate({ pointA: { x: 100, y: 100 }, pointB: { x: 400, y: 500 },
                          knownDistance: 5, unit: 'm' });
  assert.equal(cal.pixelDistance, 500);
  assert.equal(cal.mmPerPixel, 10);
});

test('metres are converted, and a nonsense calibration is refused not fudged', () => {
  const m = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6, unit: 'm' });
  assert.equal(m.mmPerPixel, 10);
  for (const bad of [{ knownDistance: 0 }, { knownDistance: -5 }, { knownDistance: '' }]) {
    const r = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, unit: 'mm', ...bad });
    assert.ok(r.error, 'a distance of ' + bad.knownDistance + ' must be refused');
  }
  const samePoint = calibrate({ pointA: { x: 10, y: 10 }, pointB: { x: 10, y: 10 },
                                knownDistance: 6000, unit: 'mm' });
  assert.ok(samePoint.error, 'two identical points cannot set a scale');
});

// ── Duct velocity ──────────────────────────────────────────────────────────

test('velocity is airflow over cross-sectional area, on every stocked diameter', () => {
  for (const d of DEFAULT_SETTINGS.duct.availableDiametersMm) {
    for (const q of [50, 100, 250, 500]) {
      const areaM2 = Math.PI * Math.pow(d / 2000, 2);   // d mm -> radius m
      const byHand = (q / 1000) / areaM2;               // L/s -> m3/s, over m2
      assert.ok(Math.abs(velocity(d, q) - byHand) < 1e-6,
        `${d} mm at ${q} L/s: engine ${velocity(d, q)} vs hand ${byHand}`);
    }
  }
});

test('the units are consistent: 100 L/s through 200 mm is 3.18 m/s', () => {
  assert.equal(Math.round(velocity(200, 100) * 100) / 100, 3.18);
  assert.equal(Math.round(velocity(300, 100) * 100) / 100, 1.41);
  assert.equal(Math.round(velocity(400, 500) * 100) / 100, 3.98);
});

test('doubling the airflow doubles the velocity in the same duct', () => {
  assert.ok(Math.abs(velocity(250, 200) - 2 * velocity(250, 100)) < 1e-9);
});

test('changing the airflow changes the duct the engine picks', () => {
  const picks = [40, 80, 120, 200, 350, 600].map(q => selectDiameter(q, 'branch').diameterMm);
  // Never smaller as the airflow grows.
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i] >= picks[i - 1], JSON.stringify(picks));
  assert.ok(picks[picks.length - 1] > picks[0], 'more air must eventually mean a bigger duct');
  for (const d of picks) assert.ok(DEFAULT_SETTINGS.duct.availableDiametersMm.includes(d));
});

test('airflow beyond what a stocked duct can carry is warned about, not hidden', () => {
  const s = selectDiameter(900, 'branch');
  assert.equal(s.diameterMm, 400, 'the largest NAC install');
  assert.ok(s.velocityMs > DEFAULT_SETTINGS.duct.velocity.branch.max,
    'and it is over the limit, which the section warning reports');
});
