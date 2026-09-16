// HOW MANY DUCTS LEAVE THE PLENUM — the default rule, and the checks that have
// to pass before the default is allowed to stand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendedSupplySpigotCount, validateSupplySpigots, checkPlenumCapacity,
         spigotVelocity, SPIGOT_RULE } from '../designer/engines/supply-spigots.mjs';
import { formInstallerAreas, planAreaFittings, splitInTwo, geometricMedian,
         MIN_FITTING_TO_OUTLET_PX } from '../designer/engines/area-router.mjs';

const UNIT = { model: 'FDYAN160AV1', supplyFlangeText: '245 x 1152', availableStaticPa: 160 };

// ── The table ───────────────────────────────────────────────────────────────

test('one to eight outlets defaults to two spigots', () => {
  for (const n of [1, 2, 4, 6, 7, 8]) {
    const r = recommendedSupplySpigotCount(n);
    assert.equal(r.count, 2, n + ' outlets gave ' + r.count);
    assert.equal(r.fromTable, true);
  }
});

test('nine to twelve outlets defaults to three spigots', () => {
  for (const n of [9, 10, 11, 12]) {
    assert.equal(recommendedSupplySpigotCount(n).count, 3, n + ' outlets');
  }
});

test('the eleven-outlet fixture recommends three', () => {
  const r = recommendedSupplySpigotCount(11);
  assert.equal(r.count, 3);
  assert.equal(r.basis, 'outlet_count');
});

test('past twelve outlets the table stops and a calculation starts', () => {
  const r = recommendedSupplySpigotCount(13, { systemAirflowLs: 1000 });
  assert.equal(r.requiresFreshCalculation, true);
  assert.equal(r.fromTable, false);
  assert.equal(r.basis, 'calculated');
  assert.ok(r.byAirflow > 0, 'airflow did not contribute to the calculation');
  assert.match(r.reason, /past the 12-outlet table/);
});

test('past the table, a thin calculation says it is thin instead of bluffing', () => {
  // Thirty outlets on 900 L/s comes back as two spigots on airflow alone. That
  // is arithmetically true and practically useless, so it is flagged.
  const bare = recommendedSupplySpigotCount(30, { systemAirflowLs: 900 });
  assert.equal(bare.provisional, true);
  assert.ok(bare.inputsMissing.includes('installer area count'));
  assert.match(bare.reason, /PROVISIONAL/);
  // Given the real inputs it stops being provisional and answers properly.
  const full = recommendedSupplySpigotCount(30, { systemAirflowLs: 900,
    installerAreaCount: 5, maxCollarsPerBody: 6 });
  assert.equal(full.provisional, false);
  assert.equal(full.count, 5);
  assert.equal(full.byCollarSpace, 5);
  assert.deepEqual(full.inputsMissing, []);
});

test('a big job is raised by real constraints, not by a fitting limit', () => {
  // 1600 L/s DOES fit two ø400 inside the velocity band, so airflow alone does
  // not raise this — and the old chain-reach term that used to is gone. What
  // raises it is the installer areas the job actually has.
  const airflowOnly = recommendedSupplySpigotCount(20, { systemAirflowLs: 1600 });
  assert.equal(airflowOnly.byAirflow, 2);
  assert.equal(airflowOnly.provisional, true, 'a bare figure must not look authoritative');

  const withAreas = recommendedSupplySpigotCount(20, { systemAirflowLs: 1600,
    installerAreaCount: 4, maxCollarsPerBody: 6 });
  assert.equal(withAreas.count, 4, 'twenty outlets over four areas is four mains');
  assert.equal(withAreas.byAreas, 4);
});

test('airflow past what the chosen size carries still raises the count on its own', () => {
  const r = recommendedSupplySpigotCount(20, { systemAirflowLs: 3200 });
  assert.ok(r.byAirflow >= 4, '3200 L/s cannot go down fewer than four ø400');
  assert.ok(r.count >= 4);
});

test('fitting port count never drives the spigot count', () => {
  // This used to divide the outlets by the reach of a chain of three-port
  // fittings, which only made sense while three was a rule and chaining was the
  // way past it. Neither is true, so it contributes nothing.
  const r = recommendedSupplySpigotCount(30, { systemAirflowLs: 900 });
  assert.equal(r.byFittings, 0);
  assert.doesNotMatch(r.reason, /3-port|three-port|chain/);
  assert.match(r.reason, /one BTO serves its area/);
});

test('a high-airflow job raises the count even with eight outlets', () => {
  // Eight outlets is a 2-spigot job by the table; 2400 L/s is not.
  const r = recommendedSupplySpigotCount(8, { systemAirflowLs: 2400 });
  assert.equal(r.count, 2, 'the table still governs at or under twelve outlets');
  // But the validation refuses to let two ø400 carry it.
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 1200 }, { key: 'B', airflowLs: 1200 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 2400, areaNames: ['a', 'b']
  });
  assert.equal(v.ok, false);
  assert.ok(v.blockers.some(b => b.code === 'MAIN_OVER_VELOCITY'),
    '1200 L/s in a ø400 is 9.5 m/s and was accepted');
});

