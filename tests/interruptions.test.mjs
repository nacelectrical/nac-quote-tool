// QUICK QUOTE MODE lives or dies on this module.
//
// The promise is "upload the plan and let NAC AI do the job". Every question
// the tool asks that it could have answered itself breaks that promise; every
// question it fails to ask sends out a wrong quote. These tests hold both ends.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectInterruptions, INTERRUPT, FIX_IN } from '../designer/engines/interruptions.mjs';

/** A design where nothing is wrong. The tool must not ask anything at all. */
const clean = (over = {}) => ({
  plan: { widthPx: 1000, heightPx: 700 },
  calibration: { pixelsPerMm: 0.3 },
  stage: 'complete',
  rooms: [{ id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12, status: 'Verified' }],
  selectedUnit: { brandName: 'Daikin', model: 'FDYA100', phase: '1Ph', supplierCost: 4000 },
  pressure: { checkCompleted: true, status: 'pass' },
  network: { sections: [{ id: 'main', destination: 'Supply plenum', lengthMm: 3400 }] },
  bom: { unpricedCount: 0, placeholderCount: 0 },
  commercials: { jobFee: 6000 },
  warnings: [],
  ...over
});

const ids = (r) => r.all.map(x => x.id);
const find = (r, prefix) => r.all.find(x => x.id.startsWith(prefix));

// ── The quiet case, which is the whole point ────────────────────────────────

test('a design with nothing wrong interrupts the estimator with NOTHING', () => {
  const r = collectInterruptions(clean());
  assert.deepEqual(r.all, [], 'a clean design must ask zero questions: ' + JSON.stringify(ids(r)));
  assert.equal(r.canQuote, true);
  assert.equal(r.canAutoProceed, true);
  assert.match(r.summary, /Nothing needs you/);
});

test('a room the tool measured confidently is not worth a question', () => {
  // HIGH confidence and verified — the plan answered it, so do not ask.
  const r = collectInterruptions(clean({
    rooms: [{ id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12,
              status: 'Verified', confidenceBand: 'HIGH', confidence: 96 }]
  }));
  assert.equal(r.all.length, 0);
});

test('rooms NAC never counts are never asked about', () => {
  // Bathrooms, ensuites, laundry and the garage are not conditioned, so an
  // unmeasured one is not a problem and must not stop a quote.
  const r = collectInterruptions(clean({
    rooms: [
      { id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12, status: 'Verified' },
      { id: 'r2', label: 'BATH', conditioned: false },
      { id: 'r3', label: 'GARAGE', conditioned: false }
    ]
  }));
  assert.equal(r.all.length, 0);
});

// ── The four interruptions Nick named ───────────────────────────────────────

test('"Study dimensions could not be verified"', () => {
  const r = collectInterruptions(clean({
    rooms: [{ id: 'r1', label: 'STUDY', conditioned: true, areaSqM: 9,
              confidenceBand: 'LOW', confidence: 41 }]
  }));
  const i = find(r, 'ROOM_LOW_CONFIDENCE');
  assert.ok(i, 'a LOW confidence room must interrupt');
  assert.match(i.title, /STUDY dimensions could not be verified/);
  assert.equal(i.level, INTERRUPT.BLOCKING);
  assert.equal(i.fixIn, FIX_IN.ROOMS);
  assert.equal(i.roomId, 'r1', 'the estimator must be taken to the right room');
});

test('"Electrical phase not confirmed"', () => {
  const r = collectInterruptions(clean({
    selectedUnit: { brandName: 'Daikin', model: 'FDYA200', phase: '3Ph', supplierCost: 6000 },
    sitePhase: null
  }));
  const i = find(r, 'PHASE_UNCONFIRMED');
  assert.ok(i);
  assert.equal(i.level, INTERRUPT.CONFIRM);
  assert.match(i.detail, /three-phase/);
});

test('a single-phase unit never raises the phase question', () => {
  const r = collectInterruptions(clean());
  assert.equal(find(r, 'PHASE_UNCONFIRMED'), undefined);
});

test('a three-phase unit on a confirmed three-phase site is not asked again', () => {
  const r = collectInterruptions(clean({
    selectedUnit: { brandName: 'Daikin', model: 'FDYA200', phase: '3Ph', supplierCost: 6000 },
    sitePhase: '3Ph'
  }));
  assert.equal(find(r, 'PHASE_UNCONFIRMED'), undefined);
});

