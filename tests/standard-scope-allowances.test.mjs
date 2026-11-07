// ─────────────────────────────────────────────────────────────────────────────
// WHAT EVERY QUOTE PROMISES, AND WHAT NAC CARRY AN ALLOWANCE FOR
//
// Nick, 4 November 2026: "Allow me to manage... standard inclusions and
// exclusions... equipment prices and installation allowances... Never invent
// reviews, credentials, product claims or warranty terms."
//
// The standard inclusions and exclusions were two arrays inside
// quote-builder.html, so Nick could not change a word of what every NAC quote
// promises without somebody editing the application. They are content now.
//
// An allowance with no figure is the interesting case: it must be WITHHELD
// rather than quoted at zero, because a zero on a proposal reads as "no
// charge" and that is a promise NAC did not make.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { standardScope, SHIPPED_STANDARD_SCOPE, SHIPPED_QUALIFICATIONS,
         normaliseAllowance, allowancesFor }
  from '../designer/engines/presentation-content.mjs';
import { firmnessOf } from '../designer/engines/option-pricing.mjs';

// ── THE STANDARD SCOPE ──────────────────────────────────────────────────────

test('a library nobody has opened behaves exactly as the builder used to', () => {
  const s = standardScope(null);
  assert.deepEqual(s.inclusions, [...SHIPPED_STANDARD_SCOPE.inclusions]);
  assert.deepEqual(s.exclusions, [...SHIPPED_STANDARD_SCOPE.exclusions]);
  assert.equal(s.isShipped, true);
});

test('the shipped wording is NAC\u2019s own, off NAC\u2019s own quotation', () => {
  // Nick, 7 November 2026, sending quotation NAC-2611-LEW: "I need these
  // inclusions on here ... so I don't have to include everyone."
  //
  // What shipped before was five lines written as a placeholder — true as far
  // as they went, and nothing like the scope NAC actually quotes. If somebody
  // changes this list without changing this test, a NAC quote quietly starts
  // promising something different.
  const inc = SHIPPED_STANDARD_SCOPE.inclusions;
  const exc = SHIPPED_STANDARD_SCOPE.exclusions;

  // The lines that carry the trade: the ones a customer is actually buying
  // and the ones that get argued about.
  for (const must of [
    /supply and installation of the ducted system/i,
    /complete new ductwork/i,
    /return air grille/i,
    /zone motors and dampers/i,
    /refrigeration pipework/i,
    /condensate drainage/i,
    /weatherproof isolating switch/i,
    /nitrogen pressure test, vacuum, charge/i,
    /ARCtick licensed refrigerant handling/i,
    /making good of all wall and ceiling penetrations/i,
    /warranty registration/i,
    /handover walkthrough/i
  ]) {
    assert.ok(inc.some(x => must.test(x)), 'the standard inclusions lost ' + must);
  }
  assert.ok(inc.length >= 14, 'only ' + inc.length + ' inclusions');

  for (const must of [
    /bathroom, ensuite, WC, laundry and linen/i,   // and it matches the room rule
    /asbestos/i,
    /switchboard/i,
    /painting, cornice, plaster/i,
    /concrete slabs or pads/i,
    /any work not expressly listed/i
  ]) {
    assert.ok(exc.some(x => must.test(x)), 'the standard exclusions lost ' + must);
  }
  assert.ok(exc.length >= 8, 'only ' + exc.length + ' exclusions');

  // ── AND NOT ONE CUSTOMER'S HOUSE ────────────────────────────────────
  //
  // The quotation these came from was for a particular place: an office that
  // was not on the system, a courtyard, a duct run to a far wing, and five
  // zones. A STANDARD list carrying one customer's floor plan is not a
  // standard list — it is a promise about somebody else's house.
  const all = [...inc, ...exc].join(' | ');
  for (const leaked of [/courtyard/i, /\bthe office\b/i, /far wing/i,
                        /master suite/i, /five zones/i, /16 kW/i]) {
    assert.ok(!leaked.test(all), 'one job\u2019s detail is in the standard list: ' + leaked);
  }
});

test('the standing qualifications are there, and are conditions not scope', () => {
  // On NAC-2611-LEW these sit beside the warranty and payment terms. Each one
  // closes a hole that otherwise opens on site.
  const ids = SHIPPED_QUALIFICATIONS.map(q => q.id);
  assert.deepEqual(ids.sort(),
    ['model_numbers', 'roof_access', 'sizing', 'zones_layout']);
  for (const q of SHIPPED_QUALIFICATIONS) {
    assert.ok(q.heading && q.heading.length > 2, 'a qualification with no heading');
    assert.ok(q.body && q.body.length > 60, q.id + ' says too little to be useful');
  }
  // The two that matter most: nothing is ordered before the site measure, and
  // a substitute model costs the customer nothing.
  assert.match(SHIPPED_QUALIFICATIONS.find(q => q.id === 'sizing').body,
    /before anything is ordered/i);
  assert.match(SHIPPED_QUALIFICATIONS.find(q => q.id === 'model_numbers').body,
    /no additional cost/i);
});

