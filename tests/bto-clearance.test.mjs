// THE 2.0 m MINIMUM BETWEEN A BTO COLLAR AND THE OUTLET IT FEEDS.
//
// Nick: "A BTO must never sit directly on top of or immediately beside an
// outlet. Every final duct from a BTO collar to an outlet must have a measured
// routed length of at least 2.0 metres. This is an engineering/layout rule, not
// just a drawing offset."
//
// The distinction in that last sentence is what this file is for. A drawing
// offset would be satisfied by moving the SYMBOL; a layout rule is satisfied
// only by moving the METAL and recalculating everything that hangs off it. So
// these assertions measure the routed polyline the router actually emitted,
// against the calibrated plan, and then check that the rest of the design moved
// with it — and that nothing was padded to make a number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproved } from './fixtures/approved-job.mjs';
import { MIN_BTO_TO_OUTLET_DUCT_LENGTH_M, placeFittingClear, finalRunLengthPx }
  from '../designer/engines/area-router.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const D = await buildApproved();
const out = D.out;
const PPM = out.calibration.pixelsPerMm;
const sections = out.network.sections;
const finals = sections.filter(s => s.role === 'final');

/** The measured routed length of a drawn run, in metres off the calibrated plan. */
const routedM = (sec) => {
  let px = 0;
  for (let i = 1; i < sec.points.length; i++) {
    px += Math.hypot(sec.points[i].x - sec.points[i - 1].x,
                     sec.points[i].y - sec.points[i - 1].y);
  }
  return px / PPM / 1000;
};
const straightM = (sec) => {
  const a = sec.points[0], z = sec.points[sec.points.length - 1];
  return Math.hypot(z.x - a.x, z.y - a.y) / PPM / 1000;
};

// ── The rule itself ─────────────────────────────────────────────────────────

test('the minimum is 2.0 m and it is a configurable design setting', () => {
  assert.equal(MIN_BTO_TO_OUTLET_DUCT_LENGTH_M, 2.0);
  assert.equal(DEFAULT_SETTINGS.duct.minimumBtoToOutletDuctLengthM, 2.0);
});

test('every BTO-to-outlet final duct measures at least 2.0 m on the plan', () => {
  assert.equal(finals.length, 10, 'the approved job has ten finals');
  const short = finals
    .map(f => ({ to: f.destination, m: routedM(f) }))
    .filter(f => f.m < MIN_BTO_TO_OUTLET_DUCT_LENGTH_M - 0.005);
  assert.deepEqual(short, [],
    'finals under the minimum: ' + short.map(f => f.to + ' ' + f.m.toFixed(2) + ' m').join(', '));
});

test('the two runs that used to breach it are the ones that moved', () => {
  // Before the rule, the Foyer and Bedroom 4 finals measured 0.47 m each: the
  // median had converged onto those outlets and only the 26 px drawing guard
  // separated them. They are the regression this file exists for.
  for (const label of ['FOYER', 'BEDROOM 4']) {
    const f = finals.find(s => String(s.destination).startsWith(label));
    assert.ok(f, label + ' has no final duct');
    assert.ok(routedM(f) >= 2.0 - 0.005,
      label + ' is ' + routedM(f).toFixed(2) + ' m, under the 2.0 m minimum');
  }
});

test('the minimum was met by moving the fitting, not by padding the run', () => {
  // A padded run is a long polyline between two close points. Every final here
  // is a single gentle bow, so the routed length can never be far above the
  // straight line between its ends. Anything above about 5% would be a detour
  // somebody would have to install and nobody would.
  for (const f of finals) {
    const ratio = routedM(f) / Math.max(0.001, straightM(f));
    assert.ok(ratio < 1.05,
      f.destination + ' is routed ' + routedM(f).toFixed(2) + ' m for a ' +
      straightM(f).toFixed(2) + ' m straight line (ratio ' + ratio.toFixed(3) +
      ') — that is a detour, not a duct');
  }
});

