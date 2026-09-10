// NAC AI HVAC DESIGNER — the money.
//
// Every figure here is checked against a value worked out by hand, not against
// whatever the engine happens to return. On NAC's basis the customer's price is
// built FROM the costs, so an arithmetic slip does not look wrong on screen —
// it just quietly under- or over-charges a real job.
//
// The load-bearing identity: on job-cost-plus-fee, gross profit must equal the
// fee EXACTLY, whatever the costs are. The fee is the margin. If GP and the fee
// ever diverge, something is being counted twice or lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { calculateLabour, calculateCommercials } from '../designer/engines/costing.mjs';
import { DEFAULT_SETTINGS, settingsWith } from '../designer/engines/settings.mjs';

const bom = (equipmentCost, materialsCost, extra = {}) => ({ equipmentCost, materialsCost, ...extra });
const flatFee = (fee = 6000) => ({ mode: 'flat', totalCost: 0, totalFee: fee, jobFeeExGst: true });
const GST = 1.1;

// ── The core sum ───────────────────────────────────────────────────────────

test('job cost is equipment + materials + labour + subcontractor + other', () => {
  const r = calculateCommercials({
    bom: bom(5000, 3000), labour: flatFee(6000),
    subcontractorCost: 1200, otherCost: 300
  });
  assert.equal(r.equipmentCost, 5000);
  assert.equal(r.materialsCost, 3000);
  assert.equal(r.labourCost, 0);            // flat fee mode: the fee is margin
  assert.equal(r.subcontractorCost, 1200);
  assert.equal(r.otherCost, 300);
  assert.equal(r.totalJobCost, 9500);       // 5000+3000+0+1200+300, by hand
});

test('the worked example: 5000 + 3000 cost, 6000 fee', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000) });
  assert.equal(r.totalJobCost, 8000);           // 5000 + 3000
  assert.equal(r.sellPriceExGst, 14000);        // 8000 + 6000
  assert.equal(r.sellPriceIncGst, 15400);       // 14000 x 1.1
  assert.equal(r.gstAmount, 1400);              // 15400 - 14000
  assert.equal(r.grossProfit, 6000);            // 14000 - 8000 == the fee
  assert.equal(r.grossMarginPct, 42.9);         // 6000 / 14000 = 42.857%
});

test('GST is exactly one eleventh of the inc-GST price', () => {
  for (const [e, m, fee] of [[5000, 3000, 6000], [1234.56, 789.01, 6000], [0, 0, 6000]]) {
    const r = calculateCommercials({ bom: bom(e, m), labour: flatFee(fee) });
    assert.equal(r.gstAmount, Math.round((r.sellPriceIncGst - r.sellPriceExGst) * 100) / 100);
    assert.ok(Math.abs(r.sellPriceIncGst / GST - r.sellPriceExGst) < 0.01,
      'ex GST must be inc / 1.1 for ' + e + '/' + m);
  }
});

// ── The identity ───────────────────────────────────────────────────────────

test('gross profit equals the fee exactly, at any cost', () => {
  for (const [e, m, sub, other] of [
    [0, 0, 0, 0], [5000, 3000, 0, 0], [5285.55, 4459.24, 0, 0],
    [1234.56, 7890.12, 345.67, 89.01], [250000, 180000, 0, 0]
  ]) {
    const r = calculateCommercials({ bom: bom(e, m), labour: flatFee(6000),
                                     subcontractorCost: sub, otherCost: other });
    assert.ok(Math.abs(r.grossProfit - 6000) <= 0.01,
      `GP ${r.grossProfit} != fee 6000 for costs ${e}/${m}/${sub}/${other}`);
    assert.ok(!r.warnings.some(w => w.code === 'MARGIN_NOT_EQUAL_TO_FEE'));
  }
});

test('a cost added moves the price by the same amount, never the profit', () => {
  const base = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000) });
  const more = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000),
                                      subcontractorCost: 1200, otherCost: 300 });
  assert.equal(more.totalJobCost - base.totalJobCost, 1500);
  assert.equal(more.sellPriceExGst - base.sellPriceExGst, 1500);
  assert.equal(more.grossProfit, base.grossProfit);
});

// ── Edge values ────────────────────────────────────────────────────────────

test('zero everywhere does not divide by zero or produce NaN', () => {
  const r = calculateCommercials({ bom: bom(0, 0), labour: flatFee(0) });
  assert.equal(r.totalJobCost, 0);
  assert.equal(r.sellPriceIncGst, 0);
  assert.equal(r.sellPriceExGst, 0);
  assert.equal(r.gstAmount, 0);
  assert.equal(r.grossProfit, 0);
  assert.equal(r.grossMarginPct, null, 'a margin on zero revenue is not a number, and must not read as 0%');
  for (const v of Object.values(r)) assert.ok(!Number.isNaN(v), 'no NaN anywhere');
});

