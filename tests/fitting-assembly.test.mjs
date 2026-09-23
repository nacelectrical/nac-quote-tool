// ─────────────────────────────────────────────────────────────────────────────
// A MAIN BUILT FROM PARTS NAC CAN BUY
//
// Nick: "use only what ive given." Four fittings, and no invention:
//
//   DB8  ø400 → 3 × ø300      B11  ø400 → ø350 + ø250
//   Y5   ø400 → 2 × ø300      Y4   ø350 → 2 × ø250 or 2 × ø300
//
// Nothing stocked takes a ø300 or a ø250 inlet, so those legs terminate at one
// outlet — which is why a ø400 main reaches three outlets and no more. That is
// not a limit somebody chose; it falls out of the parts list.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveAssembly, checkDesignAssemblies, partsIn, outletsIn, whyNot,
         maxOutletsFrom, partsForInlet } from '../designer/engines/fitting-assembly.mjs';
import { quoteGate, QUOTE_BLOCK } from '../designer/engines/quote-gate.mjs';
import { buildApproved } from './fixtures/approved-job.mjs';

const codes = (a) => partsIn(a).flatMap(p => Array(p.quantity).fill(p.code)).sort();
const cost = (a) => partsIn(a).reduce((n, p) => n + p.lineTotal, 0);
const upsizes = (a) => outletsIn(a).filter(o => o.upsizedFromMm);

test('what each inlet can reach falls out of the parts, not out of a rule', () => {
  assert.equal(maxOutletsFrom(400), 3);
  assert.equal(maxOutletsFrom(350), 2);
  assert.equal(maxOutletsFrom(300), 1, 'nothing stocked takes a ø300 inlet');
  assert.equal(maxOutletsFrom(250), 1);
  assert.equal(partsForInlet(300).length, 0);
  assert.equal(partsForInlet(250).length, 0);
});

test('an exact match uses one part and changes nothing', () => {
  const a = solveAssembly(400, [300, 300, 300]);
  assert.deepEqual(codes(a), ['MMADB8']);
  assert.equal(cost(a), 75);
  assert.equal(upsizes(a).length, 0);

  const b = solveAssembly(400, [350, 250]);
  assert.deepEqual(codes(b), ['MMAB11']);
  assert.equal(upsizes(b).length, 0);

  const c = solveAssembly(350, [250, 250]);
  assert.deepEqual(codes(c), ['MMADY14']);
  assert.equal(upsizes(c).length, 0);
});

test('three ø250 outlets are reached without resizing a single room', () => {
  // The cheap answer is a DB8 at $75 with all three upsized to ø300. The right
  // answer is a B11 into a Y4 at $105 with none: the design is not quietly
  // changed to save thirty dollars.
  const a = solveAssembly(400, [250, 250, 250]);
  assert.deepEqual(codes(a), ['MMAB11', 'MMADY14']);
  assert.equal(cost(a), 105);
  assert.equal(upsizes(a).length, 0, 'a room was resized to suit the parts list');
});

test('a leg is never smaller than the neck it feeds', () => {
  for (const necks of [[300, 300, 300], [250, 250, 250], [250, 300], [300, 250, 250]]) {
    const a = solveAssembly(400, necks);
    assert.ok(a, necks.join('+') + ' has no assembly');
    for (const o of outletsIn(a)) {
      assert.ok(o.legMm >= o.neckMm,
        'a ø' + o.neckMm + ' outlet was throttled to a ø' + o.legMm + ' leg');
    }
  }
  // A ø350 neck cannot hang off the ø250 leg of a B11, so a pair of ø350s has
  // no assembly at all rather than a throttled one.
  assert.equal(solveAssembly(400, [350, 350]), null);
});

test('an upsized leg is recorded with the size the calculation asked for', () => {
  const a = solveAssembly(400, [300, 250]);
  assert.deepEqual(codes(a), ['MMADY16']);
  const up = upsizes(a);
  assert.equal(up.length, 1);
  assert.equal(up[0].upsizedFromMm, 250);
  assert.equal(up[0].legMm, 300);
});

