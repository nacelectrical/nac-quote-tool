// DRAGGABLE ROUTE EDITING — the rules that keep a dragged drawing a real system.
//
// The danger in letting someone drag ductwork is producing a picture that looks
// fine and is not connected to anything. So these tests are mostly about what
// must NOT come apart: a junction that gets pulled in half, a branch that comes
// off the trunk, a locked run that moves anyway.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  routeHandles, handleAt, dragHandle, dragBranch, addRoutePoint, deleteRoutePoint,
  orthogonalise, squarePolyline, snapToHandles, checkDiameterOverride, crossingCheck,
  buildDuctTree, measureTree
} from '../designer/engines/router.mjs';
import { buildDuctNetwork } from '../designer/engines/ducts.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

// A network shaped like the router really produces: a trunk in two runs, a
// junction where they meet, and two branches leaving that junction.
const NET = () => ({
  routed: true,
  sections: [
    { id: 'main', role: 'main', parentId: null, destination: 'Plenum → J1',
      diameterMm: 400, airflowLs: 800,
      points: [{ x: 100, y: 300 }, { x: 300, y: 300 }] },
    { id: 'trunk_1', role: 'trunk', parentId: 'main', destination: 'J1 → J2',
      diameterMm: 300, airflowLs: 400,
      points: [{ x: 300, y: 300 }, { x: 500, y: 300 }] },
    { id: 'branch_a', role: 'branch', parentId: 'main', junctionId: 'junction_1',
      roomId: 'a', destination: 'BED 1', diameterMm: 200, airflowLs: 200,
      points: [{ x: 300, y: 300 }, { x: 300, y: 150 }, { x: 250, y: 150 }] },
    { id: 'branch_b', role: 'branch', parentId: 'main', junctionId: 'junction_1',
      roomId: 'b', destination: 'BED 2', diameterMm: 200, airflowLs: 200,
      points: [{ x: 300, y: 300 }, { x: 300, y: 450 }] }
  ]
});

const at = (net, id, i) => net.sections.find(s => s.id === id).points[i];

// ── Handles ─────────────────────────────────────────────────────────────────

test('the junction is ONE handle carrying every run that meets there', () => {
  const hs = routeHandles(NET());
  const j = hs.find(h => h.x === 300 && h.y === 300);
  assert.ok(j, 'no handle at the junction');
  assert.equal(j.kind, 'junction');
  assert.deepEqual(j.sectionIds.sort(), ['branch_a', 'branch_b', 'main', 'trunk_1']);
  assert.equal(j.shared, true);
});

test('a mid-run corner is a plain node and an outlet is an end', () => {
  const hs = routeHandles(NET());
  const corner = hs.find(h => h.x === 300 && h.y === 150);
  const outlet = hs.find(h => h.x === 250 && h.y === 150);
  assert.equal(corner.kind, 'node');
  assert.equal(outlet.kind, 'end');
});

test('a handle is locked when ANY run meeting it is locked', () => {
  const hs = routeHandles(NET(), { lockedIds: ['branch_a'] });
  const j = hs.find(h => h.x === 300 && h.y === 300);
  assert.equal(j.locked, true, 'a junction shared with a locked run cannot be dragged freely');
});

test('a junction under the finger beats a plain node beside it', () => {
  const hs = routeHandles(NET());
  // A point closer to the corner than the junction, but both in range.
  const hit = handleAt(hs, { x: 300, y: 210 }, 120);
  assert.equal(hit.kind, 'junction', 'the junction is what an estimator is reaching for');
});

test('nothing is hit when the finger is nowhere near', () => {
  assert.equal(handleAt(routeHandles(NET()), { x: 900, y: 900 }, 20), null);
});

// ── Dragging a junction ─────────────────────────────────────────────────────

const first = (pts) => pts[0];
const last = (pts) => pts[pts.length - 1];
const allSquare = (pts) => pts.every((p, i) =>
  i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);

