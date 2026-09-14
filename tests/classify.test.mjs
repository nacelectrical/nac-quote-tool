// THE ONE ROOM CLASSIFICATION ENGINE.
//
// Every room name Nick listed, plus the abbreviations and punctuation
// Australian builders' plans actually print. The rule this file protects is
// that NAC's answer to "do we air condition this?" lives in exactly one place
// and every engine gets the same answer from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONDITIONING, classifyRoomLabel, roomConditioningStatus, isConditionedRoom,
         isExcludedRoom, needsClassificationReview, classifyRoom, classificationSummary,
         isOutdoorArea, normaliseRoomLabel } from '../designer/engines/classify.mjs';
import { buildRoom, architecturalMeasurement, manualMeasurement, verifyRoom,
         setRoomConditioning, conditionedRooms, excludedRooms,
         isAutoCleared } from '../designer/engines/rooms.mjs';

const cls = (l) => classifyRoomLabel(l).status;
const EXCLUDED = CONDITIONING.NON_CONDITIONED;
const COND = CONDITIONING.CONDITIONED;
const REVIEW = CONDITIONING.REVIEW_REQUIRED;

// ── Every name on Nick's list ───────────────────────────────────────────────

test('every room NAC named as excluded is excluded', () => {
  const list = [
    'Bathroom', 'Bath', 'Ensuite', 'En-suite', 'WC', 'W.C.', 'Toilet',
    'Powder room', 'Laundry', 'Garage', 'Carport', 'Alfresco', 'Porch',
    'Patio', 'Verandah', 'Pantry', "Butler's pantry", 'WIP', 'Walk-in pantry',
    'WIR', 'W.I.R.', 'BIR', 'B.I.R.', 'Robe', 'Wardrobe', 'Cupboard',
    "CUP'D", 'CUPB', 'CPD', 'Broom cupboard', 'Linen', 'Store', 'Storage',
    'Plant room'
  ];
  for (const label of list) {
    assert.equal(cls(label), EXCLUDED, label + ' should be excluded');
  }
});

test('the abbreviations and punctuation a real plan prints', () => {
  const list = ["L'DRY", 'LDRY', 'L.DRY', "P'TRY", 'PTRY', 'ENS', 'PDR',
                'En suite', 'Walk in robe', 'Built-in robe', 'BATH RM',
                'Store room', 'Car port', 'COVERED ALFRESCO', 'Veranda'];
  for (const label of list) {
    assert.equal(cls(label), EXCLUDED, label + ' should be excluded');
  }
});

test('every habitable room is conditioned', () => {
  const list = ['Living', 'Lounge', 'Family', 'Rumpus', 'Kitchen', 'Meals',
                'Dining', 'Master Bedroom', 'Bed 1', 'Bed 2', 'BEDROOM 4',
                'Guest bedroom', 'Nursery', 'Study', 'Office', 'Media',
                'Theatre', 'Foyer', 'Entry', 'Hallway', 'Passage', 'Retreat'];
  for (const label of list) {
    assert.equal(cls(label), COND, label + ' should be conditioned');
  }
});

test('a room name NAC has no rule for is conditioned, not excluded', () => {
  // The rule is a list of what is NOT conditioned. Anything else is — and
  // sending the estimator a question about every unusual room name is the
  // noise this engine exists to remove.
  for (const label of ['Gym', 'Sunroom', 'Cellar', 'Snug', 'Room 1', 'Bonus room']) {
    assert.equal(cls(label), COND, label);
  }
});

// ── RULE 3: open-plan and compound labels ───────────────────────────────────

test('an open-plan living area is conditioned whole', () => {
  for (const label of ['Kitchen / Living / Dining', 'Kitchen/Meals/Family',
                       'Living / Dining', 'LIVING/DINING', 'Family/Meals']) {
    assert.equal(cls(label), COND, label);
  }
});

test('KITCHEN is not dragged out by the PANTRY beside it', () => {
  assert.equal(cls('Kitchen'), COND);
  assert.equal(cls('Pantry'), EXCLUDED);
  assert.equal(cls('Kitchen / Pantry'), COND, 'the kitchen is the room; the pantry is in it');
  assert.equal(cls("Kitchen + Butler's Pantry"), COND);
});