test('a main that has to feed four outlets has no assembly, and says why', () => {
  assert.equal(solveAssembly(400, [250, 250, 250, 250]), null);
  const why = whyNot(400, [250, 250, 250, 250]);
  assert.match(why, /at most 3 outlet/);
  assert.match(why, /Split it into 2 mains/);
  // And it names what is missing rather than leaving it as "not possible".
  assert.match(why, /DB6, B9, B8/);
});

test('an outlet bigger than its main is refused on the right grounds', () => {
  assert.equal(solveAssembly(300, [300, 300]), null);
  assert.match(whyNot(300, [300, 300]), /Nothing NAC stock takes a ø300 inlet/);
  assert.match(whyNot(250, [300]), /bigger than its inlet/);
});

test('one outlet needs no fitting at all', () => {
  const a = solveAssembly(300, [300]);
  assert.equal(a.terminal, true);
  assert.deepEqual(partsIn(a), []);
  assert.equal(solveAssembly(250, [300]), null, 'a ø300 neck off a ø250 duct');
});

// ── THE APPROVED JOB, AGAINST THE PARTS LIST ───────────────────────────────

const APPROVED = (await buildApproved()).out;

test('the approved job is checked main by main, as it is routed', () => {
  const chk = APPROVED.fittingAssembly;
  assert.equal(chk.rows.length, 3);
  const byKey = Object.fromEntries(chk.rows.map(r => [r.mainKey, r]));

  assert.equal(byKey.A.buildable, true);
  assert.deepEqual(codes(byKey.A.assembly), ['MMAB11', 'MMADY14']);

  assert.equal(byKey.B.buildable, true);
  assert.deepEqual(codes(byKey.B.assembly), ['MMADY16']);
  assert.equal(byKey.B.upsized.length, 1, 'the ø250 on main B goes on a ø300 leg');

  // Five outlets off one ø400 main. Nothing NAC stock reaches past three.
  assert.equal(byKey.C.buildable, false);
  assert.equal(byKey.C.outletCount, 5);
  assert.match(byKey.C.reason, /at most 3 outlet/);
  assert.equal(chk.ok, false);
  assert.match(chk.summary, /1 of 3 main/);
});

test('a job that cannot be assembled cannot be quoted, and the sheet still prints', () => {
  const gate = quoteGate(APPROVED);
  assert.equal(gate.ok, false);
  const b = gate.blockers.find(x => x.code === QUOTE_BLOCK.FITTINGS_NOT_AVAILABLE);
  assert.ok(b, 'a design nobody can build was quotable');
  assert.match(b.message, /Main C/);
  assert.equal(b.outletCount, 5);
  // The internal sheet is never blocked by this — it is how the problem gets
  // looked at in the first place.
  assert.ok(APPROVED.schedules.bto.length, 'the internal schedule stopped being produced');
});

test('an upsized leg is a check, not a blocker', () => {
  const gate = quoteGate(APPROVED);
  const w = gate.warnings.find(x => x.code === QUOTE_BLOCK.FITTING_LEG_UPSIZED);
  assert.ok(w);
  assert.equal(w.severity, 'CHECK');
  assert.match(w.message, /ø250 → ø300/);
  assert.match(w.message, /more air at those outlets/);
});

test('a design whose mains all fit is not blocked', () => {
  const ok = { ...APPROVED, fittingAssembly: { ok: true, rows: [], unbuildable: [] } };
  const gate = quoteGate(ok);
  assert.ok(!gate.blockers.some(b => b.code === QUOTE_BLOCK.FITTINGS_NOT_AVAILABLE));
});

test('checkDesignAssemblies survives a design with no network', () => {
  for (const d of [null, {}, { network: {} }, { network: { sections: [] } }]) {
    const r = checkDesignAssemblies(d);
    assert.equal(r.ok, false);
    assert.deepEqual(r.rows, []);
    assert.equal(r.summary, 'No mains to check.');
  }
});
