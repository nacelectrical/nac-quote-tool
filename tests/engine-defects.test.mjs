// FOUR DEFECTS A REAL JOB FOUND, AND THE ROUTER CAPABILITY THAT CAME WITH THEM.
//
// Each of these was a silent wrong answer, not a crash: warnings that piled up
// until an obsolete blocker stopped a finished design, a capacity check that
// described a design nobody had asked for, a grille size that never reached the
// drawing, and a spigot choice made on an average airflow that no duct carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreeAreaHouse, AREA_AIRFLOWS } from './fixtures/three-area-house.mjs';
import { resetDerivedWarnings, DERIVED_WARNING_FIELDS, DERIVED_VALIDATION_FIELDS,
         USER_ENTERED_FIELDS } from '../designer/engines/warnings.mjs';
import { designRoomOutlets, designOutlets } from '../designer/engines/outlets.mjs';
import { grilleDimensionsOf, grilleSizeText } from '../designer/engines/returnair.mjs';
import { buildReturnComponents } from '../designer/engines/return-model.mjs';
import { selectSupplySpigotArrangement, groupAreasIntoMains }
  from '../designer/engines/spigot-selection.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const H = await buildThreeAreaHouse();

// ═══════════════════════════════════════════════════════════════════════════
// DEFECT 1 — derived warnings accumulated instead of being rebuilt
// ═══════════════════════════════════════════════════════════════════════════

test('the reset blanks every derived warning and validation field', () => {
  const patch = resetDerivedWarnings({});
  for (const k of [...DERIVED_WARNING_FIELDS, ...DERIVED_VALIDATION_FIELDS]) {
    assert.equal(patch[k], null, k + ' survived the reset');
  }
});

test('the reset touches nothing a person entered', () => {
  const patch = resetDerivedWarnings({});
  for (const k of USER_ENTERED_FIELDS) {
    assert.ok(!(k in patch), k + ' would be cleared by a recomputation');
  }
});

test('an acknowledgement and site notes survive a recomputation', () => {
  const d = { ...H.design,
    warningAcknowledgements: [{ code: 'ROOF_CLEARANCE_UNMEASURED', by: 'nick', at: 'now' }],
    siteNotes: [{ text: 'Roof access through the L’dry.' }] };
  const out = H.rerun(d);
  assert.equal(out.warningAcknowledgements.length, 1);
  assert.equal(out.siteNotes.length, 1);
});

test('recomputing an unchanged design does not grow the warning count', () => {
  let d = H.design;
  const counts = [];
  for (let i = 0; i < 4; i++) {
    const out = H.rerun(d);
    counts.push((out.routeWarnings || []).length);
    d = out;                                  // the app feeds the result back in
  }
  assert.deepEqual(counts, [counts[0], counts[0], counts[0], counts[0]],
    'route warnings grew across identical recomputations: ' + counts.join(','));
  assert.ok(counts[0] < 20, 'an implausible pile of route warnings: ' + counts[0]);
});

test('a resolved intermediate-state blocker does not survive the next run', () => {
  // Exactly what happened on the real job: the reconciliation failed at an
  // intermediate state, and the blocker stayed on the design for good.
  const stale = { code: 'SUPPLY_MAINS_DO_NOT_RECONCILE', severity: 'CRITICAL',
    message: 'The mains carry 2302 L/s against 901 L/s of outlets.' };
  const out = H.rerun({ ...H.design, routeWarnings: [stale] });
  assert.ok(!(out.routeWarnings || []).some(w => /2302/.test(w.message || '')),
    'the obsolete blocker is still on the design');
  const total = out.network.sections.filter(s => !s.parentId && s.role === 'main')
    .reduce((n, s) => n + s.airflowLs, 0);
  assert.equal(out.supplySpigots.totalLs, total);
  assert.ok(Math.abs(out.supplySpigots.totalLs - out.supplySpigots.reconciledLs) <= 2,
    'the live reconciliation does not agree either');
});

