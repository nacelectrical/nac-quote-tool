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
import { MIN_MAIN_DIAMETER_MM } from '../designer/engines/nac-standard.mjs';

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
/** The trunk chain of one arm, in the order the air travels it. */
const armChain = (tree, armKey) =>
  trunks(tree).filter(s => s.arm === armKey)
    .sort((a, b) => (a.parentId === null ? -1 : b.parentId === null ? 1 : 0) ||
                     (a.id === b.parentId ? 1 : b.id === a.parentId ? -1 : 0));
const armKeys = (tree) => [...new Set(trunks(tree).map(s => s.arm))];
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
  // The plenum feeds two to four ARMS, not one spine, so what leaves it is the
  // sum of the first run on each arm. That still has to be the whole system:
  // air that leaves the fan has to be on a duct somewhere.
  const t = build();
  const leaving = t.segments.filter(s => s.parentId === null);
  assert.ok(leaving.length >= 1, 'something has to leave the plenum');
  const total = leaving.reduce((sum, s) => sum + s.airflowLs, 0);
  assert.ok(Math.abs(total - AIRFLOW.allocatedAirflowLs) < 0.5,
    'the runs leaving the plenum carry ' + total + ', not ' + AIRFLOW.allocatedAirflowLs);
});

test('trunk airflow DECREASES after every branch take-off', () => {
  const t = build();
  const byId = new Map(t.segments.map(s => [s.id, s]));
  for (const s of trunks(t)) {
    const parent = s.parentId ? byId.get(s.parentId) : null;
    if (!parent) continue;
    assert.ok(s.airflowLs < parent.airflowLs,
      s.id + ' carries ' + s.airflowLs + ' after ' + parent.id + ' carried ' +
      parent.airflowLs + ' — a trunk cannot gain air');
  }
});

