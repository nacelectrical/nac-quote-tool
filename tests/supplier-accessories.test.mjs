// NAC AI HVAC DESIGNER — the MMEM accessories quotation.
//
// These lock the numbers off MMEM quotation 447-321514-000 (10/09/2026) and the
// rules built on them: whole lengths are bought, not metres; the return grille
// already includes its filter; a size MMEM have not quoted is called out rather
// than silently priced.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MMEM_ACCESSORIES, MMEM_ACCESSORIES_META, MMEM_COPPER, MMEM_ZONE_CONTROLS,
  findAccessory, accessoriesByDiameter, ratePerM, paircoilRatePerM
} from '../designer/engines/supplier-pricing.mjs';
import { MATERIAL_CATALOGUE, resolveCost, UNQUOTED } from '../designer/engines/materials.mjs';
import { buildBillOfMaterials } from '../designer/engines/bom.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

// ── The quotation itself ───────────────────────────────────────────────────

test('the accessories quotation is attributed and dated', () => {
  assert.equal(MMEM_ACCESSORIES_META.quoteNo, '447-321514-000');
  assert.equal(MMEM_ACCESSORIES_META.account, '201169');
  assert.equal(MMEM_ACCESSORIES_META.basis, 'ex GST');
  assert.equal(MMEM_ACCESSORIES_META.validTo, '2026-11-09');
});

