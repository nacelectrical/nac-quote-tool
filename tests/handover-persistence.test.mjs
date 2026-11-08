// ─────────────────────────────────────────────────────────────────────────────
// THE HANDOVER, AND THE THREE THINGS AN ACCEPTANCE DOES NOT TELL YOU
//
// Nick: "An accepted quote must not automatically imply that a deposit is
// paid, equipment is available or an installation is booked." And: "Never
// display it as successfully synced."
//
// The engine was already right about all of that and NOTHING CALLED IT. There
// was no table, no endpoint and no row: a prepared handover had nowhere to
// live. (My inspection report said handovers were "stored locally". They were
// not stored at all.) This suite covers the editing rules and the stage model
// that the persistence layer is built on; the database half is in
// tests/handover-db.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHandover, updateHandover, recordSync, handoverStage, siteChecksFromReadiness,
  outstandingOf, CONFIRMATION, HANDOVER_STATE, HANDOVER_STAGE
} from '../designer/engines/handover.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** A frozen issued record that has been accepted. */
const ISSUED = {
  token: 'tok-abc123',
  quoteRevision: 2,
  designId: 'Q-20261108-TEST1',
  proposalNumber: 'NAC-2611-TEST',
  offerFingerprint: 'fp-deadbeef',
  customer: { name: 'TEST CUSTOMER (do not contact)', phone: '0400 000 111',
              email: 'test@example.invalid' },
  job: { siteAddress: '7 Example Court, Testville QLD 4000' },
  offer: { inclusions: ['Supply and install', 'Commissioning'],
           exclusions: ['Electrical upgrade'],
           scopeOfWork: { summary: 'Ducted system, six outlets, three zones' } },
  acceptance: {
    customerName: 'TEST CUSTOMER', acceptedAt: '2026-11-08T01:00:00.000Z',
    totalIncGst: 15716, chosenSystemId: 'sys-2',
    selectedOptionIds: ['opt-wifi', 'opt-extra-zone'], signature: 'data:image/png;base64,xx'
  }
};

const SOURCED = (what) => ({ state: CONFIRMATION.CONFIRMED, source: what,
                             at: '2026-11-08T02:00:00.000Z' });

// ── WHAT IT IS BUILT FROM ──────────────────────────────────────────────────

test('a handover is keyed on the token AND the revision', () => {
  // Keying on the token alone would mean a second revision quietly overwrote
  // the handover for the first — a different offer, the same record.
  const h = buildHandover(ISSUED, {});
  assert.equal(h.id, 'tok-abc123:2');
  assert.equal(h.quoteToken, 'tok-abc123');
  assert.equal(h.revision, 2);
});

test('it carries the exact accepted revision, its options and the offer digest', () => {
  const h = buildHandover(ISSUED, {});
  assert.equal(h.accepted.totalIncGst, 15716);
  assert.equal(h.accepted.chosenSystemId, 'sys-2');
  assert.deepEqual(h.accepted.selectedOptionIds, ['opt-wifi', 'opt-extra-zone']);
  assert.equal(h.accepted.signed, true);
  // "Revision 2" is a label; the fingerprint is the offer itself. The crew
  // install what the customer signed for.
  assert.equal(h.offerFingerprint, 'fp-deadbeef');
  // And the scope comes out of the FROZEN record, not a live draft.
  assert.deepEqual(h.scope.inclusions, ['Supply and install', 'Commissioning']);
});

test('nothing is implied by the acceptance', () => {
  const h = buildHandover(ISSUED, {});
  assert.equal(h.deposit.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.equipment.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.scheduling.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.readyToBook, false);
  assert.equal(h.outstanding.length, 3);
  assert.equal(h.sync.state, HANDOVER_STATE.PREPARED);
  assert.match(h.sync.note, /Not sent to ServiceM8/);
});

// ── THE STAGE ──────────────────────────────────────────────────────────────

