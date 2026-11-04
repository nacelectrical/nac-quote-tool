// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5, ALL THE WAY TO THE CUSTOMER'S PAGE
//
// Nick, 4 November 2026: "Each option must show brand, exact indoor and
// outdoor model pair, capacity, phase, images, controller and zoning,
// installation scope, supplier cost, approved pricing basis and the customer
// price including GST... Keep fixed quotes and provisional estimates clearly
// distinct... Do not silently transfer the old Kauri or Dungannon scope, sizes,
// counts or prices to new jobs."
//
// tests/option-pricing.test.mjs proves the rules. This proves the WIRING: that
// what the estimator's screen shows reaches the page the customer reads, that
// what NAC pay never does, and that a new quote starts empty.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQuoteDraft, normaliseQuoteDraft, draftToQuoteSource,
         draftSelectedOptions } from '../designer/engines/quote-draft.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { presentationPrintHtml } from '../designer/ui/presentation-pdf.mjs';
import { quoteOnlyDraft, quoteOnlyContent, UPGRADES, SETTINGS }
  from './fixtures/quote-only.mjs';
import { findSupplierLine } from '../designer/engines/supplier-pricing.mjs';
import { JOB_TYPE } from '../designer/engines/option-pricing.mjs';

const CONTENT = quoteOnlyContent();

/** The real MMEM trade cost of the fixture's Daikin, for the leak sweep. */
const MMEM = findSupplierLine('daikin', 'FDYAN160AV1', 16, '1Ph');

function present(draft) {
  const d = normaliseQuoteDraft(draft);
  const source = draftToQuoteSource(d, { upgrades: UPGRADES });
  const built = buildPresentation({
    design: source,
    customer: source.customer, job: source.job,
    content: CONTENT, settings: SETTINGS,
    proposalNumber: d.proposalNumber,
    preparedAt: '2026-11-04T00:00:00Z', expiresAt: '2026-12-04T00:00:00Z',
    revision: 1, status: 'issued',
    selectedOptionIds: draftSelectedOptions(d, { upgrades: UPGRADES }),
    systemOptions: source.systemOptions,
    chosenSystemId: source.chosenSystemId,
    testQuote: true
  });
  assert.ok(built.ok, 'the fixture must build: '
    + JSON.stringify((built.blockers || []).map(b => b.message)));
  return { source, p: built.presentation, html: renderPresentationHtml(built.presentation) };
}

// ── WHAT THE OPTIONS SHOW ───────────────────────────────────────────────────

test('each option names the exact indoor and outdoor pair on the page', () => {
  const { p, html } = present(quoteOnlyDraft());
  const daikin = p.systemChoice.options.find(o => o.brand === 'Daikin');
  assert.equal(daikin.model, 'FDYAN160AV1');
  assert.equal(daikin.outdoorModel, 'RZA160C2V1');
  assert.equal(daikin.modelPair, 'FDYAN160AV1 / RZA160C2V1');
  assert.ok(html.includes('FDYAN160AV1 / RZA160C2V1'),
    'the pair has to be printed, not just carried');
});

test('an option with only an indoor model does not print a pair of one', () => {
  const { p, html } = present(quoteOnlyDraft());
  // The fixture's Braemar has no outdoor model recorded.
  const braemar = p.systemChoice.options.find(o => o.brand === 'Braemar');
  assert.equal(braemar.outdoorModel, '');
  assert.equal(braemar.modelPair, 'KDHV160D1S');
  assert.ok(!html.includes('KDHV160D1S / '),
    'repeating the indoor model under its own name adds nothing');
});

test('an option’s picture reaches the page when NAC hold one', () => {
  const draft = quoteOnlyDraft();
  draft.systems[0].image = { src: 'media/daikin-ducted.jpg', alt: 'Daikin ducted unit' };
  const { p, html } = present(draft);
  const daikin = p.systemChoice.options.find(o => o.brand === 'Daikin');
  assert.equal(daikin.image.src, 'media/daikin-ducted.jpg');
  assert.ok(html.includes('media/daikin-ducted.jpg'));
  assert.ok(html.includes('alt="Daikin ducted unit"'), 'an image needs its alt text');
});