test('"Supplier cost missing"', () => {
  const r = collectInterruptions(clean({
    selectedUnit: { brandName: 'Braemar', model: 'KDHA070', phase: '1Ph', supplierCost: null }
  }));
  const i = find(r, 'UNIT_NO_COST');
  assert.ok(i);
  assert.equal(i.level, INTERRUPT.BLOCKING, 'a quote cannot be built on an uncosted unit');
  assert.match(i.title, /Braemar KDHA070/);
  assert.equal(r.canQuote, false);
});

test('"Route requires site verification"', () => {
  const r = collectInterruptions(clean({ autoRoute: { generated: true, confidence: 'MEDIUM' } }));
  const i = find(r, 'AUTO_ROUTE_UNVERIFIED');
  assert.ok(i);
  assert.equal(i.level, INTERRUPT.CONFIRM, 'an auto route must never block, but must never be silent');
  assert.match(i.detail, /trusses/);
  assert.equal(i.confidence, 'MEDIUM');
  assert.equal(r.canQuote, true, 'an unverified route does not stop a quote being produced');
  assert.equal(r.canAutoProceed, false, 'but it does stop the tool sliding past it silently');
});

// ── Things that must stop a quote ───────────────────────────────────────────

test('a static pressure check that could not be carried out is never a pass', () => {
  const r = collectInterruptions(clean({
    pressure: { checkCompleted: false, status: 'not_completed',
                statusLabel: 'STATIC PRESSURE CHECK NOT COMPLETED — MANUFACTURER DATA REQUIRED' }
  }));
  const i = find(r, 'PRESSURE_NOT_COMPLETED');
  assert.ok(i);
  assert.equal(i.level, INTERRUPT.BLOCKING);
  assert.match(i.detail, /MANUFACTURER DATA REQUIRED/);
});

test('a system that will not make its airflow stops the quote', () => {
  const r = collectInterruptions(clean({
    pressure: { checkCompleted: true, status: 'fail',
                estimatedRequirementPa: 180, unitAvailableStaticPa: 120 }
  }));
  const i = find(r, 'PRESSURE_FAIL');
  assert.ok(i);
  assert.match(i.detail, /180 Pa/);
  assert.match(i.detail, /120 Pa/);
});

test('a material line with no price stops the quote and names the line', () => {
  const r = collectInterruptions(clean({
    bom: { unpricedCount: 2, unpricedLabels: ['Zone motor 150 mm', 'Zone motor 125 mm'] }
  }));
  const i = find(r, 'BOM_UNPRICED');
  assert.equal(i.level, INTERRUPT.BLOCKING);
  assert.match(i.detail, /Zone motor 150 mm/);
});

test('placeholder rates are confirmed, not blocked, and say what they are worth', () => {
  const r = collectInterruptions(clean({
    bom: { unpricedCount: 0, placeholderCount: 19, placeholderValue: 812.5 }
  }));
  const i = find(r, 'BOM_PLACEHOLDER');
  assert.equal(i.level, INTERRUPT.CONFIRM);
  assert.match(i.detail, /\$812\.5/);
  assert.equal(r.canQuote, true);
});

test('a job with no fee is sold at cost, so it blocks', () => {
  const r = collectInterruptions(clean({ commercials: { jobFee: null } }));
  assert.equal(find(r, 'NO_JOB_FEE').level, INTERRUPT.BLOCKING);
});

// ── Duct lengths ────────────────────────────────────────────────────────────

test('no duct lengths at all is a blocker', () => {
  const r = collectInterruptions(clean({
    network: { sections: [{ id: 'main', destination: 'Supply plenum', lengthMm: null }] }
  }));
  assert.equal(find(r, 'NO_DUCT_LENGTHS').level, INTERRUPT.BLOCKING);
});

test('some runs unmeasured is a confirm that names them', () => {
  const r = collectInterruptions(clean({
    network: { sections: [
      { id: 'main', destination: 'Supply plenum', lengthMm: 3400 },
      { id: 'branch_bed1', destination: 'BED 1', lengthMm: null }
    ] }
  }));
  const i = find(r, 'SOME_DUCT_LENGTHS');
  assert.equal(i.level, INTERRUPT.CONFIRM);
  assert.match(i.detail, /BED 1/);
});

// ── Order, and getting started ──────────────────────────────────────────────

test('with no plan the tool asks for the plan and stops asking anything else', () => {
  const r = collectInterruptions({ });
  assert.equal(r.all.length, 1);
  assert.equal(r.all[0].id, 'NO_PLAN');
});

