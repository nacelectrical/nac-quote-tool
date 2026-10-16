// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTER ON PLANS THAT ARE NOT THE SAME HOUSE
//
// The review: "Some safeguards and reference-job tests were added, but those
// results do not establish reliability on new floor plans."
//
// Dungannon and the three-area house are the same SHAPE of problem — a roughly
// square single storey with central plant and a bedroom wing — so a router
// tuned to that one shape passes both and is not finished. These add three
// plans chosen for what each does that the others cannot, and assert what the
// GEOMETRY produces rather than any coordinate:
//
//   long-narrow    28 m end to end, plant at one end. No middle to radiate from.
//   l-shaped       two wings at ninety degrees, plant in the inside corner.
//   compact-core   nine rooms on 13 × 11 m. Minimum diameter sizes the duct.
//
// And the reconciliation the review asked for: the drawing, the duct schedule,
// the BOM and the pressure calculation must describe ONE system. That check is
// itself tested against a deliberately broken design, because a reconciler that
// cannot fail proves nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_SHAPES, buildPlan } from './fixtures/plan-shapes.mjs';
import { buildThreeAreaHouse } from './fixtures/three-area-house.mjs';
import { reconcileDesign } from '../designer/engines/reconcile.mjs';

const byKey = Object.fromEntries(PLAN_SHAPES.map(s => [s.key, s]));

/** Built once each — the pipeline is not cheap and nothing here mutates. */
const built = {};
async function plan(key) {
  if (!built[key]) built[key] = await buildPlan(byKey[key]);
  return built[key];
}

test('every plan routes end to end and produces a buildable system', async () => {
  for (const spec of PLAN_SHAPES) {
    const { out: d } = await plan(spec.key);
    const supply = (d.network.sections || []).filter(s => s.role !== 'return');

    assert.ok(supply.length >= 4, spec.key + ': only ' + supply.length + ' runs');
    assert.ok(d.network.totalDuctLengthM > 0, spec.key + ': no duct length');
    assert.ok((d.outlets.totals.total || 0) >= 6, spec.key + ': too few outlets');
    assert.ok(d.zones.zoneCount >= 2, spec.key + ': not zoned');
    assert.ok(d.selectedUnit, spec.key + ': no unit selected');

    // Every run has a real length, so the pressure gate can complete at all.
    for (const s of supply) {
      assert.ok(Number(s.lengthM) > 0, spec.key + ': ' + s.id + ' has no length');
      assert.ok(Number(s.diameterMm) > 0, spec.key + ': ' + s.id + ' has no diameter');
    }
  }
});

test('the three plans are genuinely different problems, not one plan rotated', async () => {
  const shapes = {};
  for (const spec of PLAN_SHAPES) {
    const { out: d } = await plan(spec.key);
    const supply = (d.network.sections || []).filter(s => s.role !== 'return');
    shapes[spec.key] = {
      rooms: d.rooms.length,
      conditioned: d.rooms.filter(r => r.conditioned).length,
      runs: supply.length,
      outlets: d.outlets.totals.total,
      zones: d.zones.zoneCount,
      btos: (d.btos || []).length,
      diameters: [...new Set(supply.map(s => s.diameterMm))].sort((a, b) => a - b).join('/')
    };
  }
  // If two plans produced identical topology they would be the same test twice.
  const keys = Object.keys(shapes);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      assert.notDeepEqual(shapes[keys[i]], shapes[keys[j]],
        keys[i] + ' and ' + keys[j] + ' produced the same system — one is not pulling '
        + 'its weight as a test');
    }
  }
});

/**
 * Every root-to-outlet path, from the take-off records that say which run
 * feeds which.
 */
