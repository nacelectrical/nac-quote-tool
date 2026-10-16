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
  designId: draft.id, customer: draft.customer,
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
