// THE ROUTER FINDS A DISTRIBUTION FITTING WHEN THE GEOMETRY WANTS ONE.
//
// The staged structure — a distribution BTO, two arms, two local BTOs — only
// ever got built when a job spelled it out by room name. So a wing of four
// bedrooms in two obvious pairs came out as one remote four-collar body with
// four long branches reaching back to it, and the only way to get the fitting
// an installer would actually set was to type the arms in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreeAreaHouse } from './fixtures/three-area-house.mjs';
import { planDistributionArms } from '../designer/engines/area-router.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const H = await buildThreeAreaHouse();

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER — distribution fittings and local BTOs, found rather than configured
// ═══════════════════════════════════════════════════════════════════════════

const WING = [
  { id: 'm',  roomLabel: 'MASTER BEDROOM', x: 70,  y: 288, airflowLs: 96 },
  { id: 'b2', roomLabel: 'BEDROOM 2',      x: 145, y: 297, airflowLs: 70 },
  { id: 'b3', roomLabel: 'BEDROOM 3',      x: 124, y: 189, airflowLs: 57 },
  { id: 'b4', roomLabel: 'BEDROOM 4',      x: 245, y: 298, airflowLs: 61 }
];
const PLENUM = { x: 217, y: 192 };
const FOOTPRINT = { x: 20, y: 30, w: 370, h: 390 };

test('the port preference is three, and it is a preference', () => {
  assert.equal(DEFAULT_SETTINGS.duct.preferredMaxDirectOutletPortsPerLocalBto, 3);
  // It decides when to ASK, never whether a fitting may be built.
  assert.equal(DEFAULT_SETTINGS.duct.btoPortCapacity ?? null, null);
});

test('four outlets in two clear pairs become a distribution fitting and two locals', () => {
  const r = planDistributionArms(WING, PLENUM, { footprint: FOOTPRINT });
  assert.ok(r, 'the wing stayed as one four-collar fitting');
  assert.equal(r.arms.length, 2);
  const pairs = r.arms.map(a => a.map(o => o.id).sort().join('+')).sort();
  assert.deepEqual(pairs, ['b2+b4', 'b3+m'], 'the pairs are not the two spatial groups');
  assert.ok(r.arms.every(a => a.length === 2));
  assert.ok(r.separationPx > r.spreadPx, 'the groups are not separated');
  assert.ok(r.stagedCost <= r.flatCost * 1.15);
});

test('three outlets are left on one fitting', () => {
  assert.equal(planDistributionArms(WING.slice(0, 3), PLENUM, { footprint: FOOTPRINT }), null);
});

test('raising the preference to four leaves the wing on one fitting', () => {
  assert.equal(planDistributionArms(WING, PLENUM,
    { footprint: FOOTPRINT, preferredMaxDirectOutletPorts: 4 }), null);
});

test('an even scatter is not split into two arms', () => {
  // Four outlets evenly around one point: one group, not two.
  const scatter = [
    { id: 'a', roomLabel: 'A', x: 180, y: 260, airflowLs: 80 },
    { id: 'b', roomLabel: 'B', x: 220, y: 260, airflowLs: 80 },
    { id: 'c', roomLabel: 'C', x: 180, y: 300, airflowLs: 80 },
    { id: 'd', roomLabel: 'D', x: 220, y: 300, airflowLs: 80 }
  ];
  assert.equal(planDistributionArms(scatter, PLENUM, { footprint: FOOTPRINT }), null);
});

test('nothing in the router knows this plan', () => {
  // The decision is made from the outlets handed to it: shift the whole wing
  // and the same two pairs come back, which a hardcoded answer could not do.
  const moved = WING.map(o => ({ ...o, x: o.x + 137, y: o.y - 61 }));
  const r = planDistributionArms(moved, { x: PLENUM.x + 137, y: PLENUM.y - 61 },
    { footprint: { x: 157, y: -31, w: 370, h: 390 } });
  assert.ok(r);
  assert.deepEqual(r.arms.map(a => a.map(o => o.id).sort().join('+')).sort(),
                   ['b2+b4', 'b3+m']);
});

// ═══════════════════════════════════════════════════════════════════════════
// THE WHOLE PLAN — three areas, five fittings, found from geometry
// ═══════════════════════════════════════════════════════════════════════════

test('a three-area house routes to three ø400 mains, one per area', () => {
  const mains = H.out.network.sections.filter(s => !s.parentId && s.role === 'main');
  assert.equal(mains.length, 3);
  assert.deepEqual(mains.map(s => s.diameterMm), [400, 400, 400]);
  assert.equal(mains.reduce((n, s) => n + s.airflowLs, 0), H.out.airflow.allocatedAirflowLs);
  // One area each: no room's outlets are split across two mains.
  const roomsPerMain = mains.map(s => new Set(s.serves));
  for (let i = 0; i < roomsPerMain.length; i++) {
    for (let j = i + 1; j < roomsPerMain.length; j++) {
      for (const r of roomsPerMain[i]) assert.ok(!roomsPerMain[j].has(r), r + ' is on two mains');
    }
  }
});

test('the bedroom wing stages itself into two local two-port fittings', () => {
  const wing = H.out.autoRoute.distributionDecisions.find(d => d.staged);
  assert.ok(wing, 'no area staged');
  assert.equal(wing.outlets, 4);
  assert.equal(wing.arms.length, 2);
  assert.ok(wing.arms.every(a => a.outlets === 2 && a.auto));
  assert.deepEqual(wing.arms.map(a => a.label).sort(),
    ['BEDROOM 2 / BEDROOM 4', 'MASTER BEDROOM / BEDROOM 3']);
  assert.match(wing.basis, /above the preferred 3 direct collars/);
});

test('five fittings, two intentional distribution ports and no chain', () => {
  assert.equal(H.out.btos.length, 5);
  assert.equal(H.out.btoValidation.ok, true);
  assert.equal(H.out.btoValidation.chained, false);
  assert.equal(H.out.btoValidation.arbitraryChainPorts, 0);
  assert.equal(H.out.btoValidation.intentionalDistributionPorts, 2);
  // No local BTO sits on an outlet: every final clears the 2 m rule.
  const minM = H.out.network.minBtoToOutletDuctLengthM ?? 2.0;
  for (const f of H.out.network.sections.filter(s => s.role === 'final')) {
    assert.ok(f.lengthM >= minM - 0.01,
      f.destination + ' is ' + f.lengthM + ' m from its fitting');
  }
});

test('the constant zone has no motorised damper and every other zone has one', () => {
  const zones = H.out.zones.zones;
  assert.equal(zones.length, 6);
  const constant = zones.find(z => z.kind === 'common');
  assert.ok(constant, 'no constant zone');
  const damperZones = new Set((H.out.zoneDampers || []).map(d => d.zone));
  assert.equal(damperZones.size, 5);
  for (const r of constant.rooms || []) {
    assert.ok(!damperZones.has(r.label || r), (r.label || r) + ' has a damper on the constant zone');
  }
});
