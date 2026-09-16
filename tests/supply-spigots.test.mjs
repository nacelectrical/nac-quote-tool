// HOW MANY DUCTS LEAVE THE PLENUM — the default rule, and the checks that have
// to pass before the default is allowed to stand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendedSupplySpigotCount, validateSupplySpigots, checkPlenumCapacity,
         spigotVelocity, SPIGOT_RULE } from '../designer/engines/supply-spigots.mjs';
import { formInstallerAreas, planAreaFittings, splitInTwo } from '../designer/engines/area-router.mjs';
import { MAX_PORTS_PER_BTO } from '../designer/engines/bto.mjs';

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
  assert.ok(r.byAirflow >= 0 && r.byFittings > 0);
  assert.match(r.reason, /past the 12-outlet table/);
});

test('a big thirteen-outlet job is not left sitting on three', () => {
  // Twenty outlets cannot be reached by three chains of three-port fittings.
  const r = recommendedSupplySpigotCount(20, { systemAirflowLs: 1600 });
  assert.ok(r.count > 3, 'twenty outlets still returned ' + r.count);
  assert.equal(r.byFittings, Math.ceil(20 / ((MAX_PORTS_PER_BTO - 1) + MAX_PORTS_PER_BTO)));
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

test('the fitting plan never exceeds the port limit and never doubles back', () => {
  const plenum = { x: 400, y: 600 };
  const outlets = [pt(200, 600, 60), pt(260, 520, 60), pt(210, 410, 113), pt(400, 430, 67)];
  const plan = planAreaFittings(outlets, plenum);
  // primary keeps at most maxPorts - 1 when it has to carry on
  assert.ok(plan.direct.length <= MAX_PORTS_PER_BTO - 1 || !plan.onward);
  assert.ok(plan.onward, 'four outlets should need a second fitting');
  // and the primary serves the half NEAREST the plenum, so the spur runs away
  // from the unit rather than back past it
  const dPrimary = Math.hypot(plan.at.x - plenum.x, plan.at.y - plenum.y);
  const dSecondary = Math.hypot(plan.onward.at.x - plenum.x, plan.onward.at.y - plenum.y);
  assert.ok(dSecondary > dPrimary,
    'the secondary fitting is closer to the unit than the primary — that is backtracking');
});

test('splitInTwo splits on the line the outlets actually spread along', () => {
  const [A, B] = splitInTwo([pt(0, 0, 10), pt(10, 0, 10), pt(500, 0, 10), pt(510, 0, 10)]);
  assert.equal(A.length, 2);
  assert.equal(B.length, 2);
});
