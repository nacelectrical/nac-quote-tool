// ─────────────────────────────────────────────────────────────────────────────
// EQUIPMENT OPTIONS AND WHAT THEY COST NAC
//
// Nick, 4 November 2026: "Distinguish markup from margin and prevent
// duplicated charges... Use existing approved prices where available. Never
// invent missing rates... Keep fixed quotes and provisional estimates clearly
// distinct."
//
// Most of these are about a number NOT being produced. A missing supplier cost
// has to make the margin UNKNOWN rather than flattering; a missing price has to
// stop the quote rather than default to something; an estimate has to say it is
// one. Every figure asserted here was worked out by hand.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JOB_TYPE, jobTypeLabel, REPLACEMENT_SCOPE, replacementGaps,
         PRICE_BASIS, priceBasisOf, supplierCostOf, marginOf, duplicateCharges,
         FIRMNESS, firmnessOf, optionDetail } from '../designer/engines/option-pricing.mjs';
import { findSupplierLine } from '../designer/engines/supplier-pricing.mjs';

/** A real MMEM line, so the cost in these tests is NAC's actual trade price. */
const MMEM = findSupplierLine('daikin', 'FDYAN100AV1', 10, '1Ph');

const DAIKIN = {
  id: 'sys-a', brand: 'Daikin', brandId: 'daikin',
  model: 'FDYAN100AV1', outdoorModel: 'RZA100C2V1',
  capacityKw: 10, phase: '1Ph', priceIncGst: 12400, warrantyYears: 5
};

// ── MARKUP IS NOT MARGIN ────────────────────────────────────────────────────

test('markup and margin are different numbers, and both are labelled', () => {
  // Worked by hand: $11,000 inc GST is $10,000 ex GST. On a $5,000 cost the
  // profit is $5,000 — a 100% markup and a 50% margin.
  const m = marginOf({ priceIncGst: 11000, gstRate: 0.1, costExGst: 5000 });
  assert.equal(m.known, true);
  assert.equal(m.sellExGst, 10000);
  assert.equal(m.profitExGst, 5000);
  assert.equal(m.markupPct, 100, 'markup is profit over COST');
  assert.equal(m.marginPct, 50, 'margin is profit over SELL');
  assert.match(m.explain, /50% markup is a 33% margin/,
    'the two get swapped, so the difference has to be spelled out');
});

test('the textbook case: a 50% markup is a 33% margin', () => {
  const m = marginOf({ priceIncGst: 3300, gstRate: 0.1, costExGst: 2000 });
  assert.equal(m.sellExGst, 3000);
  assert.equal(m.profitExGst, 1000);
  assert.equal(m.markupPct, 50);
  assert.equal(m.marginPct, 33.3);
  assert.notEqual(m.markupPct, m.marginPct, 'they must never be the same figure');
});

test('a margin with no cost behind it is unknown, not zero and not guessed', () => {
  const m = marginOf({ priceIncGst: 12400, gstRate: 0.1, costExGst: null });
  assert.equal(m.known, false);
  assert.equal(m.reason, 'no_cost');
  assert.equal(m.marginPct, undefined, 'there must be no margin figure at all');
  assert.equal(m.markupPct, undefined);
  assert.match(m.message, /not being estimated/);
});

test('a margin with no price is unknown too', () => {
  const m = marginOf({ priceIncGst: null, costExGst: 5000 });
  assert.equal(m.known, false);
  assert.equal(m.reason, 'no_price');
});

test('an equipment-only margin says the real one is lower', () => {
  const equipOnly = marginOf({ priceIncGst: 11000, costExGst: 5000 });
  assert.equal(equipOnly.equipmentOnly, true);
  assert.match(equipOnly.note, /real margin on the job is lower/);

  // With the installation cost in it, the figure drops and the caveat goes.
  const whole = marginOf({ priceIncGst: 11000, costExGst: 5000, otherCostExGst: 3000 });
  assert.equal(whole.costExGst, 8000);
  assert.equal(whole.profitExGst, 2000);
  assert.equal(whole.marginPct, 20);
  assert.equal(whole.equipmentOnly, false);
  assert.equal(whole.note, null);
  assert.ok(whole.marginPct < equipOnly.marginPct);
});

// ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────

