// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD, AND THE HANDOVER
//
// Nick, 8 November 2026: one dashboard for the business, and from an accepted
// quote an internal handover — with one sentence doing most of the design
// work: "An accepted quote must not automatically imply that a deposit is
// paid, equipment is available or an installation is booked."
//
// And, on the board: "Only show financial figures that have a verified source.
// Distinguish unavailable data from zero."
//
// Those two rules are what these tests are mostly about. Everything else on
// this screen is a list.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dashboard, STAGE, TRANSITIONS, countOf, stageOfIssued, stageOfDraft }
  from '../designer/engines/workflow.mjs';
import { buildHandover, recordSync, CONFIRMATION, HANDOVER_STATE }
  from '../designer/engines/handover.mjs';

const ISSUED = {
  token: 'TOK1', quoteRevision: 1, designId: 'Q-1', proposalNumber: 'NAC-1',
  customer: { name: 'Mark Lewis', phone: '0413 207 647' },
  job: { siteAddress: '57 Cupania St, Mudjimba' },
  acceptance: { customerName: 'Mark Lewis', acceptedAt: '2026-11-01T00:00:00Z',
                totalIncGst: 15716, chosenSystemId: 'sys-b',
                selectedOptionIds: ['at5'], signature: 'sig' },
  offer: { scopeOfWork: { inclusions: ['Supply and install'], exclusions: ['Asbestos'] } }
};

// ── UNAVAILABLE IS NOT ZERO ────────────────────────────────────────────────

test('A SOURCE THAT COULD NOT BE READ IS NOT AN EMPTY LIST', () => {
  // The single most important behaviour on this screen. An empty panel reads
  // as "nothing to do". That is a different fact from "I could not look", and
  // on a board somebody runs their week off, confusing the two is how a job
  // goes quiet for a fortnight.
  assert.equal(countOf(null), null);
  assert.equal(countOf(undefined), null);
  assert.equal(countOf([]), 0);

  const blind = dashboard({ issued: null, drafts: null, enquiries: null });
  for (const key of ['enquiries', 'preparing', 'forApproval', 'awaiting', 'accepted']) {
    const p = blind.panels[key];
    assert.equal(p.available, false, key + ' claimed to be available');
    assert.equal(p.count, null, key + ' reported a count it does not have');
  }

  const empty = dashboard({ issued: [], drafts: [], enquiries: [] });
  assert.equal(empty.panels.awaiting.available, true);
  assert.equal(empty.panels.awaiting.count, 0, 'a real zero was not reported as zero');
});

test('money is null when unreadable, and never shown as $0', () => {
  const blind = dashboard({ issued: null });
  assert.equal(blind.money.issuedIncGst, null);
  assert.equal(blind.money.acceptedIncGst, null);

  const real = dashboard({ issued: [] });
  assert.equal(real.money.issuedIncGst, 0, 'nothing issued is genuinely zero');
});

test('only figures with a source are counted, and the source is named', () => {
  const board = dashboard({ issued: [
    { token: 'a', status: 'issued', issuedAt: '2026-11-01', quotedTotalIncGst: 15000 },
    // Issued, but no total on the record. It is NOT counted as zero.
    { token: 'b', status: 'issued', issuedAt: '2026-11-01', quotedTotalIncGst: null }
  ] });
  assert.equal(board.money.issuedIncGst, 15000);
  assert.equal(board.money.issuedCounted, 1, 'a quote with no figure was counted');
  assert.equal(board.panels.awaiting.count, 2, 'the quote itself should still be listed');
  const noFigure = board.panels.awaiting.rows.find(r => r.id === 'b');
  assert.equal(noFigure.totalIncGst, null);
  assert.equal(noFigure.totalSource, null);
  assert.equal(board.panels.awaiting.rows.find(r => r.id === 'a').totalSource, 'issued revision');
  assert.match(board.money.source, /Drafts are not counted/i);
});

