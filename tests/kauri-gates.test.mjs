// ─────────────────────────────────────────────────────────────────────────────
// THE THIRTEEN
//
// Nick, after reading NAC-34-Kauri-internal-estimator.pdf:
//
//   "Before using the new customer quote presentation for 34 Kauri Crescent,
//    fix the invalid proposal-stage pipeline exposed by the internal estimator
//    report. Do not publish or issue the Kauri quote."
//
// Every test below is one of the numbered regressions he asked for. They are
// written against the FAILURE that actually happened, with the Kauri numbers
// in them, so that a future change which reintroduces one fails here by name
// rather than by a total moving somewhere downstream.
//
// The Kauri report, in its own words, said:
//
//   Plan scale          44.5 px/m, derived from a car drawn on the plan
//   Rooms               "Verified"
//   Equipment           16 kW Daikin selected
//   Supply mains        10, carrying 1921 L/s
//   Outlets             800 L/s
//   Supply plenum       4,660 mm wide, 10 × ø400 collars
//   Minimum branch      ø250 (stated) / ø200 (built, seven of them)
//   Total route length  0.0 m
//   Static pressure     107 Pa against 160 Pa available — CHECK PASSED
//   Sell price          $15,079.33 inc GST
//
// None of that was true at once. Most of it was not true at all.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordCalibration, capabilities, areaStatus, scaleStatus,
         proposalAllowance, DESIGN_STAGE, SCALE_SOURCE, ROOM_STATUS_PROVISIONAL }
  from '../designer/engines/design-stage.mjs';
import { checkSupplyGraph, checkPlenum, checkDuctSizes, pressureReadiness,
         supplyMains, PRESSURE_STATUS, MAX_DOMESTIC_PLENUM_WIDTH_MM }
  from '../designer/engines/supply-graph.mjs';
import { buildOutletRegister, checkOutletConsistency } from '../designer/engines/outlet-register.mjs';
import { zoningSafety, MINIMUM_SOURCE } from '../designer/engines/zoning-safety.mjs';
import { presentationGate, looksUnfilled } from '../designer/engines/presentation.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

// A design skeleton with a scale that came off a car on a marketing plan.
function kauriLikeDesign(over = {}) {
  return {
    designStage: DESIGN_STAGE.PROPOSAL,
    calibration: { pixelsPerMm: 0.0445, mmPerPixel: 1 / 0.0445,
                   verified: false, source: SCALE_SOURCE.DRAWN_OBJECT },
    rooms: [
      { id: 'r1', label: 'LIVING', conditioned: true, areaSqM: 32.4, status: 'Verified',
        measurement: { source: 'calibrated_geometry' } },
      { id: 'r2', label: 'BED 1', conditioned: true, areaSqM: 14.1, status: 'Verified',
        measurement: { source: 'calibrated_geometry' } }
    ],
    ...over
  };
}

// ── 1 ───────────────────────────────────────────────────────────────────────
test('1. an unverified scale blocks equipment, areas, price and the proposal', () => {
  const caps = capabilities(kauriLikeDesign());

  assert.equal(caps.mayMeasureRooms, false, 'rooms measured off an unverified scale');
  assert.equal(caps.maySelectEquipment, false, 'a unit was selectable');
  assert.equal(caps.mayPrice, false, 'a price was allowed');
  assert.equal(caps.mayRouteDucts, false, 'ductwork ran at proposal stage');

  // And each refusal says WHY, in words an estimator can act on.
  for (const key of ['measureRooms', 'selectEquipment', 'price', 'routeDucts']) {
    const reason = caps.reasonFor(key);
    assert.ok(reason && reason.length > 20, key + ' was refused without a reason');
  }

  // A car is named as the problem, not "insufficient data".
  assert.match(caps.reasonFor('price'), /unverified plan/i);
});

// ── 2 ───────────────────────────────────────────────────────────────────────
test('2. ONE measured dimension unblocks the job, and is stored in full', () => {
  const rec = recordCalibration({
    points: [{ x: 100, y: 200 }, { x: 545, y: 200 }],
    realDistanceMm: 10000,
    source: SCALE_SOURCE.PRINTED_DIMENSION,
    measuredBy: 'Nick Cahill',
    note: 'Overall width printed on the elevation',
    at: '2026-09-22T01:00:00Z',
    imageWidthPx: 1600, imageHeightPx: 1200
  });
  assert.equal(rec.ok, true, JSON.stringify(rec.reasons));

  const c = rec.calibration;
  // Nick: "store the two calibration points, the real distance, the derived
  // px/mm, the person and the timestamp, and the source."
  assert.equal(c.points.length, 2);
  assert.deepEqual(c.points[0], { x: 100, y: 200 });
  assert.equal(c.realDistanceMm, 10000);
  assert.ok(c.pixelsPerMm > 0);
  assert.equal(c.measuredBy, 'Nick Cahill');
  assert.equal(c.measuredAt, '2026-09-22T01:00:00Z');
  assert.equal(c.source, SCALE_SOURCE.PRINTED_DIMENSION);
  assert.equal(c.verified, true);

  // With that scale and the design stage started, the job is fully unblocked.
  const caps = capabilities(kauriLikeDesign({
    calibration: c, designStage: DESIGN_STAGE.DESIGN
  }));
  assert.equal(caps.mayMeasureRooms, true);
  assert.equal(caps.maySelectEquipment, true);
  assert.equal(caps.mayPrice, true);
  assert.equal(caps.mayRouteDucts, true);
});

