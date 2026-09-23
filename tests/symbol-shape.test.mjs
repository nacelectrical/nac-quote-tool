// THE TWO SYMBOLS NICK SENT BACK TWICE.
//
// Both failures were failures of SHAPE, and shape is geometry, so it can be
// tested here rather than looked at. A BTO body that works out square, with a
// second rectangle drawn inside it, is the plan symbol for an electrical
// junction box however it is styled; a damper casing barely longer than it is
// wide, turned to follow a duct, is a diamond however it is filled. These are
// the numbers that stop either from coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { btoGeometry, BTO_BODY, damperGeometry, DAMPER, ductWidthPx }
  from '../designer/ui/symbols.mjs';

const PPM = 0.0566667;                     // the Dungannon plan's calibration

/** The five fittings on the approved design, by their real specs. */
const FITTINGS = {
  'BTO-A':  { inlet: 400, outs: [250, 250, 250], angles: [0.35, 1.15, -0.85] },
  'BTO-B':  { inlet: 400, outs: [300, 250],      angles: [0.6, -0.6] },
  'BTO-C':  { inlet: 400, outs: [350, 350],      angles: [0.62, -0.62] },
  'BTO-C1': { inlet: 350, outs: [250, 250],      angles: [0.6, -0.6] },
  'BTO-C2': { inlet: 350, outs: [250, 250, 250], angles: [0.35, 1.15, -0.85] }
};
const geomOf = (k, scale = 1) => btoGeometry({
  at: { x: 0, y: 0 }, inletAngle: Math.PI, outletAngles: FITTINGS[k].angles,
  inletMm: FITTINGS[k].inlet, outletMm: FITTINGS[k].outs, scale, pxPerMm: PPM });

// ── The BTO ───────────────────────────────────────────────────────────────

test('every fitting draws one inlet neck and exactly its own outlet necks', () => {
  for (const [name, f] of Object.entries(FITTINGS)) {
    const g = geomOf(name);
    assert.ok(g.inlet, name + ' has an inlet neck');
    assert.equal(g.outlets.length, f.outs.length,
                 name + ' draws ' + f.outs.length + ' outlet necks');
  }
});

test('the body is never square, at any scale', () => {
  // Nick, twice: "The current BTO still resembles a small electrical junction
  // box." A take-off is a shallow box with a wide collar face. A square is the
  // one shape it must never be, because a square is what a junction box is.
  for (const name of Object.keys(FITTINGS)) {
    for (const scale of [0.85, 1, 1.35, 3]) {
      const g = geomOf(name, scale);
      assert.ok(g.h / g.w >= 1.3,
        name + ' at ' + scale + '× is ' + g.w.toFixed(1) + '×' + g.h.toFixed(1) +
        ' — ratio ' + (g.h / g.w).toFixed(2) + ', which is too close to square');
    }
  }
});

test('the body grows with the collar count', () => {
  // Nick: "Scale the manifold body according to its collar count."
  assert.ok(geomOf('BTO-A').h > geomOf('BTO-C').h,
            'three collars make a wider face than two');
  assert.ok(geomOf('BTO-C2').h > geomOf('BTO-C1').h,
            'and that holds on the ø350 pair too');
});

test('the body grows with the inlet size', () => {
  assert.ok(geomOf('BTO-C').w > geomOf('BTO-C1').w,
            'a ø400 inlet makes a deeper body than a ø350');
});

test('a neck is as wide as the duct that plugs into it', () => {
  // Nick: "different collar widths for Ø250, Ø300 and Ø350 where practical",
  // and "connected ducts ending at the collar face". A neck narrower than its
  // duct is swallowed by it and there is nothing left to count.
  const g = btoGeometry({ at: { x: 0, y: 0 }, inletAngle: Math.PI,
    outletAngles: [0.5, 0, -0.5], inletMm: 400, outletMm: [350, 300, 250],
    pxPerMm: PPM });
  const [w350, w300, w250] = g.outlets.map(o => o.width);
  assert.ok(w350 > w300 && w300 > w250,
            'ø350 ' + w350.toFixed(1) + ' > ø300 ' + w300.toFixed(1) +
            ' > ø250 ' + w250.toFixed(1));
  assert.ok(g.inlet.width > w350, 'and the ø400 inlet is the widest neck');
  for (const [mm, w] of [[350, w350], [300, w300], [250, w250]]) {
    assert.ok(w >= ductWidthPx(mm, PPM, { role: 'final', scale: 1 }),
              'the ø' + mm + ' neck is at least as wide as its duct');
  }
});