test('a draft total never reaches the board', () => {
  // A draft total is a number somebody is still typing.
  const board = dashboard({
    issued: [],
    drafts: [{ id: 'd1', customerName: 'X', totalIncGst: 99999, gate: { ok: true } }]
  });
  assert.equal(board.money.issuedIncGst, 0);
  assert.ok(!JSON.stringify(board.money).includes('99999'));
});

// ── STAGES ─────────────────────────────────────────────────────────────────

test('an issued quote sits where its record says', () => {
  assert.equal(stageOfIssued({ status: 'issued' }), STAGE.ISSUED);
  assert.equal(stageOfIssued({ status: 'issued', acceptedAt: '2026-11-01' }), STAGE.ACCEPTED);
  assert.equal(stageOfIssued({ status: 'accepted' }), STAGE.ACCEPTED);
  for (const s of ['declined', 'expired', 'superseded', 'withdrawn']) {
    assert.equal(stageOfIssued({ status: s }), STAGE.CLOSED, s);
  }
});

test('a draft that passes its own gate is waiting on Nick, not on the estimator', () => {
  assert.equal(stageOfDraft({}, { ok: false }), STAGE.ASSESSING);
  assert.equal(stageOfDraft({}, { ok: true }), STAGE.AWAITING_APPROVAL);
  assert.equal(stageOfDraft({ approvedBy: 'nick' }, { ok: false }), STAGE.AWAITING_APPROVAL);
});

test('leaving ACCEPTED requires the three things acceptance does not prove', () => {
  const needs = TRANSITIONS[STAGE.ACCEPTED].needs.join(' | ').toLowerCase();
  assert.match(needs, /deposit/);
  assert.match(needs, /equipment/);
  assert.match(needs, /site check/);
  assert.equal(TRANSITIONS[STAGE.ACCEPTED].to, STAGE.HANDOVER);
  // And issuing still requires the approval the server enforces.
  assert.match(TRANSITIONS[STAGE.AWAITING_APPROVAL].needs.join(' ').toLowerCase(), /approval/);
});

test('what needs Nick is gathered from everywhere, with a reason on each', () => {
  const board = dashboard({
    now: Date.parse('2026-11-20T00:00:00Z'),
    issued: [
      { token: 'old', status: 'issued', issuedAt: '2026-11-01T00:00:00Z',
        customerName: 'Quiet One', quotedTotalIncGst: 1000, viewCount: 0 },
      { token: 'acc', status: 'accepted', acceptedAt: '2026-11-18T00:00:00Z',
        acceptedBy: 'Mark', acceptedTotalIncGst: 15716, revision: 1 }
    ],
    drafts: [{ id: 'd1', customerName: 'Ready One', gate: { ok: true } }],
    handovers: []
  });
  const why = board.panels.needsNick.rows.map(r => r.why);
  assert.ok(why.some(w => /approval/i.test(w)), JSON.stringify(why));
  assert.ok(why.some(w => /no answer/i.test(w)), JSON.stringify(why));
  assert.ok(why.some(w => /no handover/i.test(w)), JSON.stringify(why));
  for (const r of board.panels.needsNick.rows) assert.ok(r.why, 'an item with no reason');
});

// ── THE HANDOVER ───────────────────────────────────────────────────────────

test('ACCEPTANCE PROVES NONE OF THE THREE', () => {
  // The sentence the whole record is designed around. A customer saying yes
  // tells you they want the work. It tells you nothing about whether their
  // money arrived, whether the machine is in the country, or whether anybody
  // has a day free.
  const h = buildHandover(ISSUED, { preparedBy: 'nick' });
  assert.equal(h.deposit.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.equipment.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.scheduling.state, CONFIRMATION.UNKNOWN);
  assert.equal(h.readyToBook, false, 'an accepted quote was treated as bookable');
  assert.equal(h.outstanding.length, 3);
  // And it is not in ServiceM8.
  assert.equal(h.sync.state, HANDOVER_STATE.PREPARED);
  assert.equal(h.sync.externalId, null);
  assert.match(h.sync.note, /Not sent to ServiceM8/i);
});