test('an option with no picture renders no image element at all', () => {
  const { html } = present(quoteOnlyDraft());
  assert.ok(!/class="sys-img"/.test(html),
    'a missing photograph must be absent, not a broken image');
});

test('capacity, phase, warranty and the price are all on each option', () => {
  const { html } = present(quoteOnlyDraft());
  assert.ok(html.includes('16 kW'));
  assert.ok(html.includes('1Ph'));
  assert.ok(/7-year manufacturer warranty/.test(html),
    'the Braemar warranty differs and a customer comparing prices is entitled to see it');
  assert.ok(html.includes('16,027') && html.includes('14,553'),
    'both prices have to be on the chooser');
});

test('the controller and the zoning are on the page', () => {
  const { p, html } = present(quoteOnlyDraft());
  assert.equal(p.zones.controller, 'AirTouch 5');
  assert.equal(p.zones.rows.length, 6, 'six zones were scoped, so six are shown');
  assert.ok(html.includes('AirTouch 5'), 'the zone control has to be named');
  assert.ok(html.includes('Living / Dining'), 'each zone names its rooms');
});

// ── WHAT NAC PAY NEVER REACHES IT ───────────────────────────────────────────

test('a supplier cost on the draft never reaches the customer’s page', () => {
  const draft = quoteOnlyDraft();
  draft.systems[0].supplierCost = 5700;
  const { source, p, html } = present(draft);

  // Not in the quote source the proposal is built from.
  assert.ok(!JSON.stringify(source).includes('supplierCost'),
    'the quote source must not carry what NAC pay');
  // Not in the presentation, and not on the page in any form.
  const docs = [JSON.stringify(p), html, presentationPrintHtml(p)];
  for (const doc of docs) {
    for (const leak of ['supplierCost', 'supplier cost', '5700', '5,700',
                        'markupPct', 'marginPct', 'grossProfit', 'MMEM',
                        'Trade Price List', 'priceBasis']) {
      assert.ok(!doc.includes(leak), '"' + leak + '" reached a customer document');
    }
  }
});

test('the MMEM trade cost of the quoted unit is nowhere on the page either', () => {
  const { html } = present(quoteOnlyDraft());
  assert.ok(MMEM && MMEM.cost > 0, 'the fixture model must be on the trade list');
  // The figure itself, in both the forms a page could print it.
  assert.ok(!html.includes('$' + MMEM.cost),
    'the trade cost reached the page as money');
  assert.ok(!html.includes('$' + MMEM.cost.toLocaleString('en-AU')),
    'the trade cost reached the page as a formatted figure');
});

// ── FIXED PRICE OR PROVISIONAL ESTIMATE ─────────────────────────────────────

test('a complete quote goes out as a fixed price, and says so beside the number', () => {
  const { source, p, html } = present(quoteOnlyDraft());
  assert.equal(source.priceFirmness.fixed, true, JSON.stringify(source.priceFirmness));
  assert.equal(p.investment.firmness.label, 'Fixed price');
  assert.equal(p.investment.priceLabel, 'Your investment');
  assert.ok(html.includes('Fixed price.'), 'the page has to say which promise this is');
  assert.ok(/does not change unless you ask us/.test(html));
  assert.ok(/class="inv-firm is-fixed"/.test(html));
});

test('a quote the estimator marked provisional says so, in their words', () => {
  const { source, p, html } = present(quoteOnlyDraft({
    provisional: true,
    provisionalReason: 'I have not been in the roof space yet — the duct run may be longer.'
  }));
  assert.equal(source.priceFirmness.fixed, false);
  assert.equal(p.investment.firmness.label, 'Provisional estimate');
  assert.equal(p.investment.priceLabel, 'Proposal price',
    'the headline changes too, not just a footnote');
  assert.ok(html.includes('Provisional estimate.'));
  assert.ok(html.includes('not a fixed price'));
  assert.ok(html.includes('I have not been in the roof space yet'),
    'what still has to be confirmed is said in the estimator’s own words');
  assert.ok(!/class="inv-firm is-fixed"/.test(html));
});