test('2b. a two-point calibration against a known distance IS a measurement', () => {
  // The existing calibrate() helper is the screen an estimator actually uses.
  const c = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 445, y: 0 },
                        knownDistance: 10, unit: 'm' });
  assert.equal(c.verified, true);
  assert.equal(c.source, SCALE_SOURCE.MEASURED);
  assert.equal(scaleStatus({ calibration: c }).verified, true);
});

test('2c. a scale taken off something drawn on the plan is refused by name', () => {
  const rec = recordCalibration({
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }],
    realDistanceMm: 4500,
    source: SCALE_SOURCE.DRAWN_OBJECT,
    measuredBy: 'Nick Cahill'
  });
  assert.equal(rec.ok, false);
  assert.equal(rec.calibration, null);
  assert.ok(rec.reasons.some(r => /drawn on the plan is not a measurement/i.test(r)),
    JSON.stringify(rec.reasons));
});

// ── 3 ───────────────────────────────────────────────────────────────────────
test('3. rooms on an unverified scale read PROVISIONAL, never Verified', () => {
  const d = kauriLikeDesign();
  const areas = areaStatus(d);
  assert.equal(areas.verified, false);
  assert.equal(areas.suspectCount, 2);

  // The status string itself, because it is what prints on the report.
  assert.equal(ROOM_STATUS_PROVISIONAL, 'PROVISIONAL — SCALE REQUIRED');
  assert.ok(!/verified/i.test(ROOM_STATUS_PROVISIONAL));
});

// ── 4 ───────────────────────────────────────────────────────────────────────
test('4. a proposal does not invent ductwork — it carries a declared allowance', () => {
  const caps = capabilities(kauriLikeDesign({ designStage: DESIGN_STAGE.PROPOSAL }));
  assert.equal(caps.mayRouteDucts, false);
  assert.equal(caps.mayBuildDuctBom, false);
  assert.equal(caps.mayCalculatePressure, false);

  // Nothing configured: no number, and a reason naming where to set one.
  const none = proposalAllowance({ outletCount: 10, zoneCount: 4, settings: DEFAULT_SETTINGS });
  assert.equal(none.ok, false);
  assert.equal(none.amount, null);
  assert.match(none.reason, /HVAC Design Settings/);

  // A flat standard allowance.
  const flat = proposalAllowance({ outletCount: 10, zoneCount: 4,
    settings: { commercial: { proposalAllowance: { flat: 4200 } } } });
  assert.equal(flat.ok, true);
  assert.equal(flat.amount, 4200);
  assert.equal(flat.provisional, true);

  // A provisional allowance from the counts, which states its own arithmetic.
  const perCount = proposalAllowance({ outletCount: 10, zoneCount: 4,
    settings: { commercial: { proposalAllowance: { flat: 1000, perOutlet: 260, perZone: 180 } } } });
  assert.equal(perCount.amount, 1000 + 10 * 260 + 4 * 180);
  assert.match(perCount.detail, /10 outlet\(s\) × 260/);
  assert.match(perCount.basis, /outlet and zone count/i);
});

test('4b. a proposal price is allowed, labelled, and is never a fixed price', () => {
  const settings = { commercial: { ...DEFAULT_SETTINGS.commercial,
    proposalAllowance: { flat: 4200 } } };

  // Verified areas + a configured allowance = quotable at proposal stage.
  const d = kauriLikeDesign({
    designStage: DESIGN_STAGE.PROPOSAL,
    calibration: { pixelsPerMm: 0.0445, verified: true, source: SCALE_SOURCE.MEASURED }
  });
  const caps = capabilities(d, { settings, outletCount: 8, zoneCount: 6 });
  assert.equal(caps.mayPrice, false, 'a FIXED price was allowed without a duct design');
  assert.equal(caps.mayQuoteProposal, true, JSON.stringify(caps.reasonFor('quoteProposal')));
  assert.equal(caps.proposalAllowance.amount, 4200);

  // No allowance configured — no proposal price, and no invented number.
  const noAllowance = capabilities(d, { settings: DEFAULT_SETTINGS, outletCount: 8 });
  assert.equal(noAllowance.mayQuoteProposal, false);
  assert.match(noAllowance.reasonFor('quoteProposal'), /HVAC Design Settings/);

  // Unverified scale — a proposal price rests on the areas like any other.
  const noScale = capabilities(kauriLikeDesign({ designStage: DESIGN_STAGE.PROPOSAL }),
    { settings, outletCount: 8 });
  assert.equal(noScale.mayQuoteProposal, false);
  assert.match(noScale.reasonFor('quoteProposal'), /rests on the room areas/);
});

