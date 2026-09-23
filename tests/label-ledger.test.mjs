// THE LABEL LEDGER — THE PART THAT KEEPS TEXT OFF THE DUCTWORK.
//
// Nick, on the internal sheet: "prevent labels from covering ducts or
// equipment; keep return labels on the return side; keep supply labels on the
// supply side."
//
// A duct is a LINE, so the ledger could not book one as a rectangle — the
// bounding box of a single diagonal run covers a quarter of the house. Runs
// were therefore never in the ledger at all, and `BTO-C · 400-350-350` sat
// straight across the two return drops. These tests are on the occupancy grid
// that replaced that, because it is the thing that decides where text lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLabelLedger, breakAround, findCrossings } from '../designer/ui/symbols.mjs';

const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });

test('a run booked in the ledger is paid for by a label over it', () => {
  const L = createLabelLedger();
  L.route([{ x: 0, y: 0 }, { x: 200, y: 0 }], 5, 'supply');
  assert.ok(L.ductCover(box(90, -5, 130, 5), 'supply') > 0.8,
            'a label sitting squarely on the run costs nearly all of itself');
  assert.equal(L.ductCover(box(90, 120, 130, 132), 'supply'), 0,
               'a label well clear of it costs nothing');
});

test('nothing is charged before any run is booked', () => {
  const L = createLabelLedger();
  assert.equal(L.ductCover(box(0, 0, 50, 12), 'supply'), 0);
});

test('crossing to the other system costs three times as much', () => {
  const L = createLabelLedger();
  L.route([{ x: 0, y: 0 }, { x: 200, y: 0 }], 5, 'return');
  const own = L.ductCover(box(90, -5, 130, 5), 'return');
  const other = L.ductCover(box(90, -5, 130, 5), 'supply');
  assert.ok(own > 0, 'a return label still pays for its own run');
  assert.ok(other > own * 2.5,
            'a SUPPLY label over return ink pays a multiple — that is what keeps ' +
            'supply text on the supply side (' + other.toFixed(2) + ' vs ' + own.toFixed(2) + ')');
});

test('reset clears the ink as well as the boxes', () => {
  const L = createLabelLedger();
  L.route([{ x: 0, y: 0 }, { x: 200, y: 0 }], 5, 'supply');
  L.reserve(300, 300, 40, 40);
  L.reset();
  assert.equal(L.ductCover(box(90, -5, 130, 5), 'supply'), 0);
  assert.equal(L.overlap(box(290, 290, 310, 310)), 0);
});

test('a wide run books a wider strip than a narrow one', () => {
  const wide = createLabelLedger(), thin = createLabelLedger();
  wide.route([{ x: 0, y: 0 }, { x: 200, y: 0 }], 12, 'supply');
  thin.route([{ x: 0, y: 0 }, { x: 200, y: 0 }], 2, 'supply');
  const at = box(90, 14, 130, 24);            // beside the centreline, not on it
  assert.ok(wide.ductCover(at, 'supply') > thin.ductCover(at, 'supply'),
            'a ø400 main claims more of the plan than a ø250 final');
});

// ── The crossing: a gap wide enough to clear what passes through it ────────
//
// Nick: "There is one remaining genuine crossing: Bedroom 3 final × Return 2.
// Show a clear bridge/gap at that exact crossing. It must not resemble a
// connection." The gap used to be cut to the width of the run being BROKEN,
// which is the wrong duct — a return cut to its own width and crossed by a
// ø400 main came out looking like a joint.
test('each break may size its own gap from the run passing through it', () => {
  const pieces = breakAround([{ x: 0, y: 0 }, { x: 100, y: 0 }],
                             [{ x: 50, y: 0, gapPx: 30 }], 4);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0][pieces[0].length - 1].x, 35);
  assert.equal(pieces[1][0].x, 65);
});

test('with no gap of its own a break falls back to the run default', () => {
  const pieces = breakAround([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: 0 }], 10);
  assert.ok(Math.abs(pieces[0][pieces[0].length - 1].x - 45) < 1e-6);
  assert.ok(Math.abs(pieces[1][0].x - 55) < 1e-6);
});

test('two runs that genuinely cross are found, and two that do not are not', () => {
  const across = findCrossings([{ x: 0, y: 0 }, { x: 100, y: 0 }],
                               [{ x: 50, y: -40 }, { x: 50, y: 40 }]);
  assert.equal(across.length, 1);
  assert.equal(Math.round(across[0].x), 50);
  assert.equal(findCrossings([{ x: 0, y: 0 }, { x: 100, y: 0 }],
                             [{ x: 0, y: 40 }, { x: 100, y: 40 }]).length, 0,
               'parallel runs do not cross, however close they are');
});