test('moving a junction moves EVERY run that meets there — nothing comes apart', () => {
  const net = NET();
  const hs = routeHandles(net);
  const j = hs.find(h => h.kind === 'junction');
  const to = { x: 340, y: 280 };
  const { edits, moved } = dragHandle(net, j, to);

  assert.deepEqual(moved.sort(), ['branch_a', 'branch_b', 'main', 'trunk_1']);
  // Every run still MEETS at the new joint. Which end depends on whether the
  // run arrives there or leaves from it.
  assert.deepEqual(last(edits.main), to, 'the trunk still arrives at the junction');
  assert.deepEqual(first(edits.trunk_1), to, 'the next trunk run still leaves it');
  assert.deepEqual(first(edits.branch_a), to);
  assert.deepEqual(first(edits.branch_b), to);
});

test('a junction drag leaves no diagonal behind it', () => {
  const net = NET();
  const j = routeHandles(net).find(h => h.kind === 'junction');
  const { edits } = dragHandle(net, j, { x: 340, y: 280 });
  for (const [id, pts] of Object.entries(edits)) {
    assert.ok(allSquare(pts), id + ' went diagonal: ' + JSON.stringify(pts));
  }
});

test('the far ends of those runs are left where they were', () => {
  const net = NET();
  const j = routeHandles(net).find(h => h.kind === 'junction');
  const { edits } = dragHandle(net, j, { x: 340, y: 280 });
  assert.deepEqual(first(edits.main), { x: 100, y: 300 }, 'the plenum did not move');
  assert.deepEqual(last(edits.trunk_1), { x: 500, y: 300 });
  assert.deepEqual(last(edits.branch_a), { x: 250, y: 150 }, 'the outlet did not move');
  assert.deepEqual(last(edits.branch_b), { x: 300, y: 450 });
});

test('a LOCKED run at a junction keeps its geometry and the rest follow', () => {
  const net = NET();
  const j = routeHandles(net, { lockedIds: ['branch_a'] }).find(h => h.kind === 'junction');
  const { edits, moved, blocked } = dragHandle(net, j, { x: 340, y: 280 }, { lockedIds: ['branch_a'] });
  assert.deepEqual(blocked, ['branch_a'], 'the locked run must be refused');
  assert.equal(edits.branch_a, undefined, 'and must not be given new geometry');
  assert.ok(moved.includes('main') && moved.includes('trunk_1'));
});

// ── Dragging a plain node ───────────────────────────────────────────────────

test('a dragged corner is squared, not left diagonal', () => {
  const net = NET();
  const corner = routeHandles(net).find(h => h.x === 300 && h.y === 150);
  const { edits } = dragHandle(net, corner, { x: 318, y: 120 });
  const pts = edits.branch_a;
  // Every leg is either horizontal or vertical.
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x);
    const dy = Math.abs(pts[i].y - pts[i - 1].y);
    assert.ok(dx < 0.01 || dy < 0.01, 'leg ' + i + ' went diagonal: ' + JSON.stringify(pts));
  }
});

test('a diagonal can be asked for explicitly', () => {
  const net = NET();
  const corner = routeHandles(net).find(h => h.x === 300 && h.y === 150);
  const { edits } = dragHandle(net, corner, { x: 318, y: 120 }, { allowDiagonal: true });
  assert.deepEqual(edits.branch_a[1], { x: 318, y: 120 });
});

test('a dragged point lands exactly where it was dropped', () => {
  // Pinning the point to stay square would mean it could not move at all when
  // both neighbours are fixed. It goes where the finger went; the legs around
  // it get the elbows.
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 100 }];
  const out = orthogonalise(pts, 1, { x: 13, y: 40 });
  assert.ok(out.some(p => p.x === 13 && p.y === 40), JSON.stringify(out));
  assert.deepEqual(out[0], { x: 0, y: 0 }, 'the ends are never moved');
  assert.deepEqual(out[out.length - 1], { x: 10, y: 100 });
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(out[i].x - out[i - 1].x) < 0.01 || Math.abs(out[i].y - out[i - 1].y) < 0.01,
      'leg ' + i + ' is diagonal');
  }
});

