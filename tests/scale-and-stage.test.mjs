// ─────────────────────────────────────────────────────────────────────────────
// §10 AND §11 — THE SCALE, AND WHAT A PROPOSAL MAY CONTAIN
//
// Re-calibrating used to remeasure the rooms and leave everything else
// standing. So a job could carry routes drawn at 44.5 px/m, duct lengths
// measured at 44.5, a plenum sized for those lengths and a static pressure
// added up from them — beside rooms measured at 39.0 and a scale record saying
// 39.0. Every one of those numbers looked current.
//
// And the Kauri proposal-stage report invented ten ø400 mains, a 4,660 mm
// plenum, BTOs, Y-pieces, a static pressure and a ductwork BOM for a job whose
// routed length was 0.0 m.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleChanged, invalidateForNewScale, proposalStageAudit,
         SCALE_DERIVED, ESTIMATOR_DECISIONS, SCALE_CHANGE_TOLERANCE }
  from '../designer/engines/scale-invalidation.mjs';
import { recordCalibration, SCALE_SOURCE, VERIFIED_SCALE_SOURCES, capabilities, DESIGN_STAGE }
  from '../designer/engines/design-stage.mjs';

// ── §10 the calibration workflow ────────────────────────────────────────────
test('two points and a real distance produce a recorded, verified calibration', () => {
  const r = recordCalibration({
    points: [{ x: 526, y: 830 }, { x: 526, y: 990 }],
    realDistanceMm: 4100,
    source: SCALE_SOURCE.MEASURED,
    measuredBy: 'Nick Cahill',
    at: '2026-09-22T01:00:00Z',
    imageWidthPx: 714, imageHeightPx: 1179
  });
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  const c = r.calibration;
  assert.equal(c.points.length, 2);
  assert.equal(c.realDistanceMm, 4100);
  assert.ok(c.pixelsPerMm > 0);
  assert.equal(c.measuredBy, 'Nick Cahill');
  assert.equal(c.measuredAt, '2026-09-22T01:00:00Z');
  assert.equal(c.source, SCALE_SOURCE.MEASURED);
  assert.equal(c.verified, true);
});

test('a distance scaled off something drawn is refused', () => {
  const r = recordCalibration({
    points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], realDistanceMm: 4500,
    source: SCALE_SOURCE.DRAWN_OBJECT, measuredBy: 'Nick Cahill'
  });
  assert.equal(r.ok, false);
  assert.equal(r.calibration, null);
  assert.ok(!VERIFIED_SCALE_SOURCES.includes(SCALE_SOURCE.DRAWN_OBJECT));
});

// ── §10 step 5: invalidation ────────────────────────────────────────────────
test('a changed scale clears everything measured through the old one', () => {
  const design = {
    calibration: { pixelsPerMm: 0.0445 },
    network: { sections: [{ id: 'main', lengthM: 4.2 }], totalDuctLengthM: 51.9 },
    autoRoute: { confidence: 'MEDIUM' },
    topology: { generated: true, segments: [{ id: 's1' }] },
    routeEdits: { s1: { points: [] } },
    lockedRoutes: { s2: { points: [] } },
    ductRoutes: { r1: { lengthMm: 6000 } },
    mainRoute: { lengthMm: 4200 },
    returnRoute: { points: [] },
    btos: [{ id: 'BTO-A' }],
    supplyPlenum: { bodyWidthMm: 1440 },
    zoneDampers: [{ id: 'z1' }],
    pressure: { estimatedRequirementPa: 107 },
    spigotSelection: { chosen: { count: 3 } },
    bom: { items: [{ key: 'flex_duct' }] },
    commercials: { sellPriceIncGst: 15079.33 },
    quoteLineItems: [{ name: 'System' }],
    fanCoilStatus: 'approved', fanCoilApprovedBy: 'installer',
    approvedAt: '2026-09-01', approvedBy: 'Nick Cahill', approved: true,
    // Decisions, which must survive.
    outletOverrides: { r1: { quantity: 2 } },
    spillRoomIds: ['study'],
    selectedUnitKey: 'daikin:x',
    statedLoad: { designKw: 15.8, statedBy: 'Nick Cahill' },
    customer: { name: 'Sarah Whitlock' }
  };

  const { design: after, cleared, changed } = invalidateForNewScale(
    design, { pixelsPerMm: 0.0445 }, { pixelsPerMm: 0.039 });

  assert.equal(changed, true);
  // EVERY scale-derived artefact is gone.
  for (const d of SCALE_DERIVED) {
    const v = after[d.key];
    const emptied = v === null || (Array.isArray(v) && v.length === 0)
      || (v && typeof v === 'object' && Object.keys(v).length === 0);
    assert.ok(emptied, d.key + ' survived a scale change: ' + JSON.stringify(v));
  }
  // The approvals that were given against those numbers are withdrawn.
  assert.equal(after.fanCoilStatus, 'proposed');
  assert.equal(after.fanCoilApprovedBy, null);
  assert.equal(after.approved, false);
  assert.equal(after.approvedBy, null);

  // AND WHAT THE ESTIMATOR DECIDED SURVIVES. A remeasure is not a reset.
  assert.deepEqual(after.outletOverrides, { r1: { quantity: 2 } });
  assert.deepEqual(after.spillRoomIds, ['study']);
  assert.equal(after.selectedUnitKey, 'daikin:x');
  assert.equal(after.statedLoad.designKw, 15.8);
  assert.equal(after.customer.name, 'Sarah Whitlock');

  // Nothing disappears silently.
  assert.ok(cleared.length >= 14, cleared.length + ' cleared');
  assert.ok(cleared.includes('Static pressure calculation'));
  assert.ok(cleared.includes('Price'));
  assert.equal(after.scaleInvalidation.fromPixelsPerMm, 0.0445);
  assert.equal(after.scaleInvalidation.toPixelsPerMm, 0.039);
});