test('no final doubles back on itself', () => {
  // A loop added to make a number would turn through more than 180° somewhere.
  for (const f of finals) {
    let turned = 0;
    for (let i = 2; i < f.points.length; i++) {
      const a = Math.atan2(f.points[i - 1].y - f.points[i - 2].y,
                           f.points[i - 1].x - f.points[i - 2].x);
      const b = Math.atan2(f.points[i].y - f.points[i - 1].y,
                           f.points[i].x - f.points[i - 1].x);
      turned += Math.abs(((b - a + Math.PI) % (Math.PI * 2)) - Math.PI);
    }
    assert.ok(turned < Math.PI / 2,
      f.destination + ' turns through ' + Math.round(turned * 180 / Math.PI) + '°');
  }
});

// ── The fitting is clear of the outlet it feeds ─────────────────────────────

test('no BTO sits on an outlet', () => {
  const btos = out.autoRoute.nodes.filter(n => n.type === 'bto');
  const outlets = out.autoRoute.nodes.filter(n => n.type === 'outlet');
  assert.ok(btos.length === 5, 'expected five BTOs, got ' + btos.length);
  // In metres, because a pixel means a different distance on every plan. Half a
  // metre is a diffuser and its neck; the fitting must clear that at minimum,
  // and in practice the 2.0 m rule puts it far further away.
  for (const b of btos) {
    for (const o of outlets) {
      const m = Math.hypot(b.x - o.x, b.y - o.y) / PPM / 1000;
      assert.ok(m > 0.5, b.label + ' is ' + m.toFixed(2) + ' m from ' + o.label);
    }
  }
});

test('no BTO bounding box overlaps an outlet bounding box', () => {
  // The physical items: a fabricated manifold is about 600 × 400 mm in plan, a
  // ceiling diffuser about 300 × 300 with its neck. Neither may sit in the
  // other's footprint, whatever the drawing does with its symbols.
  const boxAt = (p, wMm, hMm) => ({
    x0: p.x - (wMm / 2) * PPM, x1: p.x + (wMm / 2) * PPM,
    y0: p.y - (hMm / 2) * PPM, y1: p.y + (hMm / 2) * PPM });
  const hits = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const btos = out.autoRoute.nodes.filter(n => n.type === 'bto');
  const outlets = out.autoRoute.nodes.filter(n => n.type === 'outlet');
  for (const b of btos) {
    for (const o of outlets) {
      assert.ok(!hits(boxAt(b, 600, 400), boxAt(o, 300, 300)),
        b.label + ' overlaps ' + o.label);
    }
  }
});

// ── Everything downstream moved with it ─────────────────────────────────────

test('Main C is still a genuine measured ø400 run', () => {
  const c = sections.find(s => s.role === 'main' && s.mainKey === 'C');
  assert.ok(c, 'Main C is missing');
  assert.equal(c.diameterMm, 400);
  assert.ok(c.lengthM > 1.0, 'Main C measures ' + c.lengthM + ' m');
  assert.notEqual(c.lengthMm, null, 'Main C is not measured');
  assert.equal(c.airflowLs, 233);
});

test('the approved topology and airflow are unchanged by the rule', () => {
  const counts = out.componentCounts;
  assert.equal(counts.supplyMains, 3);
  assert.equal(counts.supplyBtos, 5);
  assert.equal(counts.supplyOutlets, 10);
  assert.equal(counts.returnBtos, 0);
  assert.equal(counts.returnGrilles, 2);
  assert.equal(counts.returnDucts, 2);
  const mainLs = Object.fromEntries(sections
    .filter(s => s.role === 'main').map(s => [s.mainKey, s.airflowLs]));
  assert.deepEqual(mainLs, { A: 301, B: 265, C: 233 });
  const armLs = sections.filter(s => s.role === 'branch')
    .map(s => ({ mm: s.diameterMm, ls: s.airflowLs }));
  assert.deepEqual(armLs, [{ mm: 350, ls: 95 }, { mm: 350, ls: 138 }]);
  // Every final still at the size and airflow it was approved at.
  const byRoom = Object.fromEntries(finals.map(f =>
    [String(f.destination), f.diameterMm + '/' + f.airflowLs]));
  assert.equal(byRoom['KITCHEN'], '250/113');
  assert.equal(byRoom['MEALS'], '250/67');
  assert.equal(byRoom['FAMILY'], '250/121');
  assert.equal(byRoom['LIVING'], '300/159');
  assert.equal(byRoom['LOUNGE'], '250/106');
  assert.equal(byRoom['FOYER'], '250/45');
  assert.equal(byRoom['MASTER BEDROOM'], '250/50');
  assert.equal(byRoom['BEDROOM 4'], '250/48');
  assert.equal(byRoom['BEDROOM 2'], '250/45');
  assert.equal(byRoom['BEDROOM 3'], '250/45');
});