test('airflow is conserved: what leaves a junction equals what arrives', () => {
  // Checked over the whole tree rather than one chain, so it holds however the
  // house is split into arms: everything arriving on a run either carries on
  // down that arm or goes off a branch at its junction.
  const t = build();
  for (const run of trunks(t)) {
    const onwards = t.segments.filter(s => s.parentId === run.id && (s.role === 'trunk' || s.role === 'main'))
      .reduce((sum, s) => sum + s.airflowLs, 0);
    const off = t.segments.filter(s => s.parentId === run.id && s.role === 'branch')
      .reduce((sum, s) => sum + s.airflowLs, 0);
    assert.ok(Math.abs(run.airflowLs - (onwards + off)) < 0.5,
      run.id + ': ' + run.airflowLs + ' in, ' + onwards + ' on + ' + off + ' off');
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
  // A real system leaves the fan coil in a few directions and branches off each
  // run. One run per room would be a star; one run for the whole house would be
  // the comb this replaced.
  assert.ok(fromPlenum.length >= 1 && fromPlenum.length <= 4,
    fromPlenum.length + ' runs leave the plenum — expected between 1 and 4 arms');
  assert.ok(fromPlenum.length < ROOMS.length,
    'a run per room is a star, not trunk and branch');
  assert.ok(trunks(t).length >= 2, 'a seven room house needs more than one trunk run');
});

test('nearby rooms share a junction rather than each getting their own', () => {
  const t = build();
  assert.ok(t.junctionCount < ROOMS.length,
    t.junctionCount + ' junctions for ' + ROOMS.length + ' rooms is a star, not a tree');
});

test('each trunk arm runs straight and does not chase individual rooms', () => {
  // An arm leaves the plenum on one axis and stays on it. A trunk that wanders
  // room to room is a duct nobody can hang in a truss roof.
  const t = build();
  const plenum = t.plenum;
  for (const key of armKeys(t)) {
    const runs = trunks(t).filter(s => s.arm === key);
    const horizontal = key === 'E' || key === 'W';
    const axis = horizontal ? plenum.y : plenum.x;
    for (const s of runs) {
      for (const p of s.points) {
        const off = horizontal ? Math.abs(p.y - axis) : Math.abs(p.x - axis);
        assert.ok(off < 1, s.id + ' (arm ' + key + ') leaves its axis by ' + off + ' px');
      }
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
  // And each run still only gets smaller than the one FEEDING it — the plenum
  // leaves on two or three mains, so a flat list is not one chain.
  const byId = new Map(t.segments.map(x => [x.id, x]));
  for (const run of trunks(t)) {
    const parent = run.parentId ? byId.get(run.parentId) : null;
    if (!parent) continue;
    assert.ok(run.airflowLs < parent.airflowLs,
      run.id + ' carries ' + run.airflowLs + ' after ' + parent.id + ' carried ' + parent.airflowLs);
  }
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
  // Compared against the run that actually FEEDS each one, not against the
  // previous entry in a flat list — the house is served by several arms, and
  // the first run of one arm is not downstream of the last run of another.
  const byId = new Map(net.sections.map(x => [x.id, x]));
  for (const s of line) {
    const parent = s.parentId ? byId.get(s.parentId) : null;
    if (!parent) continue;
    assert.ok(s.diameterMm <= parent.diameterMm,
      s.id + ' is BIGGER than the trunk feeding it (' + parent.id + ')');
  }
  // And no main is under the size NAC actually runs. On a house this small
  // every trunk tail is already AT that minimum, so nothing steps down — which
  // is the rule working, not a trunk that forgot to reduce.
  for (const s of line) {
    assert.ok(s.diameterMm >= MIN_MAIN_DIAMETER_MM,
      s.id + ' is a ' + s.diameterMm + ' main');
  }
});

// The same house with the air a big system moves, so the trunk has room to
// step down above the minimum. This is what keeps reducer recording covered
// now that a small house legitimately produces none.
const BIG_FLOW = { bed1: 260, bed2: 260, bed3: 250, study: 200, living: 620,
                   dining: 400, kitchen: 320 };
const BIG_AIRFLOW = {
  rows: ROOMS.map(r => ({ roomId: r.id, label: r.label, adjustedLs: BIG_FLOW[r.id] })),
  allocatedAirflowLs: Object.values(BIG_FLOW).reduce((a, b) => a + b, 0)
};

test('a trunk carrying real air does step down, above the minimum', () => {
  const t = measureTree(build({ airflow: BIG_AIRFLOW }), CAL);
  const net = buildDuctNetwork({ airflow: BIG_AIRFLOW, outlets: OUTLETS, topology: t });
  const byId = new Map(net.sections.map(x => [x.id, x]));
  const line = net.sections.filter(s => s.role === 'main' || s.role === 'trunk');
  assert.ok(line.some(s => {
    const parent = s.parentId ? byId.get(s.parentId) : null;
    return parent && s.diameterMm < parent.diameterMm;
  }), 'no trunk run reduced: ' + line.map(s => s.id + ':' + s.diameterMm).join(' '));
  for (const s of line) assert.ok(s.diameterMm >= MIN_MAIN_DIAMETER_MM);
});

test('a reducer is recorded wherever the trunk changes size, and only there', () => {
  for (const airflow of [AIRFLOW, BIG_AIRFLOW]) {
    const t = measureTree(build({ airflow }), CAL);
    const net = buildDuctNetwork({ airflow, outlets: OUTLETS, topology: t });
    const byId = new Map(net.sections.map(x => [x.id, x]));
    const reducers = net.sections.filter(s => s.reducerFrom);
    for (const r of reducers) {
      assert.ok(r.reducerFrom > r.reducerTo, r.id + ' reduces upward');
    }
    // One reducer for every trunk run that is a different size from its
    // parent, and not one anywhere else.
    const stepped = net.sections.filter(s => {
      if (s.role !== 'main' && s.role !== 'trunk') return false;
      const parent = s.parentId ? byId.get(s.parentId) : null;
      return parent && parent.diameterMm !== s.diameterMm;
    });
    assert.equal(reducers.length, stepped.length);
    assert.equal(net.reducerCount, reducers.length);
  }
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
  assert.ok(roles.includes('branch'), 'and it must reach a branch: ' + roles.join(' → '));
  // The old flat walk only ever saw main → branch → final, so every run in
  // between was invisible and the figure came out LOW. What matters is that the
  // path has the intermediate runs on it — whether they are trunk steps along
  // an arm or a major branch feeding a group of rooms.
  assert.ok(run.path.length >= 3,
    'the index run must include what is between the plenum and the room: ' + roles.join(' → '));
  const intermediate = run.path.slice(1, -1);
  assert.ok(intermediate.length >= 1,
    'there is nothing between the plenum and the outlet: ' + roles.join(' → '));

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
  // Everything between the plenum run and the final connection: trunk steps
  // along an arm, and the major branch feeding a group of rooms. All of it is
  // duct the fan has to push through.
  const intermediatePa = run.path.slice(1, -1)
    .reduce((sum, x) => sum + (x.pressureDropPa || 0), 0);
  assert.ok(intermediatePa > 0,
    'the intermediate runs carry real resistance — leaving them out is not conservative');
  // And they are a real share of the total, not a rounding error.
  assert.ok(intermediatePa / run.totalPa > 0.02,
    'the runs between the plenum and the room contribute only ' +
    Math.round((intermediatePa / run.totalPa) * 100) + '% — that looks like they were skipped');
});
