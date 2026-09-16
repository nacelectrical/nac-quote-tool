// THE APPROVED JOB, held to every condition Nick set when he approved it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproved, APPROVED_OUTLETS, FAN_COIL, RETURN_GRILLES }
  from './fixtures/approved-job.mjs';
import { PLACEMENT, OUTLET_SOURCE } from '../designer/engines/placement.mjs';
import { selectDiameter } from '../designer/engines/ducts.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const D = await buildApproved();
const out = D.out;
const finals = out.network.sections.filter(s => s.role === 'final');

// ── Outlets ─────────────────────────────────────────────────────────────────

test('exactly eleven outlets, and no Study outlet', () => {
  assert.equal(out.outlets.totals.total, 11);
  assert.equal(finals.length, 11);
  assert.ok(!out.outlets.rows.some(r => /STUDY/i.test(r.label)), 'the Study got an outlet');
  assert.ok(!finals.some(f => /STUDY/i.test(String(f.destination))), 'the Study got a duct');
});

test('the Study is conditioned, keeps its load, and takes spill air', () => {
  const study = out.rooms.find(r => r.label === 'STUDY');
  assert.ok(study.conditioned, 'the Study was excluded instead of spilled');
  const load = out.roomLoads.find(l => l.roomId === study.id);
  assert.ok(load.designW > 0, 'the Study lost its heat load');
  const spill = out.spillAllocations.find(s => s.roomId === study.id);
  assert.ok(spill, 'no spill allocation was recorded');
  assert.equal(spill.airflowLs, 43);
  assert.ok(spill.intoRoomIds.length >= 4, 'the spill air went nowhere');
});

test('Meals and Family-2 are recorded as estimator-placed, not detected marks', () => {
  const meals = out.outlets.rows.find(r => r.label === 'MEALS');
  const family = out.outlets.rows.find(r => r.label === 'FAMILY');
  assert.equal(meals.positionSource, OUTLET_SOURCE.MANUAL);
  assert.equal(meals.positionIsManual, true);
  assert.equal(family.positionSource, OUTLET_SOURCE.MANUAL);
  // And the ones that WERE read off the sheet still say so.
  const living = out.outlets.rows.find(r => r.label === 'LIVING');
  assert.equal(living.positionSource, OUTLET_SOURCE.DETECTED);
});

test('every outlet sits where it was approved', () => {
  const at = (label) => APPROVED_OUTLETS[label];
  for (const [label, list] of Object.entries(APPROVED_OUTLETS)) {
    const runs = finals.filter(f => String(f.destination).startsWith(label));
    assert.equal(runs.length, list.length, label + ' has the wrong number of outlets');
    for (const r of runs) {
      const end = r.points[r.points.length - 1];
      const nearest = Math.min(...list.map(o => Math.hypot(end.x - o.x, end.y - o.y)));
      assert.ok(nearest < 3, label + ' outlet moved ' + Math.round(nearest) + ' px off its mark');
    }
  }
  assert.ok(at('FAMILY').length === 2);
});

// ── Minimum supply branch ───────────────────────────────────────────────────

test('nothing smaller than a 250 is fitted, and no 200 appears at all', () => {
  const supply = out.network.sections.filter(s => s.role !== 'return');
  assert.equal(Math.min(...supply.map(s => s.diameterMm)), 250);
  assert.ok(!supply.some(s => s.diameterMm === 200), 'a 200 is still on the job');
});

test('a duct raised by the installer minimum says so, and keeps the calculated size', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.duct.minimumSupplyBranchDiameterMm = 250;
  const r = selectDiameter(45, 'final', { settings });
  assert.equal(r.diameterMm, 250);
  assert.equal(r.calculatedDiameterMm, 200, 'the calculated size was lost');
  assert.equal(r.raisedByMinimum, true);
  assert.equal(r.sizeBasis, 'installer_minimum');
  assert.match(r.reason, /installer minimum/);
  assert.match(r.reason, /NOT because the airflow required it/);
  // The velocity the calculation produced is still reported.
  assert.ok(r.calculatedVelocityMs > r.velocityMs);
});

test('a duct the maths genuinely required is not blamed on the minimum', () => {
  const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  settings.duct.minimumSupplyBranchDiameterMm = 250;
  const r = selectDiameter(159, 'final', { settings });
  assert.equal(r.diameterMm, 300);
  assert.equal(r.raisedByMinimum, false);
  assert.equal(r.sizeBasis, 'calculated');
});

