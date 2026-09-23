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

// ── THE WING NO LONGER STAGES, BECAUSE IT NO LONGER HAS TO ────────────────
//
// A four-outlet bedroom wing used to split into two local two-port fittings.
// That was the right answer while a BTO was something fabricated to order: any
// inlet, any port count. Nick: "use only what ive given" — and nothing NAC
// stock takes a ø300 or a ø250 inlet, so a local fitting on a branch arm is
// not a part that can be bought. A ø400 main reaches three outlets.
//
// So the router caps each area at three and moves the fourth room, whole, to
// the nearest area with room for it. The wing has three outlets and stages
// nothing, and the house comes out 3/3/3 — every main assembled from stocked
// parts, which the four-outlet version never could be.
test('no area is given more outlets than its fittings reach', () => {
  const mains = H.out.network.sections.filter(s => !s.parentId && s.role === 'main');
  for (const m of mains) {
    const serves = String(m.serves || '').split(/\s*[+/]\s*/).filter(Boolean);
    assert.ok(serves.length <= 3, m.mainKey + ' carries ' + serves.length + ' rooms');
  }
  assert.equal(H.out.autoRoute.distributionDecisions.filter(d => d.staged).length, 0,
    'an area staged into local fittings that cannot be bought');
});

test('every main is assembled from parts NAC stock', () => {
  const asm = H.out.fittingAssembly;
  assert.equal(asm.ok, true, asm.summary);
  assert.equal(asm.rows.length, 3);
  for (const r of asm.rows) {
    assert.equal(r.buildable, true, r.mainKey + ': ' + r.reason);
    assert.equal(r.outletCount, 3);
    assert.ok(r.parts.length, r.mainKey + ' has no parts list');
    for (const p of r.parts) assert.match(p.code, /^MMA/);
  }
});

test('three fittings, one per main, and no chain', () => {
  assert.equal(H.out.btos.length, 3);
  assert.equal(H.out.btoValidation.ok, true);
  assert.equal(H.out.btoValidation.chained, false);
  assert.equal(H.out.btoValidation.arbitraryChainPorts, 0);
  assert.equal(H.out.btoValidation.intentionalDistributionPorts, 0);
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
