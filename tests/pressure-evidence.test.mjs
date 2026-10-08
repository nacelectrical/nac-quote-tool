// ─────────────────────────────────────────────────────────────────────────────
// A PRESSURE CHECK IS ONLY AS GOOD AS ITS METRES
//
// Two findings from the independent review, both about the same thing: a
// static pressure result that READ as a pass with nothing real behind it.
//
//   "zero measured duct length despite a passed pressure check"
//   "unreliable scale calibration using a drawn car"
//
// The first was gated in the pipeline (supply-graph.pressureReadiness) but not
// in the engine, so any other caller was still told the check passed. The
// second was not gated anywhere: a plan scaled off a car produces lengths that
// are not zero, so a length check cannot see them. Only the scale's ORIGIN can.
//
// Nick: the AI must never invent engineering data. A metre that came from a
// drawn car is invented data wearing a decimal point.
//
// Three states, never two. `not_completed` is not a pass and is not a fail.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeSection } from '../designer/engines/ducts.mjs';
import { estimateStaticPressure } from '../designer/engines/pressure.mjs';
import { scaleTrust, SCALE_CONFIDENCE, calibrate, deriveCalibrationFromRooms }
  from '../designer/engines/calibration.mjs';

/** A three-section index run with every length the same, or unmeasured. */
const network = (lengthMm) => ({ routed: false, sections: [
  sizeSection({ id: 'main_a',    role: 'main',   destination: 'Main A', airflowLs: 400, lengthMm }),
  sizeSection({ id: 'branch_a',  role: 'branch', destination: 'Bed 1',  airflowLs: 120, lengthMm }),
  sizeSection({ id: 'final_a_1', role: 'final',  destination: 'Bed 1',  airflowLs: 60,  lengthMm })
]});

const REST = {
  returnDesign: { duct: { lengthPerDuctM: 6, diameterMm: 400, ductCount: 1 },
                  returns: [{ grilleSize: '500x400' }], filter: { size: '500x400' } },
  outlets: { rows: [{ label: 'Bed 1', type: 'diffuser', typeLabel: 'Ceiling diffuser' }] },
  // A unit WITH a manufacturer static figure, so the only thing that can stop
  // the check completing is the evidence behind the metres.
  selectedUnit: { model: 'TEST-UNIT', availableStaticPa: 260 },
  zoneAnalysis: { zoneCount: 3 }
};

/** Scaled by eye off something drawn on the plan. The Kauri case. */
const CAR = { pixelsPerMm: 0.42, source: 'car_in_driveway' };
/** Two points clicked against a 9 m dimension printed on the drawing. */
const MEASURED = { pixelsPerMm: 0.42, source: 'measured', calibrationDistanceMm: 9000 };

const codes = (r) => r.warnings.map(w => w.code);

test('zero measured length is never a pass', () => {
  const r = estimateStaticPressure({ network: network(null), calibration: null, ...REST });
  // The sum is not small — it is the fixed component allowances with no duct
  // in it at all, which is exactly why it looked like a comfortable margin.
  assert.ok(r.estimatedRequirementPa > 0);
  assert.equal(r.checkCompleted, false);
  assert.equal(r.status, 'not_completed');
  assert.notEqual(r.status, 'pass');
  assert.match(r.statusLabel, /DUCT LENGTHS HAVE NOT BEEN MEASURED/);
  assert.ok(codes(r).includes('STATIC_PRESSURE_LENGTH_NOT_MEASURED'));
  assert.equal(r.lengthEvidence.ok, false);
  assert.equal(r.lengthEvidence.measuredSegments, 0);
  assert.equal(r.lengthEvidence.unmeasuredSegments, 3);
});

test('one unmeasured run on the index path is enough to stop the check', () => {
  const net = network(6000);
  net.sections[1] = sizeSection({ id: 'branch_a', role: 'branch', destination: 'Bed 1',
                                  airflowLs: 120, lengthMm: null });
  const r = estimateStaticPressure({ network: net, calibration: MEASURED, ...REST });
  assert.equal(r.status, 'not_completed');
  assert.equal(r.lengthEvidence.unmeasuredSegments, 1);
  assert.match(r.lengthEvidence.reason, /1 of 3/);
  assert.match(r.lengthEvidence.reason, /Bed 1/);
});

test('a scale taken off a drawn car does not authorise a pass', () => {
  const measured = estimateStaticPressure({ network: network(6000), calibration: MEASURED, ...REST });
  const car = estimateStaticPressure({ network: network(6000), calibration: CAR, ...REST });

  // Identical metres, identical Pa. The ONLY difference is where the scale
  // came from, and that is the difference between a verdict and a guess.
  assert.equal(car.estimatedRequirementPa, measured.estimatedRequirementPa);
  assert.equal(measured.status, 'pass');
  assert.equal(car.status, 'not_completed');
  assert.equal(car.checkCompleted, false);
  assert.match(car.statusLabel, /PLAN SCALE IS NOT RELIABLE/);
  assert.ok(codes(car).includes('STATIC_PRESSURE_SCALE_NOT_RELIABLE'));
  assert.equal(car.lengthEvidence.scaleConfidence, SCALE_CONFIDENCE.UNTRUSTED);
});

