// ─────────────────────────────────────────────────────────────────────────────
// "DAIKIN OR BRAEMAR" — THE CHOICE NAC HAVE ALWAYS OFFERED
//
// sign.html has let a customer pick between up to three systems since before
// any of this existed. The new quote presentation was built around one
// designed system and could not, which made it a downgrade on the thing an
// estimator does every day.
//
// An OPTION is an alternative — one of these gets installed and its price is
// the price of the job. An UPGRADE is an extra on top of whichever is chosen.
// Confusing the two would have a customer thinking they are buying two units.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemOptionsStatus, chooseSystemOption, normaliseSystemOption,
         optionsFromDesign, MAX_SYSTEM_OPTIONS } from '../designer/engines/system-options.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../designer/ui/presentation-html.mjs';
import { DEMO_CONTENT, buildDemoDesign } from './fixtures/demo-presentation.mjs';

const DAIKIN = { id: 'daikin', brand: 'Daikin', model: 'FDYA160AV19 / RZAS160C2V1',
                 capacityKw: 16, phase: '1Ph', priceIncGst: 15400, recommended: true,
                 note: 'Premium inverter, quietest indoor unit' };
const BRAEMAR = { id: 'braemar', brand: 'Braemar', model: 'SDHV16D1S',
                  capacityKw: 16, phase: '1Ph', priceIncGst: 13900 };

test('two real systems are a valid choice', () => {
  const s = systemOptionsStatus([DAIKIN, BRAEMAR]);
  assert.equal(s.ok, true, s.failures.map(f => f.code).join(', '));
  assert.equal(s.offersChoice, true);
  assert.equal(s.count, 2);
  assert.equal(s.recommendedId, 'daikin');
});

test('one system is still an option, and offers no choice', () => {
  const s = systemOptionsStatus([DAIKIN]);
  assert.equal(s.ok, true);
  assert.equal(s.offersChoice, false, 'a single system must not draw a chooser');
});

test('an option nobody priced never reaches a customer', () => {
  const s = systemOptionsStatus([DAIKIN, { ...BRAEMAR, priceIncGst: null }]);
  assert.equal(s.ok, false);
  const f = s.failures.find(x => x.code === 'SYSTEM_OPTION_NOT_PRICED');
  assert.ok(f);
  assert.equal(f.optionId, 'braemar', 'the failure has to name which one');
  // Zero is not a price either.
  assert.equal(systemOptionsStatus([{ ...DAIKIN, priceIncGst: 0 }]).ok, false);
});

test('an option that does not name a real system is refused', () => {
  for (const bad of [{ ...BRAEMAR, model: 'TBC' }, { ...BRAEMAR, model: '' },
                     { ...BRAEMAR, brand: 'N/A' }, { ...BRAEMAR, model: 'placeholder' }]) {
    const s = systemOptionsStatus([DAIKIN, bad]);
    assert.equal(s.ok, false, JSON.stringify(bad.model || bad.brand));
    assert.ok(s.failures.some(f => f.code === 'SYSTEM_OPTION_NOT_REAL'));
  }
});

test('an option with no capacity is refused', () => {
  const s = systemOptionsStatus([DAIKIN, { ...BRAEMAR, capacityKw: null }]);
  assert.equal(s.ok, false);
  assert.ok(s.failures.some(f => f.code === 'SYSTEM_OPTION_NO_CAPACITY'));
});

test('alternatives for one job cannot be wildly different sizes', () => {
  // A 7 kW beside a 16 kW is not a choice — it is one of them being wrong, and
  // a customer choosing on price cannot tell which.
  const s = systemOptionsStatus([DAIKIN, { ...BRAEMAR, capacityKw: 7, priceIncGst: 9000 }]);
  assert.ok(s.failures.some(f => f.code === 'SYSTEM_OPTIONS_NOT_COMPARABLE'));
  // A warning, not a blocker: NAC may deliberately offer a smaller machine.
  assert.equal(s.ok, true);
});