// ═══════════════════════════════════════════════════════════════════════════
// DEFECT 2 — an outlet override left the capacity check on the old quantity
// ═══════════════════════════════════════════════════════════════════════════

const openPlan = { id: 'r1', label: 'LIVING / DINING', roomType: 'living',
                   areaSqM: 53.07, widthMm: 6100, lengthMm: 8700 };

test('349 L/s cut from three outlets to two reports 175 L/s over capacity', () => {
  const row = designRoomOutlets(openPlan, 349, { quantity: 2 });
  assert.equal(row.quantity, 2);
  assert.equal(row.recommendedQuantity, 3);
  assert.equal(row.perOutletLs, 175);
  const over = row.warnings.find(w => w.code === 'OUTLET_OVER_CAPACITY');
  assert.ok(over, 'no over-capacity warning on 175 L/s through a 130 L/s diffuser');
  assert.match(over.message, /175 L\/s/);
  assert.match(over.message, /130 L\/s limit/);
  assert.match(over.message, /needs 3 of them/);
});

test('the same room at the calculated three outlets is not over capacity', () => {
  const row = designRoomOutlets(openPlan, 349, {});
  assert.equal(row.quantity, 3);
  assert.equal(row.perOutletLs, 116);
  assert.ok(!row.warnings.some(w => w.code === 'OUTLET_OVER_CAPACITY'));
});

test('the neck and the reasoning follow the overridden quantity, not the old one', () => {
  const auto = designRoomOutlets(openPlan, 349, {});
  const cut = designRoomOutlets(openPlan, 349, { quantity: 2 });
  // The neck is sized for what each outlet now carries.
  assert.equal(cut.neckMm, designRoomOutlets(openPlan, 350, { quantity: 2 }).neckMm);
  assert.ok(cut.neckVelocityMs > auto.neckVelocityMs,
    'the neck velocity is still the one worked out for three outlets');
  assert.ok(cut.reasons.some(r => /manually set to 2/.test(r) && /calculated 3/.test(r)),
    'the reasoning does not say what was overridden');
  assert.equal(cut.overridden, true);
  assert.equal(auto.overridden, false);
});

test('a room set to no outlet still says so loudly', () => {
  const row = designRoomOutlets(openPlan, 349, { quantity: 0 });
  assert.equal(row.quantity, 0);
  assert.equal(row.perOutletLs, 0);
  assert.ok(row.warnings.some(w => w.code === 'ROOM_HAS_NO_OUTLET'));
});

test('a type override is applied before the capacity check', () => {
  // 143 L/s is over a round diffuser's 130 and inside a linear bar's 160.
  const lounge = { id: 'r2', label: 'LOUNGE', roomType: 'living', areaSqM: 18.9,
                   widthMm: 4500, lengthMm: 4200 };
  const round = designRoomOutlets(lounge, 143, { quantity: 1 });
  assert.ok(round.warnings.some(w => w.code === 'OUTLET_OVER_CAPACITY'));
  const bar = designRoomOutlets(lounge, 143, { quantity: 1, type: 'linear_bar' });
  assert.equal(bar.type, 'linear_bar');
  assert.ok(!bar.warnings.some(w => w.code === 'OUTLET_OVER_CAPACITY'),
    'a linear bar rated to 160 L/s was still reported over capacity at 143');
});

test('the override reaches the outlet schedule, not just the row', () => {
  const out = designOutlets([openPlan],
    [{ roomId: 'r1', label: 'LIVING / DINING', adjustedLs: 349 }],
    { overridesByRoomId: { r1: { quantity: 2 } } });
  assert.equal(out.totals.total, 2);
  assert.ok(out.warnings.some(w => w.code === 'OUTLET_OVER_CAPACITY'),
    'the schedule reports no capacity problem at 175 L/s per outlet');
});

// ═══════════════════════════════════════════════════════════════════════════
// DEFECT 3 — the grille size never reached the drawing
// ═══════════════════════════════════════════════════════════════════════════

