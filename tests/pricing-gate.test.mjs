// NAC AI HVAC DESIGNER — a quote must never be built on prices nobody confirmed.
//
// On job-cost-plus-fee the customer's price is built FROM the material costs,
// so a shipped placeholder rate is not a costing note — it is money quoted on a
// guess. And a line with NO cost at all makes the price short by whatever it is
// worth, which is money given away.
//
// The bug these tests were written around: editBomLine repriced the line but
// recomputed only the money, leaving unpricedCount, placeholderCount and the
// warnings describing a bill of materials that no longer existed. An estimator
// who entered the missing cost was still told the line had no cost — and once
// the quote gate existed, could never get past it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildBillOfMaterials, editBomLine, applyBomEdits, summariseBom } from '../designer/engines/bom.mjs';
import { buildZoneDampers } from '../designer/engines/zone-dampers.mjs';
import { MATERIAL_CATALOGUE } from '../designer/engines/materials.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { calculateCommercials, calculateLabour } from '../designer/engines/costing.mjs';

const design = () => {
  const network = {
    sections: [{ id: 'branch_a', role: 'branch', diameterMm: 150, lengthM: 8,
                 airflowLs: 60, fittings: [] }],
    totalDuctLengthM: 8
  };
  return {
    network,
    outlets: { rows: [{ roomId: 'a', type: 'round_diffuser', quantity: 1 }] },
    zones: { zones: [{ id: 'z', roomIds: ['a'] }] },
    // A ø150 branch: MMEM quote no motor that size, so the damper line is
    // unpriced — which is the case this fixture exists to exercise.
    zoneDampers: buildZoneDampers(
      [{ id: 'damper_branch_a', sectionId: 'branch_a', zone: 'z', roomId: 'a' }], network),
    returnDesign: { returnCount: 1 },
    drainPipeM: 6, cableM: 12
  };
};

test('a bill of materials reports what is unpriced and what is a placeholder', () => {
  const bom = buildBillOfMaterials(design());
  assert.ok(bom.unpricedCount > 0, 'this fixture has a duct size MMEM do not quote a damper for');
  assert.ok(bom.placeholderCount > 0);
  assert.equal(bom.unpricedLabels.length, bom.unpricedCount);
  assert.equal(bom.placeholderLabels.length, bom.placeholderCount);
});

test('the placeholder lines carry what they are worth, and it adds up', () => {
  const bom = buildBillOfMaterials(design());
  const byHand = bom.items
    .filter(i => i.priceSource === 'default_placeholder')
    .reduce((s, i) => s + (i.totalCost || 0), 0);
  assert.equal(bom.placeholderCost, Math.round(byHand * 100) / 100);
  assert.ok(bom.placeholderCost > 0);
  assert.equal(bom.placeholderDetail.length, bom.placeholderCount);
  for (const d of bom.placeholderDetail) {
    assert.ok(d.label && d.unitCost !== null && d.totalCost !== null);
  }
});

test('entering a missing cost clears it from the unpriced count', () => {
  const bom = buildBillOfMaterials(design());
  const before = bom.unpricedCount;
  const i = bom.items.findIndex(x => !x.priced);
  const after = editBomLine(bom, i, { unitCost: 48 });
  assert.equal(after.items[i].priced, true);
  assert.equal(after.items[i].unitCost, 48);
  assert.equal(after.unpricedCount, before - 1, 'the count must follow the edit');
  assert.ok(!after.unpricedLabels.includes(bom.items[i].label));
});

test('an edit re-derives the warnings too, not just the totals', () => {
  const bom = buildBillOfMaterials(design());
  assert.ok(bom.warnings.some(w => w.code === 'MATERIAL_PRICE_MISSING'));
  let out = bom;
  // Price every line that has no cost.
  for (let guard = 0; guard < 20; guard++) {
    const i = out.items.findIndex(x => !x.priced);
    if (i === -1) break;
    out = editBomLine(out, i, { unitCost: 48 });
  }
  assert.equal(out.unpricedCount, 0);
  assert.ok(!out.warnings.some(w => w.code === 'MATERIAL_PRICE_MISSING'),
    'the warning must go when the reason for it goes');
});

test('entering a NAC rate takes the line off the placeholder count', () => {
  const bom = buildBillOfMaterials(design());
  const i = bom.items.findIndex(x => x.priceSource === 'default_placeholder');
  const before = bom.placeholderCount;
  const after = editBomLine(bom, i, { unitCost: 12.5 });
  assert.equal(after.items[i].priceSource, 'nac');
  assert.equal(after.placeholderCount, before - 1);
  assert.ok(after.placeholderCost < bom.placeholderCost);
});

