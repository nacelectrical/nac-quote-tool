// READY TO ORDER — what NAC buys, and what the installer is handed.
//
// Two documents with opposite rules. The order list is a buying document and
// must be complete, in purchase units, with nothing quietly left off. The
// installer sheet must contain no money at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { supplierOrderList, installerSheet, jobState, JOB_STATE,
         READY_TO_ORDER } from '../designer/engines/order.mjs';

const design = (over = {}) => ({
  id: 'DES-1',
  quoteId: 'NAC-1',
  customer: { name: 'J Smith', address: '12 Smith St' },
  selectedUnit: { brandName: 'Daikin', model: 'FDYA125', capacityKw: 12.5, phase: '1Ph',
                  supplierCost: 4625, supplierCode: 'FDYA125AV19' },
  controller: { name: 'AirTouch 5' },
  airflow: { allocatedAirflowLs: 901 },
  pressure: { estimatedRequirementPa: 228, unitAvailableStaticPa: 250, checkCompleted: true },
  outlets: { rows: [{ label: 'BED 1', quantity: 1, typeLabel: 'Round diffuser', perOutletLs: 90 }] },
  zones: { zones: [{ id: 'z1', name: 'Z1', roomNames: ['BED 1', 'BED 2'], airflowLs: 180 }] },
  zoneDampers: [{ zone: 'Z1', roomId: 'bed1' }],
  returnDesign: { returnCount: 1, returns: [{ grilleSize: '800 x 600' }],
                  duct: { diameterMm: 400, lengthM: 5 } },
  network: { sections: [
    { id: 'main', role: 'main', destination: 'Supply plenum → J1', diameterMm: 400,
      lengthM: 3.4, airflowLs: 901 },
    { id: 'trunk_1', role: 'trunk', destination: 'J1 → J2', diameterMm: 300,
      lengthM: 4.1, airflowLs: 454, reducerFrom: 400, reducerTo: 300 },
    { id: 'branch_bed1', role: 'branch', destination: 'BED 1', diameterMm: 200,
      lengthM: 5.2, airflowLs: 90, zone: 'Z1', locked: true }
  ] },
  bom: { items: [
    { key: 'flex_duct', label: 'Insulated flexible duct R1.0 300 mm', category: 'ductwork',
      quantity: 2, unit: '6 m length', supplierCode: 'MMA3006', diameterMm: 300,
      metresRequired: 11, offcutM: 1, unitCost: 38, totalCost: 76, priced: true,
      priceSource: 'supplier_list' },
    { key: 'zone_motor', label: 'Zone motor / motorised damper 24 V 150 mm', category: 'zoning',
      quantity: 3, unit: 'each', unitCost: null, totalCost: null, priced: false },
    { key: 'grille_linear', label: 'Linear bar grille', category: 'outlets',
      quantity: 1, unit: 'each', unitCost: null, totalCost: null, priced: false,
      quotedSeparately: true },
    { key: 'isolator', label: 'Weatherproof isolator', category: 'services',
      quantity: 1, unit: 'each', unitCost: 68, totalCost: 68, priced: true,
      priceSource: 'default_placeholder' }
  ] },
  ...over
});

// ── Job state ───────────────────────────────────────────────────────────────

test('a job becomes READY TO ORDER only once the customer has accepted', () => {
  const d = design();
  assert.equal(jobState(d, null), JOB_STATE.QUOTED);
  assert.equal(jobState(d, { accepted: false }), JOB_STATE.QUOTED);
  assert.equal(jobState(d, { accepted: true }), JOB_STATE.READY_TO_ORDER);
});

test('a design that has never been quoted is not ready for anything', () => {
  assert.equal(jobState({ approved: { by: 'Nick' } }, null), JOB_STATE.DESIGNED);
});

test('the state NAC reads is spelled the way NAC says it', () => {
  assert.equal(READY_TO_ORDER, 'READY TO ORDER');
});

// ── The order list ──────────────────────────────────────────────────────────

test('the system itself is on the order — an installer cannot fit what nobody bought', () => {
  const o = supplierOrderList(design());
  const sys = o.lines.find(l => l.key === 'system');
  assert.ok(sys, 'the indoor/outdoor set is missing from the order');
  assert.match(sys.label, /Daikin FDYA125/);
  assert.equal(sys.supplierCode, 'FDYA125AV19');
  assert.equal(sys.quantity, 1);
});

test('duct is ordered in the lengths NAC buys, with the metres shown behind it', () => {
  const o = supplierOrderList(design());
  const duct = o.lines.find(l => l.key === 'flex_duct');
  assert.equal(duct.quantity, 2);
  assert.equal(duct.unit, '6 m length', 'ordering by the metre is not how it is sold');
  assert.equal(duct.metresRequired, 11, 'the counter has to be able to check the pack count');
  assert.equal(duct.offcutM, 1);
  assert.equal(duct.supplierCode, 'MMA3006');
});

test('it is grouped the way a wholesaler counter works', () => {
  const o = supplierOrderList(design());
  const names = o.groups.map(g => g.name);
  assert.ok(names.includes('Equipment'));
  assert.ok(names.includes('Ductwork'));
  assert.ok(names.includes('Zoning'));
  assert.equal(o.groups.reduce((s, g) => s + g.lineCount, 0), o.lineCount);
});