test('more than one recommendation is no recommendation', () => {
  const s = systemOptionsStatus([DAIKIN, { ...BRAEMAR, recommended: true }]);
  assert.equal(s.ok, false);
  assert.ok(s.failures.some(f => f.code === 'MORE_THAN_ONE_RECOMMENDED'));
});

test('a catalogue is not a quote', () => {
  const many = Array.from({ length: MAX_SYSTEM_OPTIONS + 1 },
    (_, i) => ({ ...DAIKIN, id: 'o' + i, recommended: false }));
  const s = systemOptionsStatus(many);
  assert.equal(s.ok, false);
  assert.ok(s.failures.some(f => f.code === 'TOO_MANY_SYSTEM_OPTIONS'));
});

test('two options with the same id could not be told apart afterwards', () => {
  const s = systemOptionsStatus([DAIKIN, { ...BRAEMAR, id: 'daikin' }]);
  assert.equal(s.ok, false);
  assert.ok(s.failures.some(f => f.code === 'DUPLICATE_SYSTEM_OPTION'));
});

test('the chosen option falls back to the recommendation, then the first', () => {
  const [a, b] = [normaliseSystemOption(DAIKIN, 0), normaliseSystemOption(BRAEMAR, 1)];
  assert.equal(chooseSystemOption([a, b], 'braemar').id, 'braemar');
  assert.equal(chooseSystemOption([a, b], null).id, 'daikin', 'the recommendation');
  assert.equal(chooseSystemOption([a, b], 'nonsense').id, 'daikin');
  const noRec = [{ ...a, recommended: false }, b];
  assert.equal(chooseSystemOption(noRec, null).id, 'daikin', 'the first');
  assert.equal(chooseSystemOption([], null), null);
});

test('a designed job is one option, so the page has one shape', () => {
  const opts = optionsFromDesign({
    selectedUnit: { brandName: 'Daikin', model: 'FDYAN160AV1', capacityKw: 16, phase: '1Ph' },
    commercials: { sellPriceIncGst: 14766.21 } });
  assert.equal(opts.length, 1);
  assert.equal(opts[0].priceIncGst, 14766.21);
  assert.equal(opts[0].recommended, true);
  // No unit or no price is no option at all, rather than a broken one.
  assert.deepEqual(optionsFromDesign({ selectedUnit: null, commercials: { sellPriceIncGst: 1 } }), []);
  assert.deepEqual(optionsFromDesign({ selectedUnit: { model: 'x' }, commercials: {} }), []);
});

// ── ON THE PAGE ────────────────────────────────────────────────────────────

const DEMO = { ...(await buildDemoDesign()).out,
               fittingAssembly: { ok: true, rows: [], unbuildable: [] } };
const TERMS = { commercial: { terms: { depositPercent: 50, balanceDueEvent: 'completion',
  validityDays: 30, paymentMethods: ['Direct deposit', 'EFT'], termsVersion: 'NAC T&C v1.0',
  paymentStages: [{ label: 'Deposit on acceptance' }],
  confirmed: true, confirmedBy: 'Nick Cahill', confirmedAt: '2026-09-23' } } };

const build = (over = {}) => buildPresentation({
  design: DEMO,
  customer: { name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com',
              phone: '0412 665 108', address: '34 Kauri Crescent, Peregian Springs QLD 4573' },
  job: { siteAddress: '34 Kauri Crescent, Peregian Springs QLD 4573' },
  content: DEMO_CONTENT, settings: TERMS, revision: 1, status: 'draft',
  systemOptions: [DAIKIN, BRAEMAR], ...over });

test('the price on the page is the price of the system chosen', () => {
  const a = build().presentation;
  assert.equal(a.systemChoice.chosenId, 'daikin');
  assert.equal(a.investment.baseIncGst, 15400);
  assert.equal(a.investment.totalIncGst, 15400);

  const b = build({ chosenSystemId: 'braemar' }).presentation;
  assert.equal(b.systemChoice.chosenId, 'braemar');
  assert.equal(b.investment.baseIncGst, 13900);
  assert.equal(b.investment.totalIncGst, 13900);
});