test('Nick’s wording wins outright', () => {
  const s = standardScope({
    inclusions: ['Supply and install', '  ', 'Make good around the openings'],
    exclusions: ['Anything structural']
  });
  assert.deepEqual(s.inclusions, ['Supply and install', 'Make good around the openings'],
    'blank lines are dropped, the rest is his');
  assert.deepEqual(s.exclusions, ['Anything structural']);
  assert.equal(s.isShipped, false);
});

test('a list Nick deliberately emptied stays empty', () => {
  // Deciding NAC's quotes carry no standard exclusions is a decision, not a
  // blank to be filled in with the shipped list behind his back.
  const s = standardScope({ inclusions: ['Supply and install'], exclusions: [] });
  assert.deepEqual(s.exclusions, []);
  assert.equal(s.isShipped, false);
});

test('the builder no longer carries its own copy of the wording', () => {
  const src = readFileSync(new URL('../quote-builder.html', import.meta.url), 'utf8');
  assert.ok(!src.includes('USUAL_INCLUSIONS'),
    'the hard-coded list is still in the builder');
  assert.ok(!src.includes('Removal of all installation waste'),
    'a line of the standard scope is still written into the application');
  assert.ok(src.includes('standardScope'),
    'the builder has to read the wording out of the library');
});

// ── INSTALLATION ALLOWANCES ─────────────────────────────────────────────────

const SWITCHBOARD = {
  id: 'sb', title: 'Switchboard upgrade allowance', priceIncGst: 850,
  covers: 'Up to a two-pole RCBO and a new circuit. A board replacement is beyond it.'
};

test('a priced allowance is offerable, with what it covers', () => {
  const { offerable, withheld } = allowancesFor([SWITCHBOARD]);
  assert.equal(withheld.length, 0);
  assert.equal(offerable.length, 1);
  assert.equal(offerable[0].priceIncGst, 850);
  assert.match(offerable[0].covers, /beyond it/,
    'what would take the job past the allowance is the part that stops an argument');
});

test('an allowance with no figure is withheld, never quoted at zero', () => {
  const { offerable, withheld } = allowancesFor([
    { id: 'x', title: 'Long duct run allowance' }]);
  assert.deepEqual(offerable, []);
  assert.equal(withheld.length, 1);
  assert.equal(withheld[0].priceIncGst, null,
    'it must not have been defaulted to anything');
  assert.match(withheld[0].reason, /reads as "no charge"/);
});

test('a zero somebody typed is a real answer and is offered', () => {
  // Number(x) || something turns a deliberate 0 into that something. A nil
  // allowance is NAC saying "we carry this at no charge", which is theirs to say.
  const { offerable } = allowancesFor([{ id: 'z', title: 'Make good', priceIncGst: 0 }]);
  assert.equal(offerable.length, 1);
  assert.equal(offerable[0].priceIncGst, 0);
});

test('an allowance with no name is withheld, because nobody could read it', () => {
  const { withheld } = allowancesFor([{ id: 'n', priceIncGst: 500 }]);
  assert.equal(withheld.length, 1);
  assert.match(withheld[0].reason, /No name/);
});

test('an allowance switched off is simply not there', () => {
  const { offerable, withheld } = allowancesFor([{ ...SWITCHBOARD, enabled: false }]);
  assert.deepEqual(offerable, []);
  assert.deepEqual(withheld, []);
});

test('allowances come back in the order they were put in', () => {
  const { offerable } = allowancesFor([
    { id: 'b', title: 'B', priceIncGst: 1, sortOrder: 2 },
    { id: 'a', title: 'A', priceIncGst: 1, sortOrder: 1 }
  ]);
  assert.deepEqual(offerable.map(o => o.id), ['a', 'b']);
});

test('a negative or nonsense figure is not a price', () => {
  for (const bad of [-100, 'soon', NaN, {}]) {
    const a = normaliseAllowance({ title: 'X', priceIncGst: bad });
    assert.equal(a.priceIncGst, null, String(bad) + ' was read as a price');
  }
});

// ── AN ALLOWANCE MAKES THE QUOTE PROVISIONAL ────────────────────────────────

test('an allowance on a quote means it is not a fixed price', () => {
  // The two halves of section 5 and section 7 meeting: Nick configures an
  // allowance, the estimator puts it on a quote, and the customer is told the
  // price is provisional rather than being quietly given a fixed one.
  const { offerable } = allowancesFor([SWITCHBOARD]);
  const line = offerable[0].title + ' — allowance of $850.00 included';
  const quote = {
    systems: [{ id: 's1', brand: 'Daikin', model: 'X', priceIncGst: 12000 }],
    rooms: [], inclusions: ['Supply and install', line], scope: {}
  };
  const f = firmnessOf(quote);
  assert.equal(f.fixed, false);
  assert.ok(f.reasons.some(r => r.code === 'ALLOWANCE_IN_SCOPE'));
  assert.equal(f.customerLabel, 'Provisional estimate');
});