test('the supplier cost comes off NAC’s own MMEM list, and says so', () => {
  const c = supplierCostOf(DAIKIN);
  assert.equal(c.basis, 'mmem');
  assert.equal(c.cost, MMEM.cost, 'the figure has to be the one on the trade list');
  assert.equal(c.gstInclusive, false, 'the MMEM list is ex GST');
  assert.match(c.source, /MMEM Trade Price List/);
  assert.ok(c.code, 'it has to name the line it matched');
});

test('a cost the estimator entered beats the list, because they bought it', () => {
  const c = supplierCostOf({ ...DAIKIN, supplierCost: 3450 });
  assert.equal(c.basis, 'entered');
  assert.equal(c.cost, 3450);
});

test('a model nobody has costed has no cost, and no cost is invented for it', () => {
  const c = supplierCostOf({ brand: 'Some Brand', brandId: 'somebrand',
    model: 'NOT-A-REAL-MODEL-9000', capacityKw: 10, phase: '1Ph' });
  assert.equal(c.cost, null);
  assert.equal(c.basis, 'none');
  assert.match(c.message, /margin on this option is unknown rather than estimated/);
});

test('an approved price is used when nobody has typed one', () => {
  const catalogue = [{ model: 'FDYAN100AV1', priceIncGst: 12900 }];
  const p = priceBasisOf({ ...DAIKIN, priceIncGst: null }, catalogue);
  assert.equal(p.basis, PRICE_BASIS.APPROVED_CATALOGUE);
  assert.equal(p.priceIncGst, 12900);
  assert.equal(p.label, 'Approved price from Price Setup');
});

test('a price with no approved figure and nothing typed is refused, not invented', () => {
  const p = priceBasisOf({ ...DAIKIN, priceIncGst: null }, []);
  assert.equal(p.basis, PRICE_BASIS.NONE);
  assert.equal(p.priceIncGst, null);
  assert.match(p.message, /not something this tool will make up/);
});

test('a price the estimator typed wins, and a gap against the approved one is reported', () => {
  const catalogue = [{ model: 'FDYAN100AV1', priceIncGst: 12900 }];
  const p = priceBasisOf({ ...DAIKIN, priceIncGst: 11400 }, catalogue);
  assert.equal(p.basis, PRICE_BASIS.ESTIMATOR);
  assert.equal(p.priceIncGst, 11400, 'the estimator is at the house; the catalogue is not');
  assert.equal(p.approvedIncGst, 12900);
  assert.equal(p.differsFromApproved, -1500);
  assert.match(p.message, /\$1500\.00 under/);
});

test('a typed price that matches the approved one raises nothing', () => {
  const catalogue = [{ model: 'FDYAN100AV1', priceIncGst: 12400 }];
  const p = priceBasisOf(DAIKIN, catalogue);
  assert.equal(p.basis, PRICE_BASIS.ESTIMATOR);
  assert.equal(p.differsFromApproved, undefined);
  assert.equal(p.message, undefined);
});

// ── NEW INSTALLATIONS AND REPLACEMENTS ──────────────────────────────────────

test('a new installation carries none of the replacement scope', () => {
  assert.equal(jobTypeLabel(JOB_TYPE.NEW_INSTALL), 'New installation');
  assert.deepEqual(replacementGaps({ jobType: JOB_TYPE.NEW_INSTALL, inclusions: [] }), []);
});

test('a replacement with nothing said about the old system says what is missing', () => {
  const gaps = replacementGaps({ jobType: JOB_TYPE.REPLACEMENT, inclusions: [], rooms: [] });
  assert.equal(gaps.length, REPLACEMENT_SCOPE.length);
  assert.ok(gaps.some(g => /refrigerant/i.test(g.label)),
    'nothing said about the refrigerant, which is licensed work');
  assert.ok(gaps.every(g => g.message.includes('This is a replacement')));
  // NAMED, NOT PRICED. Nick: "Never invent missing rates."
  assert.ok(gaps.every(g => !('priceIncGst' in g) || g.priceIncGst === null),
    'the engine must not put a price on a line nobody has costed');
});

test('a replacement the estimator has already scoped raises nothing', () => {
  const gaps = replacementGaps({
    jobType: JOB_TYPE.REPLACEMENT,
    inclusions: [
      'Recover the refrigerant from the existing system and record it',
      'Remove the existing indoor and outdoor units and dispose of them offsite',
      'Reuse the existing ducting and outlets where they are serviceable'
    ]
  });
  assert.deepEqual(gaps, [],
    'an estimator who wrote it in their own words should not get four more lines');
});