// ── Physical plenum capacity ────────────────────────────────────────────────

test('the plenum check reads the real discharge flange', () => {
  const p = checkPlenumCapacity({ count: 3, diameterMm: 400, unit: UNIT });
  assert.equal(p.verified, true);
  assert.equal(p.flangeWidthMm, 1152);
  assert.equal(p.collarRowMm, 3 * 400 + 2 * SPIGOT_RULE.collarGapMm);
  assert.equal(p.fitsInOneRow, false);
});

test('two collars do fit the same discharge', () => {
  const p = checkPlenumCapacity({ count: 2, diameterMm: 400, unit: UNIT });
  assert.equal(p.fitsInOneRow, true);
});

test('no flange data means UNVERIFIED, never a guess', () => {
  const p = checkPlenumCapacity({ count: 3, diameterMm: 400, unit: { model: 'X' } });
  assert.equal(p.verified, false);
  assert.equal(p.ok, null);
  assert.match(p.note, /UNVERIFIED/);
});

test('equipment that cannot take the collars raises a warning', () => {
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 300 }, { key: 'B', airflowLs: 260 }, { key: 'C', airflowLs: 239 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, areaNames: ['a', 'b', 'c']
  });
  assert.ok(v.warnings.some(w => w.code === 'PLENUM_COLLARS_DO_NOT_FIT_ONE_ROW'));
});

// ── Pressure and reconciliation ─────────────────────────────────────────────

test('pressure over the verified available static is a blocker', () => {
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 400 }, { key: 'B', airflowLs: 399 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, pressurePa: 200, areaNames: ['a', 'b']
  });
  assert.ok(v.blockers.some(b => b.code === 'OVER_AVAILABLE_STATIC'));
});

test('pressure with no verified static is reported unverified, not passed', () => {
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 400 }, { key: 'B', airflowLs: 399 }],
    diameterMm: 400, unit: { model: 'X' }, outletTotalLs: 799, pressurePa: 200,
    areaNames: ['a', 'b']
  });
  assert.ok(v.warnings.some(w => w.code === 'AVAILABLE_STATIC_UNVERIFIED'));
  assert.ok(!v.blockers.some(b => b.code === 'OVER_AVAILABLE_STATIC'),
    'a figure was failed against a limit that does not exist');
});

test('main airflow and outlet airflow always reconcile', () => {
  const ok = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 301 }, { key: 'B', airflowLs: 265 }, { key: 'C', airflowLs: 233 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, areaNames: ['a', 'b', 'c']
  });
  assert.equal(ok.totalLs, 799);
  assert.equal(ok.differenceLs, 0);
  const bad = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 301 }, { key: 'B', airflowLs: 265 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, areaNames: ['a', 'b']
  });
  assert.ok(bad.blockers.some(b => b.code === 'MAINS_DO_NOT_RECONCILE'));
});

test('an installer override is preserved and still told the truth', () => {
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 301 }, { key: 'B', airflowLs: 265 }, { key: 'C', airflowLs: 233 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, manualOverride: true,
    areaNames: ['a', 'b', 'c']
  });
  assert.equal(v.count, 3, 'the installer choice was overruled');
  assert.ok(v.warnings.some(w => w.code === 'SPIGOT_COUNT_INSTALLER_APPROVED'));
  assert.ok(v.warnings.some(w => w.code === 'MAIN_BELOW_PREFERRED_VELOCITY'),
    'the low velocities were hidden because a person chose the split');
});

test('velocity is calculated and shown for every main', () => {
  const v = validateSupplySpigots({
    mains: [{ key: 'A', airflowLs: 301 }, { key: 'B', airflowLs: 265 }, { key: 'C', airflowLs: 233 }],
    diameterMm: 400, unit: UNIT, outletTotalLs: 799, areaNames: ['a', 'b', 'c']
  });
  assert.deepEqual(v.rows.map(r => r.velocityMs), [2.4, 2.11, 1.85]);
  assert.equal(spigotVelocity(400, 400), 3.18);
});

// ── Area forming ────────────────────────────────────────────────────────────

const pt = (x, y, ls, extra = {}) => ({ x, y, airflowLs: ls, roomId: 'r' + x + y,
  roomLabel: 'R' + x, ...extra });

