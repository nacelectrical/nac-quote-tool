// ─────────────────────────────────────────────────────────────────────────────
// A QUOTE WITH NO DUCT DESIGN, ALL THE WAY THROUGH A REAL DATABASE
//
// Nick, 16 October 2026: "Make the quote journey work from end to end: create
// quote, enter scope and equipment, select options, preview, save, issue a
// customer link, customer chooses options, customer accepts, acceptance saved
// and visible to NAC... Report success only after the database confirms it was
// saved."
//
// tests/quote-only.test.mjs proves the engines. This proves the PLUMBING: a
// quote draft saved into nac_designs exactly as the builder saves it, issued
// through the real endpoint, opened through the real endpoint, changed and
// accepted by the customer, and then read back out of PostgreSQL.
//
// Everything that makes an issued quote trustworthy has to hold here too, and
// for the same reasons it holds for a designed job: the offer is frozen at
// issue, a later edit to the draft cannot reach it, and the accepted total is
// the total the customer was shown.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { startRest, reset, sql, row } from './helpers/pg-rest.mjs';
import { quoteOnlyDraft, UPGRADES, SETTINGS } from './fixtures/quote-only.mjs';
import { NAC_TRUST, seedTermsAndConditions } from '../designer/engines/presentation-content.mjs';

const HAVE_PG = existsSync('/usr/lib/postgresql/16/bin/psql');
const DESIGN_ID = 'Q-TEST-0001';
const STAFF = { Authorization: 'Bearer test-staff-token' };
// ── EVERY ISSUE CARRIES AN APPROVAL ─────────────────────────────────────────
// Nick, 4 November 2026: "Nick approves the exact quote revision before it is
// sent." The server refuses an issue with no approver recorded, so every issue
// in this suite carries one, and one test below proves the refusal.
const APPROVER = 'nick@nacelectrical.com.au';


const CONTENT = {
  trust: { ...NAC_TRUST },
  termsAndConditions: seedTermsAndConditions(null, NAC_TRUST),
  reviews: [], installations: [], images: [],
  standardInclusions: { commissioning: true, wasteRemoval: true, wifi: false },
  upgrades: UPGRADES
};

function call(handler, { method = 'GET', query = {}, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(v) { resolve({ status: this.statusCode, body: v }); return this; },
      send(v) { resolve({ status: this.statusCode, body: v }); return this; },
      setHeader() { return this; }
    };
    Promise.resolve(handler({ method, query, body, headers }, res)).catch(
      (e) => resolve({ status: 500, body: { error: 'threw', message: e.message } }));
  });
}

/** Save the draft the way designer/engines/store.mjs saveDesign saves it. */
function saveDraft(draft) {
  const json = JSON.stringify({ ...draft, updatedAt: '2026-10-16T01:00:00Z' })
    .replace(/\$nacjson\$/g, '');
  sql("insert into public.nac_designs (id, customer_name, customer_address, status, "
    + "design, updated_at) values ('" + draft.id + "', "
    + "$nacjson$" + draft.customer.name + "$nacjson$, "
    + "$nacjson$" + draft.siteAddress + "$nacjson$, 'draft', "
    + "$nacjson$" + json + "$nacjson$, '2026-10-16T01:00:00Z') "
    + "on conflict (id) do update set design = excluded.design, "
    + "updated_at = excluded.updated_at");
}

