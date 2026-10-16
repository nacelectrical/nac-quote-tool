// ─────────────────────────────────────────────────────────────────────────────
// QUOTING WITHOUT A DUCT DESIGN
//
// Nick, 16 October 2026: "Quoting must work independently using information I
// enter and approve... Do not fabricate a completed duct design or require one
// to issue an installer-approved quote. Retain checks for missing quote
// information, invalid prices and incompatible options."
//
// So these tests come in two halves, and both halves matter equally:
//
//   1. A sound quote with no drawing behind it GOES OUT. Every check that is
//      about a drawing — fittings, plenums, duct sizes, static pressure — has
//      to stand down, and the proof is that the presentation builds.
//
//   2. A quote-only path is NOT an unchecked path. A price of zero, a missing
//      customer, no inclusions, an upgrade that does not fit the chosen brand,
//      two figures on the same quote that contradict each other — every one of
//      those still stops the quote.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUOTE_DRAFT_SCHEMA, DRAFT_BLOCK, createQuoteDraft, normaliseQuoteDraft,
  chosenSystem, quoteDraftGate, draftToQuoteSource, draftSelectedOptions
} from '../designer/engines/quote-draft.mjs';
import { buildPresentation, presentationGate } from '../designer/engines/presentation.mjs';
import { quoteGate } from '../designer/engines/quote-gate.mjs';
import { quoteOnlyDraft, quoteOnlyContent, UPGRADES, SETTINGS } from './fixtures/quote-only.mjs';

const codes = (list) => (list || []).map(b => b.code);
const gateOf = (d) => quoteDraftGate(d, { upgrades: UPGRADES });

function build(draft, over = {}) {
  const d = draft || quoteOnlyDraft();
  const src = draftToQuoteSource(d, { upgrades: UPGRADES });
  return buildPresentation({
    design: src,
    customer: d.customer,
    job: { siteAddress: d.siteAddress },
    content: quoteOnlyContent(),
    settings: SETTINGS,
    proposalNumber: d.proposalNumber,
    revision: 1,
    status: 'issued',
    preparedAt: '2026-10-16T00:00:00Z',
    expiresAt: '2026-11-15T00:00:00Z',
    systemOptions: src.systemOptions,
    chosenSystemId: src.chosenSystemId,
    selectedOptionIds: draftSelectedOptions(d, { upgrades: UPGRADES }),
    intro: d.intro,
    // The fixture customer is openly a test, so the build is told so and the
    // page carries the label. Every other check still applies.
    testQuote: true,
    ...over
  });
}

// ── 1. A SOUND QUOTE WITH NO DRAWING GOES OUT ──────────────────────────────

test('a quote with no duct design passes its own gate', () => {
  const g = gateOf(quoteOnlyDraft());
  assert.deepEqual(g.blockers, [], 'blockers: ' + JSON.stringify(codes(g.blockers)));
  assert.equal(g.ok, true);
});

test('the duct-design gate stands down on a quote-only job, and says why', () => {
  const src = draftToQuoteSource(quoteOnlyDraft(), { upgrades: UPGRADES });
  const g = quoteGate(src);
  assert.equal(g.ok, true);
  assert.equal(g.quoteOnly, true);
  assert.deepEqual(g.blockers, []);
  // Not a silent pass: the reason is on the result for an estimator to read.
  assert.match(g.summary, /no duct design/i);
});

test('the design-derived presentation checks do not fire on a quote-only job', () => {
  const src = draftToQuoteSource(quoteOnlyDraft(), { upgrades: UPGRADES });
  const d = quoteOnlyDraft();
  const g = presentationGate(src, {
    trust: quoteOnlyContent().trust, customer: d.customer, siteAddress: d.siteAddress,
    settings: SETTINGS, termsAndConditions: quoteOnlyContent().termsAndConditions,
    issuing: true, testQuote: true
  });
  for (const code of ['ZONE_CONTROLLER_NOT_PRICED', 'CAPACITY_BELOW_CALCULATED_LOAD',
                      'ROOM_COUNT_DISAGREEMENT', 'OUTLET_COUNT_DISAGREEMENT',
                      'ZONE_COUNT_DISAGREEMENT']) {
    assert.ok(!codes(g.blockers).includes(code), code + ' fired on a quote-only job');
  }
  assert.deepEqual(g.blockers, [], 'blockers: ' + JSON.stringify(codes(g.blockers)));
});

