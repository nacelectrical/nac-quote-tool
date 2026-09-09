// PART 36 — the sample Australian builder plan, run end to end.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as SP from '../designer/engines/sample-plan.mjs';
import { interpretPlan, measureRooms } from '../designer/engines/interpret.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { verifyRoom } from '../designer/engines/rooms.mjs';
import { createDesign, addRevision } from '../designer/engines/model.mjs';
import { runPipeline, designSummary } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

/** Build the full sample design, ready for assertions in several tests. */
export function buildSampleDesign({ verifyAll = true, savedBrands = null } = {}) {
  const calibration = calibrate({
    pointA: SP.SAMPLE_PLAN_META.calibrationPointA,
    pointB: SP.SAMPLE_PLAN_META.calibrationPointB,
    knownDistance: SP.SAMPLE_PLAN_META.calibrationKnownDistance,
    unit: SP.SAMPLE_PLAN_META.calibrationUnit,
    imageWidthPx: SP.SAMPLE_PLAN_META.imageWidthPx,
    imageHeightPx: SP.SAMPLE_PLAN_META.imageHeightPx,
    scaleLabel: SP.SAMPLE_PLAN_META.scaleLabelText
  });

  const interp = interpretPlan({
    rawDetections: SP.sampleDetections(),
    openings: SP.sampleOpenings(),
    walls: SP.sampleWalls(),
    overallWidthMm: SP.H_OVERALL_MM,
    overallDepthMm: SP.V_OVERALL_MM
  });

  const roomDefs = SP.SAMPLE_ROOMS.map(r => ({
    ...r, hStations: r.h, vStations: r.v
  }));

  let rooms = measureRooms(roomDefs, {
    hChain: interp.primaryHorizontalChain,
    vChain: interp.primaryVerticalChain,
    walls: SP.sampleWalls(),
    calibration
  });
  if (verifyAll) rooms = rooms.map(r => (r.conditioned ? verifyRoom(r, 'test') : r));

  const catalogue = buildCatalogue({
    // No Price Setup prices — the sample is priced at cost plus the flat fee,
    // and the costs come from NAC's real supplier price list.
    savedBrands: savedBrands ?? null,
    specStore: {
      // Manufacturer data for the unit the sample selects. Illustrative only —
      // in the running app NAC enter these off the data sheet.
      'daikin:mmem_fdyqn200lcv1_rzq200my1': {
        ratedAirflowLs: 1100, availableStaticPa: 200, indoorWidthMm: 1550,
        indoorHeightMm: 470, indoorDepthMm: 900, electricalSupply: '415V 3Ph',
        runningCurrentA: 12, refrigerant: 'R32', heatingKw: 22.4
      }
    }
  });

  let design = createDesign({ customer: SP.SAMPLE_CUSTOMER, job: SP.SAMPLE_JOB });
  design.calibration = calibration;
  design.scaleLabel = calibration.scaleLabel;
  design.detectedDimensions = interp.detectedDimensions;
  design.chains = interp.chains;
  design.rooms = rooms;
  design.mainRoute = { lengthMm: 4200 };
  design.ductRoutes = Object.fromEntries(rooms.filter(r => r.conditioned)
    .map((r, i) => [r.id, { lengthMm: 5000 + i * 900 }]));
  design.returnDuctLengthMm = 2500;

  design = runPipeline(design, { settings: DEFAULT_SETTINGS, catalogue });
  return { design, interp, calibration, catalogue };
}

test('sample plan: chains reconstruct and close against the stated overalls', () => {
  const { interp } = buildSampleDesign();
  const h = interp.primaryHorizontalChain;
  const v = interp.primaryVerticalChain;

  assert.equal(h.totalMm, SP.H_OVERALL_MM);
  assert.equal(v.totalMm, SP.V_OVERALL_MM);
  assert.equal(h.closure.closes, true);
  assert.equal(v.closure.closes, true);
  assert.deepEqual(h.stations, SP.H_STATIONS);
  assert.deepEqual(v.stations, SP.V_STATIONS);
});