async function setup(over = {}) {
  reset();
  process.env.SUPABASE_KEY = 'test-service-key';
  // ── THE OWNER, FOR THE ISSUE GATE ────────────────────────────────────────
  //
  // Added 8 November 2026. Issuing a customer quote now needs the ISSUE_QUOTE
  // capability rather than only a sign-in: the thing being approved is a price
  // and the approval is Nick's by his own rule. This suite acts as the owner,
  // so it names the signed-in account in the deployment allowlist — the same
  // one variable production needs set.
  process.env.NAC_OWNER_EMAILS = 'nick@nacelectrical.com.au';
  globalThis.fetch = async (url, opts) => {
    const auth = (opts && opts.headers && opts.headers.Authorization) || '';
    if (!String(url).includes('/auth/v1/user')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (auth === 'Bearer test-staff-token') {
      return { ok: true, json: async () => ({ id: 'u1', email: 'nick@nacelectrical.com.au' }) };
    }
    return { ok: false, status: 401, json: async () => ({}) };
  };

  const draft = quoteOnlyDraft({ id: DESIGN_ID, testQuote: true, ...over });
  saveDraft(draft);
  sql("insert into public.nac_presentation_content (key, data, updated_at) values "
    + "('library', $nacjson$" + JSON.stringify(CONTENT) + "$nacjson$::jsonb, "
    + "'2026-10-16T01:00:00Z')");
  sql("insert into public.nac_settings (key, value, updated_at) values "
    + "('nac_hvac_settings_v1', $nacjson$" + JSON.stringify(SETTINGS) + "$nacjson$, "
    + "'2026-10-16T01:00:00Z')");
  return { draft };
}

const handlers = async () => ({
  issue: (await import('../server/quote-issue.js')).default,
  view: (await import('../server/quote-view.js')).default,
  respond: (await import('../server/quote-respond.js')).default,
  list: (await import('../server/quote-list.js')).default
});

const issueBody = (draft, extra = {}) => ({
  designId: draft.id, customer: draft.customer, approvedBy: APPROVER,
  job: { siteAddress: draft.siteAddress },
  proposalNumber: draft.proposalNumber, quoteRevision: 1, validDays: 30,
  intro: draft.intro, testQuote: true, ...extra
});

// ── THE JOURNEY ─────────────────────────────────────────────────────────────

test('a quote with no duct design is issued, chosen, accepted and read back',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();

    // ── ISSUE ────────────────────────────────────────────────────────────
    // The systems, the chosen one and the upgrade selections are all IN the
    // draft, so the request does not have to re-send what it just saved.
    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 200, 'issue failed: ' + JSON.stringify(issued.body));
    const token = issued.body.token;
    assert.ok(token && token.length >= 32, 'no usable token');

    const stored = row("select token, status, quote_rev, data from public.nac_quote_issues "
      + "where token = '" + token + "'");
    assert.equal(stored.status, 'issued');
    assert.equal(stored.data.offer.schema, 'nac.offer.v1');
    assert.deepEqual(stored.data.offer.systemIds.sort(), ['sys-a', 'sys-b']);
    assert.equal(stored.data.offer.source.designId, DESIGN_ID);

    // ── OPEN ─────────────────────────────────────────────────────────────
    const opened = await call(h.view, { method: 'GET', query: { token } });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const p = opened.body.presentation;
    assert.equal(p.systemChoice.chosenId, 'sys-a');
    // The Daikin, plus the AirTouch and four sensors the estimator selected.
    assert.equal(p.investment.totalIncGst, 17817);
    assert.equal(p.hero.customerName, draft.customer.name);
    assert.equal(p.hero.siteAddress, draft.siteAddress);
    assert.equal(p.testQuote, true, 'a test quote went out unlabelled');
    // The estimator's own scope reached the customer.
    assert.deepEqual(p.scopeOfWork.inclusions, draft.inclusions);
    assert.deepEqual(p.scopeOfWork.exclusions, draft.exclusions);
    // And no duct design was invented to get there.
    assert.equal(p.coverage.provisional, true);

    // ── CHOOSE ───────────────────────────────────────────────────────────
    // The Braemar. The AirTouch is Daikin-only, so it comes off, and with it
    // the sensors — the customer cannot carry a Daikin kit onto a Braemar.
    const chose = await call(h.respond, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b', selectedOptionIds: [] } });
    assert.equal(chose.status, 200, JSON.stringify(chose.body));
    assert.equal(chose.body.totalIncGst, 14553);
    assert.equal(chose.body.chosenSystemId, 'sys-b');

    // Back to the Daikin with both upgrades.
    const back = await call(h.respond, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-a',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }] } });
    assert.equal(back.body.totalIncGst, 17817);
    assert.equal(back.body.deposit.amount, Math.round(17817 * 50) / 100);

    // ── ACCEPT ───────────────────────────────────────────────────────────
    const accepted = await call(h.respond, { method: 'POST',
      body: { token, action: 'accept', customerName: draft.customer.name,
              acknowledgedTerms: true } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.status, 'accepted');
    assert.equal(accepted.body.acceptedTotal, 17817);

    // ── THE RECORD, OUT OF POSTGRESQL ────────────────────────────────────
    const rec = row("select status, responded_at, data from public.nac_quote_issues "
      + "where token = '" + token + "'");
    assert.equal(rec.status, 'accepted');
    assert.ok(rec.responded_at, 'responded_at was not written to its own column');
    const acc = rec.data.acceptance;
    assert.equal(acc.customerName, draft.customer.name);
    assert.equal(acc.acknowledgedTerms, true);
    assert.equal(acc.totalIncGst, 17817);
    assert.equal(acc.chosenSystemId, 'sys-a');
    assert.equal(acc.quoteRevision, 1);
    assert.ok(acc.acceptedAt, 'the acceptance carries no timestamp');
    assert.deepEqual(acc.selectedOptionIds.sort(), ['at5', 'sensor']);
    assert.equal(acc.selectedOptions.find(o => o.id === 'sensor').quantity, 4);

    // ── VISIBLE TO NAC ───────────────────────────────────────────────────
    const listed = await call(h.list, { method: 'GET', headers: STAFF, query: {} });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const mine = listed.body.quotes.find(q => q.designId === DESIGN_ID);
    assert.ok(mine, 'the quote is not in the portal');
    assert.equal(mine.status, 'accepted');
    assert.equal(mine.acceptedTotalIncGst, 17817);
    assert.equal(mine.acceptedBy, draft.customer.name);
    // The portal never hands back the frozen offer or the signature image.
    assert.equal(mine.offer, undefined);
    assert.equal(mine.signature, undefined);
  });

// ── THE OFFER IS FROZEN, ON A QUOTE-ONLY JOB TOO ────────────────────────────

test('editing the draft after issue does not change the issued quote',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();

    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const token = issued.body.token;

    // The estimator puts the price up $5,000, deletes two rooms and rewrites
    // the exclusions. The link a customer is holding must not move.
    const edited = {
      ...draft,
      systems: draft.systems.map(s => s.id === 'sys-a'
        ? { ...s, priceIncGst: s.priceIncGst + 5000 } : s),
      scope: { ...draft.scope,
               conditionedRooms: draft.scope.conditionedRooms.slice(0, 5),
               outletCount: 8, zoneCount: 4 },
      exclusions: ['Everything.']
    };
    saveDraft(edited);

    const opened = await call(h.view, { method: 'GET', query: { token } });
    const p = opened.body.presentation;
    assert.equal(p.investment.totalIncGst, 17817, 'the issued price moved');
    assert.equal(p.coverage.rooms.length, 7, 'rooms were removed from an issued quote');
    assert.deepEqual(p.scopeOfWork.exclusions, draft.exclusions,
      'the exclusions on an issued quote were rewritten');

    // And the customer can still accept what they were actually offered.
    const accepted = await call(h.respond, { method: 'POST',
      body: { token, action: 'accept', customerName: draft.customer.name,
              acknowledgedTerms: true } });
    assert.equal(accepted.body.acceptedTotal, 17817);

    // The new price only reaches a NEW revision.
    const rev2 = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(edited, { quoteRevision: 2, supersedes: token }) });
    assert.equal(rev2.status, 200, JSON.stringify(rev2.body));
    const opened2 = await call(h.view, { method: 'GET', query: { token: rev2.body.token } });
    assert.equal(opened2.body.presentation.investment.totalIncGst, 22817);
  });