function allPaths(d) {
  const byId = new Map((d.network.sections || []).map(s => [s.id, s]));
  const parent = new Map();
  for (const b of (d.network.btos || [])) {
    if (b.sectionId && b.parentSectionId) parent.set(b.sectionId, b.parentSectionId);
  }
  const paths = [];
  for (const s of byId.values()) {
    if (s.role !== 'final') continue;
    const chain = [s];
    let cur = s.id, guard = 0;
    while (parent.has(cur) && guard++ < 20) {
      cur = parent.get(cur);
      const seg = byId.get(cur);
      if (!seg) break;
      chain.unshift(seg);
    }
    paths.push({ destination: s.destination, chain,
      pa: Math.round(chain.reduce((t, x) => t + (Number(x.pressureDropPa) || 0), 0) * 10) / 10,
      m: Math.round(chain.reduce((t, x) => t + (Number(x.lengthM) || 0), 0) * 100) / 100 });
  }
  return paths;
}

test('the index run is the worst path, on every plan', async () => {
  // THE LONGEST PATH IS NOT THE INDEX RUN. On the long narrow house the living
  // end carries two thirds of the air over 8.5 m at 13.6 Pa, and the far
  // bedroom is 18.3 m at 10.8 Pa — so the SHORT path is the one the fan has to
  // make. A test that demanded a long index run on a long house would have
  // been asserting a misunderstanding.
  //
  // What has to be true is that nothing is worse than the path the pressure
  // was calculated on. Miss a worse one and the fan is undersized.
  for (const spec of PLAN_SHAPES) {
    const { out: d } = await plan(spec.key);
    const paths = allPaths(d);
    assert.ok(paths.length >= 4, spec.key + ': only ' + paths.length + ' paths found');

    const chosen = d.pressure.indexRun.path
      .reduce((t, x) => t + (Number(x.pressureDropPa) || 0), 0);
    const worst = Math.max(...paths.map(p => p.pa));
    assert.ok(chosen + 0.05 >= worst,
      spec.key + ': the pressure was calculated on a ' + chosen.toFixed(1) + ' Pa path '
      + 'while a ' + worst.toFixed(1) + ' Pa path exists — the fan would be undersized');

    // And the evidence behind that figure is complete.
    assert.equal(d.pressure.lengthEvidence.ok, true, spec.key);
    assert.ok(d.pressure.estimatedRequirementPa > 0, spec.key);
  }
});

test('the long narrow house really does reach the far end', async () => {
  const { out: d } = await plan('long-narrow');
  const paths = allPaths(d);
  const longest = Math.max(...paths.map(p => p.m));
  // A router that quietly stopped at the middle of a 28 m house would leave
  // the far bedroom unfed and still look tidy.
  assert.ok(longest > 15,
    'the longest run is only ' + longest.toFixed(1) + ' m on a 28 m house');
  // The far end is fed, and fed by its own main rather than hung off the near one.
  const mains = (d.network.sections || []).filter(x => x.role === 'main');
  assert.ok(mains.length >= 2, 'a 28 m house got one main');
  assert.ok(mains.some(x => Number(x.lengthM) > 8),
    'no main actually travels down the house');
});

test('the L-shaped house sends its mains into both wings', async () => {
  const { out: d } = await plan('l-shaped');
  const mains = (d.network.sections || []).filter(s => s.role === 'main');
  assert.ok(mains.length >= 2, 'an L needs more than one main');
  // Each main carries a real share; one main doing all the work and another
  // doing none is a fan-out that did not understand the shape.
  const flows = mains.map(m => Number(m.airflowLs) || 0).sort((a, b) => a - b);
  assert.ok(flows[0] > 0, 'a main carries no air at all');
  assert.ok(flows[flows.length - 1] / Math.max(1, flows[0]) < 4,
    'one main carries ' + flows[flows.length - 1] + ' L/s and another only ' + flows[0]);
});

test('the compact house never puts an undersized duct on a room', async () => {
  const { out: d } = await plan('compact-core');
  // Short runs and small rooms mean velocity would allow a very small duct.
  // NAC's minimum branch diameter is what must decide, not the velocity band.
  const finals = (d.network.sections || []).filter(s => s.role === 'final');
  assert.ok(finals.length > 0);
  for (const f of finals) {
    assert.ok(Number(f.diameterMm) >= 200,
      f.destination + ' got ø' + f.diameterMm + ' — below the minimum branch diameter');
  }
});