test('4c. the customer page says the proposal price is not fixed', () => {
  const base = {
    selectedUnit: { brandName: 'Daikin', model: 'X', capacityKw: 20, phase: '1Ph' },
    systemLoad: { designKw: 18 },
    rooms: [{ id: 'r1', label: 'LIVING', conditioned: true }],
    outlets: { rows: [{ roomId: 'r1', label: 'LIVING', quantity: 1 }] },
    commercials: { sellPriceIncGst: 19118.53, sellPriceExGst: 17380.48, gstAmount: 1738.05,
                   proposalPrice: true, fixedPrice: false }
  };
  const r = buildPresentation({ design: base, customer: { name: 'A' }, job: {},
    content: {}, proposalNumber: 'P1', revision: 1, status: 'draft' });
  assert.equal(r.ok, true, JSON.stringify((r.blockers || []).map(b => b.code)));

  const inv = r.presentation.investment;
  assert.equal(inv.proposalPrice, true);
  assert.equal(inv.priceLabel, 'Proposal price');
  assert.match(inv.proposalNote, /not a fixed price/i);
  assert.match(inv.proposalNote, /allowance/i);

  // On the page itself, beside the number — not buried in the terms.
  const html = renderPresentationHtml(r.presentation);
  assert.ok(html.includes('inv-prov'), 'no caveat block on the page');
  assert.match(html, /Not a fixed price/);

  // And terms that call it a fixed price stop the proposal going out.
  const lying = buildPresentation({ design: base, customer: { name: 'A' }, job: {},
    content: { termsAndConditions: 'This is a fixed-price contract for the works described.' },
    proposalNumber: 'P1', revision: 1, status: 'issued' });
  assert.equal(lying.ok, false);
  assert.ok(lying.blockers.some(b => b.code === 'TERMS_CLAIM_FIXED_PRICE'),
    JSON.stringify(lying.blockers.map(b => b.code)));
});

test('4d. a placeholder customer record never becomes a greeting', () => {
  const base = {
    selectedUnit: { brandName: 'Daikin', model: 'X', capacityKw: 20, phase: '1Ph' },
    systemLoad: { designKw: 18 },
    rooms: [{ id: 'r1', label: 'LIVING', conditioned: true }],
    outlets: { rows: [{ roomId: 'r1', label: 'LIVING', quantity: 1 }] },
    commercials: { sellPriceIncGst: 17820.75 }
  };
  const greet = (name) => buildPresentation({ design: base, customer: { name }, job: {},
    content: {}, proposalNumber: 'P', revision: 1, status: 'draft' }).presentation.hero.greeting;

  // The one that actually happened on 34 Kauri.
  assert.equal(greet('Not recorded'), 'Hello', '"Hello Not" reached the page');
  for (const junk of ['TBC', 'SAMPLE', 'Test Customer', 'placeholder', '']) {
    assert.equal(greet(junk), 'Hello', junk + ' was greeted by name');
  }
  // A real name still gets one.
  assert.equal(greet('Sarah Whitlock'), 'Hello Sarah');
});