test('an uncalibrated plan blocks, because no measurement on it can be trusted', () => {
  const r = collectInterruptions(clean({ calibration: null }));
  const i = find(r, 'NO_CALIBRATION');
  assert.equal(i.level, INTERRUPT.BLOCKING);
  assert.match(i.detail, /screenshot/);
});

test('an unacknowledged critical warning is surfaced even if nothing else caught it', () => {
  const r = collectInterruptions(clean({
    warnings: [{ code: 'SYSTEM_UNDERSIZED', severity: 'CRITICAL',
                 message: 'Selected unit is below the calculated load.', stage: 'equipment' }]
  }));
  const i = find(r, 'WARNING:SYSTEM_UNDERSIZED');
  assert.ok(i, 'a critical warning must never be swallowed by quick mode');
  assert.equal(i.level, INTERRUPT.BLOCKING);
});

test('an acknowledged critical warning is not raised again', () => {
  const r = collectInterruptions(clean({
    warnings: [{ code: 'SYSTEM_UNDERSIZED', severity: 'CRITICAL', message: 'x', acknowledged: true }]
  }));
  assert.equal(r.all.length, 0);
});

test('a CHECK level warning never interrupts quick mode', () => {
  const r = collectInterruptions(clean({
    warnings: [{ code: 'DUCT_VELOCITY_ABOVE_PREFERRED', severity: 'CHECK', message: 'x' }]
  }));
  assert.equal(r.all.length, 0, 'quick mode must not stop for a CHECK');
});

test('every interruption says where to fix it', () => {
  const r = collectInterruptions(clean({
    rooms: [{ id: 'r1', label: 'STUDY', conditioned: true, areaSqM: 9, confidenceBand: 'LOW' }],
    selectedUnit: { brandName: 'X', model: 'Y', phase: '3Ph', supplierCost: null },
    pressure: { checkCompleted: false },
    bom: { unpricedCount: 1, unpricedLabels: ['Zone motor'] , placeholderCount: 3, placeholderValue: 90 },
    autoRoute: { generated: true }
  }));
  assert.ok(r.all.length >= 5);
  for (const i of r.all) {
    assert.ok(i.fixIn, i.id + ' has nowhere to go');
    assert.ok(i.title && i.detail, i.id + ' does not explain itself');
  }
});

// ── The policy that makes quick mode quick ──────────────────────────────────

test('a room read at HIGH confidence is not a question at all', () => {
  // The plan answered it. Asking anyway is the friction the whole mode exists
  // to remove.
  const r = collectInterruptions(clean({
    rooms: [{ id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12,
              confidenceBand: 'HIGH', confidence: 96, status: 'Auto' }]
  }));
  assert.equal(r.all.length, 0, JSON.stringify(ids(r)));
});

test('a MEDIUM room is one grouped glance, not one question per room', () => {
  const r = collectInterruptions(clean({
    rooms: [
      { id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12, confidenceBand: 'MEDIUM' },
      { id: 'r2', label: 'BED 2', conditioned: true, areaSqM: 11, confidenceBand: 'MEDIUM' },
      { id: 'r3', label: 'BED 3', conditioned: true, areaSqM: 10, confidenceBand: 'MEDIUM' }
    ]
  }));
  assert.equal(r.all.length, 1, 'three rooms must be one line, not three');
  assert.equal(r.all[0].id, 'ROOMS_UNVERIFIED');
  assert.equal(r.all[0].level, INTERRUPT.CONFIRM);
  assert.deepEqual(r.all[0].roomIds, ['r1', 'r2', 'r3'],
    'confirming has to know which rooms to accept');
});

test('a LOW room is named on its own and blocks', () => {
  const r = collectInterruptions(clean({
    rooms: [
      { id: 'r1', label: 'BED 1', conditioned: true, areaSqM: 12, confidenceBand: 'HIGH' },
      { id: 'r2', label: 'STUDY', conditioned: true, areaSqM: 9, confidenceBand: 'LOW' }
    ]
  }));
  assert.equal(r.all.length, 1);
  assert.match(r.all[0].title, /STUDY/);
  assert.equal(r.all[0].level, INTERRUPT.BLOCKING);
});

test('a room already verified is never asked about again, whatever its band', () => {
  for (const band of ['LOW', 'MEDIUM', 'HIGH']) {
    const r = collectInterruptions(clean({
      rooms: [{ id: 'r1', label: 'X', conditioned: true, areaSqM: 9,
                confidenceBand: band, status: 'Verified' }]
    }));
    assert.equal(r.all.length, 0, band + ' asked again after being verified');
  }
});
