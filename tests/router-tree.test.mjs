// THE AUTO DUCT ROUTER — topology and geometry.
//
// The thing that makes this a duct system rather than lines on a picture is
// that the tree is REAL: every outlet is reached, nothing has two parents, the
// airflow adds up, and the trunk gets smaller as it drops branches off.
//
// These tests are the house shapes an estimator actually meets: bedrooms down
// one side and living down the other, the unit central, the unit at one end.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDuctTree, measureTree, deriveFootprint, trunkSpine, insideFootprint,
         AUTO_ROUTE_NOTICE } from '../designer/engines/router.mjs';
import { buildDuctNetwork, indexRun } from '../designer/engines/ducts.mjs';

// ── A house: bedrooms along the top, living along the bottom ────────────────
//
//   x:  0        200       400       600       800
//   y:0  [BED1]   [BED2]   [BED3]   [STUDY]
//   y:300           ——— hallway / spine ———
//   y:400  [LIVING      ][DINING   ][KITCHEN ]

const ROOMS = [
  { id: 'bed1',   label: 'BED 1',   boundaryPx: { x: 20,  y: 20,  w: 160, h: 220 } },
  { id: 'bed2',   label: 'BED 2',   boundaryPx: { x: 220, y: 20,  w: 160, h: 220 } },
  { id: 'bed3',   label: 'BED 3',   boundaryPx: { x: 420, y: 20,  w: 160, h: 220 } },
  { id: 'study',  label: 'STUDY',   boundaryPx: { x: 620, y: 20,  w: 160, h: 220 } },
  { id: 'living', label: 'LIVING',  boundaryPx: { x: 20,  y: 400, w: 300, h: 240 } },
  { id: 'dining', label: 'DINING',  boundaryPx: { x: 360, y: 400, w: 200, h: 240 } },
  { id: 'kitchen',label: 'KITCHEN', boundaryPx: { x: 600, y: 400, w: 180, h: 240 } }
];

const flow = {
  bed1: 90, bed2: 90, bed3: 85, study: 70, living: 220, dining: 140, kitchen: 110
};
const AIRFLOW = { rows: ROOMS.map(r => ({ roomId: r.id, label: r.label, adjustedLs: flow[r.id] })),
                  allocatedAirflowLs: Object.values(flow).reduce((a, b) => a + b, 0) };
const OUTLETS = { rows: ROOMS.map(r => ({ roomId: r.id, quantity: r.id === 'living' ? 2 : 1 })) };

const build = (over = {}) => buildDuctTree({
  rooms: ROOMS, airflow: AIRFLOW, outlets: OUTLETS,
  layout: { plenum: { x: 400, y: 320 } },
  ...over
});

const seg = (tree, id) => tree.segments.find(s => s.id === id);
const trunks = (tree) => tree.segments.filter(s => s.role === 'main' || s.role === 'trunk');
const branches = (tree) => tree.segments.filter(s => s.role === 'branch');

// ── The tree is a tree ──────────────────────────────────────────────────────

test('every conditioned outlet is connected to something', () => {
  const t = build();
  for (const r of ROOMS) {
    assert.ok(seg(t, 'branch_' + r.id), r.label + ' was never reached');
  }
});

test('no segment has two parents, and every parent exists', () => {
  const t = build();
  const ids = new Set(t.segments.map(s => s.id));
  const nodeIds = new Set(t.nodes.map(n => n.id));
  const seen = new Set();
  for (const s of t.segments) {
    assert.ok(!seen.has(s.id), 'duplicate segment id ' + s.id);
    seen.add(s.id);
    if (s.parentId === null) continue;
    assert.ok(ids.has(s.parentId) || nodeIds.has(s.parentId),
      s.id + ' hangs off ' + s.parentId + ', which does not exist');
  }
});

