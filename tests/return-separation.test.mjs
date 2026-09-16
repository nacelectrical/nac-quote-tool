// RETURN AIR IS NOT SUPPLY AIR, AND A RETURN JUNCTION IS NOT A BTO.
//
// Nick: "Critical correction: return air must never be represented or counted
// as a BTO. A BTO is a supply-air distribution fitting only."
//
// The failure mode these guard against is a quiet one. Anything that derives
// fittings by looking for ducts leaving other ducts will find two return runs
// meeting at the fan coil and call it a manifold, because geometrically that is
// exactly what it looks like. Every assertion below is about keeping the two
// sides of the system from being confused for one another.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproved } from './fixtures/approved-job.mjs';
import { RETURN_COMPONENT, buildReturnComponents, validateReturnSeparation,
         returnComponentCounts, returnBomLines } from '../designer/engines/return-model.mjs';
import { deriveBtos, isReturnSection } from '../designer/engines/bto.mjs';

const { out } = await buildApproved();

// ── The shape of the return side ────────────────────────────────────────────

test('the return is two grilles, two ducts and one fan-coil box', () => {
  const rc = out.returnComponents;
  assert.equal(rc.grilles.length, 2);
  assert.equal(rc.ducts.length, 2);
  assert.ok(rc.plenum, 'there is no return-air plenum entity at all');
  assert.equal(rc.plenum.kind, RETURN_COMPONENT.PLENUM);
  assert.equal(rc.plenum.inletCount, 2);
});

test('each grille has its own duct, and both ducts end at the fan-coil box', () => {
  const rc = out.returnComponents;
  const from = rc.ducts.map(d => d.fromGrilleId);
  assert.deepEqual(from.slice().sort(), rc.grilles.map(g => g.id).sort());
  assert.equal(new Set(from).size, 2, 'two ducts share one grille');
  for (const d of rc.ducts) {
    assert.equal(d.terminatesAt, rc.plenum.id);
    assert.equal(d.parentBtoId, null);
    assert.equal(d.diameterMm, 400);
  }
});

test('both return grilles are 600 x 400 carrying their own air', () => {
  for (const g of out.returnComponents.grilles) {
    assert.equal(g.grilleSize, '600 × 400 mm');
    assert.equal(g.airflowLs, 400);
  }
});

// ── A BTO is a supply fitting. Full stop. ──────────────────────────────────

test('no BTO exists anywhere on the return path', () => {
  const sep = out.returnSeparation;
  assert.equal(sep.checked, true, 'the separation check never ran');
  assert.equal(sep.ok, true, JSON.stringify(sep.failures));
  assert.equal(sep.counts.returnBtos, 0);
});

test('BTO entities exist only on the supply-air graph', () => {
  const returnIds = new Set([
    out.returnComponents.plenum.id,
    ...out.returnComponents.grilles.map(g => g.id),
    ...out.returnComponents.ducts.map(d => d.id)
  ]);
  for (const b of out.btos) {
    assert.ok(!returnIds.has(b.id), b.id + ' is a fitting on the return side');
    assert.ok(!returnIds.has(b.fedBy), b.id + ' is fed from the return side');
    for (const p of b.ports) {
      assert.ok(!returnIds.has(p.sectionId),
        b.id + ' port ' + p.index + ' is a return duct');
      // Every port on this fixture ends at a supply outlet, nothing else.
      assert.ok(p.servesOutletId, b.id + ' port ' + p.index + ' is not an outlet duct');
    }
  }
});

test('a return grille cannot be assigned to a BTO', () => {
  for (const g of out.returnComponents.grilles) {
    assert.equal(g.isBto, false);
    assert.equal(g.feedsBtoId, null);
  }
  // And if something did assign one, the check has to catch it.
  const rigged = {
    ...out.returnComponents,
    grilles: out.returnComponents.grilles.map((g, i) =>
      i === 0 ? { ...g, isBto: true, feedsBtoId: 'bto_1' } : g)
  };
  const v = validateReturnSeparation({ returnComponents: rigged, btos: out.btos });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some(f => f.code === 'RETURN_GRILLE_ASSIGNED_TO_BTO'));
});