test('sample plan: numbers on the plan are classified, not blindly used', () => {
  const { interp } = buildSampleDesign();
  const by = id => interp.detectedDimensions.find(d => d.id === id);

  assert.equal(by('h0_overall').classification, 'overall_building_dimension');
  assert.equal(by('h1_1').classification, 'wall_thickness');      // 110 brick
  assert.equal(by('h1_2').classification, 'internal_wall_dimension'); // 3600
  assert.equal(by('win1').classification, 'window_width');         // 1800 over a window symbol
  assert.equal(by('door1').classification, 'door_width');          // 820 over a door symbol
  assert.equal(by('slider1').classification, 'door_width');        // 2400 over a slider symbol
  assert.equal(by('note1').classification, 'annotation');          // R2.5
  assert.equal(by('note1').mm, null);
  assert.equal(by('note2').classification, 'annotation');          // FFL 12.50
  assert.equal(by('note3').classification, 'annotation');          // BED 3
  assert.equal(by('note4').classification, 'annotation');          // bare "3" is a room number
  assert.equal(by('setback1').mm, 900);
  assert.notEqual(by('setback1').classification, 'internal_wall_dimension');
});

test('sample plan: rooms are measured from chain stations at high confidence', () => {
  const { design } = buildSampleDesign();
  const bed2 = design.rooms.find(r => r.label === 'Bed 2');

  assert.equal(bed2.widthMm, 3200);            // H stations 8890 - 5690
  assert.equal(bed2.lengthMm, 3400);           // V stations 3510 - 110
  assert.equal(bed2.areaSqM, 10.88);
  assert.equal(bed2.measurement.source, 'chain_plus_wall_geometry');
  assert.ok(bed2.confidence >= 90, 'expected HIGH confidence, got ' + bed2.confidence);
  assert.equal(bed2.confidenceBand, 'HIGH');
});

test('sample plan: unconditioned rooms are excluded from sizing', () => {
  const { design } = buildSampleDesign();
  const excluded = ['Garage', 'Alfresco', 'Ensuite', 'WIR', "L'DRY", 'Bath'];
  for (const label of excluded) {
    const r = design.rooms.find(x => x.label === label);
    assert.equal(r.conditioned, false, label + ' must not be conditioned');
    assert.equal(r.status, 'Excluded');
  }
  assert.ok(!design.systemLoad.rooms.some(r => excluded.includes(r.label)));
});

test('sample plan: full pipeline reaches a costed, quotable design', () => {
  const { design } = buildSampleDesign();
  const s = designSummary(design);

  assert.equal(design.stage, 'complete');
  assert.ok(s.totalConditionedAreaSqM > 100 && s.totalConditionedAreaSqM < 200,
    'conditioned area out of range: ' + s.totalConditionedAreaSqM);
  assert.ok(s.totalCoolingLoadKw > 0);
  assert.ok(s.selectedSystem, 'a system should be selected');
  assert.ok(s.totalAirflowLs > 0);
  assert.ok(s.outletCount > 0);
  assert.ok(s.totalDuctLengthM > 0);
  assert.ok(s.zoneCount > 0);
  assert.ok(design.bom.items.length > 10);
  assert.ok(s.estimatedCost > 0);
  assert.ok(design.quoteLineItems.length >= 1);
});

test('sample plan: detailed load stays close to the existing 145 W/m² NAC rule', () => {
  const { design } = buildSampleDesign();
  const v = design.systemLoad.varianceVsLegacyPct;
  assert.ok(Math.abs(v) <= 12,
    'detailed engine diverged from the NAC rule by ' + v + '% (legacy ' +
    design.systemLoad.legacy.kw + ' kW vs ' + design.systemLoad.designKw + ' kW)');
});

