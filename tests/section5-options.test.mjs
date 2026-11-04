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
  // A real reference: the renderer will not load a src it cannot vouch for,
  // so a relative path here would prove nothing about what a customer sees.
  const SRC = 'https://example.test/media/daikin-ducted.jpg';
  draft.systems[0].image = { src: SRC, alt: 'Daikin ducted unit' };
  const { p, html } = present(draft);
  const daikin = p.systemChoice.options.find(o => o.brand === 'Daikin');
  assert.equal(daikin.image.src, SRC, 'NAC being explicit wins over the matcher');
  assert.ok(html.includes(SRC));
  assert.ok(html.includes('alt="Daikin ducted unit"'), 'an image needs its alt text');
});

test('an option NAC has no photograph of renders no image element at all', () => {
  // This fixture's content library carries no images, so neither option can
  // be matched to one. A missing photograph is absent, never a broken image
  // and never a lookalike.
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
  // The base zone control is the Siemens kit NAC's house rule sizes to the
  // job; the AirTouch is the upgrade from it, offered beside the price.
  assert.equal(p.zones.controller, 'Siemens Home zone control — 6 zone');
  assert.equal(p.zones.controllerIncludedInSystem, true);
  assert.equal(p.zones.rows.length, 6, 'six zones were scoped, so six are shown');
  assert.ok(html.includes('Siemens Home zone control'), 'the zone control has to be named');
  assert.ok(html.includes('supplied with the system at no separate charge'),
    'a customer needs to know whether the zone control is in the price');
  assert.ok(html.includes('AirTouch 5 smart control'),
    'the AirTouch has to be offered as the upgrade from it');
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

// ── THE ZONE CONTROL: SIEMENS IN THE PRICE, AIRTOUCH AS THE OPTION ─────────
//
// Nick, 5 November 2026: "Test is missing Airtouch option / Or Siemens as an
// option."
//
// The test quote named the AirTouch 5 as its zone control AND offered
// "AirTouch 5 smart control" as a $1,350 upgrade beside it — the same
// controller, included and charged. duplicateCharges() is built to catch
// exactly that and it was sitting in the demonstration quote, because the
// rule read `controller.includedInPrice` and the draft carried no such field.
//
// NAC's house rule is the Siemens kit sized to the zone count unless the job
// is on an AirTouch, so the base is a Siemens and the AirTouch is what a
// customer upgrades TO. Both are on the page: one in the price, one beside it.

test('the base zone control is the Siemens kit, in the price', () => {
  const { p } = present(quoteOnlyDraft());
  assert.equal(p.zones.controller, 'Siemens Home zone control — 6 zone');
  assert.equal(p.zones.controllerIncludedInSystem, true);
  assert.equal(p.zones.controllerMaxZones, 6,
    'the kit has to be sized to the zones actually scoped');
});

test('the AirTouch is offered as the upgrade from it, and charged once', async () => {
  const { duplicateCharges } = await import('../designer/engines/option-pricing.mjs');
  const draft = normaliseQuoteDraft(quoteOnlyDraft());

  const at5 = present(draft).p.options.find(o => o.id === 'at5');
  assert.ok(at5, 'the AirTouch is not offered at all');
  assert.equal(at5.priceIncGst, 1350);

  assert.deepEqual(duplicateCharges(draft, { upgrades: UPGRADES }), [],
    'the quote charges something twice');
});

test('a quote that includes AND charges one controller is caught', async () => {
  const { duplicateCharges } = await import('../designer/engines/option-pricing.mjs');
  // The shape this fixture used to have: the AirTouch as the zone control,
  // with the AirTouch upgrade ticked beside it.
  const bad = normaliseQuoteDraft(quoteOnlyDraft({
    controller: { name: 'AirTouch 5', zoneCount: 8 }
  }));
  const found = duplicateCharges(bad, { upgrades: UPGRADES });
  assert.ok(found.some(f => f.code === 'UPGRADE_DUPLICATES_CONTROLLER'),
    'the duplicate went unnoticed: ' + JSON.stringify(found));
});

test('the "charged twice" rule can actually fire on a real draft', async () => {
  const { duplicateCharges } = await import('../designer/engines/option-pricing.mjs');
  // It reads controller.includedInPrice and controller.priceIncGst. Neither
  // was on the normalised draft, so the rule was dead against every real
  // quote and only ever passed against a hand-built object in a test.
  const draft = normaliseQuoteDraft(quoteOnlyDraft({
    controller: { id: 'siemens_z6', name: 'Siemens Home zone control — 6 zone',
                  zoneCount: 6, includedInPrice: true, priceIncGst: 420 }
  }));
  assert.equal(draft.controller.includedInPrice, true);
  assert.equal(draft.controller.priceIncGst, 420);
  const found = duplicateCharges(draft, { upgrades: UPGRADES });
  assert.ok(found.some(f => f.code === 'CONTROLLER_CHARGED_TWICE'),
    'a controller both included and charged was not flagged');
});

test('a controller that is NOT in the price says so rather than nothing', () => {
  const { p } = present(quoteOnlyDraft({
    controller: { id: 'siemens_z6', name: 'Siemens Home zone control — 6 zone',
                  zoneCount: 6, includedInPrice: false }
  }));
  assert.equal(p.zones.controllerIncludedInSystem, false);
});

test('what NAC paid for the kit is nowhere on the page', () => {
  const { p, html } = present(quoteOnlyDraft({
    controller: { id: 'siemens_z6', name: 'Siemens Home zone control — 6 zone',
                  zoneCount: 6, cost: 295, supplierCode: 'MMASEM6ZTPKIT' }
  }));
  const blob = JSON.stringify(p)
    + html.replace(/data:[a-z/+-]+;base64,[A-Za-z0-9+/=]+/g, '');
  assert.ok(!/\b295\b/.test(blob), 'the supplier cost reached the customer page');
  assert.ok(!/MMASEM/.test(blob), 'the supplier code reached the customer page');
});