test('a bedroom with a robe in it is still a bedroom', () => {
  for (const label of ['BED 3 / ROBE', 'MASTER BEDROOM + WIR', 'Bedroom 2 with BIR',
                       'Bed 1 / W.I.R.', 'Master / Robe']) {
    assert.equal(cls(label), COND, label);
  }
});

test('a bedroom compounded with a WET area is a judgement call, not a guess', () => {
  // A robe is a fitting inside the room. An ensuite is a separate wet area
  // behind a door — assuming either way would be wrong, so it is asked.
  assert.equal(cls('Bed 1 / Ensuite'), REVIEW);
  assert.equal(cls('Master Bedroom & Ensuite'), REVIEW);
});

test('an unnamed room is asked about, never silently dropped', () => {
  assert.equal(cls(''), REVIEW);
  assert.equal(cls(null), REVIEW);
  assert.equal(cls('   '), REVIEW);
});

test('a hyphen never turns an ensuite into a conditioned room', () => {
  // This one shipped: /\bensuite\b/ does not match "En-suite", so a plan that
  // hyphenated it put a wet area into the load.
  for (const label of ['En-suite', 'EN-SUITE', 'En–suite', 'ensuite', 'ENSUITE']) {
    assert.equal(cls(label), EXCLUDED, label);
  }
});

test('dotted initialisms read the same as their plain spelling', () => {
  assert.equal(normaliseRoomLabel('W.I.R.'), 'WIR');
  assert.equal(cls('W.I.R.'), cls('WIR'));
  assert.equal(cls('B.I.R.'), cls('BIR'));
  assert.equal(cls('W.C.'), cls('WC'));
});

// ── Outdoor is a separate question from conditioned ─────────────────────────

test('outdoor is not the same question as conditioned', () => {
  assert.ok(isOutdoorArea('Alfresco'));
  assert.ok(isOutdoorArea('Garage'));
  assert.ok(!isOutdoorArea('Bathroom'), 'a bathroom is excluded but very much indoors');
  assert.equal(cls('Bathroom'), EXCLUDED);
});

// ── RULE 1: an excluded room never asks for anything ────────────────────────

test('an excluded room with no readable size is Excluded, not "needs a dimension"', () => {
  // The onsite failure: ENSUITE, WC, PORCH, ALFRESCO and CUP'D all carried no
  // printed size, and every one of them sat in the queue asking the estimator
  // for dimensions that would never be used.
  for (const label of ['ENSUITE', 'WC', 'PORCH', 'COVERED ALFRESCO', "CUP'D", "P'TRY"]) {
    const r = buildRoom({ label, measurement: architecturalMeasurement(null, null, []) });
    assert.equal(r.conditioningStatus, EXCLUDED, label);
    assert.equal(r.status, 'Excluded', label + ' status');
    assert.equal(r.conditioned, false, label);
  }
});

test('an excluded room is never sizable and never blocks', () => {
  const bath = buildRoom({ label: 'BATH', measurement: manualMeasurement(2900, 1400) });
  assert.equal(isExcludedRoom(bath), true);
  assert.equal(isAutoCleared(bath), false);
  assert.equal(conditionedRooms([bath]).length, 0);
  assert.equal(excludedRooms([bath]).length, 1);
});

// ── The estimator's override ────────────────────────────────────────────────

test('the estimator can condition an excluded room for one job', () => {
  const garage = buildRoom({ label: 'GARAGE', measurement: manualMeasurement(6000, 6900) });
  assert.equal(garage.conditioned, false);

  const on = setRoomConditioning(garage, CONDITIONING.CONDITIONED);
  assert.equal(on.conditioningStatus, COND);
  assert.equal(on.conditioned, true);
  assert.equal(on.conditioningSource, 'estimator');
  assert.notEqual(on.status, 'Excluded');
  assert.ok(on.overrides.some(o => o.field === 'conditioningStatus'));
});