test('the same quote without the allowance is a fixed price', () => {
  const f = firmnessOf({
    systems: [{ id: 's1', brand: 'Daikin', model: 'X', priceIncGst: 12000 }],
    rooms: [], inclusions: ['Supply and install'], scope: {}
  });
  assert.equal(f.fixed, true, JSON.stringify(f.reasons));
});

// ── MANUFACTURER BROCHURES ──────────────────────────────────────────────────
//
// Nick: "equipment and controller images and brochures." And: "Never invent
// reviews, credentials, product claims or warranty terms."
//
// A brochure link is a product claim by proxy: it tells the customer "this is
// the unit, here is its specification". So it is NAC's link or it is nothing,
// and no URL is ever built from a model name.

test('a brochure NAC supplied is matched to the unit being quoted', async () => {
  const { brochuresFor } = await import('../designer/engines/presentation-content.mjs');
  const { matched } = brochuresFor([
    { id: 'd', title: 'Daikin FDYAN ducted — brochure (PDF)',
      url: 'https://www.daikin.com.au/sites/default/files/fdyan.pdf',
      model: 'FDYAN160AV1' },
    { id: 'b', title: 'Braemar brochure', url: 'https://example.com/b.pdf',
      model: 'KDHV160D1S' }
  ], { model: 'FDYAN160AV1', brandId: 'daikin' });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'd', 'the wrong brand’s brochure must not be attached');
});

test('a brand-wide brochure matches on the brand when no model is named', async () => {
  const { brochuresFor } = await import('../designer/engines/presentation-content.mjs');
  const docs = [{ id: 'w', title: 'Daikin ducted range', url: 'https://x.test/d.pdf',
    brandId: 'daikin' }];
  assert.equal(brochuresFor(docs, { model: 'FDYAN160AV1', brandId: 'daikin' })
    .matched.length, 1);
  assert.equal(brochuresFor(docs, { model: 'KDHV160D1S', brandId: 'braemar' })
    .matched.length, 0);
});

test('a brochure with no link is withheld, never guessed at', async () => {
  const { brochuresFor } = await import('../designer/engines/presentation-content.mjs');
  const { matched, withheld } = brochuresFor([
    { id: 'n', title: 'Daikin brochure', model: 'FDYAN160AV1' }
  ], { model: 'FDYAN160AV1', brandId: 'daikin' });
  assert.deepEqual(matched, []);
  assert.equal(withheld.length, 1);
  assert.match(withheld[0].reason, /no URL is ever constructed from a model name/);
});

test('an insecure or malformed link is refused', async () => {
  const { normaliseBrochure } = await import('../designer/engines/presentation-content.mjs');
  for (const bad of ['http://example.com/a.pdf', 'javascript:alert(1)',
                     'not a url', 'ftp://x/a.pdf', '']) {
    assert.equal(normaliseBrochure({ title: 'X', url: bad }).url, '',
      bad + ' was accepted as a brochure link');
  }
  assert.equal(normaliseBrochure({ title: 'X', url: 'https://x.test/a.pdf' }).url,
    'https://x.test/a.pdf');
});

test('the brochure link reaches the proposal, and nothing describes the unit', async () => {
  const { buildTestQuote } = await import('../tools/quote-only-proof.mjs');
  const { renderPresentationHtml } =
    await import('../designer/ui/presentation-html.mjs');
  const { built } = buildTestQuote({ brochures: [
    { id: 'd', title: 'Daikin FDYAN ducted — manufacturer brochure (PDF)',
      url: 'https://x.test/fdyan.pdf', model: 'FDYAN160AV1' }
  ] });
  assert.ok(built.ok);
  assert.deepEqual(built.presentation.system.brochures,
    [{ title: 'Daikin FDYAN ducted — manufacturer brochure (PDF)',
       url: 'https://x.test/fdyan.pdf' }]);
  const html = renderPresentationHtml(built.presentation);
  assert.ok(html.includes('https://x.test/fdyan.pdf'));
  assert.ok(html.includes('rel="noopener noreferrer"'),
    'an outbound link from a customer page opens safely');
});

test('a quote with no brochure on file links nothing at all', async () => {
  const { buildTestQuote } = await import('../tools/quote-only-proof.mjs');
  const { renderPresentationHtml } =
    await import('../designer/ui/presentation-html.mjs');
  const { built } = buildTestQuote();
  assert.deepEqual(built.presentation.system.brochures, []);
  assert.ok(!/class="sys-docs"/.test(renderPresentationHtml(built.presentation)),
    'an empty brochure list must render nothing, not an empty block');
});