test('the minimum is a setting, not a hardcoded global', () => {
  const loose = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  assert.equal(loose.duct.minimumSupplyBranchDiameterMm, 200,
    'the default changed — other jobs would silently resize');
  assert.equal(selectDiameter(45, 'final', { settings: loose }).diameterMm, 200);
});

// ── Fan coil placement ──────────────────────────────────────────────────────

test('the approved fan coil is approved, and sits where the installer put it', () => {
  assert.equal(out.placement.fanCoil.status, PLACEMENT.APPROVED);
  assert.equal(out.placement.fanCoil.provisional, false);
  assert.equal(out.placement.fanCoil.at.x, FAN_COIL.x);
  assert.equal(out.placement.fanCoil.at.y, FAN_COIL.y);
});

test('the fan coil above the Study does not create a Study outlet', () => {
  assert.ok(!finals.some(f => /STUDY/i.test(String(f.destination))));
  assert.equal(out.outlets.rows.filter(r => /STUDY/i.test(r.label)).length, 0);
});

test('a design cannot be finalised while the fan coil is provisional', async () => {
  const prov = await buildApproved({ fanCoilStatus: PLACEMENT.ASSUMED });
  assert.equal(prov.out.placement.canFinalise, false);
  assert.equal(prov.out.placement.canPreview, true, 'a preview must still be possible');
  assert.ok(prov.out.placement.blockers.some(b => b.code === 'FAN_COIL_NOT_APPROVED'));
});

test('an approved placement clears the blockers', () => {
  assert.equal(out.placement.canFinalise, true,
    JSON.stringify(out.placement.blockers));
});

test('the engine checks the unit against its grilles and its outlets', () => {
  const pairs = out.placement.clearances;
  assert.ok(pairs.length >= 3, 'no proximity checks ran');
  assert.ok(pairs.every(c => c.ok), JSON.stringify(pairs.filter(c => !c.ok)));
  assert.ok(pairs.some(c => c.between === 'return' || c.and === 'return_2'),
    'the two grilles were never checked against each other');
});

// ── Return air ──────────────────────────────────────────────────────────────

test('two separate return grilles, both drawn, both in circulation', () => {
  assert.equal(out.returnDesign.returnCount, 2);
  assert.equal(out.returnDesign.returns.length, 2);
  assert.equal(out.returnRoutes.length, 2, 'the two returns are not two drawn paths');
  const ids = out.returnRoutes.map(r => r.id);
  assert.equal(new Set(ids).size, 2, 'both returns share one id');
  for (const r of out.returnRoutes) {
    assert.ok(r.lengthM > 0, r.id + ' has no duct');
    assert.equal(r.assumed, false, r.id + ' is still an assumed position');
  }
});

test('neither return grille is inside a bedroom', () => {
  const beds = out.rooms.filter(r => /BEDROOM|BED \d/i.test(r.label) && r.boundaryPx);
  for (const r of out.returnRoutes) {
    const at = r.points[0];
    for (const b of beds) {
      const inside = at.x >= b.boundaryPx.x && at.x <= b.boundaryPx.x + b.boundaryPx.w &&
                     at.y >= b.boundaryPx.y && at.y <= b.boundaryPx.y + b.boundaryPx.h;
      assert.ok(!inside, r.id + ' is inside ' + b.label);
    }
  }
});

test('each return carries its own airflow and they add up to the system', () => {
  const rs = out.returnDesign.returns;
  for (const r of rs) {
    assert.ok(r.airflowLs > 0, r.id + ' carries no air');
    assert.equal(r.grilleWidthMm, 600);
    assert.equal(r.grilleHeightMm, 400);
  }
  const total = rs.reduce((n, r) => n + r.airflowLs, 0);
  const system = out.airflow.allocatedAirflowLs;
  assert.ok(Math.abs(total - system) <= 2,
    'returns carry ' + total + ' L/s against a system of ' + system);
});

test('both returns are o400, one per unit spigot', () => {
  assert.equal(out.returnDesign.duct.diameterMm, 400);
  assert.equal(out.returnDesign.duct.ductCount, 2);
  assert.equal(out.returnDesign.duct.fromUnitSpec, true,
    'the return size stopped coming from the fan coil');
});

test('gross face velocity is reported, and free-area velocity is marked unverified', () => {
  for (const r of out.returnDesign.returns) {
    assert.ok(r.grossAreaM2 > 0);
    assert.ok(r.grossFaceVelocityMs > 0);
    assert.equal(r.freeAreaVerified, false,
      'a free area was claimed as verified without manufacturer data');
    assert.match(r.freeAreaRatioSource, /assumed/);
    assert.ok(r.effectiveFreeAreaVelocityMs > r.grossFaceVelocityMs);
  }
  assert.ok(out.warnings.some(w => w.code === 'RETURN_FREE_AREA_UNVERIFIED'),
    'nothing told the estimator the free area is unverified');
});