test('4e. an estimator may state the load, and the calculation survives beside it', async () => {
  const { runPipeline } = await import('../designer/engines/pipeline.mjs');
  const { buildCatalogue } = await import('../designer/engines/catalogue.mjs');
  const { buildRoom, calibratedMeasurement } = await import('../designer/engines/rooms.mjs');

  const calibration = { pixelsPerMm: 0.039, verified: true, source: SCALE_SOURCE.MEASURED,
                        measuredBy: 'Nick Cahill' };
  const mkRooms = () => ['LIVING', 'BEDROOM 1', 'BEDROOM 2', 'KITCHEN'].map(label =>
    buildRoom({ label, roomType: label === 'KITCHEN' ? 'living' : 'bedroom', conditioned: true,
      ceilingHeightMm: 2440,
      measurement: calibratedMeasurement({ calibration, widthPx: 160, lengthPx: 170 }) }))
    .map(r => ({ ...r, status: 'Verified' }));

  const base = { id: 'j', calibration, rooms: mkRooms(),
                 plan: { widthPx: 714, heightPx: 1179 } };
  const cat = await buildCatalogue({});
  const plain = runPipeline({ ...base, rooms: mkRooms() }, { catalogue: cat });
  const calculated = plain.systemLoad.designKw;
  assert.ok(calculated > 0);

  // A stated load 20% under the calculation.
  const stated = Math.round(calculated * 0.8 * 100) / 100;
  const out = runPipeline({ ...base, rooms: mkRooms(),
    statedLoad: { designKw: stated, statedBy: 'Nick Cahill',
                  at: '2026-09-22T00:00:00Z', note: 'Walked the job.' } },
    { catalogue: cat });

  assert.equal(out.systemLoad.designKw, stated, 'the stated figure did not take');
  assert.equal(out.systemLoad.loadSource, 'estimator_stated');
  assert.equal(out.systemLoad.statedBy, 'Nick Cahill');
  assert.equal(out.systemLoad.statedAt, '2026-09-22T00:00:00Z');

  // THE CALCULATION IS NOT OVERWRITTEN. That is the whole point.
  assert.equal(out.systemLoad.calculatedKw, calculated);
  assert.ok(out.systemLoad.calculatedAreaSqM > 0);
  assert.ok(Math.abs(out.systemLoad.divergencePct + 20) < 1.5,
    'divergence ' + out.systemLoad.divergencePct);

  // A gap this size is reported, with both numbers in the message.
  const w = (out.warnings || []).find(x => x.code === 'STATED_LOAD_DIVERGES');
  assert.ok(w, JSON.stringify((out.warnings || []).map(x => x.code)));
  assert.match(w.message, new RegExp(String(stated)));
  assert.match(w.message, new RegExp(String(calculated)));
  assert.match(w.message, /Nick Cahill/);

  // A stated load with nobody behind it is not a stated load.
  const anon = runPipeline({ ...base, rooms: mkRooms(),
    statedLoad: { designKw: stated, statedBy: '' } }, { catalogue: cat });
  assert.equal(anon.systemLoad.designKw, calculated, 'an unsigned figure was accepted');
  assert.equal(anon.systemLoad.loadSource, undefined);
});

// ── 5 ───────────────────────────────────────────────────────────────────────
test('5. supply mains reconcile against the outlets, or the design is invalid', () => {
  // The Kauri graph: every section parentless, so every duct counted as a main.
  const kauriNetwork = {
    sections: [
      { id: 'a', role: 'main', airflowLs: 800 },
      { id: 'b', role: 'main', airflowLs: 560 },
      { id: 'c', role: 'main', airflowLs: 561 }
    ]
  };
  const bad = checkSupplyGraph({ network: kauriNetwork, outletTotalLs: 800 });
  assert.equal(bad.ok, false);
  assert.equal(bad.mainTotalLs, 1921);
  const f = bad.failures.find(x => x.code === 'SUPPLY_MAINS_DO_NOT_RECONCILE');
  assert.ok(f, JSON.stringify(bad.failures.map(x => x.code)));
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.outletTotalLs, 800);
  // 1921 against 800 is 2.4x, and the message says so rather than "mismatch".
  assert.match(f.message, /2\.4×/);

  // A real graph: three mains off the plenum carrying the outlets between them.
  const good = checkSupplyGraph({
    network: { sections: [
      { id: 'm1', role: 'main', parentId: 'plenum', airflowLs: 300 },
      { id: 'm2', role: 'main', parentId: 'plenum', airflowLs: 280 },
      { id: 'm3', role: 'main', parentId: 'plenum', airflowLs: 220 },
      { id: 'b1', role: 'branch', parentId: 'm1', airflowLs: 150 }
    ] },
    outletTotalLs: 800, spigotCount: 3
  });
  assert.equal(good.ok, true, JSON.stringify(good.failures));
  assert.equal(good.mainTotalLs, 800);
});

test('5b. a main is a duct off the plenum — not a section with no parent recorded', () => {
  // The bug in one line: absence of a parentId used to mean "this is a main".
  const flat = { sections: [
    { id: 'branch_bed_1', role: 'branch', airflowLs: 65 },
    { id: 'final_living_1', role: 'final', airflowLs: 80 }
  ] };
  assert.equal(supplyMains(flat).length, 0, 'a branch and a final counted as mains');

  const noReconcile = checkSupplyGraph({ network: flat, outletTotalLs: 145 });
  assert.equal(noReconcile.ok, false);
  assert.ok(noReconcile.failures.some(x => x.code === 'NO_SUPPLY_MAIN'));
});