test('a line with no confirmed price is ORDERED and flagged, never dropped', () => {
  const o = supplierOrderList(design());
  const motor = o.lines.find(l => l.key === 'zone_motor');
  assert.ok(motor, 'an unpriced line must still be ordered — it is still needed on site');
  assert.equal(motor.quantity, 3);
  assert.equal(motor.priced, false);
  assert.equal(o.unpricedCount, 1);
  assert.ok(o.warnings.some(w => w.code === 'ORDER_LINE_UNPRICED' && /Zone motor/.test(w.message)));
});

test('a quoted-separately line is on the order but not counted as unpriced', () => {
  const o = supplierOrderList(design());
  const grille = o.lines.find(l => l.key === 'grille_linear');
  assert.ok(grille);
  assert.equal(grille.quotedSeparately, true);
  assert.equal(o.unpricedCount, 1, 'the linear grille is not a forgotten price');
  assert.ok(o.warnings.some(w => w.code === 'ORDER_LINE_QUOTED_SEPARATELY'));
});

test('lines with no supplier code are noted so they can be described at the counter', () => {
  const o = supplierOrderList(design());
  assert.ok(o.warnings.some(w => w.code === 'ORDER_LINE_NO_CODE'));
});

test('the order carries who and where, so it can actually be placed', () => {
  const o = supplierOrderList(design());
  assert.equal(o.customer, 'J Smith');
  assert.equal(o.site, '12 Smith St');
  assert.equal(o.quoteId, 'NAC-1');
});

test('a design with no bill of materials refuses rather than producing an empty order', () => {
  const o = supplierOrderList(design({ bom: null }));
  assert.equal(o.ready, false);
  assert.ok(o.warnings.some(w => w.severity === 'CRITICAL'));
});

test('zero-quantity lines are not ordered', () => {
  const o = supplierOrderList(design({ bom: { items: [
    { key: 'joiner', label: 'Duct joiner', category: 'ductwork', quantity: 0, unit: 'each' }
  ] } }));
  assert.equal(o.lines.filter(l => l.key === 'joiner').length, 0);
});

// ── The installer sheet ─────────────────────────────────────────────────────

test('the installer sheet has NO pricing in it anywhere', () => {
  const sheet = installerSheet(design());
  const text = JSON.stringify(sheet);
  assert.equal(sheet.containsPricing, false);
  // Nothing that reads as money, cost or margin.
  assert.ok(!/\$/.test(text), 'a dollar sign reached the installer sheet');
  assert.ok(!/cost|margin|supplier[_ ]?cost|sellPrice|grossProfit/i.test(text),
    'a costing word reached the installer sheet');
});

test('it carries the duct schedule the installer actually works from', () => {
  const sheet = installerSheet(design());
  assert.equal(sheet.ducts.length, 3);
  const branch = sheet.ducts.find(d => d.id === 'branch_bed1');
  assert.equal(branch.diameterMm, 200);
  assert.equal(branch.lengthM, 5.2);
  assert.equal(branch.zone, 'Z1');
  assert.equal(branch.locked, true);
  const trunk = sheet.ducts.find(d => d.id === 'trunk_1');
  assert.equal(trunk.reducer, '400 → 300', 'a reducer has to be fitted, so it has to be shown');
});

test('outlets, zones and dampers are on it', () => {
  const sheet = installerSheet(design());
  assert.equal(sheet.outlets[0].room, 'BED 1');
  assert.equal(sheet.zones[0].name, 'Z1');
  assert.equal(sheet.dampers[0].zone, 'Z1');
  assert.equal(sheet.returnDesign.duct, 400);
});

test('everything the tool could not settle is carried through to site', () => {
  const sheet = installerSheet(design({
    autoRoute: { generated: true, confidence: 'MEDIUM', plenum: { source: 'assumed_centre' } },
    routeScore: { warnings: [
      { code: 'UNVERIFIED_ROUTE', message: 'AUTO ROUTE — VERIFY SITE CONDITIONS' },
      { code: 'LARGE_DUCT_CLEARANCE_CHECK', message: '3 run(s) at 350 mm or larger.' }
    ] },
    pressure: { checkCompleted: false, statusLabel: 'STATIC PRESSURE CHECK NOT COMPLETED' }
  }));
  const joined = sheet.toVerify.join(' | ');
  assert.match(joined, /trusses/, 'the auto route must be flagged for site verification');
  assert.match(joined, /350 mm or larger/);
  assert.match(joined, /STATIC PRESSURE CHECK NOT COMPLETED/);
  assert.match(joined, /plenum position was assumed/);
  // The generic notice is not repeated twice.
  assert.equal(joined.match(/VERIFY SITE CONDITIONS/g)?.length ?? 0, 0,
    'the standing notice belongs on the header, not repeated in the list');
});

test('a hand-routed design raises no auto-route verification line', () => {
  const sheet = installerSheet(design());
  assert.equal(sheet.toVerify.length, 0);
});
