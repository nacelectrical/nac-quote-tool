// ─────────────────────────────────────────────────────────────────────────────
// NAC'S COMMERCIAL NUMBERS ARE NAC'S
//
// The demonstration proposal carried a 20% deposit, a 30-day validity and a
// $4,200 ductwork allowance. I put all three there to make the page look
// finished. None of them is NAC policy, and shipping them as defaults would
// have made invented commercial terms look like company policy the first time
// a real quote went out — on a document a customer signs.
//
// Nick: "Do not insert invented default dollar amounts." These tests hold that
// line: nothing has a default, everything is editable, and an unconfigured
// value blocks publication while saying exactly what is missing and where.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { proposalAllowance, ALLOWANCE_FIELDS } from '../designer/engines/design-stage.mjs';
import { commercialTermsStatus, TERMS_FIELDS } from '../designer/engines/commercial-terms.mjs';
import { checkTermsAgainstSettings, NAC_TERMS_LABEL, NAC_TERMS_EFFECTIVE }
  from '../designer/engines/nac-terms.mjs';
import { buildBillOfMaterials } from '../designer/engines/bom.mjs';
import { usedRateStatus, rateVerified, VERIFICATION_FIELDS }
  from '../designer/engines/material-verification.mjs';

// ── §3 the proposal allowance ───────────────────────────────────────────────
test('no allowance amount ships as a default', () => {
  const a = DEFAULT_SETTINGS.commercial.proposalAllowance;
  for (const f of ALLOWANCE_FIELDS) {
    assert.equal(a[f.key], null, f.key + ' shipped with an invented amount');
  }
  assert.equal(a.flat, null);
});

test('an unconfigured allowance blocks, and names the screen', () => {
  const r = proposalAllowance({ outletCount: 10, zoneCount: 4, settings: DEFAULT_SETTINGS });
  assert.equal(r.ok, false);
  assert.equal(r.amount, null);
  assert.match(r.reason, /HVAC Design Settings/);
  // And it says what is missing, so the screen can point at it.
  assert.ok(r.missing.length >= 10, 'the missing elements were not listed');
});

test('the allowance covers every element Nick named, each on its own line', () => {
  const keys = ALLOWANCE_FIELDS.map(f => f.key);
  for (const required of ['ductwork', 'perOutlet', 'perZone', 'returns', 'plenums',
                          'electrical', 'refrigeration', 'condensate', 'labour',
                          'roofAccess', 'contingencyPct']) {
    assert.ok(keys.includes(required), 'no allowance element for ' + required);
  }
  // Every element has a plain-language explanation for the screen.
  for (const f of ALLOWANCE_FIELDS) {
    assert.ok(f.help && f.help.length > 20, f.key + ' has no explanation');
    assert.ok(f.label && f.label.length > 2, f.key + ' has no label');
  }

  const settings = { commercial: { proposalAllowance: {
    ductwork: 900, perOutlet: 67.16, perZone: 40.80, returns: 260, plenums: 244,
    electrical: 300, refrigeration: 420, condensate: 160, labour: null,
    roofAccess: 250, contingencyPct: 5 } } };
  const r = proposalAllowance({ outletCount: 10, zoneCount: 6, settings });
  assert.equal(r.ok, true);
  // Each element is its own line, so an estimator can see what it covers.
  const byKey = Object.fromEntries(r.lines.map(l => [l.key, l]));
  assert.equal(byKey.perOutlet.quantity, 10);
  assert.equal(byKey.perZone.quantity, 6);
  assert.ok(byKey.contingencyPct.amount > 0);
  // Labour was left empty and does not appear at all — not as a zero.
  assert.ok(!byKey.labour);
  const sub = 900 + 67.16 * 10 + 40.8 * 6 + 260 + 244 + 300 + 420 + 160 + 250;
  assert.ok(Math.abs(r.amount - (sub * 1.05)) < 0.5, r.amount + ' vs ' + (sub * 1.05));
});