test('a scale that has not really moved throws nothing away', () => {
  assert.equal(scaleChanged({ pixelsPerMm: 0.0445 }, { pixelsPerMm: 0.0445 }), false);
  // Inside the tolerance: re-entering the same dimension must not wipe a job.
  assert.equal(scaleChanged({ pixelsPerMm: 0.0445 },
    { pixelsPerMm: 0.0445 * (1 + SCALE_CHANGE_TOLERANCE / 2) }), false);
  assert.equal(scaleChanged({ pixelsPerMm: 0.0445 }, { pixelsPerMm: 0.039 }), true);

  const design = { network: { sections: [{ id: 'main' }] } };
  const r = invalidateForNewScale(design, { pixelsPerMm: 0.0445 }, { pixelsPerMm: 0.0445 });
  assert.equal(r.changed, false);
  assert.deepEqual(r.cleared, []);
  assert.equal(r.design.network.sections.length, 1);
});

test('the decisions list and the derived list do not overlap', () => {
  // If a key were on both, one pass would clear what the other promises to
  // keep, and which won would depend on ordering.
  const derived = new Set(SCALE_DERIVED.map(d => d.key));
  for (const k of ESTIMATOR_DECISIONS) {
    assert.ok(!derived.has(k), k + ' is both derived and a decision');
  }
});

// ── §11 proposal stage ──────────────────────────────────────────────────────
test('a proposal carrying detailed ductwork is caught, item by item', () => {
  const bad = {
    network: { sections: [
      { id: 'm1', role: 'main', diameterMm: 400 },
      { id: 'f1', role: 'final', diameterMm: 250 }], totalDuctLengthM: 51.9 },
    btos: [{ id: 'BTO-A' }, { id: 'BTO-B' }],
    supplyPlenum: { bodyWidthMm: 4660 },
    pressure: { estimatedRequirementPa: 107, calculated: true },
    bom: { items: [{ category: 'ductwork', key: 'flex_duct' }] }
  };
  const a = proposalStageAudit(bad);
  assert.equal(a.ok, false);
  const what = a.violations.map(v => v.what);
  for (const expected of ['routed duct lengths', 'BTO schedule',
                          'fabricated plenum dimensions', 'index-run static pressure',
                          'detailed ductwork BOM', 'final duct diameters']) {
    assert.ok(what.includes(expected), expected + ' was not caught: ' + what.join(', '));
  }
  // The 4,660 mm plenum is named, not just counted.
  assert.match(JSON.stringify(a.violations), /4660/);
});

test('a clean proposal passes, and its allowance is not mistaken for ductwork', () => {
  const good = {
    network: { sections: [], totalDuctLengthM: 0, notRouted: true },
    btos: [], supplyPlenum: null,
    pressure: { calculated: false, status: 'NOT CALCULATED — ROUTES REQUIRED' },
    bom: { items: [
      { category: 'ductwork', key: 'proposal_ductwork_allowance',
        label: 'Standard installation allowance' },
      { category: 'outlets', key: 'diffuser_round' }
    ] }
  };
  const a = proposalStageAudit(good);
  assert.equal(a.ok, true, JSON.stringify(a.violations));
});

test('proposal stage cannot route, calculate pressure or build a duct BOM', () => {
  const caps = capabilities({
    designStage: DESIGN_STAGE.PROPOSAL,
    calibration: { pixelsPerMm: 0.039, verified: true, source: SCALE_SOURCE.MEASURED },
    rooms: [{ id: 'r1', conditioned: true, areaSqM: 20, status: 'Verified',
              measurement: { source: 'manual' } }]
  }, { settings: { commercial: { proposalAllowance: { ductwork: 900 } } } });

  assert.equal(caps.mayRouteDucts, false);
  assert.equal(caps.mayCalculatePressure, false);
  assert.equal(caps.mayBuildDuctBom, false);
  assert.match(caps.reasonFor('routeDucts'), /proposal stage/i);
  // But it may still measure, select and quote on the allowance.
  assert.equal(caps.mayMeasureRooms, true);
  assert.equal(caps.maySelectEquipment, true);
  assert.equal(caps.mayQuoteProposal, true);
});