test('one reader takes either spelling of a grille dimension', () => {
  assert.deepEqual(grilleDimensionsOf({ grilleWidthMm: 700, grilleHeightMm: 500 }),
    { widthMm: 700, heightMm: 500, text: '700 × 500 mm' });
  assert.deepEqual(grilleDimensionsOf({ widthMm: 700, heightMm: 500 }),
    { widthMm: 700, heightMm: 500, text: '700 × 500 mm' });
  // And a record that only carries the printed text still yields numbers.
  assert.deepEqual(grilleDimensionsOf({ grilleSize: '700 × 500 mm' }),
    { widthMm: 700, heightMm: 500, text: '700 × 500 mm' });
  assert.equal(grilleSizeText(700, 500), '700 × 500 mm');
  assert.equal(grilleSizeText(null, 500), null);
});

test('the component model carries the chosen size in both spellings', () => {
  const rc = buildReturnComponents({ returnDesign: {
    returns: [{ id: 'R1', airflowLs: 450, grilleWidthMm: 700, grilleHeightMm: 500,
                grilleSize: '700 × 500 mm' }], duct: { diameterMm: 400 } } });
  const g = rc.grilles[0];
  assert.equal(g.widthMm, 700);
  assert.equal(g.heightMm, 500);
  assert.equal(g.grilleWidthMm, 700);
  assert.equal(g.grilleHeightMm, 500);
  assert.equal(g.grilleSize, '700 × 500 mm');
});

test('700 x 500 reaches the drawing, the schedule and the BOM on a real design', () => {
  const drawn = H.out.returnComponents.grilles;
  assert.equal(drawn.length, 2);
  for (const g of drawn) {
    assert.equal(g.widthMm, 700, 'the drawing has no width for ' + g.id);
    assert.equal(g.heightMm, 500, 'the drawing has no height for ' + g.id);
    assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y), g.id + ' is not placed');
  }
  const line = H.out.bom.items.find(i => i.key === 'return_grille');
  assert.match(line.label, /700 x 500 mm/);
  assert.equal(line.designedSize, '700 x 500 mm');
});

