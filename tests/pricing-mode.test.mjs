// ─────────────────────────────────────────────────────────────────────────────
// ONE PRICING METHOD, DECLARED, NEVER MIXED
//
// Nick: "The reports currently require an equipment sell price even though
// equipment supplier cost already enters job cost and the flat job fee creates
// the sell price. That is conflicting pricing logic."
//
// On cost-plus-fee the customer's price is built from what the equipment COSTS
// NAC. An installed SELL price stored against the same model is a second,
// independent answer to the same question — and requiring it meant a model NAC
// could buy and fit, at a cost NAC knew exactly, was refused for want of a
// number that method never uses.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICING_MODE, activeMode, modeLabel, pricingRequirements }
  from '../designer/engines/pricing-mode.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const settings = (commercial) => ({ ...DEFAULT_SETTINGS,
  commercial: { ...DEFAULT_SETTINGS.commercial, ...commercial } });

const DESIGN = {
  selectedUnit: { model: 'FDYA160AV19', supplierCost: 5700, sellPrice: null },
  bom: { items: [
    { label: 'Flex duct 250', priced: true, totalCost: 160, sellPrice: null },
    { label: 'Diffuser 250', priced: true, totalCost: 117.5, sellPrice: null }
  ] }
};

test('NAC ships on cost plus job fee', () => {
  const a = activeMode(DEFAULT_SETTINGS);
  assert.equal(a.ok, true);
  assert.equal(a.mode, PRICING_MODE.COST_PLUS_JOB_FEE);
  assert.match(modeLabel(a.mode), /Cost plus job fee/);
});

test('cost plus job fee does NOT require an equipment sell price', () => {
  // This is the defect, stated as a test: every line has a verified COST, the
  // fee is configured, and no sell price exists anywhere. That is a complete,
  // priceable job on this method.
  const r = pricingRequirements({ design: DESIGN, settings: settings({ jobFee: 6000 }) });
  assert.equal(r.mode, PRICING_MODE.COST_PLUS_JOB_FEE);
  assert.equal(r.equipmentSellPriceRequired, false);
  assert.equal(r.ok, true, JSON.stringify(r.failures.map(f => f.code)));
});

test('cost plus job fee DOES require costs and a fee', () => {
  const noCost = { ...DESIGN, selectedUnit: { model: 'X', supplierCost: null } };
  let r = pricingRequirements({ design: noCost, settings: settings({ jobFee: 6000 }) });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.code === 'EQUIPMENT_COST_REQUIRED'));

  const unpriced = { ...DESIGN, bom: { items: [
    { label: 'Mystery bracket', priced: false, totalCost: null }] } };
  r = pricingRequirements({ design: unpriced, settings: settings({ jobFee: 6000 }) });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some(f => f.code === 'MATERIAL_COSTS_REQUIRED'));

  r = pricingRequirements({ design: DESIGN, settings: settings({ jobFee: 0 }) });
  assert.equal(r.ok, false);
  const fee = r.failures.find(f => f.code === 'JOB_FEE_REQUIRED');
  assert.ok(fee, JSON.stringify(r.failures.map(f => f.code)));
  assert.match(fee.message, /sells the job at cost/);
});

