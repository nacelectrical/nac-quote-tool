// ─────────────────────────────────────────────────────────────────────────────
// THE PODIUM MANUAL WORKFLOW
//
// Nick, 4 November 2026: "Clearly distinguish a copied link from a message
// successfully sent." And: "Do not invent Podium endpoints or claim
// integration is working." And: "Do not let both applications send duplicate
// follow-ups." And: "Keep automatic sending disabled until configured and
// tested. Do not send real customer messages during development."
//
// These are tests of RESTRAINT. Most of them prove that nothing goes out:
// that a link on a clipboard is not a message, that an answered offer stops
// being chased, that an opt-out cannot be undone by a resume button, and that
// this application neither sends nor schedules anything at all.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTOMATIC_SENDING, SCHEDULING_OWNER, OUTREACH, NO_FOLLOW_UP,
         normaliseOutreach, recordOutreach, resumeOutreach, followUpState,
         quoteMessage, INTEGRATION_BOUNDARY } from '../designer/engines/podium.mjs';

const NOW = '2026-11-04T09:00:00Z';
const days = (n, from = NOW) =>
  new Date(Date.parse(from) + n * 86400000).toISOString();

/** An issued quote, live, nothing answered yet. */
const ISSUED = {
  status: 'issued',
  expiresAt: days(30),
  customerName: 'Test Customer (TEST — do not contact)',
  customerPhone: '0400 000 000',
  siteAddress: '12 Example Street, Example QLD',
  url: 'https://nac-quote-tool.vercel.app/q/TESTTOKEN'
};

// ── NOTHING GOES OUT ─────────────────────────────────────────────────────────

test('this application sends nothing automatically', () => {
  assert.equal(AUTOMATIC_SENDING, false,
    'Automatic sending must stay off until Podium is configured and tested.');
});

test('nobody has claimed follow-up scheduling yet', () => {
  assert.equal(SCHEDULING_OWNER, 'undecided',
    'Two systems that both think they own scheduling will both send.');
});

test('no Podium request exists anywhere in the engine', async () => {
  const src = await (await import('node:fs/promises')).readFile(
    new URL('../designer/engines/podium.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'podium.com', 'api.podium',
                           'https://']) {
    assert.ok(!src.includes(forbidden),
      'The Podium engine must not contain "' + forbidden + '" — there is no verified API.');
  }
});

// ── A COPIED LINK IS NOT A SENT MESSAGE ──────────────────────────────────────

test('copying the link is recorded as copying the link, not as sending it', () => {
  const o = recordOutreach(null, { state: OUTREACH.LINK_COPIED, by: 'nick', at: NOW });
  assert.equal(o.state, OUTREACH.LINK_COPIED);
  assert.equal(o.linkCopiedAt, NOW);
  assert.equal(o.sentAt, null, 'Nothing was sent, so there is no sent time.');
});

test('a copied link is never followed up, because nobody sent it', () => {
  const o = recordOutreach(null, { state: OUTREACH.LINK_COPIED, at: days(-20) });
  const f = followUpState(ISSUED, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.NEVER_SENT);
  assert.match(f.message, /copied but nobody has recorded sending it/);
});

test('recording a manual send starts the clock, and says who and how', () => {
  let o = recordOutreach(null, { state: OUTREACH.LINK_COPIED, at: days(-9) });
  o = recordOutreach(o, { state: OUTREACH.SENT_MANUALLY, by: 'nick',
    channel: 'Podium SMS', at: days(-9) });
  assert.equal(o.state, OUTREACH.SENT_MANUALLY);
  assert.equal(o.sentAt, days(-9));
  assert.equal(o.sentBy, 'nick');
  assert.equal(o.channel, 'Podium SMS');
  assert.equal(o.linkCopiedAt, days(-9), 'The earlier copy is still on the record.');
});

test('copying the link again does not demote a quote that was already sent', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-9) });
  o = recordOutreach(o, { state: OUTREACH.LINK_COPIED, at: days(-1) });
  assert.equal(o.state, OUTREACH.SENT_MANUALLY, 'Still sent.');
  assert.equal(o.linkCopiedAt, days(-1));
});

// ── WHEN A FOLLOW-UP IS DUE, AND EVERY REASON IT IS NOT ──────────────────────

test('a sent, unanswered quote comes due after the configured wait', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-4) });
  const early = followUpState(ISSUED, o, { now: NOW, afterDays: 7 });
  assert.equal(early.due, false);
  assert.equal(early.reason, NO_FOLLOW_UP.NOT_DUE_YET);

  const now = followUpState(ISSUED, o, { now: NOW, afterDays: 3 });
  assert.equal(now.due, true);
  assert.equal(now.reason, null);
  assert.match(now.message, /not answered/);
});

test('the clock restarts from the last follow-up, not from the first send', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  o = { ...o, lastFollowUpAt: days(-1), followUpCount: 1 };
  const f = followUpState(ISSUED, o, { now: NOW, afterDays: 3 });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.NOT_DUE_YET);
});