// ── RECONCILIATION ──────────────────────────────────────────────────────────

test('every plan reconciles across drawing, schedule, BOM and pressure', async () => {
  const all = [...PLAN_SHAPES.map(s => s.key)];
  for (const key of all) {
    const { out: d } = await plan(key);
    const r = reconcileDesign(d);
    assert.ok(r.checked >= 10, key + ': only ' + r.checked + ' checks ran');
    assert.equal(r.mismatches, 0, key + ': ' + JSON.stringify(r.findings, null, 2));
    assert.equal(r.unknowns, 0, key + ': something could not be checked — '
      + JSON.stringify(r.findings.filter(f => f.level === 'UNKNOWN')));
  }
});

test('the reference fixture still reconciles, and its scale has an origin', async () => {
  const { out: d } = await buildThreeAreaHouse();
  const r = reconcileDesign(d);
  assert.equal(r.mismatches, 0, JSON.stringify(r.findings, null, 2));
  // It was standing on a bare px/mm with nothing recorded about where it came
  // from, which is the shape of the Kauri car-scale defect. The pressure check
  // refused to complete until the origin was written down.
  assert.equal(d.calibration.source, 'measured');
  assert.equal(d.pressure.status, 'pass');
});

test('the reconciler catches a disagreement rather than reporting none', async () => {
  const { out: good } = await plan('l-shaped');
  assert.equal(reconcileDesign(good).mismatches, 0);

  const clone = () => JSON.parse(JSON.stringify(good));

  // 1. The stated total no longer matches the runs.
  const a = clone();
  a.network.totalDuctLengthM = Number(a.network.totalDuctLengthM) + 7;
  const ra = reconcileDesign(a);
  assert.ok(ra.findings.some(f => f.code === 'DUCT_TOTAL_MISMATCH'),
    'seven metres of duct appeared from nowhere and nothing noticed');

  // 2. The BOM buys fewer outlets than the design places.
  const b = clone();
  for (const i of b.bom.items) {
    if (/diffuser|linear|outlet/i.test(String(i.key || '')) && i.quantity > 1) i.quantity -= 1;
  }
  assert.ok(reconcileDesign(b).findings.some(f => f.code === 'BOM_OUTLET_MISMATCH'),
    'an outlet nobody bought went unnoticed');

  // 3. The pressure figure is built through a run that does not exist.
  const c = clone();
  c.pressure.indexRun.path[0].id = 'main_GHOST';
  assert.ok(reconcileDesign(c).findings.some(f => f.code === 'PRESSURE_PATH_ORPHAN'),
    'the pressure was calculated through a duct that is not in the design');

  // 4. The pressure calculation used a different length to the run it names.
  const e = clone();
  e.pressure.indexRun.path[0].lengthM = Number(e.pressure.indexRun.path[0].lengthM) + 3;
  assert.ok(reconcileDesign(e).findings.some(f => f.code === 'PRESSURE_LENGTH_MISMATCH'));

  // 5. A damper short of the closable zones.
  const f = clone();
  f.zoneDampers.pop();
  assert.ok(reconcileDesign(f).findings.some(x => x.code === 'ZONE_DAMPER_MISMATCH'),
    'a zone with no damper went unnoticed');

  // 6. A duplicated section id — two runs the schedule cannot tell apart.
  const g = clone();
  g.network.sections[2].id = g.network.sections[1].id;
  assert.ok(reconcileDesign(g).findings.some(x => x.code === 'SECTION_ID_DUPLICATE'));

  // 7. A pass with no measured length behind it is not a pass.
  const h = clone();
  h.pressure.lengthEvidence = { ok: false, code: 'STATIC_PRESSURE_LENGTH_NOT_MEASURED',
                                reason: 'nothing measured' };
  assert.ok(reconcileDesign(h).findings.some(x => x.code === 'PRESSURE_PASS_WITHOUT_EVIDENCE'));
});