test('a return duct hung off a fitting is caught, not accepted', () => {
  const rigged = {
    ...out.returnComponents,
    ducts: out.returnComponents.ducts.map((d, i) =>
      i === 0 ? { ...d, terminatesAt: 'bto_1', parentBtoId: 'bto_1' } : d)
  };
  const v = validateReturnSeparation({ returnComponents: rigged, btos: out.btos });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some(f => f.code === 'RETURN_DUCT_DOES_NOT_END_AT_PLENUM'));
  assert.ok(v.failures.some(f => f.code === 'RETURN_DUCT_ON_A_BTO'));
});

test('the return junction geometry does not become a manifold', () => {
  // Two returns meeting at the unit is the exact shape that used to be derived
  // as a three-port fitting.
  const net = { sections: [
    { id: 'return', role: 'return', diameterMm: 400, airflowLs: 800,
      points: [{ x: 400, y: 600 }, { x: 400, y: 800 }] },
    { id: 'return_2', parentId: 'return', role: 'return', diameterMm: 400,
      airflowLs: 400, points: [{ x: 400, y: 600 }, { x: 300, y: 780 }] },
    { id: 'return_3', parentId: 'return', role: 'return', diameterMm: 400,
      airflowLs: 400, points: [{ x: 400, y: 600 }, { x: 300, y: 940 }] }
  ] };
  assert.deepEqual(deriveBtos(net), []);
});

// ── Dampers ────────────────────────────────────────────────────────────────

test('no return ever receives a zone damper', () => {
  for (const item of [...out.returnComponents.grilles, ...out.returnComponents.ducts]) {
    assert.equal(item.zoneDamper, false, item.id + ' has a zone damper');
  }
  for (const r of (out.returnRoutes || [])) {
    assert.ok(!r.zone, r.id + ' carries a zone, so a damper would be fitted to it');
  }
  const returnIds = new Set((out.returnRoutes || []).map(r => r.id));
  for (const d of (out.zoneDampers || [])) {
    assert.ok(!returnIds.has(d.sectionId),
      'a zone damper was placed on return duct ' + d.sectionId);
  }
});

test('a zone on a return duct is reported as a fault', () => {
  const v = validateReturnSeparation({
    returnComponents: out.returnComponents,
    btos: out.btos,
    network: { sections: [{ id: 'return', role: 'return', zone: 'BEDROOM 2' }] }
  });
  assert.equal(v.ok, false);
  assert.ok(v.failures.some(f => f.code === 'ZONE_DAMPER_ON_RETURN'));
});

// ── Counts ─────────────────────────────────────────────────────────────────

test('the returns are absent from every supply count', () => {
  const c = out.componentCounts;
  assert.equal(c.supplySpigots, 3);
  assert.equal(c.supplyMains, 3);
  assert.equal(c.supplyBtos, 3);
  assert.deepEqual(c.supplyBtoPorts, [4, 2, 5]);
  assert.equal(c.supplyBtoPortTotal, 11, 'a return leaked into the port total');
  assert.equal(c.supplyOutlets, 11);
  assert.equal(c.returnGrilles, 2);
  assert.equal(c.returnDucts, 2);
  assert.equal(c.returnPlenums, 1);
  assert.equal(c.returnBtos, 0);
});

test('the supply BTO port total counts outlets, not returns', () => {
  const ports = out.btos.reduce((n, b) => n + b.ports.length, 0);
  assert.equal(ports, out.componentCounts.supplyOutlets);
  assert.equal(ports, 11);
});

test('returnComponentCounts never reports a return BTO, whatever it is given', () => {
  assert.equal(returnComponentCounts(null).returnBtos, 0);
  assert.equal(returnComponentCounts({ grilles: [], ducts: [] }).returnBtos, 0);
  assert.equal(returnComponentCounts(out.returnComponents).returnBtos, 0);
});