test('a quote-only job builds a customer presentation', () => {
  const built = build();
  assert.deepEqual(built.blockers || [], [],
    'blockers: ' + JSON.stringify(codes(built.blockers)));
  assert.equal(built.ok, true);
});

// ── 2. NOTHING IS INVENTED TO GET THERE ────────────────────────────────────

test('a quote-only source carries no design it does not have', () => {
  const src = draftToQuoteSource(quoteOnlyDraft(), { upgrades: UPGRADES });
  assert.equal(src.quoteOnly, true);
  for (const key of ['bom', 'network', 'systemLoad', 'pressure', 'supplyGraph',
                     'calibration', 'outletConsistency']) {
    assert.equal(src[key], undefined, key + ' was fabricated on a quote-only job');
  }
  // Absent, not zero: a zero duct length is a measurement, and nobody measured.
  assert.equal(src.network?.totalDuctLengthM, undefined);
});

test('the coverage table is marked provisional when no design has been done', () => {
  const p = build().presentation;
  assert.equal(p.coverage.provisional, true);
  assert.match(p.coverage.provisionalNote, /confirmed during detailed design/i);
});

test('the zone schedule claims no constant zone nobody has chosen', () => {
  const p = build().presentation;
  // On a designed job the zoning engine decides which zone runs constantly.
  // On a quote nobody has, so no row carries that note.
  for (const row of p.zones.rows) assert.equal(row.note, '');
});

// ── 3. THE ESTIMATOR'S OWN SCOPE REACHES THE PAGE ──────────────────────────

test('the typed inclusions and exclusions reach the customer page verbatim', () => {
  const d = quoteOnlyDraft();
  const p = build(d).presentation;
  assert.ok(p.scopeOfWork, 'no scope of work on the presentation');
  assert.deepEqual(p.scopeOfWork.inclusions, d.inclusions);
  assert.deepEqual(p.scopeOfWork.exclusions, d.exclusions);
  assert.equal(p.scopeOfWork.summary, d.scope.summary);
});

test('a plan image is only shown when one was supplied AND approved', () => {
  const src = (over) => draftToQuoteSource(quoteOnlyDraft(over), { upgrades: UPGRADES });
  assert.equal(src({}).quoteScope.planImage, null);
  assert.equal(src({ planImage: { src: 'https://x/p.png', approved: false } })
    .quoteScope.planImage, null);
  const ok = src({ planImage: { src: 'https://x/p.png', approved: true } });
  assert.equal(ok.quoteScope.planImage.src, 'https://x/p.png');
});

test('the per-room outlet counts the estimator typed reach the coverage table', () => {
  const p = build().presentation;
  const living = p.coverage.rooms.find(r => /Living/.test(r.name));
  assert.equal(living.outlets, 3, 'the typed count was dropped for want of a schedule');
  const total = p.coverage.rooms.reduce((s, r) => s + r.outlets, 0);
  assert.equal(total, 10);
});

// ── 4. INVALID PRICES ARE STILL REFUSED ────────────────────────────────────

test('a system with no price stops the quote', () => {
  const d = quoteOnlyDraft({ systems: [
    { id: 'sys-a', brand: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16 }] });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.NO_PRICE));
});

test('a system priced at zero stops the quote', () => {
  const d = quoteOnlyDraft({ systems: [
    { id: 'sys-a', brand: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16,
      priceIncGst: 0 }] });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.BAD_PRICE));
});