// ── §6 deposit, payment and validity ────────────────────────────────────────
// What ships is what NAC stated, and nothing else. The rule these tests were
// written to protect was never "ship nothing" — it was "ship nothing NAC has
// not said". Nick has now given the deposit, the balance event and the payment
// methods, so those ship; the validity period and the terms version have not
// been given, so they must still be empty and must still block.
test('the terms that ship are the ones NAC stated', () => {
  const t = DEFAULT_SETTINGS.commercial.terms;
  assert.equal(t.depositPercent, 50);
  assert.equal(t.depositAmount, null, 'a deposit is set one way, not two');
  assert.equal(t.balanceDueEvent, 'completion');
  assert.deepEqual(t.paymentMethods, ['Direct deposit', 'EFT']);
  // The demonstration deposit is gone and must not come back.
  assert.notEqual(t.depositPercent, 20, 'the demonstration 20% deposit is back');
  // The demonstration validity was also 30 days. That figure is now NAC's own
  // — Nick gave it and clause 2.1 of the terms says the same — so the guard
  // cannot be "not 30". What matters is that it agrees with the document, and
  // checkTermsAgainstSettings holds that in the test below.
  assert.equal(t.validityDays, 30);
  // The stages add up to the whole job, and to the deposit that was stated.
  assert.equal(t.paymentStages.reduce((n, p) => n + p.percent, 0), 100);
  assert.equal(t.paymentStages[0].percent, t.depositPercent);
});

test('the settings and the terms document state the same figures', () => {
  // The customer gets both documents. If the deposit is 30% in one and 50% in
  // the other, the one they signed is whichever their solicitor reads first.
  const t = DEFAULT_SETTINGS.commercial.terms;
  assert.equal(t.validityDays, 30);                      // clause 2.1
  assert.equal(t.termsVersion, NAC_TERMS_LABEL);
  assert.equal(t.termsEffectiveDate, NAC_TERMS_EFFECTIVE);
  const check = checkTermsAgainstSettings(DEFAULT_SETTINGS);
  assert.equal(check.ok, true, check.conflicts.map(c => c.code).join(', '));

  // And it is a real check, not one that always passes.
  const drifted = checkTermsAgainstSettings({ commercial: { terms: {
    validityDays: 60, depositPercent: 20, balanceDueEvent: 'handover' } } });
  assert.deepEqual(drifted.conflicts.map(c => c.code).sort(),
    ['TERMS_BALANCE_CONFLICT', 'TERMS_DEPOSIT_CONFLICT', 'TERMS_VALIDITY_CONFLICT']);
});

test('typing the terms in is still not the same as confirming them', () => {
  const t = DEFAULT_SETTINGS.commercial.terms;
  assert.equal(t.confirmed, false, 'terms confirmed themselves');
  assert.equal(t.confirmedBy, '');
  const s = commercialTermsStatus(DEFAULT_SETTINGS);
  assert.equal(s.ok, false);
  assert.equal(s.missing.length, 0, 'something is still missing');
  assert.ok(s.failures.some(f => f.code === 'TERMS_NOT_CONFIRMED'),
    'the only thing left is Nick pressing confirm, and nothing says so');
});

test('a field cleared out is reported missing, by name and to the screen', () => {
  const gutted = { commercial: { terms: {
    ...DEFAULT_SETTINGS.commercial.terms, validityDays: null, termsVersion: '' } } };
  const s = commercialTermsStatus(gutted);
  assert.equal(s.ok, false);
  const keys = s.missing.map(m => m.key);
  for (const k of ['validityDays', 'termsVersion']) {
    assert.ok(keys.includes(k), k + ' was not reported missing');
  }
  // And the ones that ARE set are not reported missing.
  for (const k of ['deposit', 'balanceDueEvent', 'paymentMethods']) {
    assert.ok(!keys.includes(k), k + ' is set but was reported missing');
  }
  const f = s.failures.find(x => x.code === 'COMMERCIAL_TERMS_NOT_SET');
  assert.ok(f);
  assert.match(f.message, /HVAC Design Settings/);
  // Every field has an explanation for the screen.
  for (const t of TERMS_FIELDS) assert.ok(t.help && t.help.length > 20, t.key);
});

test('filling the terms in is not the same as confirming them', () => {
  const filled = { commercial: { terms: {
    depositPercent: 20, balanceDueEvent: 'completion and commissioning',
    validityDays: 30, paymentMethods: ['Bank transfer'], termsVersion: 'v1',
    confirmed: false } } };
  const s = commercialTermsStatus(filled);
  assert.equal(s.ok, false);
  assert.equal(s.missing.length, 0, 'nothing is missing, yet it is still blocked');
  assert.ok(s.failures.some(f => f.code === 'TERMS_NOT_CONFIRMED'));

  const confirmed = { commercial: { terms: { ...filled.commercial.terms,
    confirmed: true, confirmedBy: 'Nick Cahill', confirmedAt: '2026-09-22' } } };
  const ok = commercialTermsStatus(confirmed);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures.map(f => f.code)));
  assert.equal(ok.confirmed, true);
});