test('with no scale to work from the necks still differ by diameter', () => {
  // A legend tile and the symbol sheet have no plan calibration; the fallback
  // must still describe the fitting rather than three identical stubs.
  const g = btoGeometry({ at: { x: 0, y: 0 }, inletAngle: Math.PI,
    outletAngles: [0.5, 0, -0.5], inletMm: 400, outletMm: [350, 300, 250] });
  const [a, b, c] = g.outlets.map(o => o.width);
  assert.ok(a > b && b > c, a.toFixed(1) + ' > ' + b.toFixed(1) + ' > ' + c.toFixed(1));
});

test('every neck starts on the body and ends clear of it', () => {
  // The renderer trims each duct back to the neck tip, so a tip inside the
  // metal would draw the duct running through the fitting.
  const g = geomOf('BTO-A');
  const half = Math.min(g.w, g.h) / 2;
  for (const o of [...g.outlets, g.inlet]) {
    const root = Math.hypot(o.root.x - g.at.x, o.root.y - g.at.y);
    const tip = Math.hypot(o.tip.x - g.at.x, o.tip.y - g.at.y);
    assert.ok(root >= half - 1e-6, 'the neck starts on the body face');
    assert.ok(tip > root, 'and the collar face is outside it');
  }
});

test('the body stays small enough not to bury the plan', () => {
  const g = geomOf('BTO-A', 1.35);          // the largest the renderer goes to
  assert.ok(g.w <= BTO_BODY.maxW * 1.35 && g.h <= BTO_BODY.maxH * 1.35);
});

// ── The zone damper ───────────────────────────────────────────────────────

const damper = (mm, scale = 1) => damperGeometry({
  at: { x: 0, y: 0 }, angle: 0.7, diameterMm: mm, pxPerMm: PPM, scale,
  ductWidthPx: ductWidthPx(mm, PPM, { role: 'final', scale }) });

test('the casing is at least twice as long as it is wide', () => {
  // Nick, twice: "still looks like a diamond" / "a diagonal route marker".
  // Two long walls parallel to the run is what stops that, at every bearing.
  for (const mm of [250, 300, 350, 400]) {
    for (const scale of [0.85, 1, 1.35, 3.4]) {
      const g = damper(mm, scale);
      assert.ok(g.w / g.h >= 2.0,
        'ø' + mm + ' at ' + scale + '× is ' + g.w.toFixed(1) + '×' + g.h.toFixed(1) +
        ' — ratio ' + (g.w / g.h).toFixed(2));
    }
  }
});

test('the casing is never wider than the duct it is fitted in', () => {
  for (const mm of [250, 300, 350, 400]) {
    const drawn = ductWidthPx(mm, PPM, { role: 'final', scale: 1 });
    assert.ok(damper(mm).h <= drawn + 1e-9,
              'ø' + mm + ': casing ' + damper(mm).h.toFixed(1) +
              ' vs duct ' + drawn.toFixed(1));
  }
});

test('the casing follows the duct size', () => {
  assert.ok(damper(400).h > damper(300).h && damper(300).h > damper(250).h);
});

test('the actuator touches the casing wall with no gap at all', () => {
  // Nick: "small actuator box physically touching one side". The shaft belongs
  // INSIDE the casing, between the blade and that wall — not strung across a
  // gap between two objects that are not touching.
  assert.equal(DAMPER.shaft, 0, 'there is no gap to bridge');
  for (const mm of [250, 350, 400]) {
    const g = damper(mm);
    assert.ok(Math.abs(g.actuator.offset - (g.h / 2 + g.actuator.h / 2)) < 1e-9,
              'ø' + mm + ' actuator sits exactly on the wall');
  }
});

test('the whole assembly turns with the duct', () => {
  assert.equal(damper(250).angle, 0.7,
               'the casing, blade and actuator are all drawn in the duct frame');
});