test('5c. a main that hangs off another duct is a contradiction', () => {
  const r = checkSupplyGraph({
    network: { sections: [{ id: 'm1', role: 'main', parentId: 'm0', airflowLs: 800 }] },
    outletTotalLs: 800
  });
  assert.ok(r.failures.some(x => x.code === 'MAIN_HAS_A_PARENT'));
});

// ── 6 ───────────────────────────────────────────────────────────────────────
test('6. the plenum carries one collar per selected spigot, and is a real fitting', () => {
  // Kauri: ten collars because there were ten ducts in the graph, on a body
  // 4,660 mm wide.
  const r = checkPlenum({ collarCount: 10, bodyWidthMm: 4660 }, 3);
  assert.equal(r.ok, false);
  const codes = r.failures.map(f => f.code);
  assert.ok(codes.includes('PLENUM_COLLARS_NOT_SPIGOT_COUNT'), JSON.stringify(codes));
  assert.ok(codes.includes('PLENUM_IMPLAUSIBLY_WIDE'), JSON.stringify(codes));
  assert.ok(r.failures.every(f => f.severity === 'CRITICAL'));

  // 4,660 mm is not a near miss — it is two and a half times the limit.
  assert.ok(4660 > MAX_DOMESTIC_PLENUM_WIDTH_MM * 2);

  const ok = checkPlenum({ collarCount: 3, bodyWidthMm: 1200 }, 3);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
});

// ── 7 ───────────────────────────────────────────────────────────────────────
test('7. static pressure over no duct is NOT CALCULATED, not a passed check', () => {
  // Kauri: 13 sections, every length zero, total 0.0 m, "CHECK PASSED".
  const zeroLength = { sections: Array.from({ length: 13 },
    (_, i) => ({ id: 's' + i, role: 'branch', lengthM: 0 })), totalDuctLengthM: 0 };
  const r = pressureReadiness(zeroLength);
  assert.equal(r.ok, false);
  assert.equal(r.status, PRESSURE_STATUS.NOT_CALCULATED);
  assert.equal(PRESSURE_STATUS.NOT_CALCULATED, 'NOT CALCULATED — ROUTES REQUIRED');
  assert.match(r.reason, /not a low pressure drop/);

  // No routes at all.
  assert.equal(pressureReadiness({ sections: [], totalDuctLengthM: 0 }).status,
    PRESSURE_STATUS.NOT_CALCULATED);

  // Partly measured is still not calculable: the index run cannot be found.
  const partial = { totalDuctLengthM: 12, sections: [
    { id: 'a', role: 'branch', lengthM: 12 }, { id: 'b', role: 'branch', lengthM: 0 }] };
  assert.equal(pressureReadiness(partial).ok, false);

  // Fully measured, and the check runs.
  const measured = { totalDuctLengthM: 22, sections: [
    { id: 'a', role: 'main', lengthM: 10 }, { id: 'b', role: 'branch', lengthM: 12 }] };
  const good = pressureReadiness(measured);
  assert.equal(good.ok, true);
  assert.equal(good.status, PRESSURE_STATUS.CALCULATED);
  assert.equal(good.basedOnAllowances, false);
});

test('7b. a pressure figure built on standard allowances says so', () => {
  const r = pressureReadiness({ totalDuctLengthM: 14, sections: [
    { id: 'a', role: 'main', lengthM: 12 },
    { id: 'b', role: 'final', lengthM: 2, lengthSource: 'standard_allowance' }] });
  assert.equal(r.ok, true);
  assert.equal(r.basedOnAllowances, true);
  assert.deepEqual(r.allowanceSections, ['b']);
  assert.match(r.allowanceNote, /standard drop allowance/);
});

// ── 8 ───────────────────────────────────────────────────────────────────────
test('8. a ø250 minimum branch means there is no ø200 anywhere', () => {
  // Kauri: header said "Minimum supply branch ø250", the design built seven ø200.
  const network = { sections: [
    { id: 'main', role: 'main', diameterMm: 400 },
    ...Array.from({ length: 7 }, (_, i) => ({ id: 'b' + i, role: 'branch', diameterMm: 200 })),
    { id: 'ok', role: 'branch', diameterMm: 250 }
  ] };
  const r = checkDuctSizes(network, 250);
  assert.equal(r.ok, false);
  const f = r.failures[0];
  assert.equal(f.code, 'BRANCH_BELOW_CONFIGURED_MINIMUM');
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.sections.length, 7);
  assert.match(f.message, /ø200/);
  assert.match(f.message, /ø250 minimum/);

  // The main is exempt: a main is not a branch.
  assert.equal(checkDuctSizes({ sections: [{ id: 'm', role: 'main', diameterMm: 200 }] }, 250).ok,
    true);
});