test('the ductwork, pressure, BOM and price were recalculated after the move', () => {
  // Not a fixed figure — the point is that every downstream stage read the NEW
  // geometry rather than a cached one. Each of these is derived from the duct
  // lengths, so all four moving together is the evidence.
  const totalM = sections.reduce((n, s) => n + (s.lengthM || 0), 0);
  assert.ok(totalM > 40 && totalM < 70, 'total duct ' + totalM.toFixed(1) + ' m');
  assert.ok(out.pressure.estimatedRequirementPa > 0, 'no static pressure');
  assert.ok(out.bom.items.length > 0, 'no bill of materials');
  assert.ok(out.commercials.sellPriceIncGst > 0, 'no price');
  // The longest final is the one that drives the index run, and it is measured
  // off the drawing rather than estimated or entered by hand.
  const worst = finals.reduce((a, b) => (a.lengthM > b.lengthM ? a : b));
  assert.ok(worst.lengthM > 0, worst.destination + ' has no length');
  assert.ok(Number.isFinite(worst.lengthMm), worst.destination + ' is not measured');
  assert.ok(out.pressure.indexRun, 'the index run was not identified');
});

// ── The rule blocks approval when it cannot be met ──────────────────────────

test('an impossible case raises BTO_TO_OUTLET_CLEARANCE_REVIEW rather than a false number', () => {
  // Two outlets 0.3 m apart, boxed into a footprint barely bigger than they
  // are: there is nowhere inside the building that is 2.0 m from both.
  const minPx = 2.0 * 1000 * 0.05;                    // 100 px at 0.05 px/mm
  const members = [{ id: 'a', roomLabel: 'A', x: 100, y: 100, airflowLs: 50 },
                   { id: 'b', roomLabel: 'B', x: 115, y: 100, airflowLs: 50 }];
  const set = placeFittingClear({ x: 107, y: 100 }, members, {
    minFinalPx: minPx,
    footprint: { x: 90, y: 90, w: 40, h: 30 }
  });
  assert.equal(set.compliant, false, 'it claimed a compliant position that does not exist');
  assert.ok(set.shortfalls.length > 0, 'it reported no shortfall');
  // And the length it reports is the one it measured, not the one it wanted.
  for (const s of set.shortfalls) {
    assert.ok(s.lengthPx < minPx, 'a shortfall was reported at or above the minimum');
  }
});

test('when a compliant position exists it is found, and it is the cheapest one', () => {
  const minPx = 100;
  const members = [{ id: 'a', roomLabel: 'A', x: 0, y: 0, airflowLs: 50 },
                   { id: 'b', roomLabel: 'B', x: 60, y: 0, airflowLs: 50 }];
  const set = placeFittingClear({ x: 30, y: 0 }, members, {
    minFinalPx: minPx, footprint: { x: -400, y: -400, w: 800, h: 800 }
  });
  assert.equal(set.compliant, true);
  for (const m of members) {
    assert.ok(finalRunLengthPx(set.at, m) >= minPx - 1e-6,
      m.id + ' is still ' + finalRunLengthPx(set.at, m).toFixed(1) + ' px');
  }
  // Cheapest means it did not wander: no point further out is both compliant
  // and shorter in total, so the total here should be close to the theoretical
  // best of two runs at the minimum.
  const total = members.reduce((n, m) => n + finalRunLengthPx(set.at, m), 0);
  assert.ok(total < minPx * 2.35,
    'total final length ' + total.toFixed(0) + ' px against a ' +
    (minPx * 2).toFixed(0) + ' px floor — the fitting wandered');
});