test('a negative price is a mistake, not a discount', () => {
  const d = quoteOnlyDraft({ systems: [
    { id: 'sys-a', brand: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16,
      priceIncGst: -500 }] });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.BAD_PRICE));
});

test('a quote with no price builds no presentation', () => {
  const d = quoteOnlyDraft({ systems: [
    { id: 'sys-a', brand: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16 }] });
  const built = build(d);
  assert.equal(built.ok, false);
  assert.ok(codes(built.blockers).includes('NO_SELL_PRICE')
    || codes(built.blockers).includes('NO_SYSTEM_TO_QUOTE'),
    JSON.stringify(codes(built.blockers)));
});

// ── 5. MISSING QUOTE INFORMATION IS STILL REFUSED ──────────────────────────

test('no equipment means there is nothing to quote', () => {
  assert.ok(codes(gateOf(quoteOnlyDraft({ systems: [] })).blockers)
    .includes(DRAFT_BLOCK.NO_EQUIPMENT));
});

test('a system with no model stops the quote', () => {
  const d = quoteOnlyDraft({ systems: [
    { id: 'sys-a', brand: 'Daikin', priceIncGst: 16027 }] });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.NO_EQUIPMENT));
});

test('a quote with no customer name does not go out', () => {
  const d = quoteOnlyDraft({ customer: { name: '', address: '12 Boronia Street, Buderim' } });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.NO_CUSTOMER));
});

test('a quote with no site address does not go out', () => {
  const d = quoteOnlyDraft({ customer: { name: 'Test Quote', address: '' }, siteAddress: '' });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.NO_CUSTOMER));
});

test('a quote with no inclusions does not go out', () => {
  assert.ok(codes(gateOf(quoteOnlyDraft({ inclusions: [] })).blockers)
    .includes(DRAFT_BLOCK.NO_SCOPE));
});

test('no exclusions is worth saying, and does not stop the quote', () => {
  const g = gateOf(quoteOnlyDraft({ exclusions: [] }));
  assert.equal(g.ok, true);
  assert.ok(codes(g.warnings).includes('DRAFT_NO_EXCLUSIONS'));
});

test('a fake customer is still refused on a quote-only job', () => {
  const d = quoteOnlyDraft({
    customer: { name: 'Sample Customer', email: 'sample@example.invalid',
                phone: '0400 000 000', address: '1 Example Street' } });
  const built = build(d);
  assert.equal(built.ok, false);
  assert.ok(codes(built.blockers).includes('CUSTOMER_DATA_NOT_REAL'));
});

// ── 6. THE QUOTE MUST AGREE WITH ITSELF ────────────────────────────────────

test('a zone count that disagrees with the rooms stops the quote', () => {
  // The scope says 6 zones; the rooms are grouped into 2. The page would print
  // one of those numbers and the rest of the quote would contradict it.
  const d = quoteOnlyDraft({ scope: {
    outletCount: 4, returnCount: 1, zoneCount: 6,
    conditionedRooms: [
      { label: 'Living', zone: 'Living', outlets: 3 },
      { label: 'Master', zone: 'Master', outlets: 1 }
    ] } });
  const g = gateOf(d);
  assert.ok(codes(g.blockers).includes(DRAFT_BLOCK.ZONE_COUNT_MISMATCH),
    JSON.stringify(codes(g.blockers)));
});

test('per-room outlets that do not add up to the total stop the quote', () => {
  const d = quoteOnlyDraft({ scope: {
    outletCount: 12, returnCount: 2, zoneCount: 2,
    conditionedRooms: [
      { label: 'Living', zone: 'Living', outlets: 3 },
      { label: 'Master', zone: 'Master', outlets: 1 }
    ] } });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.OUTLET_COUNT_MISMATCH));
});