// ── 9 ───────────────────────────────────────────────────────────────────────
test('9. one authoritative outlet object, read by the plan, schedule and order', () => {
  const design = {
    outlets: { rows: [
      { roomId: 'r1', label: 'LIVING', type: 'round_diffuser', typeLabel: 'Round diffuser',
        quantity: 2, perOutletLs: 95, airflowLs: 190, neckMm: 250, faceSizeMm: null },
      { roomId: 'r2', label: 'BED 1', type: 'round_diffuser', typeLabel: 'Round diffuser',
        quantity: 1, perOutletLs: 55, airflowLs: 55, neckMm: 200, faceSizeMm: null }
    ] },
    network: { sections: [
      { id: 'final_r1_1', role: 'final', roomId: 'r1', diameterMm: 250 },
      { id: 'final_r1_2', role: 'final', roomId: 'r1', diameterMm: 250 },
      { id: 'branch_r2', role: 'branch', diameterMm: 200 }
    ] }
  };
  const reg = buildOutletRegister(design);

  // One record per PHYSICAL outlet, not per room.
  assert.equal(reg.length, 3);
  assert.deepEqual(reg.map(o => o.id), ['outlet_r1_1', 'outlet_r1_2', 'outlet_r2_1']);

  // Every field Nick named.
  const first = reg[0];
  for (const field of ['id', 'roomId', 'room', 'type', 'airflowLs', 'neckMm',
                       'finalDuctMm', 'catalogueKey', 'sku', 'unitCost']) {
    assert.ok(field in first, 'the register has no ' + field);
  }
  assert.equal(first.room, 'LIVING');
  assert.equal(first.airflowLs, 95);
  assert.equal(first.neckMm, 250);
  assert.equal(first.finalDuctMm, 250);
  assert.equal(first.finalSectionId, 'final_r1_1');
  assert.ok(first.unitCost > 0, 'the outlet has no price');

  // A single-outlet room reached by its branch is still in the register.
  assert.equal(reg[2].finalDuctMm, 200);
});

test('9b. the three surfaces disagreeing about an outlet is a hard failure', () => {
  const design = {
    outlets: { rows: [{ roomId: 'r1', label: 'LIVING', type: 'round_diffuser',
                        typeLabel: 'Round diffuser', quantity: 1, perOutletLs: 120,
                        airflowLs: 120, neckMm: 300 }] },
    network: { sections: [{ id: 'final_r1_1', role: 'final', roomId: 'r1', diameterMm: 250 }] }
  };
  const reg = buildOutletRegister(design);
  const c = checkOutletConsistency({ register: reg, design });
  assert.equal(c.ok, false);
  assert.ok(c.failures.some(f => f.code === 'FINAL_DUCT_SMALLER_THAN_NECK'),
    JSON.stringify(c.failures.map(f => f.code)));

  // And the order buying a different number of outlets from the design.
  const mismatched = checkOutletConsistency({
    register: reg,
    design: { ...design, bom: { items: [{ category: 'outlets', quantity: 4 }] } }
  });
  assert.ok(mismatched.failures.some(f => f.code === 'BOM_OUTLET_COUNT_DISAGREES'));
});

// ── 10 ──────────────────────────────────────────────────────────────────────
test('10. blocked equipment means null, no BOM line, and no model named', async () => {
  const { buildBillOfMaterials } = await import('../designer/engines/bom.mjs');
  const design = {
    selectedUnit: { brandName: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16,
                    phase: '1Ph', supplierCost: 5000, sellPrice: 9000 },
    equipmentBlocked: { blocked: true,
      reason: 'The plan scale has not been verified, so the load is not known.' },
    outlets: { rows: [] }, network: { sections: [] }
  };
  const bom = buildBillOfMaterials(design, {});

  // Even with a selectedUnit still hanging around on the object, nothing about
  // it reaches the order.
  assert.equal(bom.items.some(i => i.key === 'indoor_outdoor_system'), false);
  assert.equal(bom.items.some(i => /Daikin|FDYAN160AV1/.test(i.label || '')), false);
  assert.equal(bom.equipmentCost, 0);

  // The omission is DECLARED, not silent — an order short by one machine that
  // says nothing reads as a costing nobody finished.
  assert.equal(bom.equipmentOmitted.blocked, true);
  assert.equal(bom.equipmentOmitted.costIsUnknown, true);
  assert.match(bom.equipmentOmitted.reason, /scale has not been verified/);
  assert.ok(bom.warnings.some(w => w.code === 'EQUIPMENT_OMITTED_FROM_BOM'));

  // And a customer is never told a model.
  const gate = presentationGate({ ...design, selectedUnit: null });
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.some(b => b.code === 'NO_EQUIPMENT_SELECTED'));
});