test('a fitting is never moved into a wet area or the garage', () => {
  const minPx = 100;
  const members = [{ id: 'a', roomLabel: 'A', x: 0, y: 0, airflowLs: 50 },
                   { id: 'b', roomLabel: 'B', x: 60, y: 0, airflowLs: 50 }];
  // The cheapest compliant positions sit on the perpendicular bisector. Block
  // that whole corridor on one side and the fitting must take the other.
  const avoid = [{ x: -200, y: -400, w: 460, h: 400 }];
  const set = placeFittingClear({ x: 30, y: 0 }, members, {
    minFinalPx: minPx, footprint: { x: -400, y: -400, w: 800, h: 800 }, avoid });
  assert.equal(set.compliant, true);
  const inside = set.at.x >= avoid[0].x && set.at.x <= avoid[0].x + avoid[0].w &&
                 set.at.y >= avoid[0].y && set.at.y <= avoid[0].y + avoid[0].h;
  assert.equal(inside, false,
    'the fitting was placed at ' + JSON.stringify(set.at) + ', inside the excluded room');
});

test('an uncalibrated plan does not pretend to measure', () => {
  // No scale, no measured length, so the rule stands down rather than treating
  // a pixel as a millimetre. The drawing guard still applies.
  const set = placeFittingClear({ x: 10, y: 10 },
    [{ id: 'a', roomLabel: 'A', x: 10, y: 10, airflowLs: 50 }], { minFinalPx: 0 });
  assert.equal(set.compliant, true);
  assert.equal(set.moved, false);
});

// ── The warning reaches the gate that can stop the job ──────────────────────

test('routing warnings reach the approval gate', () => {
  // They were assembled in the pipeline and shown on screen, but never collected
  // into design.warnings — so a CRITICAL raised by the router, the topology
  // validator or the return-separation check counted for nothing at the
  // approval gate. BTO_TO_OUTLET_CLEARANCE_REVIEW is raised there, so it had to
  // be fixed for the rule to block anything.
  const codes = new Set((out.warnings || []).map(w => w.code));
  for (const w of (out.routeWarnings || [])) {
    assert.ok(codes.has(w.code),
      w.code + ' was raised by the router and never reached design.warnings');
  }
});

test('the approved job needs no clearance review — every fitting found a home', () => {
  const review = (out.warnings || []).filter(w => w.code === 'BTO_TO_OUTLET_CLEARANCE_REVIEW');
  assert.deepEqual(review.map(w => w.message), []);
  assert.deepEqual(out.autoRoute.btoClearanceReviews, []);
  assert.equal(out.autoRoute.minBtoToOutletDuctLengthM, 2.0);
});

// ── The return air is its own system, and a BTO is never set in it ──────────

/** Distance from a point to a polyline. */
const toPath = (p, pts) => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy;
    let t = l2 < 1e-9 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)));
  }
  return best;
};

test('R1 and R2 are two independent routes that share no duct segment', () => {
  const routes = out.returnRoutes || [];
  assert.equal(routes.length, 2, 'expected two return routes, got ' + routes.length);
  const [a, b] = routes;
  // Every point of each route, measured against the OTHER route. They meet only
  // at the fan coil, where each takes its own collar on the return plenum — so
  // away from the unit they must never come together.
  const unit = out.layout.indoorUnit || out.layout.plenum;
  const awayFromUnit = (pts) => pts.filter(q =>
    Math.hypot(q.x - unit.x, q.y - unit.y) / PPM > 1500);
  for (const q of awayFromUnit(a.points)) {
    const m = toPath(q, b.points) / PPM / 1000;
    assert.ok(m > 0.3, 'R1 runs within ' + m.toFixed(2) + ' m of R2 at ' +
      Math.round(q.x) + ',' + Math.round(q.y));
  }
  for (const q of awayFromUnit(b.points)) {
    const m = toPath(q, a.points) / PPM / 1000;
    assert.ok(m > 0.3, 'R2 runs within ' + m.toFixed(2) + ' m of R1');
  }
});