test('a replacement scoped in the estimator’s own words still counts', () => {
  // "degas", "strip out", "take away", "retain" — not the engine's wording.
  const gaps = replacementGaps({ jobType: JOB_TYPE.REPLACEMENT,
    inclusions: ['Degas and strip out the old unit, take away for scrap, '
      + 'retain the existing duct run'] });
  assert.deepEqual(gaps, []);
});

// ── THE SAME THING CHARGED TWICE ────────────────────────────────────────────

const UPGRADES = [
  { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350 },
  { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110 }
];

test('a controller both included in the price and charged is flagged', () => {
  const found = duplicateCharges({
    controller: { name: 'Siemens 6-zone kit', includedInPrice: true, priceIncGst: 980 }
  }, { upgrades: UPGRADES });
  assert.ok(found.some(f => f.code === 'CONTROLLER_CHARGED_TWICE'), JSON.stringify(found));
  assert.match(found[0].message, /One of those is wrong/);
});

test('a controller upgrade on a quote that already has that controller is flagged', () => {
  const found = duplicateCharges({
    controller: { name: 'AirTouch 5', includedInPrice: true },
    selectedUpgradeIds: ['at5']
  }, { upgrades: UPGRADES });
  assert.ok(found.some(f => f.code === 'UPGRADE_DUPLICATES_CONTROLLER'), JSON.stringify(found));
  assert.ok(found.some(f => /charges the\s+customer twice/.test(f.message.replace(/\s+/g, ' '))
    || /customer twice/.test(f.message)));
});

test('an upgrade also written into the inclusions is flagged', () => {
  const found = duplicateCharges({
    selectedUpgradeIds: ['sensor'],
    inclusions: ['Supply and install', 'Room temperature sensors in the bedrooms']
  }, { upgrades: UPGRADES });
  const hit = found.find(f => f.code === 'UPGRADE_ALREADY_INCLUDED');
  assert.ok(hit, JSON.stringify(found));
  assert.equal(hit.upgradeId, 'sensor');
  assert.match(hit.message, /Either it is in the price or it is extra/);
});

test('the same model quoted as two options is flagged', () => {
  const found = duplicateCharges({
    systems: [DAIKIN, { ...DAIKIN, id: 'sys-b' }]
  }, { upgrades: UPGRADES });
  assert.ok(found.some(f => f.code === 'SAME_MODEL_TWICE'), JSON.stringify(found));
});

test('a clean quote raises no duplicate at all', () => {
  const found = duplicateCharges({
    systems: [DAIKIN, { ...DAIKIN, id: 'sys-b', brand: 'Braemar', model: 'SDH16' }],
    controller: { name: 'Siemens 6-zone kit', includedInPrice: true },
    selectedUpgradeIds: ['sensor'],
    inclusions: ['Supply and install', 'Commissioning and handover']
  }, { upgrades: UPGRADES });
  assert.deepEqual(found, []);
});

// ── A FIXED QUOTE IS NOT AN ESTIMATE ────────────────────────────────────────

const MEASURED_ROOM = { id: 'living', include: true,
  measurement: { source: 'verified_architectural', widthMm: 5200, lengthMm: 4600 } };

const FIXABLE = {
  jobType: JOB_TYPE.NEW_INSTALL,
  systems: [DAIKIN],
  rooms: [MEASURED_ROOM],
  inclusions: ['Supply and install', 'Commissioning and handover'],
  scope: { summary: 'Seven outlets, one return, four zones.' }
};

test('a complete, measured, priced new installation is a FIXED price', () => {
  const f = firmnessOf(FIXABLE);
  assert.equal(f.firmness, FIRMNESS.FIXED);
  assert.equal(f.fixed, true);
  assert.deepEqual(f.reasons, []);
  assert.equal(f.customerLabel, 'Fixed price');
  assert.match(f.customerNote, /does not change unless you/);
});

test('an unpriced option makes the whole quote provisional', () => {
  const f = firmnessOf({ ...FIXABLE, systems: [{ ...DAIKIN, priceIncGst: null }] });
  assert.equal(f.firmness, FIRMNESS.PROVISIONAL);
  assert.ok(f.reasons.some(r => r.code === 'OPTION_UNPRICED'));
  assert.equal(f.customerLabel, 'Provisional estimate');
  assert.match(f.customerNote, /not a fixed price/);
});