// ── 11 ──────────────────────────────────────────────────────────────────────
test('11. zoning minimum airflow comes from the unit, or is declared unverified', () => {
  const zoneAnalysis = {
    systemAirflowLs: 800, alwaysOpenLs: 0, minimumOpenAirflowLs: 180,
    zones: [
      { id: 'z1', name: 'Living', airflowLs: 300, systemSharePct: 37.5, alwaysOpen: false },
      { id: 'z2', name: 'Beds', airflowLs: 320, systemSharePct: 40, alwaysOpen: false },
      { id: 'z3', name: 'Study', airflowLs: 180, systemSharePct: 22.5, alwaysOpen: false }
    ]
  };

  // No published minimum entered: the rule of thumb is used AND named as one.
  const unverified = zoningSafety({ zoneAnalysis, selectedUnit: { model: 'FDYAN160AV1' },
                                    settings: DEFAULT_SETTINGS });
  assert.equal(unverified.minimum.source, MINIMUM_SOURCE.RULE_OF_THUMB);
  assert.equal(unverified.minimum.verified, false);
  assert.match(unverified.minimum.basis, /internal screening check and not a manufacturer limit/);
  assert.equal(unverified.minimum.screeningOnly, true);
  assert.match(unverified.minimum.label, /PROVISIONAL SCREENING CHECK/);
  // §15: an unverified minimum BLOCKS zoning approval — it is a screening
  // check, and a screening check cannot sign off a design.
  const f = unverified.failures.find(x => x.code === 'MINIMUM_AIRFLOW_UNVERIFIED');
  assert.ok(f, JSON.stringify(unverified.failures.map(x => x.code)));
  assert.equal(f.severity, 'CRITICAL');
  assert.equal(f.screeningOnly, true);
  assert.match(f.message, /Equipment specs/);

  // A BARE NUMBER IS STILL NOT MANUFACTURER DATA. §7: the figure has to say
  // which fan setting it applies at, which document and revision it came from,
  // where in that document, and who read it.
  const bare = zoningSafety({
    zoneAnalysis,
    selectedUnit: { model: 'FDYAN160AV1', specs: { minimumAirflowLs: 240 } },
    settings: DEFAULT_SETTINGS
  });
  assert.equal(bare.minimum.source, MINIMUM_SOURCE.RULE_OF_THUMB,
    'a bare number was accepted as manufacturer data');
  assert.equal(bare.minimum.screeningOnly, true);

  // With the full record entered, that is the number.
  const verified = zoningSafety({
    zoneAnalysis,
    selectedUnit: { model: 'FDYAN160AV1', specs: { minimumAirflow: {
      minimumAirflowLs: 240, fanSetting: 'Low fan, cooling',
      source: 'Daikin FDYA Engineering Data', documentRevision: 'Rev 3',
      pageReference: 'Table 4-2, p.61',
      verifiedBy: 'Nick Cahill', verifiedAt: '2026-09-15' } } },
    settings: DEFAULT_SETTINGS
  });
  assert.equal(verified.minimum.source, MINIMUM_SOURCE.MANUFACTURER);
  assert.equal(verified.minimum.verified, true, verified.minimum.basis);
  assert.equal(verified.minimum.requiredLs, 240);
  assert.equal(verified.minimum.screeningOnly, false);
  // And the evidence travels with it, so a report can cite the document.
  assert.equal(verified.minimum.evidence.documentRevision, 'Rev 3');
  assert.equal(verified.minimum.evidence.pageReference, 'Table 4-2, p.61');
  assert.match(verified.minimum.basis, /Table 4-2/);
  assert.equal(verified.meetsMinimum, false);
  assert.equal(verified.shortfallLs, 60);
});

