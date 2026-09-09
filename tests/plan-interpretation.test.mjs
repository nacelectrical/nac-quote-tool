// PART 35 — dimension chains, classification, scale calibration, room geometry.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDimensionText, classifyDimension, buildDetectedDimensions, classifyAll } from '../designer/engines/dimensions.mjs';
import { reconstructChain, checkClosure, groupChains, snapToStation, bays, spanBetween } from '../designer/engines/chains.mjs';
import { calibrate, parseScaleLabel, pxToMm, polylineLengthMm, crossCheckScaleLabel } from '../designer/engines/calibration.mjs';
import { DEFAULT_SETTINGS, settingsWith } from '../designer/engines/settings.mjs';

// ── PART 4: chain reconstruction ────────────────────────────────────────────

test('chain reconstruction produces the cumulative stations from the brief', () => {
  const r = reconstructChain([350, 2050, 220, 3400, 90, 2720]);
  assert.deepEqual(r.stations, [0, 350, 2400, 2620, 6020, 6110, 8830]);
  assert.equal(r.totalMm, 8830);
});

test('chain closure is checked against the stated overall, with tolerance', () => {
  assert.equal(checkClosure(8830, 8830).closes, true);
  assert.equal(checkClosure(8830, 8870).closes, true);        // 40 mm, inside 60 mm
  assert.equal(checkClosure(8830, 8950).closes, false);       // 120 mm, outside
  assert.equal(checkClosure(8830, NaN).closes, null);         // nothing to check
});

test('a chain that does not close is reported, never quietly used', () => {
  const c = checkClosure(8830, 9200);
  assert.equal(c.closes, false);
  assert.equal(c.errorMm, -370);
  assert.match(c.note, /verify before use/i);
});

test('chains are grouped by orientation and dimension row', () => {
  const dets = buildDetectedDimensions([
    { id: 'a', text: '18020', orientation: 'horizontal', row: 0, box: { x: 500, y: 40, w: 40, h: 10 } },
    { id: 'b', text: '3600',  orientation: 'horizontal', row: 1, box: { x: 100, y: 70, w: 20, h: 10 } },
    { id: 'c', text: '90',    orientation: 'horizontal', row: 1, box: { x: 160, y: 70, w: 20, h: 10 } },
    { id: 'd', text: '14330', orientation: 'horizontal', row: 1, box: { x: 400, y: 70, w: 40, h: 10 } },
    { id: 'e', text: '14250', orientation: 'vertical',   row: 0, box: { x: 40, y: 500, w: 10, h: 40 } }
  ]);
  const chains = groupChains(dets);
  const h1 = chains.find(c => c.orientation === 'horizontal' && c.segments.length === 3);
  assert.ok(h1);
  assert.equal(h1.totalMm, 18020);
  assert.equal(h1.closure.closes, true);
  assert.equal(chains.filter(c => c.orientation === 'vertical').length, 1);
});

test('a partial dimension row is not reported as a broken chain', () => {
  const dets = buildDetectedDimensions([
    { id: 'ov', text: '18020', orientation: 'horizontal', row: 0, box: { x: 500, y: 40, w: 40, h: 10 } },
    { id: 'p1', text: '1800',  orientation: 'horizontal', row: 2, box: { x: 100, y: 120, w: 20, h: 10 } },
    { id: 'p2', text: '820',   orientation: 'horizontal', row: 2, box: { x: 200, y: 120, w: 20, h: 10 } },
    { id: 'p3', text: '2400',  orientation: 'horizontal', row: 2, box: { x: 300, y: 120, w: 20, h: 10 } }
  ]);
  const chains = groupChains(dets);
  const partial = chains.find(c => c.memberIds.includes('p1'));
  assert.equal(partial.closure.closes, null);
  assert.equal(partial.closure.partial, true);
  assert.match(partial.closure.note, /Partial dimension row/);
});

test('stations snap within tolerance and refuse to snap outside it', () => {
  const chain = reconstructChain([350, 2050, 220, 3400]);
  const near = snapToStation(chain, 2650, 120);
  assert.equal(near.stationMm, 2620);
  assert.equal(near.snapped, true);
  const far = snapToStation(chain, 3200, 120);
  assert.equal(far.snapped, false);
});

test('bays identify wall thicknesses and usable room spans', () => {
  const chain = reconstructChain([110, 3600, 90, 1800, 90, 3200]);
  const b = bays(chain);
  assert.equal(b[0].isWall, true);                       // 110 brick
  assert.equal(b[1].usableAsRoomDimension, true);        // 3600
  assert.equal(b[2].isWall, true);                       // 90 stud
  assert.equal(b[3].usableAsRoomDimension, true);        // 1800
  assert.equal(spanBetween(chain, 1, 2), 3600);
});

// ── PART 3: classification ──────────────────────────────────────────────────

test('dimension text is parsed the way Australian plans print it', () => {
  assert.equal(parseDimensionText('3400').mm, 3400);
  assert.equal(parseDimensionText('3,400').mm, 3400);
  assert.equal(parseDimensionText('3.4').mm, 3400);       // small decimal = metres
  assert.equal(parseDimensionText('3.4m').mm, 3400);
  assert.equal(parseDimensionText('2400mm').mm, 2400);
  assert.equal(parseDimensionText('90').mm, 90);
  assert.equal(parseDimensionText('R2.5'), null);
  assert.equal(parseDimensionText('FFL 12.50'), null);
  assert.equal(parseDimensionText('BED 3'), null);
  assert.equal(parseDimensionText('3'), null);            // a room number, not a length
});