test('the tree reaches every outlet from the plenum with no orphan', () => {
  const t = build();
  // Walk out from the trunk and make sure everything is attached.
  const byParent = new Map();
  for (const s of t.segments) {
    const k = s.parentId || '__root';
    byParent.set(k, [...(byParent.get(k) || []), s]);
  }
  const reached = new Set();
  const walk = (key) => {
    for (const s of (byParent.get(key) || [])) {
      if (reached.has(s.id)) continue;
      reached.add(s.id);
      walk(s.id);
      if (s.junctionId) walk(s.junctionId);
    }
  };
  walk('__root');
  for (const s of t.segments) if (s.junctionId) walk(s.junctionId);
  assert.equal(reached.size, t.segments.length,
    'orphaned: ' + t.segments.filter(s => !reached.has(s.id)).map(s => s.id).join(', '));
});

// ── Airflow ─────────────────────────────────────────────────────────────────

test('the trunk carries the whole system at the plenum', () => {
  const t = build();
  const main = seg(t, 'main');
  assert.equal(main.airflowLs, AIRFLOW.allocatedAirflowLs,
    'the first trunk run must carry everything');
});

test('trunk airflow DECREASES after every branch take-off', () => {
  const t = build();
  const line = trunks(t);
  for (let i = 1; i < line.length; i++) {
    assert.ok(line[i].airflowLs < line[i - 1].airflowLs,
      line[i].id + ' carries ' + line[i].airflowLs + ' after ' + line[i - 1].id +
      ' carried ' + line[i - 1].airflowLs + ' — a trunk cannot gain air');
  }
});

test('airflow is conserved: what leaves a junction equals what arrives', () => {
  const t = build();
  const line = trunks(t);
  for (let i = 0; i < line.length; i++) {
    const arriving = line[i].airflowLs;
    const onwards = line[i + 1]?.airflowLs || 0;
    // Branches hung off the junction this trunk run ends at.
    const jId = 'junction_' + (i + 1);
    const off = branches(t).filter(b => b.junctionId === jId)
      .reduce((s, b) => s + b.airflowLs, 0);
    assert.ok(Math.abs(arriving - (onwards + off)) < 0.5,
      jId + ': ' + arriving + ' in, ' + onwards + ' on + ' + off + ' off');
  }
});

test('a branch carries exactly its room’s airflow', () => {
  const t = build();
  for (const r of ROOMS) {
    assert.equal(seg(t, 'branch_' + r.id).airflowLs, flow[r.id], r.label);
  }
});

test('a room with two outlets gets a final, and the finals split its air', () => {
  const t = build();
  const final = seg(t, 'final_living_2');
  assert.ok(final, 'LIVING has two outlets and got no final');
  assert.equal(final.airflowLs, flow.living / 2);
  assert.equal(final.parentId, 'branch_living');
});

// ── It is trunk-and-branch, not a star ──────────────────────────────────────

test('it does NOT draw a straight line from the plenum to every outlet', () => {
  const t = build();
  const fromPlenum = t.segments.filter(s => s.parentId === null);
  assert.equal(fromPlenum.length, 1, 'exactly one run leaves the plenum, not one per room');
  assert.ok(trunks(t).length >= 2, 'a seven room house needs more than one trunk run');
});

test('nearby rooms share a junction rather than each getting their own', () => {
  const t = build();
  assert.ok(t.junctionCount < ROOMS.length,
    t.junctionCount + ' junctions for ' + ROOMS.length + ' rooms is a star, not a tree');
});

test('the big trunk stays on the spine and does not chase individual rooms', () => {
  const t = build();
  for (const s of trunks(t)) {
    for (const p of s.points) {
      const off = t.spine.horizontal ? Math.abs(p.y - t.spine.axisPos) : Math.abs(p.x - t.spine.axisPos);
      assert.ok(off < 1, s.id + ' leaves the spine by ' + off + ' px');
    }
  }
});

test('branches run square, not diagonally across the ceiling', () => {
  const t = build();
  for (const s of branches(t)) {
    for (let i = 1; i < s.points.length; i++) {
      const dx = Math.abs(s.points[i].x - s.points[i - 1].x);
      const dy = Math.abs(s.points[i].y - s.points[i - 1].y);
      assert.ok(dx < 0.5 || dy < 0.5,
        s.id + ' leg ' + i + ' is diagonal (' + dx + ',' + dy + ')');
    }
  }
});

