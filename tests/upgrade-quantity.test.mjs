// UPGRADES YOU BUY MORE THAN ONE OF, AND UPGRADES THAT ONLY FIT ONE SYSTEM.
//
// Two things a quote offering a choice of system has to get right.
//
// A smart controller is one thing or nothing. A temperature sensor is one per
// room the customer wants sensed, and how many is their call — so an upgrade
// may carry a UNIT price and a maximum, and the count is settled server-side
// rather than trusted from the page.
//
// And the AirTouch kit NAC stock is the Daikin one. On a quote where the
// customer can also pick a Braemar, ticking the AirTouch and then switching
// system left $1,950 of Daikin-only gear in the Braemar's total. A customer
// could have accepted a price for a kit that cannot be installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseUpgrade, resolveUpgrades } from '../designer/engines/presentation-content.mjs';
import { normaliseSystemOption } from '../designer/engines/system-options.mjs';
import { buildPresentation } from '../designer/engines/presentation.mjs';

const SENSOR = { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 100,
                 maxQuantity: 6, requires: ['has_zoning', 'daikin_system'], enabled: true };
const AT5 = { id: 'at5', title: 'AirTouch 5', priceIncGst: 1350,
              requires: ['has_zoning', 'daikin_system'], enabled: true };

// ── The unit price ───────────────────────────────────────────────────────────

test('an upgrade may be priced per unit instead of flat', () => {
  const u = normaliseUpgrade(SENSOR);
  assert.equal(u.unitPriceIncGst, 100);
  assert.equal(u.maxQuantity, 6);
  assert.equal(u.priceIncGst, null, 'a unit-priced upgrade must not gain a flat price');
  assert.equal(u.unitLabel, 'each');
});

test('absent stays absent on a flat upgrade', () => {
  // Number(null) is 0. A flat upgrade must not read as costing 0 per unit and
  // become something a customer can order six of for nothing.
  const u = normaliseUpgrade(AT5);
  assert.equal(u.unitPriceIncGst, null);
  assert.equal(u.maxQuantity, null);
  assert.equal(u.priceIncGst, 1350);
});

test('a unit-priced upgrade with no ceiling is withheld', () => {
  // Without a maximum the page is an order form, not a quote.
  const { offerable, withheld } = resolveUpgrades(
    [{ ...SENSOR, maxQuantity: null }], { has_zoning: true, daikin_system: true });
  assert.equal(offerable.length, 0);
  assert.match(withheld[0].reason, /maximum quantity/i);
});

test('an upgrade with neither price is still withheld', () => {
  const { offerable, withheld } = resolveUpgrades(
    [{ id: 'x', title: 'Something', enabled: true }], {});
  assert.equal(offerable.length, 0);
  assert.match(withheld[0].reason, /No price/i);
});

// ── The count, settled by the server ─────────────────────────────────────────

const DESIGN = {
  zones: { zones: [{ id: 'z1' }, { id: 'z2' }], zoneCount: 2 },
  controller: { name: 'Siemens Home zone control — 6 zone', cost: 295 },
  selectedUnit: { brandId: 'daikin', brandName: 'Daikin', model: 'FDYAN160AV1', phase: '1Ph' },
  commercials: { sellPriceIncGst: 15037.79, gstRate: 0.1 }
};
const OPTIONS = [
  { id: 'daikin-16', brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1',
    capacityKw: 16, priceIncGst: 15037.79, recommended: true },
  { id: 'braemar-16', brand: 'Braemar', brandId: 'braemar', model: 'KDHV160D1S',
    capacityKw: 16.3, priceIncGst: 13563.79, warrantyYears: 7 }
];
const build = (selectedOptionIds) => buildPresentation({
  design: DESIGN, content: { upgrades: [AT5, SENSOR] },
  customer: { name: 'A Customer' }, job: { siteAddress: '1 Test St' },
  systemOptions: OPTIONS, chosenSystemId: 'daikin-16', selectedOptionIds
}).presentation;

