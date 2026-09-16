// THE BTO IS A PHYSICAL FITTING — the nine conditions Nick set, plus the ones
// that came out of approving this job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBto, deriveBtos, validateBtos, reconcileBto, btoBomLines,
         DEFAULT_PORT_CAPACITY, btoBodyGeometry, isReturnSection }
  from '../designer/engines/bto.mjs';
import { PLACEMENT, OUTLET_SOURCE, assessPlacement } from '../designer/engines/placement.mjs';
import { selectDiameter } from '../designer/engines/ducts.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { DUNGANNON } from './fixtures/dungannon.mjs';
import { buildApproved, APPROVED_OUTLETS, FAN_COIL } from './fixtures/approved-job.mjs';

const D = await buildApproved();
const out = D.out;
const btos = out.btos;

// ── 1. A BTO is a physical multi-branch fitting ─────────────────────────────

test('a BTO is a physical multi-branch fitting, not a label', () => {
  assert.ok(btos.length > 0, 'the job produced no fittings at all');
  for (const b of btos) {
    assert.equal(b.kind, 'bto_fitting');
    assert.ok(b.inletDiameterMm > 0, b.id + ' has no inlet duct');
    assert.ok(b.inletAirflowLs > 0, b.id + ' carries no air');
    assert.ok(b.ports.length >= 2,
      b.id + ' has ' + b.ports.length + ' port — a single take-off is a collar, not a manifold');
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), b.id + ' is nowhere');
  }
});

// ── 2. Individual outlets are not labelled as BTOs ──────────────────────────

test('individual outlets are never labelled as BTOs', () => {
  const outletCount = out.outlets.totals.total;
  assert.equal(outletCount, 11);
  assert.ok(btos.length < outletCount,
    'there are as many fittings as outlets — that is the old one-BTO-per-outlet defect');
  // No fitting is named after a room, and no outlet carries a BTO number.
  for (const b of btos) assert.match(b.id, /^bto_\d+$/);
  for (const s of out.network.sections.filter(x => x.role === 'final')) {
    assert.ok(!/^BTO/i.test(String(s.destination)),
      'a final flex is described as a BTO: ' + s.destination);
  }
});

// ── 3. One BTO can serve several outlets ────────────────────────────────────

test('one BTO serves several outlets', () => {
  const multi = btos.filter(b => b.ports.filter(p => p.servesOutletId).length >= 2);
  assert.ok(multi.length >= 1, 'no fitting serves more than one outlet');
  const served = btos.reduce((n, b) => n + b.ports.filter(p => p.servesOutletId).length, 0);
  assert.ok(served >= 10, 'only ' + served + ' outlets are fed from a manifold');
});

// ── 4. The fan coil connects to mains BEFORE the BTOs ───────────────────────

test('the fan coil feeds mains, and the mains feed the BTOs', () => {
  const byId = new Map(out.network.sections.map(s => [s.id, s]));
  const mains = out.network.sections.filter(s => !s.parentId && s.role !== 'return');
  assert.equal(mains.length, 3, 'the plenum should carry the three approved mains');
  for (const b of btos) {
    // Walk up from the fitting's feed: it must reach a main, never an outlet.
    let cur = byId.get(b.fedBy);
    let hops = 0;
    while (cur?.parentId && hops < 12) { cur = byId.get(cur.parentId); hops++; }
    assert.ok(cur && !cur.parentId, b.id + ' is not connected back to a main');
    assert.notEqual(cur.role, 'final', b.id + ' hangs off a final flex');
  }
});

// ── 5. Branch ducts begin downstream of their assigned BTO ──────────────────

test('every branch duct begins downstream of its fitting', () => {
  const byId = new Map(out.network.sections.map(s => [s.id, s]));
  for (const b of btos) {
    for (const p of b.ports) {
      if (!p.sectionId) continue;
      const run = byId.get(p.sectionId);
      assert.ok(run, b.id + ' port ' + p.index + ' names a section that does not exist');
      assert.equal(run.parentId, b.fedBy,
        b.id + ' port ' + p.index + ' does not leave the duct the fitting sits on');
      const at = run.points[0];
      assert.ok(Math.hypot(at.x - b.x, at.y - b.y) < 40,
        b.id + ' port ' + p.index + ' starts away from the fitting');
    }
  }
});

// ── 6. BTO airflow equals the sum of downstream airflows ────────────────────