test('the return velocities are finite numbers, not Infinity on a missing size', () => {
  for (const r of H.out.returnDesign.returns) {
    assert.ok(Number.isFinite(r.grossFaceVelocityMs), r.id + ' gross velocity is not a number');
    assert.ok(Number.isFinite(r.effectiveFreeAreaVelocityMs));
    assert.ok(r.effectiveFreeAreaVelocityMs <= 2.0,
      r.id + ' at ' + r.effectiveFreeAreaVelocityMs + ' m/s is over the 2 m/s limit');
    assert.equal(r.freeAreaVerified, false,
      'the 72% free-area assumption is being presented as verified');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DEFECT 4 — the spigot choice was made on an average no duct carries
// ═══════════════════════════════════════════════════════════════════════════

test('installer areas are packed onto mains whole, never split', () => {
  const three = groupAreasIntoMains(AREA_AIRFLOWS, 3);
  assert.deepEqual(three.mains.map(m => m.airflowLs).sort((a, b) => b - a), [349, 284, 267]);
  assert.ok(three.mains.every(m => m.areas.length === 1));
  const two = groupAreasIntoMains(AREA_AIRFLOWS, 2);
  assert.equal(two.mains.reduce((n, m) => n + m.areas.length, 0), 3);
  assert.equal(two.mains.reduce((n, m) => n + m.airflowLs, 0), 900);
  assert.ok(two.mains.every(m => m.areas.length >= 1), 'a main was left with no area');
});

const UNIT = { model: 'FDYQN180LCV1', capacityKw: 18, supplyFlangeText: '350 x 918',
               availableStaticPa: 210, ratedAirflowLs: 1200 };
const candidate = (job, count, diameterMm) => {
  const r = selectSupplySpigotArrangement(job);
  return [...r.ranked, ...r.rejected].find(c => c.count === count && c.diameterMm === diameterMm);
};

test('two spigots averaging 450 L/s are measured on the 616 they really carry', () => {
  const job = { unit: UNIT, systemAirflowLs: 900, availableStaticPa: 210,
                installerAreaCount: 3, mainAirflowsLs: [616, 284], longestMainRouteM: 7.2 };
  const c = candidate(job, 2, 400);
  assert.equal(c.actualPerMainAirflow, true);
  assert.equal(c.perDuctAirflowLs, 450, 'the average should still be reported');
  assert.deepEqual(c.mains.map(m => m.airflowLs), [616, 284]);
  assert.equal(c.heaviestMainLs, 616);
  // The arrangement is judged on its worst main, not on the average.
  assert.equal(c.velocityMs, c.mains[0].velocityMs);
  assert.ok(c.velocityMs > 4.5 && c.velocityMs < 5.5, '616 L/s in a ø400 is about 4.9 m/s');
  assert.ok(c.notes.some(n => n.code === 'MAINS_UNEVEN'),
    'a 616 / 284 split was not reported as uneven');
  assert.ok(c.imbalancePct > 50);
});

test('the same split at ø350 breaches the target velocity the average hides', () => {
  const job = { unit: UNIT, systemAirflowLs: 900, availableStaticPa: 210,
                installerAreaCount: 3, mainAirflowsLs: [616, 284], longestMainRouteM: 7.2 };
  const c = candidate(job, 2, 350);
  const band = DEFAULT_SETTINGS.duct.velocity.main;
  assert.ok(c.velocityMs > band.preferred, '616 L/s in a ø350 is above the 6 m/s target');
  assert.ok(c.notes.some(n => n.code === 'MAIN_ABOVE_TARGET_VELOCITY'));
  // The average would have passed silently, which is the whole defect.
  const averageVelocity = c.mains[1].velocityMs;           // 284 L/s, the light main
  assert.ok(averageVelocity < band.preferred);
  assert.match(c.notes.find(n => n.code === 'MAIN_ABOVE_TARGET_VELOCITY').message,
    /450 L\/s average/);
});

test('a single main over the ceiling rejects the arrangement the average passes', () => {
  const job = { unit: UNIT, systemAirflowLs: 1300, availableStaticPa: 210,
                installerAreaCount: 3, mainAirflowsLs: [1100, 200], longestMainRouteM: 7.2 };
  const c = candidate(job, 2, 350);
  assert.equal(c.feasible, false, 'an 11 m/s main was accepted');
  const b = c.blockers.find(x => x.code === 'OVER_VELOCITY');
  assert.ok(b);
  assert.match(b.message, /1100 L\/s/);
  assert.match(b.message, /650 L\/s average passes/);
  // And the average on its own would have been inside the ceiling.
  const averageOnly = candidate({ ...job, mainAirflowsLs: null }, 2, 350);
  assert.equal(averageOnly.feasible, true);
  assert.equal(averageOnly.actualPerMainAirflow, false);
});

test('three real installer areas choose three mains, and say what each carries', () => {
  const r = selectSupplySpigotArrangement({ unit: UNIT, systemAirflowLs: 900,
    availableStaticPa: 210, installerAreas: AREA_AIRFLOWS, longestMainRouteM: 7.2,
    outletCount: 9 });
  assert.equal(r.chosen.count, 3);
  assert.equal(r.chosen.diameterMm, 400);
  assert.equal(r.decidedByOutletCount, false);
  assert.equal(r.inputs.perMainAirflowBasis, 'actual grouped installer areas');
  assert.deepEqual(r.chosen.mains.map(m => m.airflowLs).sort((a, b) => b - a), [349, 284, 267]);
  assert.match(r.summary, /349 L\/s/);
  assert.ok(r.ranked.every(c => c.actualPerMainAirflow));
});

test('the routed design re-measures the selection on the mains that were built', () => {
  const sel = H.out.spigotSelection;
  const built = H.out.network.sections.filter(s => !s.parentId && s.role === 'main')
    .map(s => s.airflowLs);
  assert.equal(sel.inputs.perMainAirflowBasis, 'measured on the routed mains');
  assert.deepEqual(sel.chosen.mains.map(m => m.airflowLs).sort((a, b) => b - a),
                   [...built].sort((a, b) => b - a));
});