test('wall thicknesses are classified from the standard AU set', () => {
  for (const t of [70, 90, 110, 140, 190, 230, 290]) {
    const r = classifyDimension({ id: 'x', mm: t, box: { x: 0, y: 0, w: 10, h: 10 }, orientation: 'horizontal' });
    assert.equal(r.classification, 'wall_thickness', t + ' mm should read as a wall');
  }
});

test('a number spanning a window symbol is a window width, not a room', () => {
  const det = { id: 'w', mm: 1800, orientation: 'horizontal', box: { x: 100, y: 200, w: 24, h: 10 } };
  const withSymbol = classifyDimension(det, {
    openings: [{ id: 'o', type: 'window', box: { x: 60, y: 198, w: 110, h: 12 } }]
  });
  assert.equal(withSymbol.classification, 'window_width');

  // Same number with no symbol nearby is a plausible room dimension instead —
  // and the engine says so with lower confidence rather than pretending.
  const without = classifyDimension(det, { openings: [] });
  assert.equal(without.classification, 'internal_wall_dimension');
  assert.ok(without.confidence < withSymbol.confidence);
});

test('chain membership and closure raise a dimension\'s confidence', () => {
  const det = { id: 'x', mm: 3400, orientation: 'horizontal', box: { x: 0, y: 0, w: 10, h: 10 } };
  const bare = classifyDimension(det, {});
  const inClosingChain = classifyDimension(det, {
    chain: { id: 'c1', closure: { closes: true, errorMm: 0 } },
    walls: [{ id: 'w1' }, { id: 'w2' }]
  });
  assert.ok(inClosingChain.confidence > bare.confidence);
  assert.ok(inClosingChain.evidence.some(e => /closes against the overall/.test(e)));
});

test('numbers too big for a room are not offered as room dimensions', () => {
  const r = classifyDimension({ id: 'x', mm: 18020, orientation: 'horizontal', box: { x: 0, y: 0, w: 10, h: 10 } });
  assert.equal(r.classification, 'overall_building_dimension');
});

test('classification thresholds come from settings, not hard-coded numbers', () => {
  const strict = settingsWith({ plan: { minRoomDimensionMm: 2500 } });
  const r = classifyDimension(
    { id: 'x', mm: 2000, orientation: 'horizontal', box: { x: 0, y: 0, w: 10, h: 10 } },
    { settings: strict });
  assert.notEqual(r.classification, 'internal_wall_dimension');
});

test('non-length text survives as an annotation and never becomes a number', () => {
  const dets = classifyAll(buildDetectedDimensions([
    { id: 'n1', text: 'FFL 12.50', orientation: 'horizontal', box: { x: 0, y: 0, w: 10, h: 10 } }
  ]), {});
  assert.equal(dets[0].mm, null);
  assert.equal(dets[0].classification, 'annotation');
});

// ── PART 5/6: scale ─────────────────────────────────────────────────────────

test('scale calibration converts pixels to millimetres', () => {
  const c = calibrate({ pointA: { x: 100, y: 200 }, pointB: { x: 700, y: 200 }, knownDistance: 6000 });
  assert.equal(c.pixelDistance, 600);
  assert.equal(c.pixelsPerMm, 0.1);
  assert.equal(pxToMm(c, 320), 3200);
  assert.equal(c.display.pixelDistance, '600 px');
});

test('calibration accepts metres and stores millimetres internally', () => {
  const c = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6, unit: 'm' });
  assert.equal(c.calibrationDistanceMm, 6000);
  assert.equal(c.pixelsPerMm, 0.1);
});

test('calibration is refused rather than guessed when the input is unusable', () => {
  assert.ok(calibrate({ pointA: { x: 10, y: 10 }, pointB: { x: 10, y: 10 }, knownDistance: 6000 }).error);
  assert.ok(calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 100, y: 0 }, knownDistance: 0 }).error);
  assert.ok(calibrate({ pointA: { x: 0, y: 0 }, knownDistance: 6000 }).error);
});

test('a printed scale label is parsed but never trusted on its own', () => {
  const s = parseScaleLabel('SCALE 1:100 @ A3');
  assert.equal(s.ratio, 100);
  assert.equal(s.sheet, 'A3');
  assert.equal(s.trusted, false);
  assert.equal(parseScaleLabel('1 : 200').ratio, 200);
  assert.equal(parseScaleLabel('no scale here'), null);
});

test('a resized screenshot keeps its architectural dimensions but changes px/mm', () => {
  // Same drawing, exported at half size: calibration must be redone, and the
  // reconstructed chain must be completely unaffected.
  const full = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const half = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 300, y: 0 }, knownDistance: 6000 });
  assert.equal(full.pixelsPerMm, 0.1);
  assert.equal(half.pixelsPerMm, 0.05);
  assert.equal(pxToMm(full, 340), pxToMm(half, 170));

  const chain = reconstructChain([110, 3600, 90, 1800]);
  assert.equal(chain.totalMm, 5600);              // unchanged by any image scaling
});

test('the scale-label cross-check is advisory and reports disagreement', () => {
  const c = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const x = crossCheckScaleLabel(c, '1:100', 300);      // 300 dpi A3 => 0.118 px/mm
  assert.equal(x.agrees, false);
  assert.match(x.note, /Advisory only/);
});

test('polyline length uses the calibration for drawn duct routes', () => {
  const c = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const mm = polylineLengthMm(c, [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }]);
  assert.equal(mm, 7000);                          // 700 px at 0.1 px/mm
});