test('component sell prices requires sell prices, and refuses a smuggled fee', () => {
  const s = settings({ pricingMode: PRICING_MODE.COMPONENT_SELL_PRICES, jobFee: 6000 });
  const r = pricingRequirements({ design: DESIGN, settings: s });
  assert.equal(r.mode, PRICING_MODE.COMPONENT_SELL_PRICES);
  assert.equal(r.equipmentSellPriceRequired, true);
  assert.equal(r.ok, false);
  const codes = r.failures.map(f => f.code);
  assert.ok(codes.includes('EQUIPMENT_SELL_PRICE_REQUIRED'), codes);
  assert.ok(codes.includes('MATERIAL_SELL_PRICES_REQUIRED'), codes);
  // THE TWO METHODS ARE NEVER MIXED SILENTLY. A flat fee on top of lines that
  // already carry their own margin charges the margin twice.
  const mix = r.failures.find(f => f.code === 'JOB_FEE_WOULD_BE_MIXED_IN');
  assert.ok(mix, codes);
  assert.match(mix.message, /charges the margin twice/);

  // Ticked deliberately, it is allowed.
  const deliberate = pricingRequirements({ design: DESIGN,
    settings: settings({ pricingMode: PRICING_MODE.COMPONENT_SELL_PRICES, jobFee: 6000,
                         applyJobFeeOnComponentPricing: true }) });
  assert.ok(!deliberate.failures.some(f => f.code === 'JOB_FEE_WOULD_BE_MIXED_IN'));
});

test('two different methods configured at once is not an answer', () => {
  // The exact shape that caused this: a stored legacy value under a newer
  // default. Nothing picks a winner.
  const a = activeMode(settings({ pricingMode: PRICING_MODE.COST_PLUS_JOB_FEE,
                                  pricingBasis: 'catalogue_price' }));
  assert.equal(a.ok, false);
  assert.equal(a.mode, null);
  assert.match(a.reason, /Two different pricing methods/);

  // Agreeing values are fine.
  assert.equal(activeMode(settings({ pricingMode: PRICING_MODE.COST_PLUS_JOB_FEE,
                                     pricingBasis: 'materials_plus_fee' })).ok, true);
  // And a legacy value on its own still resolves, so stored settings keep working.
  const legacy = activeMode({ commercial: { pricingBasis: 'catalogue_price' } });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.mode, PRICING_MODE.COMPONENT_SELL_PRICES);
  assert.match(legacy.source, /pricingBasis/);
});

test('an unset mode is reported, never guessed', () => {
  const a = activeMode({ commercial: {} });
  assert.equal(a.ok, false);
  assert.equal(a.mode, null);
  assert.match(a.reason, /HVAC Design Settings/);
  const r = pricingRequirements({ design: DESIGN, settings: { commercial: {} } });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].code, 'PRICING_MODE_NOT_SET');
});

test('the active mode is on the internal estimate and never on the customer page', async () => {
  const { calculateCommercials, calculateLabour } = await import('../designer/engines/costing.mjs');
  const s = settings({ jobFee: 6000 });
  const labour = calculateLabour({ outlets: { totals: { total: 8 } }, zones: { zones: [] },
                                   network: {} }, { settings: s });
  const c = calculateCommercials({
    bom: { equipmentCost: 5700, materialsCost: 2000, items: [] },
    labour, cataloguePrice: null
  }, { settings: s });
  assert.equal(c.pricingMode, PRICING_MODE.COST_PLUS_JOB_FEE);
  assert.match(c.pricingModeLabel, /Cost plus job fee/);

  // The customer presentation carries no pricing-method field at all.
  const { buildPresentation } = await import('../designer/engines/presentation.mjs');
  const r = buildPresentation({
    design: { selectedUnit: { brandName: 'Daikin', model: 'X', capacityKw: 20 },
              systemLoad: { designKw: 18 },
              rooms: [{ id: 'r1', label: 'LIVING', conditioned: true }],
              outlets: { rows: [{ roomId: 'r1', label: 'LIVING', quantity: 1 }] },
              commercials: { ...c, sellPriceIncGst: 19800 } },
    customer: { name: 'Sarah Whitlock' }, job: {}, content: {},
    proposalNumber: 'P', revision: 1, status: 'draft'
  });
  assert.equal(r.ok, true, JSON.stringify((r.blockers || []).map(b => b.code)));
  const json = JSON.stringify(r.presentation);
  assert.ok(!/COST_PLUS_JOB_FEE|COMPONENT_SELL_PRICES/.test(json),
    'the pricing method leaked onto the customer document');
  assert.ok(!/pricingMode/.test(json));
});