test('areas are formed from what the rooms are, then split on position', () => {
  const pts = [
    pt(100, 100, 150, { openPlan: true }), pt(120, 400, 110, { openPlan: true }),
    pt(500, 150, 100, { openPlan: true }), pt(140, 600, 60, { openPlan: true }),
    pt(800, 900, 50, { roomType: 'bedroom' }), pt(820, 1000, 45, { roomType: 'bedroom' })
  ];
  const two = formInstallerAreas(pts, 2);
  assert.equal(two.length, 2);
  const three = formInstallerAreas(pts, 3);
  assert.equal(three.length, 3, 'the biggest area was not subdivided for a third main');
  // No outlet is lost or duplicated.
  assert.equal(three.flat().length, pts.length);
  assert.equal(new Set(three.flat()).size, pts.length);
});

test('a heavy open plan is split rather than left on one main', () => {
  const pts = [
    pt(100, 100, 200, { openPlan: true }), pt(120, 400, 200, { openPlan: true }),
    pt(500, 150, 200, { openPlan: true }),
    pt(800, 900, 50, { roomType: 'bedroom' })
  ];
  const three = formInstallerAreas(pts, 3);
  const flows = three.map(a => a.reduce((n, o) => n + o.airflowLs, 0));
  assert.equal(three.length, 3);
  assert.ok(Math.max(...flows) < 600, 'one main still carries the whole open plan');
});

test('an area gets ONE fitting with every outlet direct off it', () => {
  const plenum = { x: 400, y: 600 };
  const outlets = [pt(200, 600, 60), pt(260, 520, 60), pt(210, 410, 113), pt(400, 430, 67)];
  const plan = planAreaFittings(outlets, plenum);
  assert.equal(plan.onward, null, 'a secondary fitting was planned');
  assert.equal(plan.direct.length, 4, 'four outlets must all hang off the one body');
});

test('the median beats the centroid — one far outlet does not drag the fitting', () => {
  // Three outlets bunched, one a long way off. The centroid is pulled a third
  // of the way to the outlier; the geometric median stays with the bunch, and
  // the summed distance it minimises IS the total flex length.
  const pts = [{ x: 200, y: 600 }, { x: 210, y: 610 }, { x: 205, y: 590 }, { x: 900, y: 600 }];
  const med = geometricMedian(pts);
  const centroid = { x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
                     y: pts.reduce((n, p) => n + p.y, 0) / pts.length };
  const total = (at) => pts.reduce((n, p) => n + Math.hypot(at.x - p.x, at.y - p.y), 0);
  assert.ok(total(med) < total(centroid), 'the median is no shorter than the centroid');
  assert.ok(Math.hypot(med.x - 205, med.y - 600) < 30, 'the median chased the outlier');
  assert.ok(Math.hypot(centroid.x - 205, centroid.y - 600) > 100,
    'the centroid did not move, so this case proves nothing');
});

test('the ø400 main is what the weighting keeps short', () => {
  const plenum = { x: 400, y: 600 };
  const outlets = [pt(150, 1000, 45), pt(400, 1100, 45), pt(650, 1000, 45)];
  const mainLen = (mm) => {
    const at = planAreaFittings(outlets, plenum, { mainDiameterMm: mm }).at;
    return Math.hypot(at.x - plenum.x, at.y - plenum.y);
  };
  // The bigger the main, the more it is worth walking the fitting back toward
  // the plenum and spending the distance on the small finals instead.
  assert.ok(mainLen(400) < mainLen(300), 'a ø400 main did not pull the fitting in');
  assert.ok(mainLen(300) < mainLen(250), 'a ø300 main did not pull the fitting in');
});

test('a fitting never lands on top of an outlet and emit a zero-length run', () => {
  const plenum = { x: 400, y: 600 };
  // A single outlet plus the plenum: the median wants to sit on one of them.
  const outlets = [pt(300, 700, 60), pt(300, 700, 60), pt(300, 700, 60)];
  const plan = planAreaFittings(outlets, plenum);
  for (const o of plan.direct) {
    assert.ok(Math.hypot(plan.at.x - o.x, plan.at.y - o.y) >= MIN_FITTING_TO_OUTLET_PX - 0.5,
      'the fitting sits on an outlet, so that run has no length');
  }
});

test('the fitting never lands outside the conditioned footprint', () => {
  const plenum = { x: 400, y: 600 };
  const outlets = [pt(120, 200, 60), pt(900, 1000, 60)];
  const footprint = { x: 100, y: 150, w: 850, h: 900 };
  const plan = planAreaFittings(outlets, plenum, { footprint });
  assert.ok(plan.at.x >= footprint.x && plan.at.x <= footprint.x + footprint.w);
  assert.ok(plan.at.y >= footprint.y && plan.at.y <= footprint.y + footprint.h);
});

test('splitInTwo splits on the line the outlets actually spread along', () => {
  const [A, B] = splitInTwo([pt(0, 0, 10), pt(10, 0, 10), pt(500, 0, 10), pt(510, 0, 10)]);
  assert.equal(A.length, 2);
  assert.equal(B.length, 2);
});