test('squarePolyline leaves an already-square run alone', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }];
  assert.deepEqual(squarePolyline(pts), pts);
});

// ── Snapping ────────────────────────────────────────────────────────────────

test('a dragged point snaps onto a nearby joint so runs actually meet', () => {
  const hs = routeHandles(NET());
  const snapped = snapToHandles({ x: 305, y: 296 }, hs, { radius: 14 });
  assert.deepEqual({ x: snapped.x, y: snapped.y }, { x: 300, y: 300 });
  assert.ok(snapped.snappedTo);
});

test('it does not snap to the handle being dragged', () => {
  const hs = routeHandles(NET());
  const j = hs.find(h => h.kind === 'junction');
  const snapped = snapToHandles({ x: 301, y: 301 }, hs, { exclude: [j.id], radius: 14 });
  assert.equal(snapped.snappedTo, null);
});

// ── Whole branches ──────────────────────────────────────────────────────────

test('a whole branch can be moved, and stays joined to the trunk', () => {
  const net = NET();
  const { edits } = dragBranch(net, 'branch_a', { x: 25, y: -40 });
  assert.deepEqual(edits.branch_a[0], { x: 300, y: 300 }, 'the take-off stays on the trunk');
  assert.deepEqual(edits.branch_a[1], { x: 325, y: 110 });
  assert.deepEqual(edits.branch_a[2], { x: 275, y: 110 });
});

test('a locked branch cannot be dragged', () => {
  const r = dragBranch(NET(), 'branch_a', { x: 25, y: -40 }, { lockedIds: ['branch_a'] });
  assert.deepEqual(r.blocked, ['branch_a']);
  assert.deepEqual(r.edits, {});
});

// ── Adding and deleting points ──────────────────────────────────────────────

test('a point is added onto the leg it was dropped on', () => {
  const net = NET();
  const { edits, index } = addRoutePoint(net, 'branch_a', { x: 300, y: 220 });
  assert.equal(index, 1, 'dropped on the first leg');
  assert.equal(edits.branch_a.length, 4);
  assert.deepEqual(edits.branch_a[1], { x: 300, y: 220 });
  assert.deepEqual(edits.branch_a[0], { x: 300, y: 300 });
  assert.deepEqual(edits.branch_a[3], { x: 250, y: 150 });
});

test('a point dropped near the second leg lands there, not the first', () => {
  const { index } = addRoutePoint(NET(), 'branch_a', { x: 275, y: 152 });
  assert.equal(index, 2);
});

test('a mid point can be deleted', () => {
  const { edits } = deleteRoutePoint(NET(), 'branch_a', 1);
  assert.equal(edits.branch_a.length, 2);
});

test('an END point cannot be deleted — that is where the run joins the system', () => {
  for (const i of [0, 2]) {
    const r = deleteRoutePoint(NET(), 'branch_a', i);
    assert.deepEqual(r.edits, {}, 'index ' + i + ' was deleted and should not have been');
    assert.match(r.reason, /joins the system|two points/);
  }
});

test('a two-point run cannot be reduced further', () => {
  const r = deleteRoutePoint(NET(), 'main', 1);
  assert.deepEqual(r.edits, {});
});

test('nothing can be added to or deleted from a locked run', () => {
  assert.deepEqual(addRoutePoint(NET(), 'branch_a', { x: 300, y: 220 }, { lockedIds: ['branch_a'] }).edits, {});
  assert.deepEqual(deleteRoutePoint(NET(), 'branch_a', 1, { lockedIds: ['branch_a'] }).edits, {});
});

// ── Manual diameters ────────────────────────────────────────────────────────