test('BTO airflow equals the sum of everything downstream of it', () => {
  for (const b of btos) {
    const r = reconcileBto(b);
    assert.ok(r.ok, b.id + ': ' + r.inletAirflowLs + ' in, ' + r.downstreamSumLs + ' out');
    if (r.differenceLs !== 0) assert.ok(r.rounding, b.id + ' is out by more than rounding');
  }
});

test('a fitting whose air does not add up is reported, not accepted', () => {
  const bad = makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
    inletDiameterMm: 300, inletAirflowLs: 300,
    ports: [{ sectionId: 'a', diameterMm: 250, airflowLs: 100, servesOutletId: 'o1' }] });
  const v = validateBtos([bad]);
  assert.equal(v.ok, false);
  assert.ok(v.failures.some(f => f.code === 'AIRFLOW_DOES_NOT_RECONCILE'));
});

// ── 7. Duct sizes reflect the airflow each section carries ──────────────────

test('every duct size reflects the airflow that section carries', () => {
  for (const b of btos) {
    for (const p of b.ports) {
      assert.ok(p.diameterMm > 0, b.id + ' port ' + p.index + ' has no size');
      assert.ok(p.diameterMm <= b.inletDiameterMm,
        b.id + ' port ' + p.index + ' is bigger than the duct feeding it');
      assert.ok(p.airflowLs > 0, b.id + ' port ' + p.index + ' carries no air');
    }
  }
});

// ── 8. Port count is the area's business, not a universal rule ─────────────

test('there is no universal port maximum', () => {
  assert.equal(DEFAULT_PORT_CAPACITY, null,
    'a hard port ceiling is back — it was an inference from one drawing');
});

const fourPort = () => makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
  inletDiameterMm: 400, inletAirflowLs: 400,
  ports: [1, 2, 3, 4].map(i => ({ sectionId: 's' + i, diameterMm: 250,
    airflowLs: 100, servesOutletId: 'o' + i })) });

test('a four-port fitting is valid, not a failure', () => {
  const v = validateBtos([fourPort()]);
  assert.equal(v.ok, true, JSON.stringify(v.failures));
  assert.equal(v.failures.filter(f => f.code === 'TOO_MANY_PORTS').length, 0);
});

test('a five-port fitting is valid too — the bedroom wing needs one', () => {
  const five = makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
    inletDiameterMm: 400, inletAirflowLs: 233,
    ports: [50, 48, 45, 45, 45].map((ls, i) => ({ sectionId: 's' + i, diameterMm: 250,
      airflowLs: ls, servesOutletId: 'o' + i })) });
  const v = validateBtos([five]);
  assert.equal(v.ok, true, JSON.stringify(v.failures));
  assert.equal(v.maxPortsUsed, 5);
});

test('a job may still cap ports, and that is a warning for review — never a chain', () => {
  const v = validateBtos([fourPort()], { maxPorts: 3 });
  assert.equal(v.ok, true, 'a configured cap must not fail the design');
  const w = v.warnings.find(x => x.code === 'PORT_COUNT_ABOVE_CONFIGURED_CAPACITY');
  assert.ok(w, 'a configured cap was not reported at all');
  assert.match(w.message, /do NOT chain a second fitting/);
});

// ── The physical fitting: what the sheet metal shop has to make ─────────────

test('a fitting records its body, collars and collar space', () => {
  const body = btoBodyGeometry(fourPort());
  assert.equal(body.portCount, 4);
  assert.deepEqual(body.collarDiametersMm, [250, 250, 250, 250]);
  assert.deepEqual(body.collarAirflowsLs, [100, 100, 100, 100]);
  assert.equal(body.totalOutletAirflowLs, 400);
  assert.equal(body.inletDiameterMm, 400);
  assert.ok(body.bodyLengthMm > 0 && body.bodyDepthMm > 0);
  assert.ok(body.requiredCollarRunMm > 0);
  assert.ok(body.availableCollarSpaceMm >= body.requiredCollarRunMm);
  assert.match(body.bomDescription, /BTO distribution box/);
  assert.match(body.bomDescription, /4 × collar/);
});

test('the body size is derived, and says so rather than claiming a part exists', () => {
  const body = btoBodyGeometry(fourPort());
  assert.equal(body.dimensionsSource, 'derived_from_collars');
  assert.equal(body.verified, false);
});