test('GST and the deposit follow the choice, and reconcile', () => {
  for (const [id, total] of [['daikin', 15400], ['braemar', 13900]]) {
    const p = build({ chosenSystemId: id }).presentation;
    const inv = p.investment;
    assert.ok(Math.abs((inv.subtotalExGst + inv.gst) - total) < 0.02,
      id + ': ' + inv.subtotalExGst + ' + ' + inv.gst + ' != ' + total);
    assert.equal(inv.deposit.percent, 50);
    assert.ok(Math.abs(inv.deposit.amount - total / 2) < 0.02,
      id + ': the deposit did not follow the system');
  }
});

test('a single-system quote is unchanged, and draws no chooser', () => {
  const p = build({ systemOptions: null }).presentation;
  assert.equal(p.systemChoice.offersChoice, false);
  assert.equal(p.investment.baseIncGst, DEMO.commercials.sellPriceIncGst);
  assert.ok(!renderPresentationHtml(p).includes('Choose your system'));
});

test('a blocked option blocks the quote rather than being dropped from it', () => {
  const out = build({ systemOptions: [DAIKIN, { ...BRAEMAR, priceIncGst: null }] });
  assert.equal(out.ok, false);
  assert.equal(out.presentation, null, 'a quote went out with an option quietly removed');
  assert.ok(out.blockers.some(b => b.code === 'SYSTEM_OPTION_NOT_PRICED'));
});

test('the page draws alternatives as a choice, not as extras', () => {
  const html = renderPresentationHtml(build().presentation);
  assert.ok(html.includes('Choose your system'));
  // Radios, so exactly one is chosen. Checkboxes would read as "add both".
  assert.equal((html.match(/class="sys-in"/g) || []).length, 2);
  assert.ok(/type="radio" name="sys"/.test(html));
  assert.ok(html.includes('Daikin FDYA160AV19 / RZAS160C2V1'));
  assert.ok(html.includes('Braemar SDHV16D1S'));
  assert.ok(html.includes('Our recommendation'));
  // Each carries its own price so the page can move the total on a tap.
  assert.ok(/data-sys-price="15400"/.test(html));
  assert.ok(/data-sys-price="13900"/.test(html));
});

test('no cost or margin rides in on the choice', () => {
  const html = renderPresentationHtml(build().presentation);
  const c = DEMO.commercials;
  for (const v of [c.totalJobCost, c.equipmentCost, c.materialsCost, c.grossProfit]) {
    const whole = String(Math.round(Number(v)));
    assert.ok(!new RegExp('(?<![\\d.,])' + whole + '(?![\\d])').test(html),
      'a cost figure (' + whole + ') reached the page with the options');
  }
  assert.ok(!/unitCost|grossMargin|totalJobCost/.test(html));
});

// ── ONE DEPOSIT, NOT TWO ───────────────────────────────────────────────────
//
// The deposit on the page used to come from the content library, where the
// WORDING lives. So a customer read "20% to confirm your booking" on the page
// while accepting terms whose clause 5.1 says 50%. One document, two deposits.
// The numbers now come from the confirmed terms; the library keeps the prose.

test('the deposit shown is the deposit NAC confirmed, not the library’s', () => {
  const p = build().presentation;
  assert.equal(p.investment.deposit.percent, 50,
    'the page showed a different deposit from the terms being accepted');
  assert.equal(p.investment.deposit.amount, 7700);           // 50% of 15,400
  // The demo library says 20%, so this is a real difference rather than a
  // coincidence of the two agreeing.
  assert.equal(DEMO_CONTENT.paymentTerms.depositPercent, 20);
});

test('unconfirmed terms do not override the library', () => {
  // Confirming is what makes NAC's terms authoritative. Half-typed ones are
  // not, and must not quietly replace what is on the page.
  const unconfirmed = { commercial: { terms: {
    ...TERMS.commercial.terms, depositPercent: 35, confirmed: false } } };
  const p = build({ settings: unconfirmed }).presentation;
  assert.equal(p.investment.deposit.percent, 20, 'unconfirmed terms were treated as policy');
});

test('the validity on the page is the one NAC set', () => {
  assert.match(String(build().presentation.investment.validity), /30 days/);
});