test('the count the customer asked for is priced at the unit rate', () => {
  const inv = build([{ id: 'sensor', quantity: 4 }]).investment;
  const line = inv.selectedOptions.find(o => o.id === 'sensor');
  assert.equal(line.quantity, 4);
  assert.equal(line.priceIncGst, 400);
  assert.equal(inv.optionsTotal, 400);
});

test('a count past the maximum is clamped, not honoured', () => {
  // The page has a max on the spinner. The price is settled here, so a request
  // for two hundred sensors gets the six NAC offered.
  const line = build([{ id: 'sensor', quantity: 200 }]).investment.selectedOptions
    .find(o => o.id === 'sensor');
  assert.equal(line.quantity, 6);
  assert.equal(line.priceIncGst, 600);
});

test('none chosen is not a selection', () => {
  for (const q of [0, -3, null, 'six']) {
    const inv = build([{ id: 'sensor', quantity: q }]).investment;
    assert.equal(inv.selectedOptions.filter(o => o.id === 'sensor').length, 0,
      'quantity ' + JSON.stringify(q) + ' put a line on the quote');
  }
});

test('a fractional count is a whole number of sensors', () => {
  const line = build([{ id: 'sensor', quantity: 3.7 }]).investment.selectedOptions
    .find(o => o.id === 'sensor');
  assert.equal(line.quantity, 4);
});

test('a flat upgrade still works by bare id', () => {
  const inv = build(['at5']).investment;
  assert.equal(inv.optionsTotal, 1350);
  assert.equal(inv.totalIncGst, 15037.79 + 1350);
});

test('both together add up', () => {
  const inv = build(['at5', { id: 'sensor', quantity: 6 }]).investment;
  assert.equal(inv.optionsTotal, 1950);
  assert.equal(inv.totalIncGst, 15037.79 + 1950);
  // The GST split follows the system, not the upgrades — they are already
  // GST-inclusive figures NAC set.
  assert.equal(inv.baseIncGst, 15037.79);
});

// ── Which systems an upgrade fits ────────────────────────────────────────────

test('a brand-locked upgrade names only the systems it fits', () => {
  const opts = build([]).options;
  for (const id of ['at5', 'sensor']) {
    const o = opts.find(x => x.id === id);
    assert.deepEqual(o.forSystemIds, ['daikin-16'],
      id + ' was offered against a system it cannot be installed on');
  }
});

test('an upgrade with no brand lock fits every system on the page', () => {
  const p = buildPresentation({
    design: DESIGN,
    content: { upgrades: [{ id: 'wifi', title: 'Wi-Fi', priceIncGst: 300,
                            requires: ['has_zoning'], enabled: true }] },
    customer: { name: 'A Customer' }, job: { siteAddress: '1 Test St' },
    systemOptions: OPTIONS, chosenSystemId: 'daikin-16'
  }).presentation;
  assert.deepEqual(p.options[0].forSystemIds, ['daikin-16', 'braemar-16']);
});

// ── The warranty that differs by brand ───────────────────────────────────────

test('a system option carries the manufacturer warranty stated for it', () => {
  assert.equal(normaliseSystemOption({ brand: 'Braemar', model: 'KDHV160D1S',
    warrantyYears: 7 }).warrantyYears, 7);
  // Never supplied. A brand nobody has given a figure for shows none.
  assert.equal(normaliseSystemOption({ brand: 'Daikin', model: 'FDYAN160AV1' })
    .warrantyYears, null);
});

test('the warranty reaches the customer page beside the price', () => {
  const cards = build([]).systemChoice.options;
  assert.equal(cards.find(o => o.id === 'braemar-16').warrantyYears, 7);
  assert.equal(cards.find(o => o.id === 'daikin-16').warrantyYears, null);
});

test('a brand id is derived when the catalogue did not supply one', () => {
  assert.equal(normaliseSystemOption({ brand: 'Mitsubishi Electric', model: 'X' }).brandId,
    'mitsubishielectric');
  assert.equal(normaliseSystemOption({ brand: 'Daikin', model: 'X', brandId: 'daikin' }).brandId,
    'daikin');
});