test('a collar bigger than the duct feeding it is a fabrication warning, not a silent chain', () => {
  const bad = makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
    inletDiameterMm: 200, inletAirflowLs: 300,
    ports: [1, 2].map(i => ({ sectionId: 's' + i, diameterMm: 250,
      airflowLs: 150, servesOutletId: 'o' + i })) });
  const body = btoBodyGeometry(bad);
  assert.equal(body.fits, false);
  assert.ok(body.issues.some(i => i.code === 'COLLAR_LARGER_THAN_INLET'));
  const v = validateBtos([{ ...bad, body }]);
  assert.equal(v.ok, true, 'fabrication fit must not fail validation outright');
  assert.ok(v.warnings.some(w => w.code === 'BTO_FABRICATION_FIT'));
});

test('collars that will not fit a configured body are reported against that body', () => {
  const five = makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
    inletDiameterMm: 400, inletAirflowLs: 233,
    ports: [50, 48, 45, 45, 45].map((ls, i) => ({ sectionId: 's' + i, diameterMm: 250,
      airflowLs: ls, servesOutletId: 'o' + i })) });
  const body = btoBodyGeometry(five, { bodyLengthMm: 300, bodyDepthMm: 300 });
  assert.equal(body.dimensionsSource, 'configured');
  assert.equal(body.verified, true);
  assert.equal(body.fits, false);
  assert.ok(body.issues.some(i => i.code === 'COLLARS_EXCEED_AVAILABLE_SPACE'));
});

test('a body longer than a configured maximum asks for review', () => {
  const body = btoBodyGeometry(fourPort(), { maxBodyLengthMm: 200 });
  assert.equal(body.fits, false);
  assert.ok(body.issues.some(i => i.code === 'BODY_LONGER_THAN_CONFIGURED_MAXIMUM'));
});

// ── A BTO is a supply fitting. There is no such thing as a return BTO. ──────

test('return sections never become BTOs', () => {
  const net = { sections: [
    { id: 'return', role: 'return', diameterMm: 400, airflowLs: 400,
      points: [{x:0,y:0},{x:100,y:0}] },
    { id: 'return_2', parentId: 'return', role: 'return', diameterMm: 400,
      airflowLs: 400, points: [{x:50,y:0},{x:50,y:50}] },
    { id: 'return_3', parentId: 'return', role: 'return', diameterMm: 400,
      airflowLs: 400, points: [{x:50,y:0},{x:50,y:-50}] }
  ] };
  assert.deepEqual(deriveBtos(net), [],
    'the return path was turned into a take-off fitting');
});

test('a return is recognised however it identifies itself', () => {
  assert.equal(isReturnSection({ id: 'return' }), true);
  assert.equal(isReturnSection({ id: 'return_2' }), true);
  assert.equal(isReturnSection({ id: 'x', role: 'return' }), true);
  assert.equal(isReturnSection({ id: 'x', nacRole: 'RETURN' }), true);
  assert.equal(isReturnSection({ id: 'x', isReturn: true }), true);
  assert.equal(isReturnSection({ id: 'x', airSide: 'return' }), true);
  assert.equal(isReturnSection({ id: 'main_A', role: 'main' }), false);
  assert.equal(isReturnSection({ id: 'final_x', role: 'final' }), false);
});

test('a supply fitting is never built out of mixed supply and return runs', () => {
  const net = { sections: [
    { id: 'main_A', role: 'main', diameterMm: 400, airflowLs: 300,
      points: [{x:0,y:0},{x:100,y:0}] },
    { id: 'final_a', parentId: 'main_A', role: 'final', diameterMm: 250, airflowLs: 150,
      outletId: 'o1', points: [{x:50,y:0},{x:50,y:50}] },
    { id: 'final_b', parentId: 'main_A', role: 'final', diameterMm: 250, airflowLs: 150,
      outletId: 'o2', points: [{x:50,y:0},{x:50,y:-50}] },
    { id: 'return_x', parentId: 'main_A', role: 'return', diameterMm: 400, airflowLs: 400,
      points: [{x:50,y:0},{x:150,y:0}] }
  ] };
  const [bto] = deriveBtos(net);
  assert.equal(bto.ports.length, 2, 'a return run was fitted to a supply BTO');
  assert.ok(bto.ports.every(p => p.servesOutletId));
});

test('every port goes somewhere real', () => {
  const orphan = makeBto({ id: 'x', index: 1, position: { x: 0, y: 0 },
    inletDiameterMm: 300, inletAirflowLs: 100,
    ports: [{ sectionId: 'a', diameterMm: 250, airflowLs: 100 }] });
  const v = validateBtos([orphan]);
  assert.ok(v.failures.some(f => f.code === 'PORT_GOES_NOWHERE'));
});