test('an override survives the label being re-read', () => {
  const laundry = setRoomConditioning(
    buildRoom({ label: 'LAUNDRY', measurement: manualMeasurement(2900, 2300) }),
    CONDITIONING.CONDITIONED);
  // The plan reader hands the same room back; the label still says LAUNDRY.
  const reread = buildRoom({ label: 'LAUNDRY', measurement: manualMeasurement(2900, 2300),
                             conditioningOverride: laundry.conditioningOverride });
  assert.equal(reread.conditioned, true, 'the estimator’s call must not be re-derived away');
  assert.equal(reread.conditioningSource, 'estimator');
});

test('an override the other way excludes a room NAC would normally condition', () => {
  const study = buildRoom({ label: 'STUDY', measurement: manualMeasurement(2800, 2600) });
  assert.equal(study.conditioned, true);
  const off = setRoomConditioning(study, CONDITIONING.NON_CONDITIONED);
  assert.equal(off.conditioned, false);
  assert.equal(off.status, 'Excluded');
});

test('setRoomConditioning refuses a status that is not an answer', () => {
  const r = buildRoom({ label: 'STUDY', measurement: manualMeasurement(2800, 2600) });
  assert.throws(() => setRoomConditioning(r, CONDITIONING.REVIEW_REQUIRED));
  assert.throws(() => setRoomConditioning(r, 'maybe'));
});

// ── One field, one answer ───────────────────────────────────────────────────

test('conditioned is always derived from the status, never set on its own', () => {
  // A room handed in claiming to be conditioned while its status says otherwise
  // is the disagreement that put a bathroom in the router.
  const r = classifyRoom({ label: 'BATH', conditioned: true,
                           conditioningStatus: CONDITIONING.NON_CONDITIONED });
  assert.equal(r.conditioned, false, 'the status wins');
  assert.equal(isConditionedRoom(r), false);
});

test('a room carrying only the old boolean still answers', () => {
  assert.equal(roomConditioningStatus({ label: 'X', conditioned: true }), COND);
  assert.equal(roomConditioningStatus({ label: 'X', conditioned: false }), EXCLUDED);
});

test('an override outranks both the status and the label', () => {
  assert.equal(roomConditioningStatus({
    label: 'GARAGE', conditioned: false,
    conditioningStatus: CONDITIONING.NON_CONDITIONED,
    conditioningOverride: CONDITIONING.CONDITIONED
  }), COND);
});

test('REVIEW_REQUIRED is not quietly treated as excluded', () => {
  const r = classifyRoom({ label: '' });
  assert.equal(needsClassificationReview(r), true);
  assert.equal(isConditionedRoom(r), false, 'it does not join the design unasked');
  assert.equal(isExcludedRoom(r), false, 'nor is it dropped as if the answer were no');
});

test('verifying a room never changes what it is', () => {
  const bath = verifyRoom(buildRoom({ label: 'BATH', measurement: manualMeasurement(2900, 1400) }));
  assert.equal(bath.status, 'Excluded', 'verifying an excluded room does not condition it');
  assert.equal(bath.conditioned, false);
});

// ── The counts the UPLOAD screen shows ──────────────────────────────────────

test('the real sheet reads as 11 conditioned and 9 excluded', () => {
  const SHEET = [
    'LIVING', 'KITCHEN', 'MEALS', 'LOUNGE', 'FAMILY', 'STUDY', 'FOYER',
    'MASTER BEDROOM', 'BEDROOM 4', 'BEDROOM 2', 'BEDROOM 3',
    'ENSUITE', 'WC', "L'DRY", 'BATH', 'GARAGE', 'COVERED ALFRESCO', 'PORCH',
    "P'TRY", "CUP'D"
  ];
  const rooms = SHEET.map(label =>
    buildRoom({ label, measurement: architecturalMeasurement(3000, 3000, []) }));
  const c = classificationSummary(rooms);
  assert.equal(c.total, 20);
  assert.equal(c.conditionedCount, 11);
  assert.equal(c.excludedCount, 9);
  assert.equal(c.reviewCount, 0);
  // Grouped, so the screen can say "1 Bathroom, 1 Laundry, 1 Garage…" rather
  // than nine lines the estimator does not care about.
  assert.equal(Object.keys(c.excludedByKind).length, 9);
});
