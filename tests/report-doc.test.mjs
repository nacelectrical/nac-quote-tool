// The two documents NAC sends out.
//
// The one that matters most: the CUSTOMER HVAC DESIGN SUMMARY must never carry
// a supplier cost, a margin, or an internal engineering note. That is not
// checked by reading the code — it is checked by scanning the finished document
// for anything that looks like money or like internal wording, so a future
// block added to the wrong builder fails this file rather than reaching a
// customer.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { internalReportDoc, customerReportDoc, docText, REPORT_KIND, ENGINEERING_DISCLAIMER }
  from '../designer/engines/report-doc.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { measureRooms } from '../designer/engines/interpret.mjs';
import { verifyRoom } from '../designer/engines/rooms.mjs';

/** A complete, costed design — the state a document is actually produced from. */
function costedDesign() {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const rooms = measureRooms([
    { label: 'Living', boundaryPx: { x: 0, y: 0, w: 620, h: 480 } },
    { label: 'Bed 1',  boundaryPx: { x: 0, y: 0, w: 380, h: 340 } },
    { label: 'Bed 2',  boundaryPx: { x: 0, y: 0, w: 330, h: 320 } }
  ], { calibration: cal }, { imageQuality: 'high' }).map(r => verifyRoom(r, 'estimator'));

  let d = createDesign({
    customer: { name: 'Sample Residence', address: '1 Test St, Buderim QLD',
                phone: '0400 000 000', email: 'test@example.com' },
    job: { description: 'Ducted reverse cycle, new build' }
  });
  d.calibration = cal;
  d.rooms = rooms;
  d = runPipeline(d, { catalogue: buildCatalogue({}) });
  return d;
}

const DESIGN = costedDesign();

test('the design used for these documents really is costed', () => {
  assert.equal(DESIGN.stage, 'complete');
  assert.ok(DESIGN.bom && DESIGN.bom.items.length > 0, 'a bill of materials');
  assert.ok(DESIGN.commercials, 'commercials');
  assert.ok(DESIGN.commercials.totalJobCost > 0, 'a job cost worth hiding');
});

test('the internal sheet carries the working: costs, margin and warnings', () => {
  const doc = internalReportDoc(DESIGN);
  const text = docText(doc);
  assert.equal(doc.kind, REPORT_KIND.INTERNAL);
  assert.match(text, /Bill of materials/i);
  assert.match(text, /Total job cost/i);
  assert.match(text, /Gross (profit|margin)/i);
  assert.match(text, /\$[\d,]+\.\d\d/, 'money appears, because this is the internal sheet');
  assert.match(text, /Design assumptions/i);
});

test('the customer summary carries NO money at all', () => {
  const text = docText(customerReportDoc(DESIGN));
  const money = text.match(/\$\s?[\d,]+(\.\d\d)?/g) || [];
  assert.deepEqual(money, [], 'a dollar figure reached the customer document: ' + money.join(', '));
});

test('the customer summary carries no cost, margin or supplier wording', () => {
  const text = docText(customerReportDoc(DESIGN)).toLowerCase();
  const banned = ['supplier', 'cost', 'margin', 'gross profit', 'markup', 'mark-up',
                  'unit cost', 'job fee', 'placeholder', 'price source', 'bill of materials',
                  'mmem', 'gst', 'sell price', 'quote total', 'part code'];
  const found = banned.filter(w => text.includes(w));
  assert.deepEqual(found, [], 'internal wording reached the customer document: ' + found.join(', '));
});

test('the customer summary carries no internal engineering detail', () => {
  // The standard engineering disclaimer is excluded: it is one reviewed
  // sentence that belongs on both documents and it names static pressure as
  // something to be verified, which is not the same as reporting a figure.
  const text = docText(customerReportDoc(DESIGN))
    .replace(ENGINEERING_DISCLAIMER, '').toLowerCase();
  const banned = ['static pressure', 'pressure drop', 'velocity', 'confidence',
                  'plan calibration', 'px/mm', 'warning', 'critical', 'acknowledged',
                  'design assumptions', 'w/m²', 'index run'];
  const found = banned.filter(w => text.includes(w));
  // Engineering units, matched as whole words so "parts of the home" is not a hit.
  const units = (text.match(/\b\d+(\.\d+)?\s?(pa|l\/s|m\/s|kpa)\b/g) || []);
  assert.deepEqual(found, [], 'internal engineering detail reached the customer document: ' + found.join(', '));
  assert.deepEqual(units, [], 'an engineering figure reached the customer document: ' + units.join(', '));
});