// ── The order ──────────────────────────────────────────────────────────────

test('the order keeps return components in their own category', () => {
  const returns = out.bom.items.filter(i => i.category === 'return');
  assert.ok(returns.length > 0, 'nothing is categorised as return air');
  for (const i of returns) {
    assert.notEqual(i.key, 'bto_fitting', 'a BTO was priced as a return item');
    assert.equal(i.airSide, 'return');
  }
  const btoLines = out.bom.items.filter(i => i.key === 'bto_fitting');
  for (const i of btoLines) {
    assert.equal(i.airSide, 'supply');
    assert.equal(i.category, 'ductwork');
    assert.match(i.note, /never a return-air component/);
  }
});

test('the order carries ONE fan-coil return box, not one per grille', () => {
  const box = out.bom.items.filter(i => i.key === 'return_plenum');
  assert.equal(box.length, 1);
  assert.equal(box[0].quantity, 1, 'the return box was bought once per grille');
  assert.match(box[0].label, /2 × ø400 inlet/);
  assert.match(box[0].note, /Not a BTO/);
});

test('the order buys three supply fittings and two return grilles', () => {
  const fittings = out.bom.items.filter(i => i.key === 'bto_fitting')
    .reduce((n, i) => n + i.quantity, 0);
  const grilles = out.bom.items.filter(i => i.key === 'return_grille')
    .reduce((n, i) => n + i.quantity, 0);
  assert.equal(fittings, 3);
  assert.equal(grilles, 2);
});

test('return BOM lines are their own set and contain no fitting', () => {
  const lines = returnBomLines(out.returnComponents);
  assert.ok(lines.length >= 3);
  for (const l of lines) {
    assert.equal(l.airSide, 'return');
    assert.equal(l.category, 'return_air');
    assert.ok(!/bto/i.test(l.key + ' ' + l.label), l.label + ' names a BTO');
  }
});

// ── The separation holds for a bare design too ─────────────────────────────

test('a design with no return still reports zero return BTOs rather than nothing', () => {
  const rc = buildReturnComponents({ returnDesign: null, returnRoutes: [] });
  assert.equal(rc.grilles.length, 0);
  assert.equal(rc.ducts.length, 0);
  assert.equal(returnComponentCounts(rc).returnBtos, 0);
  const v = validateReturnSeparation({ returnComponents: rc, btos: [] });
  assert.equal(v.ok, true);
});

test('isReturnSection is what keeps the two graphs apart', () => {
  for (const r of (out.returnRoutes || [])) {
    assert.equal(isReturnSection(r), true, r.id + ' is not recognised as a return');
  }
  for (const s of out.network.sections) {
    assert.equal(isReturnSection(s), false, s.id + ' was mistaken for a return');
  }
});

// ── Where the two systems cross ────────────────────────────────────────────

test('supply/return crossings are found and named, not quietly overlapped', () => {
  const c = out.supplyReturnClashes;
  assert.equal(c.checked, true, 'the clash check never ran');
  // This layout has exactly one, out in the roof: the Bedroom 2 final crosses
  // the R1 return duct. It is reported so it can be allowed for on site.
  assert.equal(c.count, 1);
  assert.equal(c.clashes[0].supplyId, 'final_outlet_room_bedroom_2');
  assert.equal(c.clashes[0].returnId, 'return');
  assert.match(c.clashes[0].message, /pass under the other/);
  const warned = (out.routeWarnings || []).find(w => w.code === 'SUPPLY_RETURN_CROSSING');
  assert.ok(warned, 'the crossing never reached the estimator');
});

test('mains leaving the fan coil while returns arrive at it is not a clash', () => {
  // Every main leaves the plenum and every return lands on it, so they meet
  // there by definition. Counting that would bury the one real crossing.
  const ids = out.supplyReturnClashes.clashes.map(c => c.supplyId);
  for (const id of ['main_A', 'main_B', 'main_C']) {
    assert.ok(!ids.includes(id), id + ' was reported as clashing at the fan coil');
  }
});