test('sample plan: nothing is sized until rooms are verified', () => {
  const { design } = buildSampleDesign({ verifyAll: false });
  assert.equal(design.stage, 'awaiting_room_verification');
  assert.equal(design.systemLoad.totalConditionedAreaSqM, 0);
  assert.equal(design.selectedUnit, null);
  assert.ok(design.warnings.some(w => w.code === 'UNVERIFIED_ROOM'));
});

test('sample plan: revisions are appended, never overwritten', () => {
  let { design } = buildSampleDesign();
  design = addRevision(design, { by: 'test', reason: 'initial' });
  const firstKw = design.systemLoad.designKw;
  design.rooms = design.rooms.map(r => r.label === 'Living' ? { ...r, ceilingHeightMm: 3300 } : r);
  design = runPipeline(design, { catalogue: buildCatalogue({}) });
  design = addRevision(design, { by: 'test', reason: 'raised living ceiling' });

  assert.equal(design.revisions.length, 2);
  assert.equal(design.revisions[0].snapshot.systemLoad.designKw, firstKw);
  assert.ok(design.systemLoad.designKw > firstKw, 'raising the ceiling should raise the load');
});


test('sample plan: the job is priced at cost plus the flat fee', () => {
  const { design } = buildSampleDesign();
  const c = design.commercials;

  assert.equal(design.labour.mode, 'flat');
  assert.equal(c.pricingBasis.key, 'materials_plus_fee');
  assert.equal(c.jobFee, DEFAULT_SETTINGS.commercial.jobFee);

  // Cost is what NAC actually buys. The fee is not a cost.
  assert.equal(c.labourCost, 0);
  assert.equal(c.totalJobCost,
    Math.round((c.equipmentCost + c.materialsCost + c.subcontractorCost + c.otherCost) * 100) / 100);

  // Price is that cost plus the fee, then GST, exactly the way the existing
  // quote tool derives GST.
  assert.equal(c.sellPriceExGst, Math.round((c.totalJobCost + c.jobFee) * 100) / 100);
  assert.equal(c.gstRate, 0.10);
  assert.equal(c.gstAmount, Math.round((c.sellPriceExGst * 0.1) * 100) / 100);
  assert.equal(c.sellPriceIncGst, Math.round((c.sellPriceExGst * 1.1) * 100) / 100);

  // Gross profit is the fee, whatever the job cost.
  assert.equal(c.grossProfit, c.jobFee);
  assert.ok(c.grossMarginPct > 0 && c.grossMarginPct < 100);

  // The unit cost comes from the supplier price list, not a guess.
  assert.ok(design.selectedUnit.supplierCost > 0);
  assert.match(design.selectedUnit.supplierSource, /MMEM/);
});

test('sample plan: static pressure is compared against the unit ESP on file', () => {
  const { design } = buildSampleDesign();
  assert.ok(design.pressure.estimatedRequirementPa > 0);
  assert.equal(design.pressure.unitAvailableStaticPa, 200);
  assert.equal(design.pressure.remainingMarginPa,
    Math.round((200 - design.pressure.estimatedRequirementPa) * 10) / 10);
  assert.match(design.pressure.disclaimer, /COMMISSIONING VERIFICATION REQUIRED/);
});

test('sample plan: quote line items match the existing nac_quotes shape', () => {
  const { design } = buildSampleDesign();
  const [item] = design.quoteLineItems;
  // admin.html writes { name, desc, price, link } — sign.html renders exactly that.
  assert.ok(typeof item.name === 'string' && item.name.length > 0);
  assert.ok(typeof item.desc === 'string');
  assert.equal(typeof item.price, 'number');
  assert.equal(typeof item.link, 'string');
  // The extra underscore fields are what admin.html's loadDraft() reads back.
  assert.equal(item._brand, design.selectedUnit.brandName);
  assert.equal(item._model, design.selectedUnit.model);
});