test('decimal costs round to the cent and stay balanced', () => {
  const r = calculateCommercials({ bom: bom(5285.55, 4459.24), labour: flatFee(6000) });
  assert.equal(r.totalJobCost, 9744.79);
  assert.equal(r.sellPriceExGst, 15744.79);
  assert.equal(r.sellPriceIncGst, 17319.27);
  assert.equal(r.gstAmount, 1574.48);
  // The parts must still add up after rounding.
  assert.equal(Math.round((r.sellPriceExGst + r.gstAmount) * 100) / 100, r.sellPriceIncGst);
});

test('a very large job stays exact', () => {
  const r = calculateCommercials({ bom: bom(250000, 180000), labour: flatFee(60000) });
  assert.equal(r.totalJobCost, 430000);
  assert.equal(r.sellPriceExGst, 490000);
  assert.equal(r.sellPriceIncGst, 539000);
  assert.equal(r.grossProfit, 60000);
  assert.equal(r.grossMarginPct, 12.2);
});

test('a fee stated INC GST is converted before it is applied', () => {
  const s = settingsWith({ commercial: { jobFeeExGst: false, jobFee: 6600 } });
  const r = calculateCommercials(
    { bom: bom(5000, 3000), labour: { mode: 'flat', totalCost: 0, totalFee: 6600, jobFeeExGst: false } },
    { settings: s });
  // 6600 inc GST is 6000 ex, so the answer must match the ex-GST case exactly.
  assert.equal(r.sellPriceIncGst, 15400);
  assert.equal(r.grossProfit, 6000);
});

// ── Overrides ──────────────────────────────────────────────────────────────

test('a manual sell price overrides the calculation and is reported as such', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000), sellOverride: 18000 });
  assert.equal(r.pricingBasis.key, 'override');
  assert.equal(r.sellPriceIncGst, 18000);
  assert.equal(r.sellPriceExGst, 16363.64);     // 18000 / 1.1
  assert.equal(r.grossProfit, 8363.64);         // 16363.64 - 8000
  assert.equal(r.grossMarginPct, 51.1);
});

test('an override BELOW cost is called out as a loss, not shown as fine', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000), sellOverride: 5000 });
  assert.ok(r.grossProfit < 0, 'this job loses money');
  const w = r.warnings.find(x => x.code === 'NEGATIVE_GROSS_PROFIT');
  assert.ok(w, 'selling under cost must be reported');
  assert.equal(w.severity, 'CRITICAL');
});

test('an override of zero is honoured, not treated as "no override"', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000), sellOverride: 0 });
  assert.equal(r.pricingBasis.key, 'override');
  assert.equal(r.sellPriceIncGst, 0);
  assert.equal(r.grossProfit, -8000);
  assert.ok(r.warnings.some(x => x.code === 'NEGATIVE_GROSS_PROFIT'));
});

// ── Extras ─────────────────────────────────────────────────────────────────

test('an extra line adds to the price inc GST and to the profit', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000),
                                   extras: [{ price: 1100, qty: 1 }] });
  assert.equal(r.sellPriceIncGst, 16500);       // 15400 + 1100
  assert.equal(r.sellPriceExGst, 15000);        // 16500 / 1.1
  // An extra carries a price but no cost, so all of its ex-GST value is margin.
  assert.equal(r.grossProfit, 7000);            // 6000 fee + 1000 ex-GST extra
});

test('extra quantities multiply', () => {
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: flatFee(6000),
                                   extras: [{ price: 550, qty: 4 }] });
  assert.equal(r.sellPriceIncGst, 15400 + 2200);
});

// ── Hourly mode, for the basis NAC no longer uses but the code still supports ─
test('hourly labour is a COST, and the price comes from the catalogue', () => {
  const s = settingsWith({ commercial: { labourMode: 'hourly', pricingBasis: 'catalogue_price' } });
  const labour = calculateLabour({}, { settings: s });
  assert.equal(labour.mode, 'hourly');
  assert.ok(labour.totalCost > 0);
  const r = calculateCommercials({ bom: bom(5000, 3000), labour, cataloguePrice: 22000 }, { settings: s });
  assert.equal(r.labourCost, labour.totalCost);
  assert.equal(r.totalJobCost, 8000 + labour.totalCost);
  assert.equal(r.sellPriceIncGst, 22000);
  assert.equal(r.sellPriceExGst, 20000);
  assert.equal(r.grossProfit, Math.round((20000 - r.totalJobCost) * 100) / 100);
});

test('no price at all is reported rather than guessed', () => {
  const s = settingsWith({ commercial: { labourMode: 'hourly', pricingBasis: 'catalogue_price' } });
  const r = calculateCommercials({ bom: bom(5000, 3000), labour: calculateLabour({}, { settings: s }) },
                                 { settings: s });
  assert.equal(r.sellPriceIncGst, null);
  assert.equal(r.grossProfit, null);
  assert.equal(r.grossMarginPct, null);
  assert.ok(r.warnings.some(w => w.code === 'NO_SELL_PRICE'));
});