test('prepared, ready for scheduling and synced are three different answers', () => {
  // Nick: "Clearly distinguish prepared, ready for scheduling and synced."
  // `state` alone could not: it said PREPARED both for a handover with three
  // unchecked facts and for one that was genuinely waiting on a diary entry.
  const fresh = buildHandover(ISSUED, {});
  assert.equal(handoverStage(fresh), HANDOVER_STAGE.PREPARED);

  const ready = updateHandover(fresh, {
    deposit: SOURCED('Xero payment PMT-0099'),
    equipment: SOURCED('MMEM order 44812 delivered'),
    scheduling: SOURCED('Booked with the customer by phone')
  });
  assert.equal(handoverStage(ready), HANDOVER_STAGE.READY_FOR_SCHEDULING);
  assert.equal(ready.readyToBook, true);
  assert.deepEqual(ready.outstanding, []);

  const synced = recordSync(ready, { ok: true, externalId: 'SM8-1234' });
  assert.equal(handoverStage(synced), HANDOVER_STAGE.SYNCED);
  assert.equal(synced.sync.externalId, 'SM8-1234');
});

test('a record claiming to be synced with no job id is not synced', () => {
  // A hand-edited row, or a bad migration. The stage is derived from the id,
  // not from the word, so no screen has to defend itself against one.
  const faked = { ...buildHandover(ISSUED, {}),
    sync: { state: HANDOVER_STATE.SYNCED, externalId: null } };
  assert.equal(handoverStage(faked), HANDOVER_STAGE.FAILED);
  assert.notEqual(handoverStage(faked), HANDOVER_STAGE.SYNCED);
});

test('an "ok" from ServiceM8 with no job id is a failure, not a success', () => {
  const h = buildHandover(ISSUED, {});
  const out = recordSync(h, { ok: true });
  assert.equal(out.sync.externalId, null);
  assert.match(out.sync.lastError, /returned no job id/);
  assert.notEqual(out.state, HANDOVER_STATE.SYNCED);
});

test('retrying stops after three attempts and becomes a person’s problem', () => {
  let h = buildHandover(ISSUED, {});
  for (let i = 0; i < 2; i++) h = recordSync(h, { ok: false, error: 'timeout' });
  assert.equal(h.state, HANDOVER_STATE.PENDING_SYNC);
  h = recordSync(h, { ok: false, error: 'timeout' });
  assert.equal(h.state, HANDOVER_STATE.FAILED);
  assert.equal(handoverStage(h), HANDOVER_STAGE.FAILED);
  assert.match(h.sync.note, /needs a person/);
});

// ── EDITING ONE ────────────────────────────────────────────────────────────

test('a confirmation with no source is demoted on an edit, as on creation', () => {
  // "Somebody ticked it" is not a source. This is the rule the whole record
  // rests on, and an edit path that skipped it would be the way around it.
  const h = buildHandover(ISSUED, {});
  const out = updateHandover(h, { deposit: { state: CONFIRMATION.CONFIRMED } });
  assert.equal(out.deposit.state, CONFIRMATION.UNKNOWN);
  assert.match(out.deposit.note, /no source recorded/);
  assert.equal(out.readyToBook, false);
});

test('an edit recomputes what is outstanding rather than patching it', () => {
  const h = buildHandover(ISSUED, { siteChecks: [{ what: 'Roof access' }] });
  assert.equal(h.outstanding.length, 4);
  const a = updateHandover(h, { deposit: SOURCED('Xero PMT-1') });
  assert.equal(a.outstanding.length, 3);
  const b = updateHandover(a, { siteChecks: [{ what: 'Roof access', resolved: true }] });
  assert.equal(b.outstanding.length, 2);
  assert.ok(!b.outstanding.some(o => /Roof access/.test(o)));
});

test('an edit cannot touch what was signed for', () => {
  const h = buildHandover(ISSUED, {});
  const out = updateHandover(h, {
    accepted: { totalIncGst: 1 }, id: 'something-else', scope: { inclusions: [] },
    sync: { state: HANDOVER_STATE.SYNCED, externalId: 'FAKE' },
    deposit: SOURCED('Xero PMT-1')
  });
  assert.equal(out.accepted.totalIncGst, 15716, 'the accepted total is not editable');
  assert.equal(out.id, 'tok-abc123:2', 'the id is not editable');
  assert.deepEqual(out.scope.inclusions, ISSUED.offer.inclusions);
  assert.equal(out.sync.externalId, null, 'an edit cannot invent a ServiceM8 job');
  assert.equal(handoverStage(out), HANDOVER_STAGE.PREPARED);
});