test('a deposit set two ways, or an impossible validity, is refused', () => {
  const both = commercialTermsStatus({ commercial: { terms: {
    depositPercent: 20, depositAmount: 1500, balanceDueEvent: 'x', validityDays: 30,
    paymentMethods: ['Bank'], termsVersion: 'v1', confirmed: true, confirmedBy: 'N' } } });
  assert.ok(both.failures.some(f => f.code === 'DEPOSIT_SET_TWO_WAYS'));

  const expired = commercialTermsStatus({ commercial: { terms: {
    depositPercent: 20, balanceDueEvent: 'x', validityDays: 0,
    paymentMethods: ['Bank'], termsVersion: 'v1', confirmed: true, confirmedBy: 'N' } } });
  assert.ok(expired.failures.some(f => f.code === 'VALIDITY_IMPLAUSIBLE'));
});

// ── §5 material rates requiring confirmation ────────────────────────────────
test('a rate is verified only when somebody can say where it came from', () => {
  assert.equal(rateVerified(null), false);
  assert.equal(rateVerified({ cost: 95 }), false, 'a bare number counted as verified');
  assert.equal(rateVerified({ cost: 95, supplier: 'MMEM', effectiveDate: '2026-09-01' }),
    false, 'no verifier counted as verified');
  assert.equal(rateVerified({ cost: 95, supplier: 'MMEM', effectiveDate: '2026-09-01',
    verifiedBy: 'Nick Cahill', verifiedAt: '2026-09-15' }), true);

  // Every column Nick asked for.
  const keys = VERIFICATION_FIELDS.map(f => f.key);
  for (const k of ['supplier', 'supplierDesc', 'effectiveDate', 'cost',
                   'verifiedBy', 'verifiedAt']) {
    assert.ok(keys.includes(k), 'no verification column for ' + k);
  }
});

test('unverified rates on lines the job USES block the quote', () => {
  const design = { bom: { items: [
    { key: 'outdoor_feet', label: 'Outdoor unit mounting feet', unitCost: 95,
      priced: true, priceSource: 'default_placeholder' },
    { key: 'flex_duct', diameterMm: 250, label: 'Flex duct 250', unitCost: 32,
      priced: true, priceSource: 'supplier_list', supplierCode: 'MMA2506' }
  ] } };
  const r = usedRateStatus({ design, verifications: {} });
  assert.equal(r.ok, false);
  // The placeholder needs confirming; the supplier-quoted line carries its own
  // evidence and does not.
  assert.deepEqual(r.needing.map(x => x.id), ['outdoor_feet']);
  assert.match(r.failures[0].message, /HVAC Design Settings/);
  assert.match(r.failures[0].message, /Outdoor unit mounting feet/);

  const verified = usedRateStatus({ design, verifications: { outdoor_feet: {
    supplier: 'MMEM', effectiveDate: '2026-09-01', cost: 95,
    verifiedBy: 'Nick Cahill', verifiedAt: '2026-09-15' } } });
  assert.equal(verified.ok, true, JSON.stringify(verified.needing.map(x => x.id)));
});

test('a fixed sell price is evidenced by who set it, not by a supplier', () => {
  // Nick's six fixed-price lines carry a SELL price and no cost, because the
  // job fee is not applied to them. Demanding a supplier and a NAC cost for
  // those would leave two boxes that can only be filled by inventing figures.
  const design = { bom: { items: [
    { key: 'isolator', label: 'Weatherproof isolator', unit: 'each',
      unitCost: null, priced: true, priceSource: 'nac_sell',
      fixedSell: true, sellPrice: 68, statedBy: 'Nick, 2026-09-22' }
  ] } };
  const r = usedRateStatus({ design, verifications: {} });
  assert.equal(r.ok, true, 'a stated sell price was still treated as unevidenced');
  assert.equal(r.rows[0].sellPriceStated, true);
  assert.equal(r.rows[0].sellPrice, 68);
  assert.equal(r.rows[0].statedBy, 'Nick, 2026-09-22');
  assert.equal(r.rows[0].needsConfirmation, false);
});