test('a single take-off never becomes a fitting', () => {
  const net = { sections: [
    { id: 'main', role: 'main', diameterMm: 400, airflowLs: 400, points: [{x:0,y:0},{x:100,y:0}] },
    { id: 'f1', parentId: 'main', role: 'final', diameterMm: 250, airflowLs: 100,
      outletId: 'o1', points: [{x:50,y:0},{x:50,y:50}] }
  ] };
  assert.deepEqual(deriveBtos(net), [], 'one duct off a main was called a manifold');
});

// ── 9. The fittings reach the bill of materials ─────────────────────────────

test('every fitting is on the order', () => {
  const lines = out.bom.items.filter(i => i.key === 'bto_fitting');
  assert.ok(lines.length > 0, 'the BOM has no BTO fittings');
  const ordered = lines.reduce((n, l) => n + l.quantity, 0);
  assert.equal(ordered, btos.length, 'the order does not carry one fitting per fitting');
  for (const l of lines) assert.ok(l.diameterMm > 0 && l.portCount > 0);
});

test('btoBomLines groups by what is actually different to order', () => {
  const rows = btoBomLines([
    makeBto({ id: 'a', index: 1, position: {x:0,y:0}, inletDiameterMm: 400, inletAirflowLs: 200,
      ports: [{ sectionId: 's', diameterMm: 250, airflowLs: 100, servesOutletId: 'o' },
              { sectionId: 't', diameterMm: 250, airflowLs: 100, servesOutletId: 'p' }] }),
    makeBto({ id: 'b', index: 2, position: {x:0,y:0}, inletDiameterMm: 400, inletAirflowLs: 200,
      ports: [{ sectionId: 'u', diameterMm: 250, airflowLs: 100, servesOutletId: 'q' },
              { sectionId: 'v', diameterMm: 250, airflowLs: 100, servesOutletId: 'r' }] })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
});

// ── The Dungannon reference still describes what NAC drew ───────────────────

test('the Dungannon reference job is four fittings for eight outlets', () => {
  assert.equal(DUNGANNON.btos.length, 4);
  const outletPorts = DUNGANNON.btos.flatMap(b => b.ports).filter(p => p.serves).length;
  assert.equal(outletPorts, DUNGANNON.outletCount);
  assert.ok(DUNGANNON.btos.length < DUNGANNON.outletCount,
    'the reference would have one fitting per outlet, which is the defect');
});

test('every Dungannon fitting reconciles, at whatever port count it used', () => {
  for (const b of DUNGANNON.btos) {
    assert.ok(b.ports.length >= 2, b.id + ' has ' + b.ports.length + ' ports');
    const sum = b.ports.reduce((n, p) => n + p.ls, 0);
    assert.ok(Math.abs(sum - b.inletLs) <= 2,
      b.id + ': ' + b.inletLs + ' in, ' + sum + ' out');
  }
});

test('Dungannon has a reducing tee — a main that carries on out of a fitting', () => {
  const tee = DUNGANNON.btos.find(b => b.reducingTee);
  assert.ok(tee, 'the reference pattern has lost its reducing tee');
  assert.ok(tee.ports.some(p => p.feedsBto), 'the tee does not carry the main on');
  assert.ok(tee.ports.some(p => p.serves), 'the tee does not drop a room on the way');
  const onward = tee.ports.find(p => p.feedsBto);
  assert.ok(onward.mm < tee.inletMm, 'the main did not reduce through the fitting');
});

test('Dungannon runs nothing smaller than a 250 on the supply side', () => {
  const sizes = DUNGANNON.btos.flatMap(b => b.ports.map(p => p.mm));
  assert.equal(Math.min(...sizes), DUNGANNON.smallestSupplyMm);
});

test('Dungannon zone airflow adds up to the system', () => {
  const total = DUNGANNON.zones.reduce((n, z) => n + z.ls, 0);
  assert.equal(total, DUNGANNON.systemLs);
});

test('Dungannon proves the plenum is not always balanced', () => {
  // The golden reference itself runs 374 / 509 / 303 off three identical
  // spigots. A rule that failed this design would fail NAC's own drawing.
  const mains = [374, 509, 303];
  const mean = mains.reduce((a, b) => a + b, 0) / mains.length;
  const worst = Math.max(...mains.map(f => Math.abs(f - mean) / mean * 100));
  assert.ok(worst > 15, 'the reference is balanced after all — re-read the sheet');
  assert.equal(DUNGANNON.plenum.ductCount, 3);
  assert.equal(DUNGANNON.plenum.ductSizeMm, 400);
});