const manual = (dia, flow, role = 'branch') => ({
  id: 'branch_x', role, destination: 'BED 1', diameterMm: dia,
  velocityMs: Math.round(((flow / 1000) / (Math.PI * Math.pow(dia / 2000, 2))) * 100) / 100,
  selection: { manual: true }
});

test('a manual size that runs too fast is reported and KEPT', () => {
  const w = checkDiameterOverride(manual(150, 300), DEFAULT_SETTINGS);
  assert.ok(w, 'a 150 carrying 300 L/s must not pass silently');
  assert.equal(w.severity, 'WARNING');
  assert.match(w.message, /kept/i, 'the estimator must be told it was not reverted');
  assert.match(w.message, /reset it to auto/i);
});

test('a manual size that is oversized is reported too', () => {
  const w = checkDiameterOverride(manual(400, 40), DEFAULT_SETTINGS);
  assert.ok(w);
  assert.match(w.code, /BELOW_PREFERRED/);
});

test('an automatic size is never reported as an override', () => {
  assert.equal(checkDiameterOverride({ ...manual(200, 100), selection: { manual: false } }), null);
  assert.equal(checkDiameterOverride({ id: 'x' }), null);
});

// ── Crossings ───────────────────────────────────────────────────────────────

test('runs that share a joint are not reported as crossing', () => {
  assert.deepEqual(crossingCheck(NET()), [], 'a junction is not a clash');
});

test('two runs genuinely crossing are reported', () => {
  const net = NET();
  net.sections.push({ id: 'branch_c', role: 'branch', parentId: 'trunk_1',
    points: [{ x: 400, y: 100 }, { x: 400, y: 500 }] });
  net.sections.push({ id: 'branch_d', role: 'branch', parentId: 'trunk_1',
    points: [{ x: 350, y: 200 }, { x: 460, y: 200 }] });
  const hits = crossingCheck(net).map(h => h.sort().join('+'));
  assert.ok(hits.includes('branch_c+branch_d'), JSON.stringify(hits));
});

// ── The whole point: an edit changes the real engineering ───────────────────

test('an edited run re-measures, and the design follows', () => {
  const ROOMS = [
    { id: 'a', label: 'BED 1', boundaryPx: { x: 20, y: 20, w: 160, h: 200 } },
    { id: 'b', label: 'BED 2', boundaryPx: { x: 220, y: 20, w: 160, h: 200 } },
    { id: 'c', label: 'LIVING', boundaryPx: { x: 20, y: 400, w: 300, h: 220 } }
  ];
  const airflow = { rows: ROOMS.map(r => ({ roomId: r.id, label: r.label, adjustedLs: 120 })),
                    allocatedAirflowLs: 360 };
  const outlets = { rows: ROOMS.map(r => ({ roomId: r.id, quantity: 1 })) };
  const cal = { pixelsPerMm: 0.06 };

  const tree = measureTree(buildDuctTree({ rooms: ROOMS, airflow, outlets,
    layout: { plenum: { x: 200, y: 320 } } }), cal);
  const before = buildDuctNetwork({ airflow, outlets, topology: tree });
  const b0 = before.sections.find(s => s.id === 'branch_a');

  // Drag that branch a long way and re-measure, exactly as the app does.
  const { edits } = dragBranch(before, 'branch_a', { x: 0, y: -60 });
  const edited = measureTree({ ...tree,
    segments: tree.segments.map(s => (edits[s.id] ? { ...s, points: edits[s.id] } : s)) }, cal);
  const after = buildDuctNetwork({ airflow, outlets, topology: edited });
  const b1 = after.sections.find(s => s.id === 'branch_a');

  assert.notEqual(b1.lengthM, b0.lengthM, 'a moved run must change its length');
  assert.notEqual(b1.pressureDropPa, b0.pressureDropPa, 'and its pressure drop');
  assert.notEqual(after.totalDuctLengthM, before.totalDuctLengthM,
    'and the total the BOM buys from');
});