test('the customer summary still says what the customer is buying', () => {
  const doc = customerReportDoc(DESIGN);
  const text = docText(doc);
  assert.equal(doc.kind, REPORT_KIND.CUSTOMER);
  assert.equal(doc.customer.name, 'Sample Residence');
  assert.match(text, /Your system/i);
  assert.match(text, /Rooms and airflow/i);
  assert.match(text, /What is included/i);
  assert.match(text, /commissioning/i);
  assert.match(text, /Living/, 'the rooms are listed');
  // The model and capacity are the thing being sold — they belong here.
  assert.match(text, new RegExp(DESIGN.selectedUnit.model));
});

test('the customer builder never reads the costing branches of the design', () => {
  // Feed it a design whose costing is deliberately absurd. If any of it were
  // being read, one of these markers would surface.
  const poisoned = {
    ...DESIGN,
    bom: { items: [{ category: 'POISON', label: 'POISON-BOM', quantity: 1, unit: 'each',
                     unitCost: 9999, totalCost: 9999, priceSource: 'nac' }], placeholderCount: 0 },
    labour: { mode: 'flat', rows: [{ task: 'POISON-LABOUR', cost: 8888 }], totalFee: 8888 },
    commercials: { ...DESIGN.commercials, totalJobCost: 7777, grossProfit: 6666 },
    assumptions: [{ label: 'POISON-ASSUMPTION', value: 'x', source: 'y' }],
    warnings: [{ code: 'POISON_WARNING', severity: 'CRITICAL', message: 'POISON-WARNING', area: 'x' }]
  };
  const text = docText(customerReportDoc(poisoned));
  for (const marker of ['POISON-BOM', 'POISON-LABOUR', 'POISON-ASSUMPTION', 'POISON-WARNING',
                        '9999', '8888', '7777', '6666']) {
    assert.ok(!text.includes(marker), marker + ' reached the customer document');
  }
});

test('a half-built design still produces both documents rather than throwing', () => {
  // An estimator can press Reports at any point. Neither document may crash.
  const bare = createDesign({ customer: { name: 'Early' } });
  for (const build of [internalReportDoc, customerReportDoc]) {
    const doc = build(bare);
    assert.ok(doc.blocks.length > 0);
    assert.equal(doc.customer.name, 'Early');
    assert.ok(docText(doc).length > 0);
  }
});

test('a not-completed static pressure check is stated in the internal sheet', () => {
  const d = { ...DESIGN, pressure: { ...DESIGN.pressure, checkCompleted: false, status: 'not_completed',
    unitAvailableStaticPa: null, remainingMarginPa: null,
    statusLabel: 'STATIC PRESSURE CHECK NOT COMPLETED — MANUFACTURER DATA REQUIRED' } };
  const doc = internalReportDoc(d);
  const text = docText(doc);
  assert.match(text, /NOT COMPLETED/);
  assert.match(text, /MANUFACTURER DATA REQUIRED/);
  assert.ok(doc.blocks.some(b => b.t === 'flag' && /NOT COMPLETED/.test(b.text)),
    'it is flagged, not buried in a note');
});

test('every table cell is a string, so no renderer has to guess', () => {
  for (const doc of [internalReportDoc(DESIGN), customerReportDoc(DESIGN)]) {
    for (const blk of doc.blocks) {
      if (blk.t !== 'table') continue;
      for (const row of blk.rows) {
        assert.equal(row.length, blk.cols.length, blk.cols.map(c => c.label).join('/'));
        for (const cell of row) assert.equal(typeof cell, 'string');
      }
    }
  }
});

test('a line with no price says PRICE REQUIRED rather than showing nothing', () => {
  const d = { ...DESIGN, bom: { items: [
    { category: 'duct', label: 'Mystery part', quantity: 2, unit: 'each',
      unitCost: null, totalCost: null, priceSource: null }
  ], unpricedCount: 1, unpricedLabels: ['Mystery part'], placeholderCount: 0 } };
  const text = docText(internalReportDoc(d));
  assert.match(text, /PRICE REQUIRED/);
  assert.match(text, /have no cost at all/);
});