test('an accepted quote is never chased again', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  const f = followUpState({ ...ISSUED, status: 'accepted' }, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.ACCEPTED);
  assert.match(f.message, /booking and the deposit/);
});

test('a declined quote is never chased again', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  const f = followUpState({ ...ISSUED, status: 'declined' }, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.DECLINED);
});

test('an expired quote is not chased — a new revision is issued instead', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-60) });
  const f = followUpState({ ...ISSUED, expiresAt: days(-10) }, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.EXPIRED);
});

test('a superseded revision hands the follow-up to the one that replaced it', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  const f = followUpState({ ...ISSUED, supersededBy: 'rev-3' }, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.SUPERSEDED);
});

test('a withdrawn quote is not chased', () => {
  const o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  const f = followUpState({ ...ISSUED, status: 'revoked' }, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.REVOKED);
});

// ── A CUSTOMER WHO REPLIES IS NOT A CUSTOMER TO CHASE ────────────────────────

test('a customer reply pauses follow-up and says why', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  o = recordOutreach(o, { state: OUTREACH.CUSTOMER_REPLIED, at: days(-1) });
  assert.equal(o.paused, true);
  const f = followUpState(ISSUED, o, { now: NOW });
  assert.equal(f.due, false);
  assert.equal(f.reason, NO_FOLLOW_UP.PAUSED);
  assert.match(f.message, /customer replied/);
});

test('Nick taking it over pauses follow-up', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  o = recordOutreach(o, { state: OUTREACH.TAKEN_OVER, by: 'nick', at: days(-1) });
  assert.equal(o.paused, true);
  assert.equal(followUpState(ISSUED, o, { now: NOW }).reason, NO_FOLLOW_UP.PAUSED);
});

test('a pause can be lifted deliberately, and the history keeps both', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  o = recordOutreach(o, { state: OUTREACH.CUSTOMER_REPLIED, at: days(-9) });
  const r = resumeOutreach(o, { by: 'nick', at: days(-8) });
  assert.equal(r.ok, true);
  assert.equal(r.outreach.paused, false);
  assert.equal(r.outreach.events.length, 3, 'sent, replied, resumed — all three kept.');
  assert.equal(followUpState(ISSUED, r.outreach, { now: NOW, afterDays: 3 }).due, true);
});

test('an opt-out cannot be resumed by anybody', () => {
  let o = recordOutreach(null, { state: OUTREACH.SENT_MANUALLY, at: days(-20) });
  o = recordOutreach(o, { state: OUTREACH.OPTED_OUT, at: days(-9) });
  const r = resumeOutreach(o, { by: 'nick' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'opted_out');
  assert.equal(followUpState(ISSUED, o, { now: NOW }).reason, NO_FOLLOW_UP.OPTED_OUT);
});

// ── THE MESSAGE ──────────────────────────────────────────────────────────────

test('the message carries the real link and nothing it cannot stand behind', () => {
  const m = quoteMessage(ISSUED, { brand: { businessName: 'NAC Electrical Air & Refrigeration',
    phone: '0400 000 000' } });
  assert.equal(m.kind, 'first');
  assert.ok(m.body.includes(ISSUED.url), 'The customer link must be in the message.');
  assert.ok(m.body.includes('NAC Electrical Air & Refrigeration'));
  assert.match(m.note, /Nothing is sent by this application/);
  // No price, no capacity, no model: the proposal is the offer, and a message
  // that summarises it is a second version of it that nobody is checking.
  assert.ok(!/\$/.test(m.body), 'No price in the message.');
  assert.ok(!/\bkW\b/.test(m.body), 'No capacity in the message.');
});

test('the follow-up message reads as a follow-up, not as a first send', () => {
  const m = quoteMessage(ISSUED, { kind: 'follow_up' });
  assert.equal(m.kind, 'follow_up');
  assert.match(m.body, /following up/i);
  assert.ok(m.body.includes(ISSUED.url));
});

test('the message uses the first name, and copes when there is not one', () => {
  assert.match(quoteMessage({ ...ISSUED, customerName: 'Jane Smith' }).body, /^Hi Jane,/);
  assert.match(quoteMessage({ ...ISSUED, customerName: '' }).body, /^Hi there,/);
});

// ── THE SEAM ─────────────────────────────────────────────────────────────────

test('the integration boundary names stable ids and keeps the token out of events', () => {
  const b = INTEGRATION_BOUNDARY;
  for (const id of ['customerId', 'quoteId', 'revision', 'issueToken']) {
    assert.ok(b.identifiers[id], id + ' must be documented.');
  }
  assert.match(b.identifiers.issueToken, /never put in a log or a webhook/);
  for (const e of ['quote.issued', 'quote.accepted', 'quote.declined',
                   'quote.expired', 'quote.superseded']) {
    assert.ok(b.events.includes(e), e + ' must be an emitted event.');
  }
  assert.ok(b.required.length >= 5,
    'What is still unknown about Podium has to be written down, not guessed.');
  assert.ok(b.required.some(r => /sandbox|test/i.test(r)),
    'A test inbox is required: no proving this against a real customer.');
});
