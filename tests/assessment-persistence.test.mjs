// ─────────────────────────────────────────────────────────────────────────────
// THE ASSESSMENT SURVIVED THE DUCT DESIGNER'S REMOVAL, AND HAS TO KEEP DOING
//
// Nick, 8 November 2026: "Duct routing, BTO design and drawing tools must stay
// retired. Plan upload, room/area assessment and preliminary equipment sizing
// are still required. Inspect whether those capabilities remain."
//
// They do. tests/designer-removed.test.mjs already walks the import graph and
// proves the duct engines are unreachable; this is the other half of that
// question — that what was KEPT still works, is still wired into a screen, and
// still SAVES. A capability that computes correctly and does not persist is a
// site visit somebody has to do twice.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preliminarySizing, sizingReadiness, ESTIMATING_RULES }
  from '../designer/engines/plan-sizing.mjs';
import { normaliseQuoteDraft } from '../designer/engines/quote-draft.mjs';
import { buildRoom, manualMeasurement } from '../designer/engines/rooms.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { siteChecksFromReadiness } from '../designer/engines/handover.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const S = { settings: DEFAULT_SETTINGS };

/** Rooms as the plan step builds them: measured, and one that is not. */
function rooms() {
  return [
    buildRoom({ id: 'r1', label: 'Living',
                measurement: manualMeasurement(5000, 6400, 'Tape on site') }, S),
    buildRoom({ id: 'r2', label: 'Bed 1',
                measurement: manualMeasurement(3600, 3400, 'Tape on site') }, S),
    // Conditioned, in the job, and nobody knows how big it is. The interesting
    // case, and the one that has to reach the crew.
    buildRoom({ id: 'r3', label: 'Bed 3' }, S),
    // Never counted. Nick: "dont count bathrooms, ensuites, laundry or garage".
    buildRoom({ id: 'r4', label: 'Double garage',
                measurement: manualMeasurement(6000, 6000, 'Tape on site') }, S)
  ];
}

// ── THE CAPABILITY IS STILL THERE ──────────────────────────────────────────

test('preliminary sizing still runs, on conditioned rooms only', () => {
  const out = preliminarySizing(rooms(), S);
  const counted = out.rooms.map(r => r.label);
  assert.ok(counted.includes('Living'));
  assert.ok(!counted.includes('Double garage'), 'the garage is never conditioned');
  assert.ok(!counted.includes('Bed 3'), 'a room with no dimension cannot be sized from');
  assert.equal(out.isEstimate, true, 'it is an estimate and says so, every time');
  assert.ok(out.estimates.areaRule.kw > 0);
  assert.ok(out.recommendedKw > 0);
});

test('both estimates are produced every time, so neither goes unquestioned', () => {
  const out = preliminarySizing(rooms(), { ...S, method: ESTIMATING_RULES.PER_ROOM });
  assert.ok(out.estimates.areaRule, 'NAC’s W/m² rule');
  assert.ok(out.estimates.perRoom, 'the room-by-room estimate');
});

test('the assumptions are reported, not buried', () => {
  // Nick: "Show assumptions, uncertain dimensions and required site checks."
  const out = preliminarySizing(rooms(), S);
  assert.ok(Array.isArray(out.assumptions) && out.assumptions.length > 0);
  for (const a of out.assumptions) {
    assert.ok(a.label && a.value !== undefined && a.source,
      'every assumption needs a value and a source: ' + JSON.stringify(a));
  }
});

test('an uncertain dimension is named, with the reason', () => {
  const out = preliminarySizing(rooms(), S);
  assert.equal(out.unmeasured.length, 1);
  assert.equal(out.unmeasured[0].label, 'Bed 3');
  assert.match(out.unmeasured[0].reason, /No dimension has been read or entered/);
});

test('required site checks come out of the sizing and reach the handover', () => {
  // This is the repair. The readiness notes were shown on the sizing step and
  // went no further: the crew who turn up to install never saw them.
  const ready = sizingReadiness(preliminarySizing(rooms(), S));
  assert.ok(ready.notes.some(n => n.code === 'ROOM_NOT_MEASURED'));
  const checks = siteChecksFromReadiness(ready);
  assert.ok(checks.length > 0, 'a readiness note has to become a site check');
  assert.ok(checks.every(c => c.resolved === false));
  assert.ok(checks.some(c => /Bed 3/.test(c.what)));
});