// ── Capacity ────────────────────────────────────────────────────────────────

test('the capacity shortfall is stated, and neither figure is altered to hide it', () => {
  const w = out.warnings.find(x => x.code === 'SYSTEM_UNDERSIZED' && !x.perCandidate);
  assert.ok(w, 'no capacity mismatch warning');
  assert.match(w.message, /Installer review\/manual equipment override required/);
  assert.equal(w.severity, 'CRITICAL');
  assert.equal(w.blocksFinalApproval, true);
  assert.ok(w.calculatedDesignLoadKw > w.selectedCapacityKw);
  // Both survive.
  assert.equal(w.selectedCapacityKw, out.selectedUnit.capacityKw);
  assert.equal(w.calculatedDesignLoadKw, out.systemLoad.designKw);
  assert.ok(out.systemLoad.designKw > 20, 'the heat load was trimmed to fit the unit');
});

// ── Renovated walls ─────────────────────────────────────────────────────────

test('the demolished Lounge partitions are recorded, and the exterior wall is not', () => {
  const dw = D.design.demolishedWalls;
  assert.equal(dw.length, 2);
  for (const w of dw) {
    assert.ok(w.reason, w.id + ' was removed without a reason');
    assert.ok(w.approvedBy, w.id + ' was removed by nobody');
  }
  assert.ok(!dw.some(w => (w.between || []).includes('COVERED ALFRESCO')),
    'the exterior wall to the alfresco was marked demolished');
});

// ── Reconciliation ──────────────────────────────────────────────────────────

test('outlet, BTO, main and system airflow all reconcile', () => {
  const outletTotal = out.outlets.rows.reduce((n, r) => n + r.airflowLs, 0);
  const mains = out.network.sections.filter(s => !s.parentId && s.role !== 'return');
  const mainTotal = mains.reduce((n, s) => n + s.airflowLs, 0);
  const zoneTotal = out.zones.zones.reduce((n, z) => n + Math.round(z.airflowLs), 0);
  assert.ok(Math.abs(outletTotal - mainTotal) <= 2, outletTotal + ' vs ' + mainTotal);
  assert.ok(Math.abs(zoneTotal - outletTotal) <= 2, zoneTotal + ' vs ' + outletTotal);
  // And the difference from the nameplate is rounding, not a leak.
  const nameplate = out.airflow.systemAirflowLs ?? out.airflow.allocatedAirflowLs;
  assert.ok(Math.abs(nameplate - outletTotal) <= 2,
    'the system is out by ' + (nameplate - outletTotal) + ' L/s');
});

test('the two mains are the approved 566 and 233', () => {
  const mains = out.network.sections.filter(s => !s.parentId && s.role !== 'return')
    .map(s => s.airflowLs).sort((a, b) => b - a);
  assert.deepEqual(mains, [566, 233]);
});

// ── The order matches the drawing ───────────────────────────────────────────

test('a run off a BTO is not also charged a saddle collar', () => {
  const onManifold = new Set(out.btos.flatMap(b => b.ports.map(p => p.sectionId).filter(Boolean)));
  const collars = out.bom.items.find(i => i.key === 'takeoff');
  const fittings = out.bom.items.filter(i => i.key === 'bto_fitting')
    .reduce((n, i) => n + i.quantity, 0);
  assert.equal(fittings, out.btos.length);
  const loose = out.network.sections.filter(s =>
    (s.fittings || []).some(f => f.type === 'takeoff') && !onManifold.has(s.id)).length;
  assert.equal(collars ? collars.quantity : 0, loose,
    'the order buys collars for runs that leave a manifold');
});

test('the return grille on the order is the grille on the drawing', () => {
  const g = out.bom.items.find(i => i.key === 'return_grille');
  assert.ok(g, 'no return grille on the order');
  assert.equal(g.quantity, 2);
  assert.equal(g.designedSize, '600 x 400 mm');
  assert.match(g.label, /600 x 400/);
  if (g.rateIsForAnotherSize) {
    assert.match(g.note, /confirm the price for this size/,
      'the order used a rate for a different size without saying so');
  }
});

test('the static pressure figure is not presented as verified', () => {
  assert.ok(out.pressure.estimatedRequirementPa > 0);
  assert.equal(out.pressure.availableStaticPa ?? null, null,
    'an available-static figure appeared without manufacturer data behind it');
});