test('a px/mm number with no recorded origin is refused too', () => {
  // This is what a scale restored from an old save looks like when nothing
  // recorded how it was arrived at. Trusting it is trusting a stranger.
  const r = estimateStaticPressure({ network: network(6000),
    calibration: { pixelsPerMm: 0.42 }, ...REST });
  assert.equal(r.status, 'not_completed');
  assert.ok(codes(r).includes('STATIC_PRESSURE_SCALE_NOT_RELIABLE'));
});

test('lengths entered by hand do not need a plan scale', () => {
  // The manual fallback must never be blocked for want of a calibration —
  // "the estimator must never be blocked" cuts both ways. No calibration on
  // the design means the metres did not come off the image.
  const r = estimateStaticPressure({ network: network(6000), calibration: null, ...REST });
  assert.equal(r.status, 'pass');
  assert.equal(r.lengthEvidence.ok, true);
  assert.equal(r.lengthEvidence.scaleConfidence, null);
});

test('no index run at all is not a pass', () => {
  const r = estimateStaticPressure({ network: { routed: false, sections: [] },
    calibration: MEASURED, ...REST });
  assert.equal(r.status, 'not_completed');
  assert.ok(codes(r).includes('STATIC_PRESSURE_NO_INDEX_RUN'));
});

test('a genuine overload is still a fail, not a "not completed"', () => {
  const r = estimateStaticPressure({ network: network(60000), calibration: MEASURED,
    ...REST, selectedUnit: { model: 'TEST-UNIT', availableStaticPa: 40 } });
  assert.equal(r.status, 'fail');
  assert.equal(r.checkCompleted, true);
});

// ── THE SCALE ITSELF ────────────────────────────────────────────────────────

test('scaleTrust accepts only a plan dimension or agreeing dimensioned rooms', () => {
  assert.equal(scaleTrust(null).confidence, SCALE_CONFIDENCE.NONE);
  assert.equal(scaleTrust({ pixelsPerMm: 0 }).confidence, SCALE_CONFIDENCE.NONE);

  for (const bad of [
    { pixelsPerMm: 0.4 },                                   // no origin
    { pixelsPerMm: 0.4, source: 'car_in_driveway' },         // an illustration
    { pixelsPerMm: 0.4, source: 'scale_label' },             // a printed label
    { pixelsPerMm: 0.4, source: 'measured' },                // no distance behind it
    { pixelsPerMm: 0.4, source: 'derived_from_dimensioned_rooms' }  // no readings
  ]) {
    const t = scaleTrust(bad);
    assert.equal(t.trusted, false, JSON.stringify(bad) + ' was trusted');
    assert.equal(t.confidence, SCALE_CONFIDENCE.UNTRUSTED);
    assert.ok(t.reason.length > 20, 'a refusal with no reason is not actionable');
  }
});

test('a real two-point calibration carries its evidence and is trusted', () => {
  const c = calibrate({ pointA: { x: 100, y: 100 }, pointB: { x: 400, y: 100 },
                        knownDistance: 9, unit: 'm', imageWidthPx: 2000, imageHeightPx: 1400 });
  assert.ok(!c.error, c.error);
  const t = scaleTrust(c);
  assert.equal(t.trusted, true);
  assert.equal(t.confidence, SCALE_CONFIDENCE.HIGH);
  assert.equal(t.source, 'measured');
  assert.equal(t.evidence.length, 1);
  assert.match(t.evidence[0], /9 m/);
});

test('rooms that disagree downgrade the derived scale rather than averaging it away', () => {
  // Two rooms whose printed sizes and drawn boundaries agree closely.
  const tight = deriveCalibrationFromRooms([
    { id: 'r1', label: 'Lounge', boundaryPx: { w: 400, h: 300 },
      measurement: { source: 'verified_architectural', widthMm: 4000, lengthMm: 3000 } },
    { id: 'r2', label: 'Bed 1', boundaryPx: { w: 300, h: 300 },
      measurement: { source: 'verified_architectural', widthMm: 3000, lengthMm: 3000 } }
  ], { imageWidthPx: 2000, imageHeightPx: 1400 });
  assert.equal(tight.ok, true, tight.reason);
  const t = scaleTrust(tight.calibration);
  assert.equal(t.trusted, true);
  assert.equal(t.confidence, SCALE_CONFIDENCE.HIGH);
  assert.ok(t.evidence.length >= 2, 'the readings behind the scale are not recorded');

  // Readings that spread are still usable, but they are not "high".
  const loose = scaleTrust({ pixelsPerMm: 0.1, source: 'derived_from_dimensioned_rooms',
                             derivedFrom: ['Lounge: …', 'Bed 1: …'], agreementSpreadPct: 9.4 });
  assert.equal(loose.trusted, true);
  assert.equal(loose.confidence, SCALE_CONFIDENCE.MODERATE);
});