test('a room list with no outlet counts is not held to the total', () => {
  // Rooms may be listed for coverage before anyone has apportioned the
  // outlets. That is incomplete, not contradictory, and it does not block.
  const d = quoteOnlyDraft({ scope: {
    outletCount: 10, returnCount: 2, zoneCount: 2,
    conditionedRooms: [
      { label: 'Living', zone: 'Living' }, { label: 'Master', zone: 'Master' }
    ] } });
  const g = gateOf(d);
  assert.ok(!codes(g.blockers).includes(DRAFT_BLOCK.OUTLET_COUNT_MISMATCH));
  assert.equal(g.ok, true, JSON.stringify(codes(g.blockers)));
});

// ── 7. INCOMPATIBLE OPTIONS ────────────────────────────────────────────────

test('a Daikin-only upgrade is refused on a quote whose chosen system is a Braemar', () => {
  const d = quoteOnlyDraft({ chosenSystemId: 'sys-b' });
  const g = gateOf(d);
  assert.ok(codes(g.blockers).includes(DRAFT_BLOCK.OPTION_INCOMPATIBLE),
    JSON.stringify(codes(g.blockers)));
});

test('a brand-locked upgrade is withheld from the system it does not fit', () => {
  const p = build().presentation;
  const at5 = p.options.find(o => o.id === 'at5');
  // Offered against the Daikin, and not against the Braemar the customer can
  // also choose on the same page.
  assert.deepEqual(at5.forSystemIds, ['sys-a']);
});

test('an unpriced upgrade is never offerable', () => {
  const up = [{ id: 'nope', title: 'Mystery extra', requires: ['has_zoning'], enabled: true }];
  const d = quoteOnlyDraft({ selectedUpgradeIds: ['nope'] });
  const g = quoteDraftGate(d, { upgrades: up });
  assert.ok(codes(g.blockers).includes(DRAFT_BLOCK.OPTION_UNPRICED));
});

test('an upgrade needing zoning is refused on an unzoned quote', () => {
  const d = quoteOnlyDraft({
    scope: { outletCount: 4, returnCount: 1, zoneCount: 1, conditionedRooms: [] },
    selectedUpgradeIds: ['at5'] });
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.OPTION_INCOMPATIBLE));
});

// ── 8. A COUNTED UPGRADE IS PRICED BY ITS COUNT ────────────────────────────

test('the sensor count the estimator entered prices the sensors', () => {
  const p = build().presentation;
  const line = p.investment.selectedOptions.find(o => o.id === 'sensor');
  assert.ok(line, 'the sensors fell off the offer');
  assert.equal(line.quantity, 4);
  assert.equal(line.priceIncGst, 440);          // 4 × $110
});

test('a counted upgrade with no count does not go out priced at nothing', () => {
  // The library default is 0. Sent as a bare id the upgrade would be dropped
  // from the offer silently, which is how four sensors came to be free.
  const d = quoteOnlyDraft({ sensorCount: null, upgradeQuantities: {} });
  const g = gateOf(d);
  assert.ok(codes(g.blockers).includes(DRAFT_BLOCK.SENSOR_COUNT_NOT_SET),
    JSON.stringify(codes(g.blockers)));
});

test('the selection carries the count, not just the id', () => {
  const sel = draftSelectedOptions(quoteOnlyDraft(), { upgrades: UPGRADES });
  assert.deepEqual(sel, ['at5', { id: 'sensor', quantity: 4 }]);
});

test('removing an option removes its price', () => {
  const full = build().presentation.investment.totalIncGst;
  const d = quoteOnlyDraft({ selectedUpgradeIds: ['at5'], sensorCount: 0,
                             upgradeQuantities: {} });
  const less = build(d).presentation.investment.totalIncGst;
  assert.equal(full, 17817);                     // 16027 + 1350 + 440
  assert.equal(less, 17377);                     // 16027 + 1350
  assert.equal(full - less, 440);
});

// ── 9. THE TOTAL AND ITS BREAKDOWN RECONCILE ───────────────────────────────

test('the GST breakdown is of the total the customer is accepting', () => {
  const inv = build().presentation.investment;
  assert.equal(inv.totalIncGst, 17817);
  assert.equal(Math.round((inv.totalExGst + inv.totalGst) * 100) / 100, inv.totalIncGst);
  assert.equal(inv.totalGst, 1619.73);
});

