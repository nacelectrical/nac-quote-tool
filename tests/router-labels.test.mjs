// PHASE 1 — the calculated design has to be readable ON the drawing.
//
// A duct line with no size on it is decoration. These tests hold the join
// between the route the estimator drew and the section the engine sized: a
// route can never show a diameter the design does not actually carry, and the
// trunk must never be drawn the same weight as a 150 branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  segmentLabel, lineWidthForDiameter, routeOverlayFromNetwork, roleColour,
  LABEL_DETAIL, DEFAULT_LABEL_DETAIL, AUTO_ROUTE_NOTICE
} from '../designer/engines/router.mjs';

const section = (over = {}) => ({
  id: 'branch_bed1', role: 'branch', destination: 'BED 1',
  diameterMm: 200, airflowLs: 105, lengthM: 5.23, ...over
});

// ── Labels ──────────────────────────────────────────────────────────────────

test('the default label shows the diameter at minimum', () => {
  assert.equal(DEFAULT_LABEL_DETAIL, LABEL_DETAIL.DIAMETER);
  assert.equal(segmentLabel(section()), '200Ø');
});

test('diameter + airflow reads as one line', () => {
  assert.equal(segmentLabel(section(), LABEL_DETAIL.DIAMETER_FLOW), '200Ø — 105 L/s');
});

test('full detail names the room first, then the numbers', () => {
  assert.equal(segmentLabel(section(), LABEL_DETAIL.FULL), 'BED 1\n200Ø — 105 L/s — 5.2 m');
});

test('labels can be turned off entirely', () => {
  assert.equal(segmentLabel(section(), LABEL_DETAIL.HIDE), null);
});

test('a section with no measured length still labels', () => {
  // A route that has not been drawn yet has no length. The diameter is still
  // known, and hiding the label would lose the most useful number on the plan.
  assert.equal(segmentLabel(section({ lengthM: null }), LABEL_DETAIL.FULL),
    'BED 1\n200Ø — 105 L/s');
});

test('a missing section labels nothing rather than inventing a size', () => {
  assert.equal(segmentLabel(null), null);
  assert.equal(segmentLabel(undefined, LABEL_DETAIL.FULL), null);
});

// ── Line weight ─────────────────────────────────────────────────────────────

test('a trunk is drawn heavier than a branch, and a branch heavier than a final', () => {
  const w400 = lineWidthForDiameter(400);
  const w300 = lineWidthForDiameter(300);
  const w200 = lineWidthForDiameter(200);
  const w100 = lineWidthForDiameter(100);
  assert.ok(w400 > w300, '400 must outweigh 300');
  assert.ok(w300 > w200, '300 must outweigh 200');
  assert.ok(w200 > w100, '200 must outweigh 100');
});

test('every duct stays thick enough to see and to click', () => {
  for (const d of [0, null, undefined, 50, 100, 400, 9999]) {
    const w = lineWidthForDiameter(d);
    assert.ok(w >= 2, d + ' produced an invisible line: ' + w);
    assert.ok(w <= 9, d + ' produced an absurd line: ' + w);
  }
});

// ── Role colours ────────────────────────────────────────────────────────────

test('return air is never drawn the same colour as supply', () => {
  assert.notEqual(roleColour('return'), roleColour('main'));
  assert.notEqual(roleColour('return'), roleColour('branch'));
  assert.notEqual(roleColour('return'), roleColour('final'));
});

// ── The join between drawn geometry and the sized design ────────────────────

const network = {
  sections: [
    { id: 'main', role: 'main', destination: 'Supply plenum', diameterMm: 400, airflowLs: 820, lengthM: 3.4 },
    { id: 'branch_bed1', role: 'branch', destination: 'BED 1', diameterMm: 200, airflowLs: 105, lengthM: 5.2 },
    { id: 'branch_living', role: 'branch', destination: 'LIVING', diameterMm: 300, airflowLs: 310, lengthM: 4.1 }
  ]
};
const pts = (n = 2) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: i * 5 }));

test('each drawn route carries its own section’s real numbers', () => {
  const overlay = routeOverlayFromNetwork({
    network,
    mainRoute: { points: pts() },
    ductRoutes: { bed1: { points: pts(3) }, living: { points: pts() } },
    rooms: [{ id: 'bed1', label: 'BED 1' }, { id: 'living', label: 'LIVING' }]
  });

  assert.equal(overlay.main.diameterMm, 400);
  assert.equal(overlay.main.airflowLs, 820);
  assert.equal(overlay.main.sectionId, 'main');
  assert.equal(overlay.bed1.diameterMm, 200);
  assert.equal(overlay.living.diameterMm, 300);
  // And the weights follow the sizes, so the drawing reads correctly.
  assert.ok(overlay.main.width > overlay.living.width);
  assert.ok(overlay.living.width > overlay.bed1.width);
});

test('a route with no matching section shows no size rather than a wrong one', () => {
  const overlay = routeOverlayFromNetwork({
    network,
    ductRoutes: { ghost: { points: pts() } },
    rooms: [{ id: 'ghost', label: 'NOT IN THE DESIGN' }]
  });
  assert.equal(overlay.ghost.diameterMm, null);
  assert.equal(overlay.ghost.label, null, 'an unsized route must not be labelled with a guess');
});

test('a one-point route is not drawn at all', () => {
  const overlay = routeOverlayFromNetwork({
    network, ductRoutes: { bed1: { points: [{ x: 1, y: 1 }] } }
  });
  assert.equal(overlay.bed1, undefined);
});

test('the return duct is drawn from the return design, not the supply sections', () => {
  const overlay = routeOverlayFromNetwork({
    network,
    returnRoute: { points: pts() },
    returnDesign: { duct: { diameterMm: 400, lengthM: 2.5 }, totalAirflowLs: 820 }
  });
  assert.equal(overlay.return.role, 'return');
  assert.equal(overlay.return.diameterMm, 400);
  assert.match(overlay.return.label, /RETURN/);
  assert.equal(overlay.return.colour, roleColour('return'));
});

test('auto and locked flags survive onto the overlay', () => {
  const overlay = routeOverlayFromNetwork({
    network,
    mainRoute: { points: pts(), auto: true, locked: true },
    ductRoutes: { bed1: { points: pts(), auto: true, locked: false } }
  });
  assert.equal(overlay.main.auto, true);
  assert.equal(overlay.main.locked, true);
  assert.equal(overlay.bed1.locked, false);
});

test('the hide setting silences every label, including the return', () => {
  const overlay = routeOverlayFromNetwork({
    network,
    mainRoute: { points: pts() },
    ductRoutes: { bed1: { points: pts() } },
    returnRoute: { points: pts() },
    returnDesign: { duct: { diameterMm: 400 } },
    labelDetail: LABEL_DETAIL.HIDE
  });
  for (const k of ['main', 'bed1', 'return']) assert.equal(overlay[k].label, null, k);
});

test('the site-verification notice exists and says what it has to say', () => {
  assert.match(AUTO_ROUTE_NOTICE, /AUTO ROUTE/);
  assert.match(AUTO_ROUTE_NOTICE, /VERIFY SITE CONDITIONS/);
  assert.match(AUTO_ROUTE_NOTICE, /STRUCTURE/);
  assert.match(AUTO_ROUTE_NOTICE, /CLEARANCES/);
});
