// NAC AI HVAC DESIGNER — tying a chain's millimetres back to the image.
//
// A chain's stations are millimetres from its own zero, which sits wherever the
// first dimension falls in the image — not at the image's left edge. Reading a
// plan means putting a room label against a station, so the chain has to know
// where it lives in pixel space. Without that every room lands in the wrong bay,
// silently, which is exactly the kind of failure the confidence scoring cannot
// catch: the number looks fine, it is just the wrong room's number.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupChains, chainMmAtPx, chainPxAtMm, bays } from '../designer/engines/chains.mjs';
import { scaleObservations, scaleBox } from '../designer/ui/image.mjs';

/**
 * A dimension row as it appears on a plan: each number printed centred over the
 * span it measures, on a drawing that sits `originPx` in from the image edge at
 * `pxPerMm` pixels per millimetre.
 */
function dimensionRow(segmentsMm, { orientation = 'horizontal', pxPerMm = 0.05,
                                    originPx = 400, rowPx = 900, row = 1 } = {}) {
  let acc = 0;
  return segmentsMm.map((mm, i) => {
    const midMm = acc + mm / 2;
    acc += mm;
    const alongPx = originPx + midMm * pxPerMm;
    const box = orientation === 'horizontal'
      ? { x: alongPx - 15, y: rowPx, w: 30, h: 10 }
      : { x: rowPx, y: alongPx - 15, w: 10, h: 30 };
    return { id: orientation[0] + i, mm, orientation, row, box };
  });
}

test('a chain records where it sits in the image, not just how long it is', () => {
  const [chain] = groupChains(dimensionRow([3600, 1800, 4200, 3000]));
  assert.deepEqual(chain.stations, [0, 3600, 5400, 9600, 12600]);
  assert.ok(chain.pixelAnchor, 'a chain must be anchored to the image it came from');
  assert.equal(chain.pixelAnchor.pxPerMm, 0.05);
  assert.equal(chain.pixelAnchor.originPx, 400);
  assert.equal(chain.pixelAnchor.r2, 1);
  assert.equal(chain.pixelAnchor.points, 4);
});

test('a pixel on the plan converts to a position along the chain', () => {
  const [chain] = groupChains(dimensionRow([3600, 1800, 4200, 3000]));
  // 4500 mm along the building, on a drawing that starts 400 px in.
  assert.equal(chainMmAtPx(chain, 400 + 4500 * 0.05), 4500);
  assert.equal(chainMmAtPx(chain, 400), 0);
  // And back again.
  assert.equal(chainPxAtMm(chain, 0), 400);
  assert.equal(chainPxAtMm(chain, 12600), 1030);
});

test('a label lands in the bay it is actually printed in', () => {
  const [chain] = groupChains(dimensionRow([3600, 1800, 4200, 3000]));
  const bayAt = (mm) => {
    const b = bays(chain);
    return b.findIndex(x => mm >= x.startMm && mm <= x.endMm);
  };
  // Second bay runs 3600–5400 mm.
  const labelPx = 400 + 4500 * 0.05;
  assert.equal(bayAt(chainMmAtPx(chain, labelPx)), 1);
  // Using the image origin instead — the bug — puts it at 12500 mm, the far end.
  assert.notEqual(bayAt(labelPx / 0.05), 1);
});

test('the anchor works at any scale and offset', () => {
  for (const [pxPerMm, originPx] of [[0.02, 0], [0.12, 1250], [0.008, 77]]) {
    const [chain] = groupChains(dimensionRow([3000, 4000, 3500], { pxPerMm, originPx }));
    assert.ok(Math.abs(chain.pixelAnchor.pxPerMm - pxPerMm) < 1e-6);
    assert.ok(Math.abs(chain.pixelAnchor.originPx - originPx) < 0.5);
    assert.ok(Math.abs(chainMmAtPx(chain, originPx + 5000 * pxPerMm) - 5000) < 1);
  }
});