// ── WHAT IS STILL REFUSED AT THE SERVER ─────────────────────────────────────

test('a draft that does not pass its own gate is refused by the server',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    // No inclusions: a customer accepting this would not know what is in it.
    const { draft } = await setup({ inclusions: [] });
    const h = await handlers();

    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 409, JSON.stringify(issued.body));
    assert.ok(issued.body.blockers.some(b => b.code === 'DRAFT_NO_SCOPE'),
      JSON.stringify(issued.body.blockers));

    // And nothing was written.
    const any = row("select count(*)::int as n from public.nac_quote_issues");
    assert.equal(any.n, 0, 'a refused quote still created an issue row');
  });

test('a price of zero is refused by the server, not just by the screen',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const base = quoteOnlyDraft();
    const { draft } = await setup({
      systems: base.systems.map(s => s.id === 'sys-a' ? { ...s, priceIncGst: 0 } : s) });
    const h = await handlers();
    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 409, JSON.stringify(issued.body));
    assert.ok(issued.body.blockers.some(b => b.code === 'DRAFT_BAD_PRICE'));
  });

test('an upgrade that does not fit the quoted system is refused at issue',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    // Quoted on the Braemar with the Daikin-only AirTouch still selected.
    const { draft } = await setup({ chosenSystemId: 'sys-b' });
    const h = await handlers();
    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 409, JSON.stringify(issued.body));
    assert.ok(issued.body.blockers.some(b => b.code === 'DRAFT_OPTION_INCOMPATIBLE'));
  });