test('the deposit is a percentage of the total, options included', () => {
  const inv = build().presentation.investment;
  assert.equal(inv.deposit.percent, 50);
  assert.equal(inv.deposit.amount, Math.round(inv.totalIncGst * 50) / 100);
});

test('switching the chosen system changes the price on the page', () => {
  // The Braemar is $1,474 cheaper, and the AirTouch does not fit it, so its
  // $1,350 comes off too. The page cannot show the Daikin price beside a
  // Braemar heading.
  const d = quoteOnlyDraft({ chosenSystemId: 'sys-b', selectedUpgradeIds: [],
                             sensorCount: 0, upgradeQuantities: {} });
  const inv = build(d).presentation.investment;
  assert.equal(inv.baseIncGst, 14553);
  assert.equal(inv.totalIncGst, 14553);
});

test('an upgrade that does not fit the chosen system carries no price into the total', () => {
  const d = quoteOnlyDraft({ chosenSystemId: 'sys-b', selectedUpgradeIds: ['at5'],
                             sensorCount: 0, upgradeQuantities: {} });
  const src = draftToQuoteSource(d, { upgrades: UPGRADES });
  const built = buildPresentation({
    design: src, customer: d.customer, job: { siteAddress: d.siteAddress },
    content: quoteOnlyContent(), settings: SETTINGS,
    proposalNumber: d.proposalNumber, revision: 1, status: 'issued',
    preparedAt: '2026-10-16T00:00:00Z', expiresAt: '2026-11-15T00:00:00Z',
    systemOptions: src.systemOptions, chosenSystemId: 'sys-b',
    selectedOptionIds: draftSelectedOptions(d, { upgrades: UPGRADES })
  });
  // The gate refuses the quote outright, which is the stronger answer: an
  // offer that cannot be installed is not issued at all.
  assert.equal(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.OPTION_INCOMPATIBLE), true);
  // And if it were built anyway, the AirTouch is not on the Braemar's bill.
  if (built.ok) {
    const at5 = built.presentation.investment.selectedOptions.find(o => o.id === 'at5');
    assert.ok(!at5 || !at5.priceIncGst, 'a Daikin-only kit was priced onto a Braemar');
  }
});

// ── 10. THE DRAFT ITSELF ───────────────────────────────────────────────────

test('a new draft is normalised and schema-stamped', () => {
  const d = createQuoteDraft({});
  assert.equal(d.schema, QUOTE_DRAFT_SCHEMA);
  assert.equal(d.status, 'draft');
  assert.equal(d.validDays, 30);
  assert.deepEqual(d.systems, []);
  assert.equal(d.chosenSystemId, null);
});

test('the recommended system is the one quoted when none was chosen', () => {
  const d = quoteOnlyDraft({ chosenSystemId: '' });
  assert.equal(chosenSystem(d).id, 'sys-a');
});

test('an empty price string stays absent rather than becoming zero', () => {
  // Number('') is 0, which is how a quote with no price read as a quote at
  // nothing and passed every presence check.
  const d = normaliseQuoteDraft({ systems: [{ brand: 'Daikin', model: 'X', priceIncGst: '' }] });
  assert.equal(d.systems[0].priceIncGst, null);
  assert.ok(codes(gateOf(d).blockers).includes(DRAFT_BLOCK.NO_PRICE));
});

test('a configured zero stays zero and is not nudged into a default', () => {
  const d = normaliseQuoteDraft({ scope: { outletCount: 0, zoneCount: 0 },
                                  sensorCount: 0, validDays: 0 });
  assert.equal(d.scope.outletCount, 0);
  assert.equal(d.scope.zoneCount, 0);
  assert.equal(d.sensorCount, 0);
  assert.equal(d.validDays, 0);
});