test('a fixed sell price with nobody behind it is not evidence', () => {
  // The evidence IS the name and the date. Without them it is just a number.
  for (const missing of [{ statedBy: '' }, { statedBy: '   ' }, { sellPrice: null }]) {
    const design = { bom: { items: [
      { key: 'isolator', label: 'Weatherproof isolator', unit: 'each',
        unitCost: null, priced: true, priceSource: 'nac_sell',
        fixedSell: true, sellPrice: 68, statedBy: 'Nick, 2026-09-22', ...missing }
    ] } };
    const r = usedRateStatus({ design, verifications: {} });
    assert.equal(r.ok, false, 'accepted a sell price with ' + JSON.stringify(missing));
    assert.equal(r.rows[0].sellPriceStated, false);
  }
});

test('a real cost line is still asked for its supplier', () => {
  // The exemption is for fixed sell prices only. A unit and a controller are
  // things NAC buy, and a customer quote still waits on the supplier's quote.
  const design = { bom: { items: [
    { key: 'indoor_unit', label: 'Daikin FDYA160AV19 — 16 kW', unit: 'system',
      unitCost: 5700, priced: true, priceSource: 'nac' },
    { key: 'zone_controller', label: 'Siemens Home zone control — 6 zone',
      unit: 'each', unitCost: 295, priced: true, priceSource: 'nac' }
  ] } };
  const r = usedRateStatus({ design, verifications: {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.needing.map(x => x.id), ['indoor_unit', 'zone_controller']);
  for (const row of r.needing) assert.equal(row.sellPriceStated, false);
});

test('rates the job does not use never block it', () => {
  // The catalogue carries every size. Blocking on sizes this house will never
  // see is noise that teaches an estimator to ignore the check.
  const design = { bom: { items: [
    { key: 'flex_duct', diameterMm: 250, label: 'Flex 250', unitCost: 32,
      priced: true, priceSource: 'supplier_list', supplierCode: 'MMA2506' }
  ] } };
  const r = usedRateStatus({ design, verifications: {} });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1, 'it looked beyond the lines this job uses');
});

test('the proposal allowance is not a material rate and is never asked to be one', () => {
  const design = { bom: { items: [
    { key: 'proposal_ductwork_allowance', label: 'Standard installation allowance',
      unitCost: 1093.24, priced: true, priceSource: 'NAC' }
  ] } };
  const r = usedRateStatus({ design, verifications: {} });
  assert.equal(r.rows.length, 0, 'the allowance was treated as a supplier rate');
  assert.equal(r.ok, true);
});

test('a unit and a controller off MMEM carry their stock code into the BOM', () => {
  // This blocked a real quote. Both lines are priced from MMEM's list and both
  // know the stock code they were priced under — the BOM was dropping it, so
  // the rate check looked at a bare number and asked which supplier quoted it,
  // on the two lines where the answer was already on file.
  const design = {
    selectedUnit: { brandName: 'Daikin', model: 'FDYAN160AV1 / RZA160C2V1',
      capacityKw: 16, phase: '1Ph', supplierCost: 4820,
      supplierCode: 'FDYAN160AV1 / RZA160C2V1',
      supplierSource: 'MMEM Trade Price List January 2026' },
    controller: { name: 'Siemens Home zone control — 6 zone', cost: 295,
      supplierCode: 'MMASEM6ZTPKIT' },
    outlets: null, zones: null, network: null
  };
  const bom = buildBillOfMaterials(design, { settings: DEFAULT_SETTINGS });
  const unit = bom.items.find(i => i.key === 'indoor_outdoor_system');
  const ctrl = bom.items.find(i => i.key === 'zone_controller');
  assert.equal(unit.supplierCode, 'FDYAN160AV1 / RZA160C2V1');
  assert.equal(unit.supplierSource, 'MMEM Trade Price List January 2026');
  assert.equal(ctrl.supplierCode, 'MMASEM6ZTPKIT');

  // And that evidence is what the rate check is looking for.
  const r = usedRateStatus({ design: { bom }, verifications: {} });
  assert.equal(r.ok, true, 'still blocked: ' + r.needing.map(x => x.label).join(', '));
});

test('a line with no supplier code is still asked where its price came from', () => {
  // The fix must not wave through a rate somebody typed in by hand.
  const design = {
    controller: { name: 'Some controller', cost: 295 },
    outlets: null, zones: null, network: null
  };
  const bom = buildBillOfMaterials(design, { settings: DEFAULT_SETTINGS });
  assert.equal(bom.items.find(i => i.key === 'zone_controller').supplierCode, null);
  const r = usedRateStatus({ design: { bom }, verifications: {} });
  assert.equal(r.ok, false);
  assert.deepEqual(r.needing.map(x => x.id), ['zone_controller']);
});