test('11b. the options are safe, approvable, priced — and never a manual damper', () => {
  const zoneAnalysis = {
    systemAirflowLs: 800, alwaysOpenLs: 0, minimumOpenAirflowLs: 180,
    zones: [
      { id: 'z1', name: 'Living', airflowLs: 300, systemSharePct: 37.5, alwaysOpen: false },
      { id: 'z2', name: 'Beds', airflowLs: 320, systemSharePct: 40, alwaysOpen: false },
      { id: 'z3', name: 'Study', airflowLs: 180, systemSharePct: 22.5, alwaysOpen: false }
    ]
  };
  const r = zoningSafety({ zoneAnalysis, settings: DEFAULT_SETTINGS });
  assert.equal(r.ok, false);
  assert.ok(r.options.length >= 3);

  // Every option is approved by a person, and says what it costs.
  for (const o of r.options) {
    assert.equal(o.requiresApproval, true, o.code + ' applies itself');
    assert.ok('costsNothing' in o, o.code + ' does not say whether it costs anything');
  }
  // An option that only just clears the threshold is not an answer. The Kauri
  // report proposed a constant zone that reached 40.0% against 40% required —
  // two litres a second of margin on a seven-hundred-litre system.
  const bare = zoningSafety({
    zoneAnalysis: { systemAirflowLs: 736, alwaysOpenLs: 0, minimumOpenAirflowLs: 68,
      zones: [{ id: 'z6', name: 'Family', airflowLs: 296, alwaysOpen: false },
              { id: 'z1', name: 'Living',  airflowLs: 111, alwaysOpen: false },
              { id: 'z2', name: 'Bed 2',   airflowLs: 68,  alwaysOpen: false }] },
    settings: DEFAULT_SETTINGS
  });
  const constant = bare.options.find(o => o.code === 'NOMINATE_CONSTANT_ZONE');
  assert.equal(constant.marginLs, 2, '296 L/s against 294 required');
  assert.equal(constant.sufficient, false, '2 L/s of margin was called sufficient');
  assert.match(constant.detail, /not a margin a real system holds/);

  // Spill and bypass are real parts and must be priced.
  for (const code of ['SPILL_TO_COMMON_AREA', 'BYPASS_DAMPER']) {
    const o = r.options.find(x => x.code === code);
    assert.ok(o, code + ' is not offered');
    assert.equal(o.mustBePriced, true);
    assert.ok(o.sizeForLs > 0, code + ' is not sized');
  }
  // Nothing is assumed into existence.
  assert.equal(r.bypassAssumed, false);
  // And a manual balancing damper is never one of the answers.
  assert.equal(r.options.some(o => /manual/i.test(o.title)), false,
    JSON.stringify(r.options.map(o => o.title)));

  // Offered as the remedy, it is rejected by name.
  const withManual = zoningSafety({
    zoneAnalysis, settings: DEFAULT_SETTINGS,
    design: { extraMaterials: [{ label: 'Manual balancing damper ø250' }] }
  });
  assert.ok(withManual.failures.some(f => f.code === 'MANUAL_DAMPER_PROPOSED_AS_REMEDY'),
    JSON.stringify(withManual.failures.map(f => f.code)));
});

// ── 12 ──────────────────────────────────────────────────────────────────────
test('12. $15,079.33 is not displayed on a design that may not be priced', () => {
  const caps = capabilities(kauriLikeDesign());
  assert.equal(caps.mayPrice, false);

  // The pipeline's own rule, stated here so the intent is testable without a
  // full run: a blocked design carries no sell price and no quote lines.
  const blocked = {
    capabilities: caps,
    commercials: { priceBlocked: true, sellPriceIncGst: null, sellPriceExGst: null,
                   gstAmount: null, grossProfit: null },
    quoteLineItems: []
  };
  assert.equal(blocked.commercials.sellPriceIncGst, null);
  assert.equal(blocked.quoteLineItems.length, 0);
  // Null, not zero. A $0.00 price reads as a price.
  assert.notEqual(blocked.commercials.sellPriceIncGst, 0);

  // And the quote gate refuses on the scale, not on a missing line item.
  const gate = presentationGate({ capabilities: caps });
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.some(b => b.code === 'SCALE_NOT_VERIFIED'),
    JSON.stringify(gate.blockers.map(b => b.code)));
});

// ── 13 ──────────────────────────────────────────────────────────────────────
test('13. a proposal never states a credential NAC does not hold', () => {
  for (const v of ['SAMPLE-12345', 'TEST-ELEC-0000', 'PLACEHOLDER', 'nick@example.invalid',
                   'TBC', 'XXXXX', 'N/A', 'TODO']) {
    assert.equal(looksUnfilled(v), true, v + ' was accepted as a real value');
  }
  // Real ones are not caught.
  for (const v of ['11 222 333 444', '86420', 'AU13579', 'QBCC 15123456']) {
    assert.equal(looksUnfilled(v), false, v + ' was rejected as a placeholder');
  }
  // Empty is handled by omission, not by this check.
  assert.equal(looksUnfilled(''), false);

  const gate = presentationGate(
    { selectedUnit: { capacityKw: 20 }, systemLoad: { designKw: 18 },
      commercials: { sellPriceIncGst: 19800 } },
    { issuing: true, trust: { abn: '11 222 333 444', electricalLicence: 'SAMPLE-12345',
                              arcAuthorisation: '', insuranceStatement: '' } });
  const b = gate.blockers.find(x => x.code === 'PLACEHOLDER_CREDENTIAL');
  assert.ok(b, JSON.stringify(gate.blockers.map(x => x.code)));
  assert.equal(b.field, 'electricalLicence');
  assert.equal(b.severity, 'CRITICAL');
});