test('every accessory carries a code, a group and a positive cost', () => {
  assert.ok(MMEM_ACCESSORIES.length >= 30);
  for (const a of MMEM_ACCESSORIES) {
    assert.ok(a.code, 'missing code');
    assert.ok(a.group, a.code + ' has no group');
    assert.ok(a.cost > 0, a.code + ' has no cost');
    assert.ok(a.desc, a.code + ' has no description');
  }
  const codes = MMEM_ACCESSORIES.map(a => a.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate part codes');
});

test('quoted unit prices are carried verbatim', () => {
  assert.equal(findAccessory('MMA3006').cost, 38.00);      // 300 mm flex, 6 m
  assert.equal(findAccessory('MMARD250').cost, 23.50);     // 250 mm diffuser
  assert.equal(findAccessory('MMADZ200').cost, 45.00);     // 200 mm zone motor
  assert.equal(findAccessory('MMARAG800600').cost, 81.30); // return grille + filter
  assert.equal(findAccessory('MMAPPELB9020').cost, 0.78);  // drain elbow
});

test('a length item reports its per-metre rate off the pack, not a guess', () => {
  assert.equal(ratePerM('MMA2006'), 5.00);    // $30 / 6 m
  assert.equal(ratePerM('MMA4006'), 8.33);    // $50 / 6 m
  assert.equal(ratePerM('MMAPP20'), 1.92);    // $7.50 / 3.9 m
  assert.equal(ratePerM('MMARD250'), null);   // not sold by the metre
});

test('paircoil is repriced from the quotation', () => {
  assert.equal(paircoilRatePerM('AIRBTT3858'), 17.1);   // $342 / 20 m
  const roll = MMEM_COPPER.find(c => c.code === 'AIRBTT3858');
  assert.equal(roll.rollCost, 342.00);
  // The 3/8 – 3/4 roll the quotation adds.
  assert.ok(MMEM_COPPER.some(c => c.code === 'MMABTT3834' && c.rollCost === 400.00));
});

test('the zone controllers on the quotation are repriced', () => {
  const byId = Object.fromEntries(MMEM_ZONE_CONTROLS.map(c => [c.id, c]));
  assert.equal(byId.siemens_z4.cost, 250.00);
  assert.equal(byId.siemens_z6.cost, 295.00);
  assert.equal(byId.siemens_z8.cost, 320.00);
  assert.equal(byId.at5_daikin.cost, 1100.00);
  assert.equal(byId.at5_sensor.cost, 92.00);
});

// ── How the catalogue uses them ────────────────────────────────────────────

test('quoted diameters are supplier-priced and the rest stay placeholders', () => {
  for (const d of [200, 250, 300, 350, 400]) {
    const r = resolveCost('flex_duct', { diameterMm: d });
    assert.equal(r.source, 'supplier_list', d + ' mm should be supplier-priced');
    assert.equal(r.pack.lengthM, 6);
    assert.match(r.note, /447-321514-000/);
  }
  for (const d of [100, 125, 150, 450, 500]) {
    const r = resolveCost('flex_duct', { diameterMm: d });
    assert.equal(r.source, 'default_placeholder', d + ' mm is not on the quote');
    assert.equal(r.pack, null);
  }
});

test('lines MMEM have not quoted are declared, not quietly dressed up', () => {
  for (const key of UNQUOTED) {
    const def = MATERIAL_CATALOGUE[key];
    assert.ok(def, key + ' is listed as unquoted but is not in the catalogue');
    assert.notEqual(def.source, 'supplier_list', key + ' claims a supplier price');
    assert.equal(resolveCost(key, {}).source, 'default_placeholder');
  }
});

test('the return grille line already includes its filter', () => {
  const g = resolveCost('return_grille', {});
  assert.equal(g.cost, 81.30);
  assert.equal(g.includesFilter, true);
  // So the separate filter line must not add cost on top.
  assert.equal(resolveCost('return_filter', {}).cost, 0);
});

test('the duct size ladder only offers sizes NAC can actually buy', () => {
  const ladder = DEFAULT_SETTINGS.duct.availableDiametersMm;
  // 175 and 225 are not stocked flex sizes.
  assert.ok(!ladder.includes(175));
  assert.ok(!ladder.includes(225));
  // Everything MMEM quote is on the ladder.
  for (const d of Object.keys(accessoriesByDiameter('flex')).map(Number)) {
    assert.ok(ladder.includes(d), d + ' mm is quoted but not offered');
  }
});

// ── What the BOM does with them ───────────────────────────────────────────

function bomFor(overrides = {}) {
  const sections = [
    { id: 'main',        role: 'main',   diameterMm: 400, lengthM: 4, fittings: [{ type: 'supply_plenum', quantity: 1 }] },
    { id: 'branch_bed1', role: 'branch', diameterMm: 250, lengthM: 7, fittings: [{ type: 'takeoff', quantity: 1 }] },
    { id: 'branch_bed2', role: 'branch', diameterMm: 200, lengthM: 5, fittings: [] }
  ];
  return buildBillOfMaterials({
    network: { sections, totalDuctLengthM: 16 },
    outlets: { rows: [{ roomId: 'bed1', type: 'round_diffuser', quantity: 1 },
                      { roomId: 'bed2', type: 'round_diffuser', quantity: 1 }] },
    zones: { zones: [{ id: 'z1', roomIds: ['bed1'] }, { id: 'z2', roomIds: ['bed2'] }] },
    returnDesign: { returnCount: 1 },
    drainPipeM: 6, refrigerantPipeM: 8,
    ...overrides
  });
}

test('flex duct is bought in whole 6 m lengths, with the off-cut shown', () => {
  const bom = bomFor();
  const f250 = bom.items.find(i => i.key === 'flex_duct' && i.diameterMm === 250);
  assert.equal(f250.metresRequired, 7);
  assert.equal(f250.quantity, 2);              // 7 m needs two 6 m lengths
  assert.equal(f250.metresBought, 12);
  assert.equal(f250.offcutM, 5);
  assert.equal(f250.totalCost, 64);            // 2 x $32
  assert.equal(f250.supplierCode, 'MMA2506');
});

test('a zone damper is sized off the branch duct that feeds it', () => {
  const bom = bomFor();
  const motors = bom.items.filter(i => i.key === 'zone_motor');
  const sizes = Object.fromEntries(motors.map(m => [m.diameterMm, m.unitCost]));
  assert.equal(sizes[250], 51.00);
  assert.equal(sizes[200], 45.00);
  // One 15 m lead per damper.
  assert.equal(bom.items.find(i => i.key === 'zone_cable').quantity, 2);
});

test('the BOM does not charge for the return filter twice', () => {
  const bom = bomFor();
  const filterLines = bom.items.filter(i => i.key === 'return_filter');
  assert.equal(filterLines.length, 0, 'the grille line already covers the filter');
  assert.equal(bom.items.find(i => i.key === 'return_grille').totalCost, 81.30);
});

test('paircoil and drain pipe are bought by the roll and the length', () => {
  const bom = bomFor();
  const coil = bom.items.find(i => i.key === 'refrigerant_pipe');
  assert.equal(coil.quantity, 1);              // 8 m off one 20 m roll
  assert.equal(coil.totalCost, 342);
  const drain = bom.items.find(i => i.key === 'drain_pipe');
  assert.equal(drain.quantity, 2);             // 6 m needs two 3.9 m lengths
  assert.equal(drain.totalCost, 15);
});

test('a size that is not on the quote is called out', () => {
  // A 150 mm branch — below anything MMEM quoted.
  const bom = bomFor({
    network: { sections: [{ id: 'branch_bed1', role: 'branch', diameterMm: 150, lengthM: 6, fittings: [] }],
               totalDuctLengthM: 6 },
    zones: { zones: [{ id: 'z1', roomIds: ['bed1'] }] }
  });
  const w = bom.warnings.find(x => x.code === 'SIZE_NOT_ON_SUPPLIER_QUOTE');
  assert.ok(w, 'an off-quote size must be reported');
  assert.match(w.message, /150 mm/);
});

test('a NAC rate still overrides a quoted supplier rate', () => {
  const bom = bomFor({}, {});
  const withNac = buildBillOfMaterials({
    network: { sections: [{ id: 'branch_bed1', role: 'branch', diameterMm: 250, lengthM: 7, fittings: [] }],
               totalDuctLengthM: 7 }
  }, { nacRates: { flex_duct: { 250: 9.90 } } });
  const f = withNac.items.find(i => i.key === 'flex_duct');
  assert.equal(f.priceSource, 'nac');
  assert.equal(f.unitCost, 9.90);
  assert.equal(f.unit, 'm');                   // a NAC rate is per metre
  assert.equal(f.totalCost, 69.3);
  assert.ok(bom.totalCost > 0);
});