test('the money still reconciles after an edit', () => {
  const bom = buildBillOfMaterials(design());
  const i = bom.items.findIndex(x => x.priced);
  const after = editBomLine(bom, i, { unitCost: 99, quantity: 3 });
  assert.equal(after.items[i].totalCost, 297);
  assert.equal(after.totalCost, Math.round(after.items.reduce((s, x) => s + (x.totalCost || 0), 0) * 100) / 100);
  assert.equal(Math.round((after.materialsCost + after.equipmentCost) * 100) / 100, after.totalCost);
});

test('edits survive a rebuild, and the counts follow them', () => {
  const bom = buildBillOfMaterials(design());
  const i = bom.items.findIndex(x => !x.priced);
  const edits = [{ match: bom.items[i].key + '|' + bom.items[i].label, unitCost: 48 }];
  const rebuilt = applyBomEdits(buildBillOfMaterials(design()), edits);
  assert.equal(rebuilt.items[i].unitCost, 48);
  assert.equal(rebuilt.unpricedCount, bom.unpricedCount - 1,
    'a rebuild must not resurrect a price the estimator already entered');
});

test('the sell-price warning states the dollars built on guesses', () => {
  const bom = buildBillOfMaterials(design());
  const c = calculateCommercials({ bom, labour: calculateLabour({}) });
  const w = c.warnings.find(x => x.code === 'PRICE_BASED_ON_PLACEHOLDER_RATES');
  assert.ok(w, 'the estimator must be told');
  assert.equal(w.placeholderCost, bom.placeholderCost);
  assert.match(w.message, /\$\d/);
  assert.match(w.message, /straight through to the customer/);
});

test('summariseBom is the single source of the derived figures', () => {
  // Both paths must produce the same summary for the same lines, or the two
  // will drift again.
  const bom = buildBillOfMaterials(design());
  const again = summariseBom(bom.items);
  for (const k of ['totalCost','materialsCost','equipmentCost','lineCount',
                   'placeholderCount','placeholderCost','unpricedCount']) {
    assert.equal(again[k], bom[k], k);
  }
});

test('a line NAC quote separately does not block the quote, but is declared', () => {
  // A linear bar grille is priced on its own when it goes on a job. Carrying a
  // shipped rate meant a number nobody agreed could reach a customer; carrying
  // no rate at all must not look like a price somebody forgot.
  const bom = buildBillOfMaterials({
    outlets: { rows: [{ roomId: 'r1', type: 'linear_bar', quantity: 2, label: 'Living' }] },
    network: { sections: [], totalsByDiameter: {} }
  });
  const line = bom.items.find(i => /Linear bar grille/.test(i.label));
  assert.ok(line, 'it still appears on the bill of materials');
  assert.equal(line.unitCost, null, 'with no rate');
  assert.equal(line.quotedSeparately, true);

  assert.equal(bom.unpricedCount, 0, 'it is NOT counted as a hole in the pricing');
  assert.ok(!(bom.unpricedLabels || []).includes('Linear bar grille'));
  assert.equal(bom.quotedSeparatelyCount, 1);

  const w = bom.warnings.find(x => x.code === 'QUOTED_SEPARATELY');
  assert.ok(w, 'and the estimator is told to add it as its own line');
  assert.match(w.message, /quote it separately/);
});

test('the outlets NAC do not fit are gone from the catalogue and the settings', () => {
  for (const key of ['diffuser_4way', 'diffuser_slot', 'grille_sidewall']) {
    assert.equal(MATERIAL_CATALOGUE[key], undefined, key + ' is still in the catalogue');
  }
  for (const type of ['four_way', 'slot', 'sidewall']) {
    assert.equal(DEFAULT_SETTINGS.outlets.types[type], undefined, type + ' is still selectable');
  }
  // The two NAC do fit are still there.
  assert.ok(DEFAULT_SETTINGS.outlets.types.round_diffuser);
  assert.ok(DEFAULT_SETTINGS.outlets.types.linear_bar);
  // And duct joiners and reducers stay — NAC use them.
  assert.ok(MATERIAL_CATALOGUE.joiner);
  assert.ok(MATERIAL_CATALOGUE.reducer);
});