test('vertical chains are anchored down the page', () => {
  const dets = dimensionRow([3400, 3400, 4200], { orientation: 'vertical', originPx: 260, rowPx: 120 });
  const [chain] = groupChains(dets);
  assert.equal(chain.orientation, 'vertical');
  assert.equal(chain.pixelAnchor.originPx, 260);
  assert.equal(chainMmAtPx(chain, 260 + 3400 * 0.05), 3400);
});

test('a single dimension is not enough to anchor, and does not pretend to be', () => {
  const [chain] = groupChains(dimensionRow([3600]));
  assert.equal(chain.pixelAnchor, null);
  assert.equal(chainMmAtPx(chain, 500), null);
  assert.equal(chainPxAtMm(chain, 500), null);
});

test('segments follow the drawing, whatever order the reader listed them in', () => {
  // The plan reader has no obligation to return detections left to right, so
  // the chain is ordered by where the text sits, and the anchor follows that.
  const ordered = dimensionRow([3600, 1800, 4200]);
  const shuffled = [ordered[2], ordered[0], ordered[1]];
  const [chain] = groupChains(shuffled);
  assert.deepEqual(chain.segments, [3600, 1800, 4200]);
  assert.deepEqual(chain.stations, [0, 3600, 5400, 9600]);
  assert.equal(chain.pixelAnchor.originPx, 400);
});

test('a poor fit is reported rather than hidden', () => {
  const dets = dimensionRow([3000, 3000, 3000, 3000]);
  // Nudge one label well off where its dimension says it should be.
  dets[2].box = { ...dets[2].box, x: dets[2].box.x + 60 };
  const [chain] = groupChains(dets);
  assert.ok(chain.pixelAnchor, 'still monotonic, so it fits');
  assert.ok(chain.pixelAnchor.r2 < 1, 'but the fit is not perfect and says so');
});

// ── Downscaled reads ───────────────────────────────────────────────────────

test('boxes from a downscaled read are scaled back to the page', () => {
  const obs = {
    detections: [{ id: 'd1', text: '3400', box: { x: 100, y: 50, w: 20, h: 8 } }],
    roomLabels: [{ id: 'r1', text: 'BED 2', box: { x: 200, y: 300, w: 40, h: 12 } }],
    walls: [{ id: 'w1', box: { x: 0, y: 0, w: 10, h: 10 } }],
    openings: [],
    scaleLabelText: 'SCALE 1:100 @ A3'
  };
  const out = scaleObservations(obs, 2.5);
  assert.deepEqual(out.detections[0].box, { x: 250, y: 125, w: 50, h: 20 });
  assert.deepEqual(out.roomLabels[0].box, { x: 500, y: 750, w: 100, h: 30 });
  assert.deepEqual(out.walls[0].box, { x: 0, y: 0, w: 25, h: 25 });
  // Everything else is carried through untouched.
  assert.equal(out.scaleLabelText, 'SCALE 1:100 @ A3');
  assert.equal(out.detections[0].text, '3400');
});

test('an image that was not downscaled is left exactly as it is', () => {
  const obs = { detections: [{ id: 'd1', box: { x: 1, y: 2, w: 3, h: 4 } }] };
  assert.equal(scaleObservations(obs, 1), obs);
  const b = { x: 1, y: 2, w: 3, h: 4 };
  assert.equal(scaleBox(b, 1), b);
});

test('scaling a read back preserves the geometry the chain fit depends on', () => {
  // Read at half size, then scaled back: the anchor must land on the real page.
  const full = dimensionRow([3600, 1800, 4200], { pxPerMm: 0.05, originPx: 400 });
  const half = full.map(d => ({ ...d, box: scaleBox(d.box, 0.5) }));
  const [chain] = groupChains(
    scaleObservations({ detections: half }, 2).detections.map((d, i) => ({ ...d, mm: full[i].mm })));
  assert.ok(Math.abs(chain.pixelAnchor.pxPerMm - 0.05) < 1e-6);
  assert.ok(Math.abs(chain.pixelAnchor.originPx - 400) < 0.5);
});