test('an allowance in the scope is not a fixed price', () => {
  for (const line of ['Allowance for an electrical upgrade',
                      'Switchboard works TBC',
                      'Subject to roof access on the day']) {
    const f = firmnessOf({ ...FIXABLE, inclusions: [...FIXABLE.inclusions, line] });
    assert.equal(f.firmness, FIRMNESS.PROVISIONAL, line + ' read as a fixed price');
    assert.ok(f.reasons.some(r => r.code === 'ALLOWANCE_IN_SCOPE'), line);
  }
});

test('a room nobody measured makes the price provisional, because the sizing is', () => {
  const f = firmnessOf({ ...FIXABLE,
    rooms: [MEASURED_ROOM, { id: 'study', include: true, measurement: null }] });
  assert.equal(f.firmness, FIRMNESS.PROVISIONAL);
  const r = f.reasons.find(x => x.code === 'ROOMS_UNMEASURED');
  assert.ok(r);
  assert.match(r.message, /1 room\(s\)/);
});

test('an unscoped replacement cannot be a fixed price', () => {
  const f = firmnessOf({ ...FIXABLE, jobType: JOB_TYPE.REPLACEMENT });
  assert.equal(f.firmness, FIRMNESS.PROVISIONAL);
  assert.ok(f.reasons.some(r => r.code === 'REPLACEMENT_SCOPE_OPEN'));
});

test('a scoped replacement can be a fixed price', () => {
  const f = firmnessOf({ ...FIXABLE, jobType: JOB_TYPE.REPLACEMENT,
    inclusions: ['Supply and install',
      'Recover the refrigerant, remove the old units and dispose of them',
      'Reuse the existing ducting where it is serviceable'] });
  assert.equal(f.firmness, FIRMNESS.FIXED, JSON.stringify(f.reasons));
});

test('the estimator can call it an estimate themselves, and that wins', () => {
  const f = firmnessOf({ ...FIXABLE, provisional: true,
    provisionalReason: 'I have not been in the roof space yet.' });
  assert.equal(f.firmness, FIRMNESS.PROVISIONAL);
  const r = f.reasons.find(x => x.code === 'MARKED_PROVISIONAL');
  assert.equal(r.message, 'I have not been in the roof space yet.');
});

// ── WHAT AN OPTION SHOWS, AND WHAT A CUSTOMER SEES OF IT ────────────────────

test('an option carries everything section 5 asks it to show', () => {
  const d = optionDetail({ ...DAIKIN, image: { src: 'media/daikin.jpg', alt: 'Daikin unit' } },
    { catalogue: [{ model: 'FDYAN100AV1', priceIncGst: 12400 }] });
  assert.equal(d.brand, 'Daikin');
  assert.equal(d.modelPair, 'FDYAN100AV1 / RZA100C2V1',
    'the exact indoor and outdoor pair, not just one of them');
  assert.equal(d.capacityKw, 10);
  assert.equal(d.phase, '1Ph');
  assert.equal(d.image.src, 'media/daikin.jpg');
  assert.equal(d.priceIncGst, 12400);
  assert.ok(d.priceBasis.label, 'the pricing basis has to be named');
  assert.equal(d.supplierCostExGst, MMEM.cost);
  assert.equal(d.margin.known, true);
  assert.deepEqual(d.gaps, []);
});

test('the customer’s half of an option carries no cost, margin or markup', () => {
  const d = optionDetail(DAIKIN, {});
  const text = JSON.stringify(d.customer);
  for (const leak of ['cost', 'Cost', 'margin', 'markup', 'supplier', 'basis', 'mmem',
                      'MMEM', String(MMEM.cost)]) {
    assert.ok(!text.includes(leak),
      '"' + leak + '" reached the customer half of the option: ' + text);
  }
  assert.equal(d.customer.model, 'FDYAN100AV1 / RZA100C2V1');
  assert.equal(d.customer.priceIncGst, 12400);
});

test('an option with nothing known about it says so rather than showing zeroes', () => {
  const d = optionDetail({ id: 'sys-x', brand: 'Some Brand', model: 'UNKNOWN-1' }, {});
  assert.equal(d.priceIncGst, null);
  assert.equal(d.supplierCostExGst, null);
  assert.equal(d.margin.known, false);
  assert.equal(d.gaps.length, 3, 'the price, the cost and the margin are all missing');
  assert.ok(d.gaps.every(g => typeof g === 'string' && g.length > 20));
});