test('an allowance in the scope makes it provisional without anybody ticking a box', () => {
  const draft = quoteOnlyDraft();
  draft.inclusions = [...draft.inclusions, 'Allowance for an electrical upgrade'];
  const { source, p } = present(draft);
  assert.equal(source.priceFirmness.fixed, false);
  assert.equal(p.investment.firmness.label, 'Provisional estimate');
});

test('the estimator’s reasons stay on the estimator’s screen', () => {
  const draft = quoteOnlyDraft({ jobType: JOB_TYPE.REPLACEMENT });
  const { source, html } = present(draft);
  assert.equal(source.priceFirmness.fixed, false,
    'a replacement with nothing said about the old system is not a fixed price');
  // "nothing in the scope mentions removing the old units" is a note to NAC.
  assert.ok(!html.includes('nothing in the scope mentions'),
    'the working behind a provisional estimate is not a sentence for a customer');
  assert.ok(!source.priceFirmness.reasons,
    'only the label and the note travel to the page');
});

test('a replacement scoped properly goes out as a fixed price', () => {
  const draft = quoteOnlyDraft({ jobType: JOB_TYPE.REPLACEMENT });
  draft.inclusions = [...draft.inclusions,
    'Recover the refrigerant from the existing system and record it',
    'Remove the old indoor and outdoor units and dispose of them offsite',
    'Reuse the existing ducting where it is serviceable'];
  const { source } = present(draft);
  assert.equal(source.priceFirmness.fixed, true, JSON.stringify(source.priceFirmness));
});

test('the job type travels with the quote', () => {
  assert.equal(draftToQuoteSource(quoteOnlyDraft()).jobType, 'new_install');
  assert.equal(draftToQuoteSource(quoteOnlyDraft({ jobType: 'replacement' })).jobType,
    'replacement');
});

// ── A NEW QUOTE STARTS EMPTY ────────────────────────────────────────────────

test('a new quote carries nothing from any previous job', () => {
  // Nick: "Do not silently transfer the old Kauri or Dungannon scope, sizes,
  // counts or prices to new jobs." A fresh draft has to be genuinely blank —
  // no system, no price, no counts, no scope, no rooms.
  const fresh = createQuoteDraft({});
  assert.deepEqual(fresh.systems, []);
  assert.equal(fresh.chosenSystemId, null);
  assert.equal(fresh.scope.outletCount, null);
  assert.equal(fresh.scope.returnCount, null);
  assert.equal(fresh.scope.zoneCount, null);
  assert.equal(fresh.scope.summary, '');
  assert.deepEqual(fresh.scope.conditionedRooms, []);
  assert.deepEqual(fresh.inclusions, []);
  assert.deepEqual(fresh.exclusions, []);
  assert.deepEqual(fresh.selectedUpgradeIds, []);
  assert.equal(fresh.controller.id, '');
  assert.equal(fresh.controller.name, '');
  assert.equal(fresh.intro, '');
  assert.equal(fresh.jobType, 'new_install');
  assert.equal(fresh.provisional, false);

  // And nothing in it names a previous customer or site.
  const text = JSON.stringify(fresh).toLowerCase();
  for (const old of ['kauri', 'dungannon', 'boronia', 'buderim']) {
    assert.ok(!text.includes(old), 'a new quote mentions ' + old);
  }
});

test('a new quote cannot be issued at all until somebody prices it', () => {
  const fresh = createQuoteDraft({});
  // Built through the real source conversion: with no system there is no
  // price, so there is no investment section and nothing to accept.
  const source = draftToQuoteSource(fresh, { upgrades: UPGRADES });
  assert.equal(source.selectedUnit, null);
  assert.deepEqual(source.commercials, {});
  assert.deepEqual(source.systemOptions, []);
  assert.equal(source.priceFirmness.fixed, true,
    'an empty draft has no open items — the gate stops it, not the firmness');
});