test('no room measured at all is CRITICAL, not a zero-kilowatt answer', () => {
  const out = preliminarySizing([buildRoom({ id: 'r1', label: 'Living' }, S)], S);
  const ready = sizingReadiness(out);
  assert.equal(ready.ok, false);
  assert.ok(ready.notes.some(n => n.code === 'NO_ROOMS_SIZED'));
  const checks = siteChecksFromReadiness(ready);
  assert.ok(checks.length > 0, 'and it is a job for somebody, not a silent 0 kW');
});

test('an override is kept BESIDE the calculation, never instead of it', () => {
  const out = preliminarySizing(rooms(), {
    ...S, override: { designKw: 18, reason: 'Two storeys, west glass', by: 'Nick' }
  });
  assert.equal(out.recommendedKw, 18);
  assert.ok(out.override.replaced.designKw > 0,
    'the figure it replaced has to still be readable');
  assert.equal(out.override.reason, 'Two storeys, west glass');
});

// ── AND IT PERSISTS ───────────────────────────────────────────────────────

test('rooms, the plan and the sizing choice survive the draft round trip', () => {
  // saveDesign writes `normaliseQuoteDraft(draft)` as JSON and loadDesign reads
  // it back. A field the normaliser drops is a measurement the estimator took
  // on a roof and then took again.
  const before = normaliseQuoteDraft({
    id: 'Q-TEST', rooms: rooms(),
    plan: { src: 'data:image/png;base64,AAA', mediaType: 'image/png', page: 1,
            printedFloorAreaSqM: 212 },
    sizing: { method: ESTIMATING_RULES.AREA_RULE,
              override: { designKw: 16.5, reason: 'Experience', by: 'Nick',
                          at: '2026-11-08T00:00:00.000Z' } },
    enquiryId: 'NAC-TESTCUST-1'
  });

  const after = normaliseQuoteDraft(JSON.parse(JSON.stringify(before)));
  assert.equal(after.rooms.length, 4, 'every room survives');
  assert.equal(after.rooms[0].label, 'Living');
  assert.ok(after.rooms[0].areaSqM > 0, 'and its area with it');
  assert.equal(after.plan.printedFloorAreaSqM, 212,
    'the sheet’s own printed area is what the cross-check needs');
  assert.equal(after.sizing.method, ESTIMATING_RULES.AREA_RULE);
  assert.equal(after.sizing.override.designKw, 16.5);
  assert.equal(after.sizing.override.reason, 'Experience');
  assert.equal(after.enquiryId, 'NAC-TESTCUST-1',
    'the enquiry this assessment came from has to survive the save, or the link '
    + 'can never be written');
});

test('the sizing computed from a reloaded draft is the same sizing', () => {
  const draft = normaliseQuoteDraft({ id: 'Q-T2', rooms: rooms() });
  const first = preliminarySizing(draft.rooms, S);
  const reloaded = normaliseQuoteDraft(JSON.parse(JSON.stringify(draft)));
  const second = preliminarySizing(reloaded.rooms, S);
  assert.equal(second.totalConditionedAreaSqM, first.totalConditionedAreaSqM);
  assert.equal(second.recommendedKw, first.recommendedKw);
});

// ── THE SCREEN STILL HAS IT ────────────────────────────────────────────────

test('the plan step is still wired into the quote screen', () => {
  const builder = readFileSync(ROOT + '/quote-builder.html', 'utf8');
  assert.match(builder, /planStep/, 'the plan and rooms step');
  assert.match(builder, /\/api\/plan-read/, 'the plan reader');
  assert.match(builder, /roomsFromObservations/, 'what turns what it saw into rooms');

  const step = readFileSync(ROOT + '/designer/ui/plan-step.mjs', 'utf8');
  assert.match(step, /preliminarySizing/, 'the sizing panel');
  assert.match(step, /sizingReadiness/, 'and its readiness notes');
  assert.match(step, /What this estimate assumes/, 'the assumptions, on screen');
});

test('the duct designer is still retired, and this suite did not bring it back', () => {
  const designer = readFileSync(ROOT + '/designer.html', 'utf8');
  assert.ok(designer.length < 8000, 'designer.html is a retirement notice, not a tool');
  assert.match(designer, /retired/i);
});
