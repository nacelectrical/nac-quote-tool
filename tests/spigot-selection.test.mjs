// WHICH SUPPLY SPIGOT ARRANGEMENT, AND WHY.
//
// Nick: "Do not use outlet count as the deciding rule. Selection must consider:
// selected indoor unit; total airflow; manufacturer spigot/flange data;
// available static pressure; target main velocity; pressure loss; fabricated
// supply-plenum capacity; installer areas; roof geometry; route lengths;
// physical collar spacing."
//
// The three fixtures are three NEW designs, run through the real pipeline with
// no stored `supplyMainConfig`, that land on 2 × ø350, 2 × ø400 and 3 × ø400.
// Two of them have the SAME outlet count and choose differently, which is the
// point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSupplySpigotArrangement, evaluateArrangement, overrideSpigotArrangement,
         availableArrangements, STANDARD_ARRANGEMENTS,
         FLEX_INSULATION_MM } from '../designer/engines/spigot-selection.mjs';
import { buildThreeByFourHundred, buildTwoByFourHundred,
         buildTwoByThreeFifty } from './fixtures/spigot-jobs.mjs';
import { buildApproved } from './fixtures/approved-job.mjs';

const unit = (model, flange, staticPa) =>
  ({ model, supplyFlangeText: flange, availableStaticPa: staticPa });
const FDYAN160 = unit('FDYAN160AV1', '245 x 1152', 160);
const FDYAN100 = unit('FDYAN100AV1', '185 x 852', 130);

// ── The three arrangements Nick asked to see working ───────────────────────

test('a new design over three installer areas chooses 3 × ø400', async () => {
  const { out, design } = await buildThreeByFourHundred();
  assert.equal(design.supplyMainConfig ?? null, null, 'this must be a NEW design');
  assert.equal(out.spigotOverride ?? null, null, 'and so nothing was overridden');
  const c = out.spigotSelection.chosen;
  assert.equal(c.count, 3);
  assert.equal(c.diameterMm, 400);
  assert.equal(out.componentCounts.supplyMains, 3, 'and it is what actually got routed');
  const mains = new Set((out.network.sections || [])
    .filter(s => !s.parentId && s.role !== 'return').map(s => s.diameterMm));
  assert.deepEqual([...mains], [400]);
});

test('a long two-area house chooses 2 × ø400 — the reach decides it', async () => {
  const { out } = await buildTwoByFourHundred();
  const c = out.spigotSelection.chosen;
  assert.equal(c.count, 2);
  assert.equal(c.diameterMm, 400);
  assert.equal(out.componentCounts.supplyMains, 2);
  const smaller = out.spigotSelection.ranked.find(r => r.key === '2x350');
  assert.ok(smaller, 'ø350 was available');
  assert.ok(smaller.mainLossPa > c.mainLossPa,
    'ø400 was chosen over ø350 because the longer main loses less in it');
  assert.ok(smaller.score > c.score);
});

test('a compact house under a low roof chooses 2 × ø350 — geometry decides it', async () => {
  const { out } = await buildTwoByThreeFifty();
  const c = out.spigotSelection.chosen;
  assert.equal(c.count, 2);
  assert.equal(c.diameterMm, 350);
  assert.equal(out.componentCounts.supplyMains, 2);
  const mains = new Set((out.network.sections || [])
    .filter(s => !s.parentId && s.role !== 'return').map(s => s.diameterMm));
  assert.deepEqual([...mains], [350]);
  // Every ø400 arrangement was ruled out by the roof that was measured.
  for (const r of out.spigotSelection.rejected) {
    assert.equal(r.diameterMm, 400);
    assert.ok(r.blockers.some(b => b.code === 'ROOF_CLEARANCE'));
  }
});

// ── Outlet count is not the rule ───────────────────────────────────────────

test('two designs with the SAME outlet count choose different arrangements', async () => {
  const [a, b] = await Promise.all([buildTwoByFourHundred(), buildTwoByThreeFifty()]);
  assert.equal(a.out.outlets.totals.total, b.out.outlets.totals.total,
    'the fixtures must have the same outlet count for this to prove anything');
  assert.notDeepEqual(
    [a.out.spigotSelection.chosen.count, a.out.spigotSelection.chosen.diameterMm],
    [b.out.spigotSelection.chosen.count, b.out.spigotSelection.chosen.diameterMm]);
});

test('the selection says outright that it is not an outlet-count rule', async () => {
  const { out } = await buildThreeByFourHundred();
  assert.equal(out.spigotSelection.decidedByOutletCount, false);
  assert.match(out.spigotSelection.basis, /installer areas/);
  assert.match(out.spigotSelection.basis, /roof geometry/);
  assert.match(out.spigotSelection.basis, /pressure loss/);
  // The outlet count is carried as an input, and it is only an input.
  assert.equal(out.spigotSelection.inputs.outletCount, out.outlets.totals.total);
});

// ── Every input Nick listed is actually looked at ──────────────────────────

test('an arrangement records equipment, airflow, static, velocity, loss, plenum and roof', () => {
  const ev = evaluateArrangement(STANDARD_ARRANGEMENTS[2],
    { unit: FDYAN160, systemAirflowLs: 799, installerAreaCount: 3,
      longestMainRouteM: 14, roofGeometry: { minClearanceMm: 600 } });
  assert.equal(ev.perDuctAirflowLs, 266);
  assert.ok(ev.velocityMs > 0);
  assert.ok(ev.paPerM > 0 && ev.mainLossPa > 0);
  assert.equal(ev.availableStaticPa, 160);
  assert.equal(ev.availableStaticVerified, true);
  assert.equal(ev.collarRowMm, 3 * 400 + 2 * 60);
  assert.equal(ev.plenum.flangeWidthMm, 1152);
  assert.equal(ev.plenumWidened, true, '1320 mm of collar will not sit on an 1152 mm flange');
  assert.equal(ev.roofClearanceRequiredMm, 400 + FLEX_INSULATION_MM * 2);
  assert.equal(ev.installerAreaCount, 3);
  assert.equal(ev.feasible, true);
});

