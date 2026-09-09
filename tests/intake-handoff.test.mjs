// The GHL intake → designer handoff: a design starts from what the customer
// submitted, and pushing it back does not lose their own material.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIntakeDraft, designNotesBlock } from '../designer/engines/store.mjs';

const ROW = {
  id: 'NAC-SMITH-1738000000',
  client: 'Smith Residence',
  job_desc: 'Ducted AC Supply & Install',
  line_items: JSON.stringify([
    { name: 'Daikin FDYAN140AV1 14kW', desc: '14kW ducted', price: 0, _brand: 'Daikin', _model: 'FDYAN140AV1', _kw: 14 }
  ]),
  notes: [
    'INTAKE DRAFT | 0412 345 678 | 12 Oak St, Springfield Lakes QLD 4300',
    '',
    'SIZE:            17.3 kW  (conditioned area 119 m2 x 145)',
    'CONDITIONED_M2:  119',
    'CONFIDENCE:      MEDIUM',
    'NOT COUNTED:     Garage, Alfresco, Ensuite, WIR',
    '',
    'PHOTOS:',
    'https://x.supabase.co/storage/v1/object/public/intake-uploads/plan-1738-0-floorplan.pdf',
    'https://x.supabase.co/storage/v1/object/public/intake-uploads/photo-1738-1-switchboard.jpg',
    'https://x.supabase.co/storage/v1/object/public/intake-uploads/photo-1738-2-roofspace.jpg'
  ].join('\n'),
  accepted: false
};

test('the customer’s details are read back off the intake draft', () => {
  const d = parseIntakeDraft(ROW);
  assert.equal(d.quoteId, 'NAC-SMITH-1738000000');
  assert.equal(d.customer.name, 'Smith Residence');
  assert.equal(d.customer.phone, '0412 345 678');
  assert.equal(d.customer.address, '12 Oak St, Springfield Lakes QLD 4300');
  assert.equal(d.jobDescription, 'Ducted AC Supply & Install');
});

test('the floor plan is told apart from the site photos', () => {
  const d = parseIntakeDraft(ROW);
  assert.match(d.planUrl, /plan-1738-0-floorplan\.pdf$/);
  assert.equal(d.photoUrls.length, 2);
  assert.ok(d.photoUrls.every(u => /photo-/.test(u)));
});

test('the intake’s own sizing read is kept for comparison, without the photo list', () => {
  const d = parseIntakeDraft(ROW);
  assert.match(d.intakePack, /CONDITIONED_M2:\s+119/);
  assert.match(d.intakePack, /NOT COUNTED/);
  assert.ok(!d.intakePack.includes('PHOTOS:'));
  assert.ok(!d.intakePack.includes('INTAKE DRAFT'));
  assert.equal(d.intakeOptions[0]._model, 'FDYAN140AV1');
});

test('a draft with no plan attached is handled, not crashed on', () => {
  const d = parseIntakeDraft({ id: 'X', client: 'No Plan', notes: 'INTAKE DRAFT | 0400 | Somewhere' });
  assert.equal(d.planUrl, null);
  assert.deepEqual(d.photoUrls, []);
  assert.equal(d.customer.name, 'No Plan');
});

test('a quote raised outside the intake form still parses', () => {
  const d = parseIntakeDraft({ id: 'Y', client: 'Walk In', notes: '' });
  assert.equal(d.customer.phone, '');
  assert.equal(d.customer.address, '');
  assert.equal(d.intakePack, '');
});

test('the design summary that travels with the quote carries the headline figures', () => {
  const block = designNotesBlock({
    id: 'NACD-SMITH-1',
    systemLoad: { totalConditionedAreaSqM: 119.45, designKw: 18.63, legacy: { kw: 17.3 } },
    selectedUnit: { brandName: 'Daikin', model: 'FDYQN200LCV1', capacityKw: 20, phase: '3Ph' },
    airflow: { allocatedAirflowLs: 1000 },
    outlets: { totals: { total: 11 } },
    zones: { zoneCount: 8 },
    network: { totalDuctLengthM: 94.7 },
    returnDesign: { returnCount: 1, returns: [{ grilleSize: '1200 × 600 mm' }], perReturnLs: 1000 },
    pressure: { estimatedRequirementPa: 141, unitAvailableStaticPa: 200, disclaimer: 'DESIGN ESTIMATE' },
    warnings: []
  });
  assert.match(block, /NACD-SMITH-1/);
  assert.match(block, /119\.45 m²/);
  assert.match(block, /18\.63 kW/);
  assert.match(block, /145 W\/m² rule: 17\.3 kW/);
  assert.match(block, /Daikin FDYQN200LCV1/);
  assert.match(block, /1000 L\/s/);
  assert.match(block, /Zones: 8/);
});

test('critical warnings travel with the quote so whoever picks it up sees them', () => {
  const block = designNotesBlock({
    id: 'NACD-X', warnings: [
      { severity: 'CRITICAL', code: 'MINIMUM_OPEN_AIRFLOW_TOO_LOW' },
      { severity: 'WARNING', code: 'RETURN_AIR_UNDERSIZED' }
    ]
  });
  assert.match(block, /CRITICAL WARNINGS: MINIMUM_OPEN_AIRFLOW_TOO_LOW/);
  assert.ok(!block.includes('RETURN_AIR_UNDERSIZED'));
});