test('an edit leaves alone the facts it does not mention', () => {
  // The update endpoint is called to confirm one thing at a time. A patch that
  // reset the other two would undo work every time somebody saved.
  const h = updateHandover(buildHandover(ISSUED, {}), { deposit: SOURCED('Xero PMT-1') });
  const after = updateHandover(h, { equipment: SOURCED('On site') });
  assert.equal(after.deposit.state, CONFIRMATION.CONFIRMED);
  assert.equal(after.deposit.source, 'Xero PMT-1');
  assert.equal(after.equipment.state, CONFIRMATION.CONFIRMED);
  assert.equal(after.scheduling.state, CONFIRMATION.UNKNOWN);
});

test('not-yet and not-checked are both outstanding, and are told apart', () => {
  const h = updateHandover(buildHandover(ISSUED, {}), {
    deposit: { state: CONFIRMATION.NOT_YET, source: 'Checked Xero, nothing in' }
  });
  assert.equal(h.deposit.state, CONFIRMATION.NOT_YET);
  assert.ok(h.outstanding.some(o => /Deposit received — not yet/.test(o)));
  assert.ok(h.outstanding.some(o => /Equipment available — not checked/.test(o)));
});

// ── SITE CHECKS COME FROM THE ASSESSMENT ───────────────────────────────────

test('the sizing’s own readiness notes become site checks', () => {
  // sizingReadiness() has always produced exactly the list of things somebody
  // has to go and look at. They were shown on the sizing step and went no
  // further: the crew who turn up to install never saw them.
  const checks = siteChecksFromReadiness({ notes: [
    { code: 'ROOM_NOT_MEASURED', severity: 'CHECK', message: 'Bed 3: no dimension on file' },
    { code: 'ESTIMATES_DISAGREE', severity: 'CHECK', message: 'The two estimates are 27% apart' },
    { code: 'NOTE', severity: 'INFO', message: 'Single storey' }
  ] });
  assert.equal(checks.length, 2, 'an informational note is not a job for somebody');
  assert.equal(checks[0].resolved, false);
  assert.match(checks[0].source, /Preliminary sizing/);
  assert.match(checks[0].what, /Bed 3/);
});

test('a readiness result with nothing in it yields no site checks', () => {
  assert.deepEqual(siteChecksFromReadiness(null), []);
  assert.deepEqual(siteChecksFromReadiness({ notes: [] }), []);
});

test('outstandingOf is the one place readiness to book is decided', () => {
  assert.deepEqual(outstandingOf([], []), []);
  const out = outstandingOf([SOURCED('a'), null], [{ what: 'Switchboard', resolved: false }]);
  assert.deepEqual(out, ['Site check: Switchboard']);
});

// ── THE DATABASE HALF OF THE DUPLICATE RULE ────────────────────────────────

test('the migration refuses a second handover for one accepted revision', () => {
  // The endpoint checks before it writes, but the guarantee must not depend on
  // that code winning a race with itself. A customer DOES retry an acceptance.
  const sql = readFileSync(ROOT + '/designer/enquiries-handovers-schema.sql', 'utf8');
  assert.match(sql, /id\s+text primary key/, 'the id is the primary key');
  assert.match(sql, /unique \(quote_token, revision\)/,
    'one handover per accepted revision, enforced by the database');
  assert.match(sql, /sync_state <> 'synced' or \(external_id is not null/,
    'the database must refuse a row claiming to be synced with no job id');
});

test('there is no ServiceM8 write in the handover endpoint', () => {
  // Nick: "Do not enable ServiceM8 writes in this task." Not a disabled one,
  // not one behind a flag — none.
  const src = readFileSync(ROOT + '/server/handover.js', 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  assert.ok(!/servicem8-job|createServiceM8Job|api\.servicem8\.com/i.test(code),
    'server/handover.js must not reach ServiceM8');
  assert.ok(!/recordSync/.test(code),
    'nothing in the endpoint may write a sync outcome while ServiceM8 is off');
});