test('a main over the velocity ceiling is not available at all', () => {
  const ev = evaluateArrangement({ key: '2x350', count: 2, diameterMm: 350 },
    { unit: FDYAN160, systemAirflowLs: 2000, installerAreaCount: 2,
      longestMainRouteM: 10, roofGeometry: { minClearanceMm: 600 } });
  assert.equal(ev.feasible, false);
  assert.ok(ev.blockers.some(b => b.code === 'OVER_VELOCITY'));
});

test('collars that will not fit a plenum the job refuses to widen are blocked', () => {
  const ev = evaluateArrangement({ key: '3x400', count: 3, diameterMm: 400 },
    { unit: FDYAN100, systemAirflowLs: 700, installerAreaCount: 3,
      longestMainRouteM: 10, roofGeometry: { minClearanceMm: 600 },
      allowWidenedPlenum: false });
  assert.equal(ev.feasible, false);
  assert.ok(ev.blockers.some(b => b.code === 'PLENUM_COLLARS_DO_NOT_FIT'));
});

test('what could not be checked is named, not assumed', () => {
  const r = selectSupplySpigotArrangement({
    unit: { model: 'UNKNOWN', supplyFlangeText: null, availableStaticPa: null },
    systemAirflowLs: 600, installerAreaCount: 2 });
  assert.ok(r.unverified.includes('AVAILABLE_STATIC_UNVERIFIED'));
  assert.ok(r.unverified.includes('PLENUM_CAPACITY_UNVERIFIED'));
  assert.ok(r.unverified.includes('ROOF_CLEARANCE_UNMEASURED'));
  assert.equal(r.chosen.availableStaticVerified, false);
});

test('a unit that states its own spigot arrangements offers them first', () => {
  const list = availableArrangements({
    unit: { supplySpigotArrangements: [{ count: 4, diameterMm: 300, key: '4x300' }] } });
  assert.equal(list[0].key, '4x300');
  assert.equal(list[0].source, 'manufacturer');
  assert.ok(list.some(a => a.key === '3x400'), 'the standard list is still there');
});

test('nothing feasible is an answer, with the reasons', () => {
  const r = selectSupplySpigotArrangement({
    unit: FDYAN160, systemAirflowLs: 800, installerAreaCount: 2,
    roofGeometry: { minClearanceMm: 300 } });
  assert.equal(r.chosen, null);
  assert.equal(r.ranked.length, 0);
  assert.equal(r.rejected.length, 3);
  assert.match(r.summary, /No supply spigot arrangement is physically available/);
});

// ── The installer's choice, and the record of it ───────────────────────────

test('an installer override records the recommendation, the choice, who and why', async () => {
  const { out } = await buildThreeByFourHundred();
  const job = { unit: FDYAN160, systemAirflowLs: 800, installerAreaCount: 3,
                longestMainRouteM: 14, roofGeometry: { minClearanceMm: 600 } };
  const rec = overrideSpigotArrangement(out.spigotSelection,
    { count: 2, diameterMm: 400, by: 'Nick', reason: 'Only two roof crossings available.',
      at: '2026-09-16T04:00:00.000Z', job });
  assert.equal(rec.recommended.key, '3x400');
  assert.equal(rec.selected.key, '2x400');
  assert.equal(rec.by, 'Nick');
  assert.equal(rec.at, '2026-09-16T04:00:00.000Z');
  assert.match(rec.reason, /roof crossings/);
  assert.equal(rec.differsFromRecommendation, true);
  assert.equal(rec.overridesABlocker, false, '2 × ø400 is legal here, just not preferred');
});

test('an override that breaks a hard check is built, and carries the warning', () => {
  const job = { unit: FDYAN160, systemAirflowLs: 800, installerAreaCount: 2,
                longestMainRouteM: 10, roofGeometry: { minClearanceMm: 380 } };
  const sel = selectSupplySpigotArrangement(job);
  const rec = overrideSpigotArrangement(sel,
    { count: 2, diameterMm: 400, by: 'Nick', reason: 'Roof will be opened up.', job });
  assert.equal(rec.overridesABlocker, true);
  assert.equal(rec.warnings.length, 1);
  assert.match(rec.warnings[0].code, /^INSTALLER_OVERRODE_/);
  assert.match(rec.warnings[0].message, /chosen by Nick/);
});

// ── A saved and approved design is never rerouted behind anyone's back ─────

test('the approved job keeps its 3 × ø400 and is not rerouted by this logic', async () => {
  const { out } = await buildApproved();
  assert.equal(out.componentCounts.supplyMains, 3);
  assert.equal(out.supplySpigots.count, 3);
  const mains = new Set((out.network.sections || [])
    .filter(s => !s.parentId && s.role !== 'return').map(s => s.diameterMm));
  assert.deepEqual([...mains], [400]);
  // The selection ran, and is recorded beside the stored arrangement.
  assert.ok(out.spigotSelection.chosen);
  // And the installer's stored choice has its audit record.
  assert.equal(out.spigotOverride.selected.count, 3);
  assert.equal(out.spigotOverride.selected.diameterMm, 400);
  assert.equal(out.spigotOverride.by, 'installer');
});