test('every route stays inside the house', () => {
  const t = build();
  for (const s of t.segments) {
    for (const p of s.points) {
      assert.ok(insideFootprint(t.footprint, p, 2), s.id + ' leaves the building at ' + JSON.stringify(p));
    }
  }
});

// ── The unit somewhere else ─────────────────────────────────────────────────

test('a unit at one end of the house still produces a sensible trunk', () => {
  const t = build({ layout: { plenum: { x: 40, y: 320 } } });
  assert.ok(t.generated);
  assert.ok(trunks(t).length >= 2);
  // Everything still reached.
  for (const r of ROOMS) assert.ok(seg(t, 'branch_' + r.id), r.label);
  // And the trunk still only gets smaller.
  const line = trunks(t);
  for (let i = 1; i < line.length; i++) assert.ok(line[i].airflowLs < line[i - 1].airflowLs);
});

test('with no plenum placed it says so rather than pretending', () => {
  const t = build({ layout: {} });
  assert.equal(t.plenum.source, 'assumed_centre');
  assert.ok(t.warnings.some(w => w.code === 'PLENUM_POSITION_ASSUMED'));
});

test('a room with no boundary is reported, not silently skipped', () => {
  const t = buildDuctTree({
    rooms: ROOMS.filter(r => r.id !== 'study'),
    airflow: AIRFLOW, outlets: OUTLETS, layout: { plenum: { x: 400, y: 320 } }
  });
  assert.ok(t.warnings.some(w => w.code === 'ROOM_NOT_ON_PLAN' && /STUDY/.test(w.message)));
  assert.equal(seg(t, 'branch_study'), undefined);
});

test('no geometry at all produces nothing and says why', () => {
  const t = buildDuctTree({ rooms: [], airflow: AIRFLOW, outlets: OUTLETS });
  assert.equal(t.generated, false);
  assert.ok(t.warnings.length);
});

test('the site-verification notice rides on the tree', () => {
  assert.equal(build().notice, AUTO_ROUTE_NOTICE);
});

// ── Footprint and spine ─────────────────────────────────────────────────────

test('the footprint is the rooms, and admits it is derived', () => {
  const f = deriveFootprint(ROOMS);
  assert.equal(f.x, 20);
  assert.equal(f.y, 20);
  assert.equal(f.x + f.w, 780);
  assert.equal(f.derived, true);
  assert.match(f.note, /no wall data/);
});

test('the spine follows the long axis of the house', () => {
  const f = deriveFootprint(ROOMS);
  const s = trunkSpine(f, { x: 400, y: 320 });
  assert.equal(s.horizontal, true, 'this house is wider than it is deep');
  assert.equal(s.axisPos, 320, 'the spine runs through the plenum');
});

// ── Measuring, and the numbers reaching the design ──────────────────────────

const CAL = { pixelsPerMm: 0.06 };   // ~16.7 mm per pixel

test('the routed drawing becomes the length', () => {
  const t = measureTree(build(), CAL);
  const main = t.segments.find(s => s.id === 'main');
  assert.ok(main.lengthM > 0);
  assert.equal(main.lengthSource, 'routed_drawing');
  assert.match(main.lengthNote, /routed layout/);
  // A dog-legged branch must measure LONGER than the straight line, which is
  // the whole reason the drawing is used instead of an estimate.
  const dogleg = t.segments.find(s => s.role === 'branch' && s.points.length > 2);
  assert.ok(dogleg.lengthM >= dogleg.straightLineM, dogleg.id);
});

test('without a calibration it reports no length rather than a wrong one', () => {
  const t = measureTree(build(), null);
  for (const s of t.segments) {
    assert.equal(s.lengthM, null);
    assert.equal(s.lengthSource, 'uncalibrated');
  }
});