test('a quote-only job still cannot be issued without a signed-in estimator',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();
    const issued = await call(h.issue, { method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token' }, body: issueBody(draft) });
    assert.ok(issued.status === 401 || issued.status === 403, 'status ' + issued.status);
    assert.equal(row("select count(*)::int as n from public.nac_quote_issues").n, 0);
  });

// ── THE APPROVAL IS NOT DECORATION ──────────────────────────────────────────
//
// Nick, 4 November 2026: "Nick approves the exact quote revision before it is
// sent." The builder has always had the tick; the server dropped it, so no
// issued quote carried any record of who approved it and the control existed
// only on a screen. These two prove it survives the round trip.

test('a quote with nobody recorded as approving it is refused',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();

    const body = issueBody(draft);
    delete body.approvedBy;
    const out = await call(h.issue, { method: 'POST', headers: STAFF, body });
    assert.equal(out.status, 409);
    assert.equal(out.body.error, 'approval_required');
    assert.match(out.body.message, /tick the approval/);

    const issues = row('select count(*)::int as n from public.nac_quote_issues');
    assert.equal(issues.n, 0, 'A refused issue must mint no token at all.');
  });

test('the approval is frozen onto the issued offer, with a fingerprint of it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();

    const out = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft, { approvedAt: '2026-11-04T09:30:00Z' }) });
    assert.equal(out.status, 200, JSON.stringify(out.body));

    const stored = row("select data from public.nac_quote_issues where token = '"
      + out.body.token + "'");
    assert.equal(stored.data.approvedBy, APPROVER);
    assert.equal(stored.data.approvedAt, '2026-11-04T09:30:00Z');
    assert.match(stored.data.offerFingerprint, /^[0-9a-f]{16}$/,
      'The exact offer that was approved has to be identifiable afterwards.');
  });

// ── SECTION 8: WHAT AN ISSUED OFFER IS PROOF AGAINST ────────────────────────
//
// Nick, 4 November 2026: "Freeze the exact offer at issue... Calculate totals
// on the server from saved prices... Switching equipment must remove
// incompatible upgrades and their charges... Later catalogue, job or content
// changes must not change an issued offer."
//
// The screen already refuses these. These are about the SERVER refusing them,
// because the screen is the half a customer can edit.