test('an outlet count of nothing is worth saying', () => {
  const d = quoteOnlyDraft({ scope: {
    outletCount: null, returnCount: 2, zoneCount: 1, conditionedRooms: [] },
    selectedUpgradeIds: [], sensorCount: 0, upgradeQuantities: {} });
  assert.ok(codes(gateOf(d).warnings).includes('DRAFT_NO_OUTLET_COUNT'));
});

test('an upgrade not in the library is not quietly priced', () => {
  const d = quoteOnlyDraft({ selectedUpgradeIds: ['ghost'], sensorCount: 0,
                             upgradeQuantities: {} });
  const g = gateOf(d);
  assert.ok(codes(g.warnings).includes('DRAFT_UPGRADE_UNKNOWN'));
  const p = build(d).presentation;
  assert.ok(!p.investment.selectedOptions.some(o => o.id === 'ghost'));
});

// ── 11. NO INTERNAL COSTING REACHES THE CUSTOMER PAGE ──────────────────────

test('the customer page carries no cost, margin or supplier figure', () => {
  const p = build().presentation;
  const json = JSON.stringify({ ...p, _internal: undefined });
  for (const word of ['margin', 'marginPercent', 'supplierCost', 'costIncGst',
                      'tradePrice', 'profit', 'bom']) {
    assert.ok(!new RegExp('"' + word + '"').test(json),
      word + ' reached the customer presentation');
  }
});

// ── 12. A TEST QUOTE IS LABELLED, AND IS STILL CHECKED ─────────────────────

test('a test quote says so on the page', () => {
  const p = build().presentation;
  assert.equal(p.testQuote, true);
  assert.match(p.testQuoteNote, /TEST QUOTE/);
  assert.match(p.testQuoteNote, /not an offer/i);
  // And it is not a demonstration: the content is NAC's real library, so what
  // Nick reviews is what a customer would see.
  assert.equal(p.demonstration, false);
});

test('a real quote carries no test label', () => {
  const d = quoteOnlyDraft({ customer: {
    name: 'A Real Looking Name', email: 'someone@bigpond.com',
    phone: '0412 665 108', address: '12 Boronia Street, Buderim QLD 4556' } });
  const p = build(d, { testQuote: false }).presentation;
  assert.equal(p.testQuote, false);
  assert.equal(p.testQuoteNote, null);
});

test('a test quote still needs a reachable contact', () => {
  const d = quoteOnlyDraft({ customer: {
    name: 'Test Quote — do not send', email: 'nope@example.invalid', phone: '',
    address: '12 Boronia Street, Buderim QLD 4556' } });
  const built = build(d);
  assert.equal(built.ok, false);
  assert.ok(codes(built.blockers).includes('CUSTOMER_DATA_NOT_REAL'));
});

test('a test quote still needs a real site address', () => {
  const d = quoteOnlyDraft({ customer: {
    name: 'Test Quote — do not send', email: 'quotes@nacelectrical.com.au',
    phone: '0455 123 456', address: '1 Example Street' }, siteAddress: '1 Example Street' });
  const built = build(d);
  assert.equal(built.ok, false);
  assert.ok(codes(built.blockers).includes('CUSTOMER_DATA_NOT_REAL'));
});

test('the test-quote name is recorded as a note, not waved through silently', () => {
  const src = draftToQuoteSource(quoteOnlyDraft(), { upgrades: UPGRADES });
  const d = quoteOnlyDraft();
  const g = presentationGate(src, {
    trust: quoteOnlyContent().trust, customer: d.customer, siteAddress: d.siteAddress,
    settings: SETTINGS, issuing: true, testQuote: true });
  assert.equal(g.ok, true);
  assert.ok(codes(g.notes).includes('TEST_QUOTE_NAME'));
});

test('without the test-quote flag the placeholder name blocks', () => {
  const built = build(quoteOnlyDraft(), { testQuote: false });
  assert.equal(built.ok, false);
  assert.ok(codes(built.blockers).includes('CUSTOMER_DATA_NOT_REAL'));
});