test('a confirmation with no source is not a confirmation', () => {
  const h = buildHandover(ISSUED, { deposit: { state: 'confirmed' } });
  assert.equal(h.deposit.state, CONFIRMATION.UNKNOWN);
  assert.match(h.deposit.note, /no source/i);

  const real = buildHandover(ISSUED, {
    deposit: { state: 'confirmed', source: 'Xero payment 4821', at: '2026-11-02' } });
  assert.equal(real.deposit.state, CONFIRMATION.CONFIRMED);
  assert.equal(real.deposit.source, 'Xero payment 4821');
});

test('ready to book only when nothing at all is outstanding', () => {
  const h = buildHandover(ISSUED, {
    deposit: { state: 'confirmed', source: 'Xero 1' },
    equipment: { state: 'confirmed', source: 'MMEM order 9912' },
    scheduling: { state: 'confirmed', source: 'Booked 20 Nov' },
    siteChecks: [{ what: 'Roof access', resolved: true }]
  });
  assert.equal(h.readyToBook, true);
  assert.deepEqual(h.outstanding, []);

  // One unresolved site check is enough to stop it.
  const blocked = buildHandover(ISSUED, {
    deposit: { state: 'confirmed', source: 'Xero 1' },
    equipment: { state: 'confirmed', source: 'MMEM' },
    scheduling: { state: 'confirmed', source: 'Booked' },
    siteChecks: [{ what: 'Roof access above the hall', resolved: false }]
  });
  assert.equal(blocked.readyToBook, false);
  assert.match(blocked.outstanding[0], /Roof access/);
});

test('it carries what was SIGNED FOR, off the frozen revision', () => {
  const h = buildHandover(ISSUED, {});
  assert.equal(h.accepted.totalIncGst, 15716);
  assert.equal(h.accepted.chosenSystemId, 'sys-b');
  assert.deepEqual(h.accepted.selectedOptionIds, ['at5']);
  assert.equal(h.accepted.signed, true);
  assert.deepEqual(h.scope.inclusions, ['Supply and install']);
  // Keyed on token AND revision: a second revision is a different offer and
  // gets its own handover rather than overwriting the first.
  assert.equal(h.id, 'TOK1:1');
  assert.equal(buildHandover({ ...ISSUED, quoteRevision: 2 }, {}).id, 'TOK1:2');
});

test('retries are bounded and failure stays visible', () => {
  const h = buildHandover(ISSUED, {});
  let s = recordSync(h, { ok: false, error: 'ServiceM8 timed out' });
  assert.equal(s.sync.state, HANDOVER_STATE.PENDING_SYNC);
  assert.equal(s.sync.attempts, 1);
  assert.equal(s.sync.lastError, 'ServiceM8 timed out');

  // An "ok" with no job id is NOT a success. Something answered; nothing
  // was created, and calling that synced is how a job never gets booked.
  s = recordSync(s, { ok: true });
  assert.notEqual(s.sync.state, HANDOVER_STATE.SYNCED);
  assert.match(s.sync.lastError, /no job id/i);

  s = recordSync(s, { ok: false, error: 'again' });
  assert.equal(s.sync.state, HANDOVER_STATE.FAILED, 'it kept retrying forever');
  assert.match(s.sync.note, /needs a person/i);

  // The one way to be synced.
  const good = recordSync(h, { ok: true, externalId: 'SM8-4421' });
  assert.equal(good.sync.state, HANDOVER_STATE.SYNCED);
  assert.equal(good.sync.externalId, 'SM8-4421');
});

test('an accepted job with no handover is flagged, not assumed fine', () => {
  const board = dashboard({
    now: Date.parse('2026-11-20T00:00:00Z'),
    issued: [{ token: 'TOK1', revision: 1, status: 'accepted',
               acceptedAt: '2026-11-18T00:00:00Z', acceptedBy: 'Mark',
               acceptedTotalIncGst: 15716 }],
    handovers: []
  });
  const row = board.panels.accepted.rows[0];
  assert.equal(row.handover, null);
  assert.match(row.action, /Prepare the handover/i);
  assert.deepEqual(row.outstanding, ['No handover prepared yet']);
});