test('switching system on the issued page drops an upgrade that does not fit it',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();

    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const token = issued.body.token;

    // On the Daikin, with the Daikin-only AirTouch selected, the total is the
    // issued one.
    const onDaikin = await call(h.respond, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-a',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }] } });
    assert.equal(onDaikin.status, 200, JSON.stringify(onDaikin.body));
    assert.equal(onDaikin.body.totalIncGst, 17817);

    // Switch to the Braemar. The AirTouch and its sensors only fit a Daikin,
    // so they come off — and so do their charges. Nobody pays $1,350 for a
    // controller that cannot go on the system they chose.
    const onBraemar = await call(h.respond, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-b',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }] } });
    assert.equal(onBraemar.status, 200, JSON.stringify(onBraemar.body));
    assert.equal(onBraemar.body.totalIncGst, 14553,
      'the Braemar price alone — the Daikin-only upgrades and their charges are gone');
    assert.deepEqual(onBraemar.body.selectedOptionIds, [],
      'an upgrade that cannot go on the chosen system is not carried along');

    // And the record agrees: the server, not the page, decided this.
    const rec = row("select data from public.nac_quote_issues where token = '"
      + token + "'");
    assert.equal(rec.data.chosenSystemId, 'sys-b');
    assert.deepEqual(rec.data.selectedOptionIds, []);
  });

test('an accepted total cannot be dictated by the page',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();
    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    const token = issued.body.token;

    // A figure in the body is not an instruction. The server prices the
    // selection from the frozen copy and ignores whatever the page sent.
    const ignored = await call(h.respond, { method: 'POST',
      body: { token, action: 'options', chosenSystemId: 'sys-a',
              selectedOptionIds: ['at5', { id: 'sensor', quantity: 4 }],
              totalIncGst: 1, priceIncGst: 1, deposit: 1 } });
    assert.equal(ignored.status, 200, JSON.stringify(ignored.body));
    assert.equal(ignored.body.totalIncGst, 17817,
      'a total sent by the page was treated as the price');

    // And where the page STATES the figure it is showing, a disagreement is
    // refused rather than resolved in silence: a customer must not accept
    // believing one number while another is recorded.
    const stale = await call(h.respond, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Test Quote — do not send',
              acknowledgedTerms: true, expectedTotalIncGst: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.state, 'total_mismatch');
    assert.equal(stale.body.totalIncGst, 17817,
      'the server says what the figure actually is');

    const rec = row("select status, data from public.nac_quote_issues where token = '"
      + token + "'");
    assert.equal(rec.status, 'issued', 'nothing was accepted');
    assert.ok(!rec.data.acceptance, 'an acceptance was recorded anyway');
  });

test('changing the content library after issue does not change the issued offer',
  { skip: !HAVE_PG && 'needs PostgreSQL' }, async (t) => {
    const stop = await startRest();
    t.after(() => stop());
    const { draft } = await setup();
    const h = await handlers();
    const issued = await call(h.issue, { method: 'POST', headers: STAFF,
      body: issueBody(draft) });
    const token = issued.body.token;
    const before = await call(h.view, { method: 'GET', query: { token } });
    const beforeTotal = before.body.presentation.investment.totalIncGst;

    // Nick doubles the price of an upgrade in the library and rewrites the
    // terms. An offer already in a customer's hands is not touched by either.
    const changed = {
      ...CONTENT,
      upgrades: UPGRADES.map(u => ({ ...u,
        priceIncGst: u.priceIncGst ? u.priceIncGst * 2 : u.priceIncGst,
        unitPriceIncGst: u.unitPriceIncGst ? u.unitPriceIncGst * 2 : u.unitPriceIncGst })),
      termsAndConditions: { version: 'REWRITTEN', clauses: [] }
    };
    sql("update public.nac_presentation_content set data = $nacjson$"
      + JSON.stringify(changed) + "$nacjson$::jsonb where key = 'library'");

    const after = await call(h.view, { method: 'GET', query: { token } });
    assert.equal(after.body.presentation.investment.totalIncGst, beforeTotal,
      'a library edit reached a quote that had already gone out');
    assert.ok(!JSON.stringify(after.body.presentation).includes('REWRITTEN'),
      'the terms the customer is accepting were rewritten underneath them');

    // And the figure they can still accept is the one they were issued.
    const accepted = await call(h.respond, { method: 'POST',
      body: { token, action: 'accept', customerName: 'Test Quote — do not send',
              acknowledgedTerms: true } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.acceptedTotal, beforeTotal);
  });