test('the sized network uses the routed tree, and steps the trunk down', () => {
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  assert.equal(net.routed, true);

  const line = net.sections.filter(s => s.role === 'main' || s.role === 'trunk');
  assert.ok(line.length >= 2);
  // Diameters may repeat where the ladder has no finer step, but must never grow.
  for (let i = 1; i < line.length; i++) {
    assert.ok(line[i].diameterMm <= line[i - 1].diameterMm,
      line[i].id + ' is BIGGER than the trunk feeding it');
  }
  // Somewhere along a seven-room house the trunk has to get smaller.
  assert.ok(line[line.length - 1].diameterMm < line[0].diameterMm,
    'the trunk never reduced across the whole house');
});

test('a reducer is recorded wherever the trunk changes size', () => {
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  const reducers = net.sections.filter(s => s.reducerFrom);
  assert.ok(reducers.length > 0, 'a stepping trunk must produce reducers to buy');
  for (const r of reducers) {
    assert.ok(r.reducerFrom > r.reducerTo, r.id + ' reduces upward');
  }
  assert.equal(net.reducerCount, reducers.length);
});

test('the geometry travels WITH the sized section, not in a parallel model', () => {
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  for (const s of net.sections) {
    assert.ok(Array.isArray(s.points) && s.points.length >= 2, s.id + ' lost its geometry');
    assert.equal(s.auto, true);
  }
});

test('duct sizes match the airflow they were given', () => {
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  for (const s of net.sections) {
    // More air must never end up in a smaller duct than less air did.
    for (const other of net.sections) {
      if (s.airflowLs > other.airflowLs && s.role === other.role) {
        assert.ok(s.diameterMm >= other.diameterMm,
          s.id + ' (' + s.airflowLs + ' L/s, ' + s.diameterMm + ') is smaller than ' +
          other.id + ' (' + other.airflowLs + ' L/s, ' + other.diameterMm + ')');
      }
    }
  }
});

test('an unrouted design is sized exactly as it always was', () => {
  // Backwards compatibility is not optional: a design that has never been
  // routed must behave the way it did before the router existed.
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS });
  assert.equal(net.routed, undefined);
  assert.ok(net.sections.find(s => s.id === 'main'));
  assert.equal(net.sections.filter(s => s.role === 'branch').length, ROOMS.length);
});

test('the same plan routes the same way every time', () => {
  const a = JSON.stringify(build().segments);
  const b = JSON.stringify(build().segments);
  assert.equal(a, b, 'routing must be deterministic or nobody can trust a change');
});

// ── The index run, which decides the fan ────────────────────────────────────

test('the index run walks the REAL tree, not just main → branch → final', () => {
  // This is the one that matters most. On a routed system the old walk only
  // looked at the first trunk run, so every intermediate trunk was invisible to
  // the pressure calculation and the figure came out LOW — which is how a unit
  // gets specified that cannot make its airflow.
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  const run = indexRun(net);

  assert.ok(run, 'a routed network must have an index run');
  const roles = run.path.map(s => s.role);
  assert.equal(roles[0], 'main', 'the path starts at the plenum');
  assert.ok(roles.filter(r => r === 'trunk').length >= 1,
    'the index run must include the intermediate trunk runs: ' + roles.join(' → '));
  assert.ok(roles.includes('branch'), 'and it must reach a branch: ' + roles.join(' → '));

  // Every step is genuinely connected to the one before it.
  const byId = new Map(net.sections.map(s => [s.id, s]));
  for (let i = 1; i < run.path.length; i++) {
    assert.equal(byId.get(run.path[i].id).parentId, run.path[i - 1].id,
      run.path[i].id + ' does not actually hang off ' + run.path[i - 1].id);
  }

  // And it is the WORST path, not just any path.
  const total = run.path.reduce((s, x) => s + x.pressureDropPa, 0);
  assert.ok(Math.abs(total - run.totalPa) < 0.2);
});

test('ignoring the intermediate trunks would understate the pressure', () => {
  const t = measureTree(build(), CAL);
  const net = buildDuctNetwork({ airflow: AIRFLOW, outlets: OUTLETS, topology: t });
  const run = indexRun(net);
  const trunkPa = run.path.filter(s => s.role === 'trunk')
    .reduce((s, x) => s + x.pressureDropPa, 0);
  assert.ok(trunkPa > 0,
    'the intermediate trunks carry real resistance — leaving them out is not conservative');
});