test('each return duct is its own ø400 run from its own grille', () => {
  const ducts = out.returnComponents.ducts;
  assert.equal(ducts.length, 2);
  assert.equal(new Set(ducts.map(x => x.id)).size, 2, 'the two ducts share an id');
  for (const x of ducts) assert.equal(x.diameterMm, 400);
  const grilles = out.returnComponents.grilles;
  assert.equal(grilles.length, 2);
  assert.equal(new Set(grilles.map(g => g.x + ',' + g.y)).size, 2,
    'both grilles are in the same place');
});

test('the return plenum takes both ducts on separate inlets, and is not a BTO', () => {
  const plenum = out.returnComponents.plenum;
  assert.ok(plenum, 'no return plenum');
  assert.equal(plenum.inletCount, 2);
  assert.equal(plenum.inletDiameterMm, 400);
  assert.equal(out.componentCounts.returnBtos, 0);
  assert.equal(out.componentCounts.returnJunctions, 0,
    'a junction between R1 and R2 would be a merge');
});

/**
 * The clearance a supply take-off must keep from a return duct, in metres.
 *
 * It is the sum of three real things: the ø400 return's own radius (0.20 m),
 * the half-width of a fabricated take-off body (about 0.30 m) and a gap
 * somebody can get a hand into (0.15 m). Not a round number chosen to look
 * generous — an earlier 1.0 m version pushed BTO-C2 far enough off the bedroom
 * wing to buy three and a half extra metres of flex, which is a real cost for a
 * drawing problem the label placer already solves.
 */
const RETURN_CLEARANCE_M = 0.65;

test('no supply take-off is set in the return-air corridor', () => {
  // A BTO is supply metal. One set in the corridor the return flexes occupy is
  // a clash in the roof, and on the drawing it reads as a take-off plumbed into
  // the return — which is what moved BTO-C.
  const routes = (out.returnRoutes || []).map(r => r.points);
  const btos = out.autoRoute.nodes.filter(n => n.type === 'bto');
  for (const bto of btos) {
    for (const pts of routes) {
      const m = toPath(bto, pts) / PPM / 1000;
      assert.ok(m >= RETURN_CLEARANCE_M - 0.01,
        bto.label + ' is ' + m.toFixed(2) + ' m from a return duct — a ø400 return and a ' +
        'fabricated take-off body cannot share that');
    }
  }
});

test('BTO-C is clear of the return and still downstream of a measured Main C', () => {
  const c = sections.find(s => s.role === 'main' && s.mainKey === 'C');
  assert.ok(c.lengthM >= 1.69, 'Main C shortened to ' + c.lengthM + ' m');
  const btoC = out.autoRoute.nodes.find(n => n.type === 'bto' && n.label === 'BTO-C');
  assert.ok(btoC, 'BTO-C is missing');
  const unit = out.layout.indoorUnit || out.layout.plenum;
  // Clear of the return plenum body: the unit is about 1.25 m long and the
  // plenum and its collars add roughly another 0.5 m, so anything inside about
  // 1.2 m of the unit centre is ON the equipment.
  const fromUnit = Math.hypot(btoC.x - unit.x, btoC.y - unit.y) / PPM / 1000;
  assert.ok(fromUnit > 1.3, 'BTO-C is ' + fromUnit.toFixed(2) + ' m from the unit centre');
  for (const r of (out.returnRoutes || [])) {
    const m = toPath(btoC, r.points) / PPM / 1000;
    assert.ok(m >= RETURN_CLEARANCE_M - 0.01, 'BTO-C is ' + m.toFixed(2) + ' m from ' + r.id);
  }
});
